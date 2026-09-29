import { homedir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { scan, Environment } from './environments.js';
import { loadCatalog, parseOutdated, ToolItem, SkillItem } from './catalog.js';
import { computeLayout } from './layout.js';
import { render } from './render.js';
import { createEnvironment, readSettings, updateEnvironment, deleteEnvironment, type CreateRequest } from './create.js';
import { AppState, initialState, Key, reducer } from './state.js';
import { createTerm, Term } from './terminal.js';

function defaultAgentDir(): string {
  return process.env.PI_CODING_AGENT_DIR ?? join(homedir(), '.pi', 'agent');
}

/**
 * Запускает pi в окружении, передав ему терминал.
 * ponytail: кодов выхода не различаем — любой exit означает возврат в TUI.
 */
function launchPi(term: Term, env: Environment): Promise<{ ok: boolean; message: string }> {
  return new Promise((resolve) => {
    term.stop();
    let done = false;
    const finish = (ok: boolean, message: string) => {
      if (done) return;
      done = true;
      term.start();
      resolve({ ok, message });
    };
    const child = spawn('pi', [], {
      cwd: process.cwd(),
      env: { ...process.env, PI_CODING_AGENT_DIR: env.path },
      stdio: 'inherit',
    });
    child.on('error', (e: Error) => finish(false, `Не удалось запустить pi: ${e.message}`));
    child.on('exit', () => finish(true, ''));
  });
}

/** Запускает команду, собирает stdout/stderr; таймаут — убийство процесса. */
function runCmd(
  cmd: string,
  args: string[],
  timeoutMs: number,
  opts: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    let done = false;
    let stdout = '';
    let stderr = '';
    let timer: NodeJS.Timeout | undefined;
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      resolve({ ok, stdout, stderr });
    };
    const child = spawn(cmd, args, { cwd: opts.cwd, env: opts.env });
    child.on('error', () => finish(false));
    child.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    child.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
    child.on('exit', (code) => finish(code === 0));
    timer = setTimeout(() => { child.kill(); finish(false); }, timeoutMs);
  });
}

/**
 * Цикл приложения: чтение клавиши → reducer → отрисовка.
 * Побочные эффекты: отправка формы (submitting) — createEnvironment/updateEnvironment,
 * удаление (deleting) — deleteEnvironment, запуск (sub 'run') — дочерний pi.
 */
export async function run(root: string): Promise<void> {
  const term: Term = createTerm();
  const agentDir = defaultAgentDir();
  let catalog = loadCatalog(agentDir);
  let state: AppState = initialState(catalog);
  let statusMsg: string | null = null;

  function load(): { envs: Environment[]; status: string | null } {
    const scanned = scan(root);
    if (scanned === null) {
      return { envs: [], status: `Окружения не найдены в ${root}` };
    }
    return { envs: scanned, status: null };
  }

  function twoColumns(): boolean {
    return computeLayout({ width: term.width(), height: term.height() }).twoColumns;
  }

  /** npm outdated в каталоге npm main-агента → карта имени → latest. */
  async function checkUpdates(): Promise<void> {
    state = { ...state, pkgCheck: 'checking' };
    const names = load().envs.map((e) => e.name);
    const raw = await runCmd('npm', ['outdated', '--json', '--prefix', join(agentDir, 'npm')], 10_000);
    state = reducer(state, { type: 'updates-result', ok: raw.ok, latest: parseOutdated(raw.stdout) }, names, twoColumns());
    repaint();
  }

  /** pi update --extensions: обновление всех установленных пакетов. */
  async function doUpdateAll(): Promise<void> {
    const names = load().envs.map((e) => e.name);
    const r = await runCmd('pi', ['update', '--extensions'], 5 * 60_000, {
      cwd: process.cwd(),
      env: { ...process.env, PI_CODING_AGENT_DIR: agentDir, NO_COLOR: '1' },
    });
    if (r.ok) statusMsg = 'Расширения обновлены';
    state = reducer(state, { type: 'update-result', ok: r.ok, message: r.ok ? 'Расширения обновлены' : r.stderr || 'ошибка обновления' }, names, twoColumns());
    if (r.ok) {
      try {
        catalog = loadCatalog(agentDir);
        state = { ...state, catalog };
      } catch { /* каталог не перечитан — остаётся старый */ }
      void checkUpdates();
    }
    repaint();
  }

  /** pi remove <source>: полное удаление пакета из main-агента. */
  async function doRemove(source: string): Promise<void> {
    const names = load().envs.map((e) => e.name);
    const r = await runCmd('pi', ['remove', source], 5 * 60_000, {
      cwd: process.cwd(),
      env: { ...process.env, PI_CODING_AGENT_DIR: agentDir, NO_COLOR: '1' },
    });
    if (r.ok) statusMsg = 'Расширение удалено: ' + source;
    state = reducer(state, { type: 'remove-result', ok: r.ok, message: r.ok ? source : r.stderr || 'ошибка удаления' }, names, twoColumns());
    if (r.ok) {
      try {
        catalog = loadCatalog(agentDir);
        state = { ...state, catalog };
      } catch { /* каталог не перечитан — остаётся старый */ }
      void checkUpdates();
    }
    repaint();
  }

  async function dispatch(key: Key): Promise<void> {
    statusMsg = null;
    const { envs } = load();
    const names = envs.map((e) => e.name);
    const prevView = state.create?.view ?? null;
    if (key === 'e' && state.tab === 'envs' && state.sub === null && state.selected < envs.length) {
      const settings = readSettings(envs[state.selected].path) ?? {};
      state = reducer(state, { type: 'edit-start', name: envs[state.selected].name, settings }, names, twoColumns());
    } else {
      state = reducer(state, key, names, twoColumns());
    }
    if (state.create) {
      const v = state.create.view;
      if (v === 'removing' && prevView === 'confirm-remove') {
        const name = state.create.removing;
        const pkg = name !== null ? catalog.packages.find((p) => p.name === name) : undefined;
        if (pkg) void doRemove(pkg.source);
      } else if (v === 'updating' && prevView === 'packages') {
        void doUpdateAll();
      } else if (v === 'packages' && prevView === 'form' && state.pkgCheck !== 'checking') {
        void checkUpdates();
      }
    }

    if (state.create && state.create.view === 'submitting') {
      const cr = state.create;
      const req: CreateRequest = {
        name: cr.name,
        defaultProvider: cr.provider ?? undefined,
        defaultModel: cr.model ?? undefined,
        tools: cr.tools
          .map((n) => catalog.tools.find((t) => t.name === n))
          .filter((t): t is ToolItem => t !== undefined),
        skills: cr.skills
          .map((n) => catalog.skills.find((s) => s.name === n))
          .filter((s): s is SkillItem => s !== undefined),
        packages: cr.packages,
      };
      const res = cr.mode === 'edit'
        ? updateEnvironment(root, cr.origName ?? cr.name, req, catalog.tools, catalog.skills, agentDir)
        : createEnvironment(root, req, agentDir);
      const message = res.ok ? res.path : res.error;
      state = reducer(state, { type: 'create-result', ok: res.ok, message }, names, twoColumns());
    }

    if (state.create && state.create.view === 'deleting') {
      const name = state.create.name;
      const res = deleteEnvironment(root, name);
      state = reducer(state, { type: 'delete-result', ok: res.ok, message: res.ok ? name : res.error }, names, twoColumns());
      if (res.ok) {
        const n = load().envs.length;
        state = { ...state, selected: Math.max(0, Math.min(state.selected, n - 1)) };
      }
    }

    if (state.sub === 'run' && state.tab === 'envs' && state.selected < envs.length) {
      const env = envs[state.selected];
      const res = await launchPi(term, env);
      state = reducer(state, { type: 'run-result', ok: res.ok }, names, twoColumns());
      if (!res.ok) statusMsg = res.message;
    }
  }

  function repaint(): void {
    const { envs, status } = load();
    const w = term.width();
    const h = term.height();
    term.clear();
    process.stdout.write(render({
      state,
      envs,
      root,
      width: w,
      height: h,
      useColor: state.colorToggle && !term.noColor,
      status: statusMsg ?? status,
    }));
  }

  term.onResize(repaint);
  term.start();
  repaint();

  for (;;) {
    const key = await term.key();
    await dispatch(key as Key);
    if (state.quit) break;
    repaint();
  }
  term.stop();
}
