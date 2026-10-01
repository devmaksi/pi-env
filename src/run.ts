import { homedir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { scan, Environment } from './environments.js';
import { loadCatalog, parseOutdated, fetchPackageCatalog, normalizePkgSource, ToolItem, SkillItem, type CatalogPkg } from './catalog.js';
import { computeLayout } from './layout.js';
import { render } from './render.js';
import { createEnvironment, readSettings, updateEnvironment, deleteEnvironment, type CreateRequest } from './create.js';
import { AppState, initialState, Key, reducer, type Action } from './state.js';
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

/** Таймауты дочерних процессов, мс. */
const PI_TIMEOUT_MS = 5 * 60_000;
const NPM_TIMEOUT_MS = 10_000;

/** Окружение для pi-команд: каталог агента и вывод без цвета. */
function piEnv(dir: string): NodeJS.ProcessEnv {
  return { ...process.env, PI_CODING_AGENT_DIR: dir, NO_COLOR: '1' };
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

  function envNames(): string[] {
    return load().envs.map((e) => e.name);
  }

  /** Перечитывает каталог main-агента; ошибка — остаётся старый. */
  function reloadCatalog(): void {
    try {
      catalog = loadCatalog(agentDir);
      state = { ...state, catalog };
    } catch { /* каталог не перечитан — остаётся старый */ }
  }

  /** pi <args> в main-агенте. */
  async function runPi(args: string[]): Promise<{ ok: boolean; stdout: string; stderr: string }> {
    return runCmd('pi', args, PI_TIMEOUT_MS, { cwd: process.cwd(), env: piEnv(agentDir) });
  }

  /** Общий финал pi-команды: результат в reducer, перечитка каталога, отрисовка. */
  function afterPiCommand(r: { ok: boolean }, action: Action): void {
    state = reducer(state, action, envNames(), twoColumns());
    if (r.ok) {
      reloadCatalog();
      void checkUpdates();
    }
    repaint();
  }

  /** npm outdated в каталоге npm main-агента → карта имени → latest. */
  async function checkUpdates(): Promise<void> {
    state = { ...state, pkgCheck: 'checking' };
    const raw = await runCmd('npm', ['outdated', '--json', '--prefix', join(agentDir, 'npm')], NPM_TIMEOUT_MS);
    state = reducer(state, { type: 'updates-result', ok: raw.ok, latest: parseOutdated(raw.stdout) }, envNames(), twoColumns());
    repaint();
  }

  /** pi update --extensions: обновление всех установленных пакетов. */
  async function doUpdateAll(): Promise<void> {
    const r = await runPi(['update', '--extensions']);
    if (r.ok) statusMsg = 'Расширения обновлены';
    afterPiCommand(r, { type: 'update-result', ok: r.ok, message: r.ok ? 'Расширения обновлены' : r.stderr || 'ошибка обновления' });
  }

  /** pi remove <source>: полное удаление пакета из main-агента. */
  async function doRemove(source: string): Promise<void> {
    const r = await runPi(['remove', source]);
    if (r.ok) statusMsg = 'Расширение удалено: ' + source;
    afterPiCommand(r, { type: 'remove-result', ok: r.ok, message: r.ok ? source : r.stderr || 'ошибка удаления' });
  }

  /** pi update <source>: обновление одного пакета main-агента. */
  async function doUpdateOne(source: string): Promise<void> {
    const r = await runPi(['update', source]);
    if (r.ok) statusMsg = 'Обновлено: ' + source;
    afterPiCommand(r, { type: 'update-result', ok: r.ok, message: r.ok ? source : r.stderr || 'ошибка обновления' });
  }

  /** pi install <source>: установка пакета в указанный каталог агента (main или окружение). */
  async function doInstall(installDir: string, source: string, envName: string | null): Promise<void> {
    const r = await runCmd('pi', ['install', source], PI_TIMEOUT_MS, { cwd: process.cwd(), env: piEnv(installDir) });
    if (r.ok) statusMsg = 'Установлено: ' + source;
    let sources: string[] | undefined;
    if (r.ok) {
      if (envName !== null) {
        const settings = readSettings(join(root, envName)) ?? {};
        sources = (settings.packages ?? []).map((s) => normalizePkgSource(s, catalog.packages));
      } else {
        reloadCatalog();
        void checkUpdates();
      }
    }
    state = reducer(state, { type: 'install-result', ok: r.ok, message: r.ok ? source : r.stderr || 'ошибка установки', sources }, envNames(), twoColumns());
    repaint();
  }

  /** Скачивает каталог пакетов pi.dev в открытый пикер (вкладка или форма). */
  async function loadPackageCatalog(): Promise<void> {
    let pkgs: CatalogPkg[] | null;
    try {
      pkgs = await fetchPackageCatalog();
    } catch {
      pkgs = null;
    }
    if (state.ext !== null && state.ext.view === 'catalog' && state.ext.catalogStatus === 'loading') {
      state = { ...state, ext: { ...state.ext, catalog: pkgs ?? [], catalogStatus: pkgs === null ? 'error' : 'ready' } };
    } else if (state.create !== null && state.create.view === 'install' && state.create.installStatus === 'loading') {
      state = { ...state, create: { ...state.create, installCatalog: pkgs ?? [], installStatus: pkgs === null ? 'error' : 'ready' } };
    }
    repaint();
  }

  async function dispatch(key: Key): Promise<void> {
    statusMsg = null;
    const { envs } = load();
    const names = envs.map((e) => e.name);
    const prevView = state.create?.view ?? null;
    const prevExt = state.ext;
    const prevTab = state.tab;
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
      } else if (v === 'install' && prevView === 'packages' && state.create.installStatus === 'loading') {
        void loadPackageCatalog();
      } else if (v === 'installing' && prevView === 'install') {
        const envName = state.create.origName ?? state.create.name;
        void doInstall(join(root, envName), 'npm:' + (state.create.installing ?? ''), envName);
      }
    }
    if (state.ext !== null) {
      const e = state.ext;
      if (e.view === 'catalog' && prevExt === null && e.catalogStatus === 'loading') {
        void loadPackageCatalog();
      } else if (e.view === 'installing' && prevExt !== null && prevExt.view === 'catalog') {
        void doInstall(agentDir, 'npm:' + (e.installing ?? ''), null);
      } else if (e.view === 'removing' && prevExt !== null && prevExt.view === 'confirm-remove') {
        const pkg = catalog.packages.find((p) => p.name === e.removing);
        if (pkg) void doRemove(pkg.source);
      } else if (e.view === 'updating' && prevExt === null) {
        if (e.updating === null) void doUpdateAll();
        else {
          const pkg = catalog.packages.find((p) => p.name === e.updating);
          if (pkg) void doUpdateOne(pkg.source);
        }
      }
    }

    if (prevTab !== 'extensions' && state.tab === 'extensions' && state.ext === null && state.pkgCheck === 'idle') {
      void checkUpdates();
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
        ? updateEnvironment(root, cr.origName ?? cr.name, req, { allTools: catalog.tools, allSkills: catalog.skills, agentDir })
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
