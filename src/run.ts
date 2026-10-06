import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { scan, Environment } from './environments.js';
import { loadAppSettings, saveAppSettings } from './appsettings.js';
import { loadCatalog, interpretOutdated, fetchPackageCatalog, normalizePkgSource, ToolItem, SkillItem, type CatalogPkg } from './catalog.js';
import { computeLayout } from './layout.js';
import { render } from './render.js';
import { createEnvironment, readSettings, updateEnvironment, deleteEnvironment, type CreateRequest } from './create.js';
import { readMcpServers, mcpAddCliArgs, copyMcpEntry, removeMcpEntry, type McpServer } from './mcp.js';
import { AppState, initialState, Key, reducer, type Action, type McpFormAdd } from './state.js';
import { createTerm, Term } from './terminal.js';
import { defaultLang, localeCodes, t } from './i18n.js';

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
    child.on('error', (e: Error) => finish(false, e.message));
    child.on('exit', () => finish(true, ''));
  });
}

/**
 * Неинтерактивный проброс: запускает pi в окружении,
 * передаёт терминал и пробрасывает код выхода.
 * ponytail: ENOENT → 127, прочие ошибки spawn — сообщение в stderr.
 */
export function runPassthrough(envPath: string, args: string[], lang: string): void {
  const child = spawn('pi', args, {
    cwd: process.cwd(),
    env: { ...process.env, PI_CODING_AGENT_DIR: envPath },
    stdio: 'inherit',
  });
  child.on('error', (e: NodeJS.ErrnoException) => {
    process.stderr.write((e.code === 'ENOENT' ? t(lang, 'run.pi.not_found') : e.message) + '\n');
    process.exit(127);
  });
  child.on('exit', (code) => process.exit(code ?? 1));
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
  const app = loadAppSettings(root);
  const lang0 = app.language ?? defaultLang(localeCodes());
  let state: AppState = { ...initialState(catalog), colorToggle: app.color, recheckUpdates: app.recheckUpdates, language: lang0 };
  let statusMsg: string | null = null;

  function load(): { envs: Environment[]; status: string | null } {
    const scanned = scan(root);
    if (scanned === null) {
      return { envs: [], status: t(state.language, 'status.not-found', { root }) };
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

  /** Каталог агента для формы: окружение (edit) или main-агент (create, окружение ещё не существует). */
  function formTargetDir(): string {
    const cr = state.create!;
    return cr.mode === 'edit' ? join(root, cr.origName ?? cr.name) : agentDir;
  }

  /** Общий финал pi-команды: результат в reducer, перечитка каталога, отрисовка. */
  function afterPiCommand(r: { ok: boolean }, action: Action, targetDir: string, scope: 'main' | 'create'): void {
    state = reducer(state, action, envNames(), twoColumns());
    if (r.ok) {
      reloadCatalog();
      void checkUpdates(targetDir, scope);
    }
    repaint();
  }

  /**
   * npm outdated по npm-каталогу заданной папки агента (main-агент или окружение)
   * → карта имени → latest. Scope: 'main' — верхний уровень (вкладка «Расширения»),
   * 'create' — состояние формы создания. Каталога нет — карта пуста (обновлять нечего).
   */
  async function checkUpdates(targetDir: string, scope: 'main' | 'create'): Promise<void> {
    const npmDir = join(targetDir, 'npm');
    const setChecking = (): void => {
      if (scope === 'create') {
        if (state.create !== null) state = { ...state, create: { ...state.create, check: 'checking' } };
      } else {
        state = { ...state, pkgCheck: 'checking' };
      }
    };
    const finish = (ok: boolean, latest: Record<string, string>): void => {
      state = reducer(state, { type: 'updates-result', ok, latest, scope }, envNames(), twoColumns());
      repaint();
    };
    if (!existsSync(npmDir)) {
      finish(true, {});
      return;
    }
    setChecking();
    const raw = await runCmd('npm', ['outdated', '--json', '--prefix', npmDir], NPM_TIMEOUT_MS);
    const r = interpretOutdated(raw.stdout);
    finish(r.ok, r.latest);
  }

  /** pi update --extensions: обновление всех установленных пакетов в папке агента targetDir. */
  async function doUpdateAll(targetDir: string, scope: 'main' | 'create'): Promise<void> {
    const r = await runCmd('pi', ['update', '--extensions'], PI_TIMEOUT_MS, { cwd: process.cwd(), env: piEnv(targetDir) });
    if (r.ok) statusMsg = t(state.language, 'status.ext-updated');
    afterPiCommand(r, { type: 'update-result', ok: r.ok, message: r.ok ? t(state.language, 'status.ext-updated') : r.stderr || t(state.language, 'status.update-error') }, targetDir, scope);
  }

  /** pi remove <source>: полное удаление пакета из main-агента. */
  async function doRemove(source: string): Promise<void> {
    const r = await runPi(['remove', source]);
    if (r.ok) statusMsg = t(state.language, 'status.ext-removed', { name: source });
    afterPiCommand(r, { type: 'remove-result', ok: r.ok, message: r.ok ? source : r.stderr || t(state.language, 'status.remove-error') }, agentDir, 'main');
  }

  /** pi update <source>: обновление одного пакета main-агента. */
  async function doUpdateOne(source: string): Promise<void> {
    const r = await runPi(['update', source]);
    if (r.ok) statusMsg = t(state.language, 'status.updated', { name: source });
    afterPiCommand(r, { type: 'update-result', ok: r.ok, message: r.ok ? source : r.stderr || t(state.language, 'status.update-error') }, agentDir, 'main');
  }

  /** pi install <source>: установка пакета в указанный каталог агента (main или окружение). */
  async function doInstall(installDir: string, source: string, envName: string | null): Promise<void> {
    const r = await runCmd('pi', ['install', source], PI_TIMEOUT_MS, { cwd: process.cwd(), env: piEnv(installDir) });
    if (r.ok) statusMsg = t(state.language, 'status.installed', { name: source });
    let sources: string[] | undefined;
    if (r.ok) {
      if (envName !== null) {
        const settings = readSettings(join(root, envName)) ?? {};
        sources = (settings.packages ?? []).map((s) => normalizePkgSource(s, catalog.packages));
      } else {
        reloadCatalog();
        void checkUpdates(agentDir, 'main');
      }
    }
    state = reducer(state, { type: 'install-result', ok: r.ok, message: r.ok ? source : r.stderr || t(state.language, 'status.install-error'), sources }, envNames(), twoColumns());
    repaint();
  }

  /** pi mcp add: добавляет сервер в указанный каталог агента (main или окружение). */
  async function doMcpAdd(dir: string, form: McpFormAdd, scope: 'main' | 'create'): Promise<void> {
    const r = await runCmd('pi', mcpAddCliArgs(form), PI_TIMEOUT_MS, { cwd: process.cwd(), env: piEnv(dir) });
    const msg = r.ok ? t(state.language, 'status.mcp-added', { name: form.name }) : (r.stderr.trim() || t(state.language, 'status.mcp-add-error'));
    statusMsg = msg;
    state = reducer(state, { type: 'mcp-result', ok: r.ok, message: msg, scope, list: scope === 'create' ? readMcpServers(dir) : undefined }, envNames(), twoColumns());
    if (r.ok && scope === 'main') reloadCatalog();
    repaint();
  }

  /** Идентификатор последней загрузки каталога: устаревшая не трогает UI. */
  let catalogLoadId = 0;

  /**
   * Скачивает каталог пакетов pi.dev в открытый пикер (вкладка или форма).
   * Прогресс по страницам — в state.catalogProgress, UI остаётся отзывчивым.
   */
  async function loadPackageCatalog(): Promise<void> {
    const id = ++catalogLoadId;
    let pkgs: CatalogPkg[] | null;
    try {
      pkgs = await fetchPackageCatalog(undefined, (loaded, total) => {
        if (id !== catalogLoadId) return;
        state = { ...state, catalogProgress: { loaded, total } };
        repaint();
      });
    } catch {
      pkgs = null;
    }
    if (id !== catalogLoadId) return;
    state = { ...state, catalogProgress: null };
    if (state.ext !== null && state.ext.view === 'catalog' && state.ext.catalogStatus === 'loading') {
      state = { ...state, ext: { ...state.ext, catalog: pkgs ?? [], catalogStatus: pkgs === null ? 'error' : 'ready' } };
    } else if (state.create !== null && state.create.view === 'install' && state.create.installStatus === 'loading') {
      state = { ...state, create: { ...state.create, installCatalog: pkgs ?? [], installStatus: pkgs === null ? 'error' : 'ready' } };
    }
    repaint();
  }

  async function dispatch(key: Key): Promise<void> {
    statusMsg = null;
    const prevColor = state.colorToggle;
    const prevRecheck = state.recheckUpdates;
    const prevLang = state.language;
    const { envs } = load();
    const names = envs.map((e) => e.name);
    const prevView = state.create?.view ?? null;
    const prevExt = state.ext;
    const prevMcp = state.mcp;
    const prevTab = state.tab;
    if (key === 'e' && state.tab === 'envs' && state.sub === null && state.selected < envs.length) {
      const settings = readSettings(envs[state.selected].path) ?? {};
      state = reducer(state, { type: 'edit-start', name: envs[state.selected].name, settings, mcp: readMcpServers(envs[state.selected].path) }, names, twoColumns());
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
        void doUpdateAll(formTargetDir(), 'create');
      } else if (v === 'packages' && prevView === 'form' && state.create.check !== 'checking') {
        void checkUpdates(formTargetDir(), 'create');
      } else if (v === 'install' && prevView === 'packages' && state.create.installStatus === 'loading') {
        void loadPackageCatalog();
      } else if (v === 'installing' && prevView === 'install') {
        const envName = state.create.origName ?? state.create.name;
        void doInstall(join(root, envName), 'npm:' + (state.create.installing ?? ''), envName);
      } else if (v === 'mcp-op' && state.create.mcpOp !== null) {
        const op = state.create.mcpOp;
        const envDir = join(root, state.create.origName ?? state.create.name);
        const r = op.kind === 'copy' ? copyMcpEntry(agentDir, envDir, op.name) : removeMcpEntry(envDir, op.name);
        const list = readMcpServers(envDir);
        const okMsg = op.kind === 'copy'
          ? t(state.language, 'status.mcp-copied', { name: op.name })
          : t(state.language, 'status.mcp-removed', { name: op.name });
        const errMsg = op.kind === 'copy' ? t(state.language, 'status.mcp-copy-error') : t(state.language, 'status.mcp-remove-error');
        const message = r.ok ? okMsg : (r.error !== undefined ? errMsg + ': ' + r.error : errMsg);
        statusMsg = message;
        state = reducer(state, { type: 'mcp-result', ok: r.ok, message, scope: 'create', list }, names, twoColumns());
        repaint();
      } else if (v === 'mcp-submitting' && prevView === 'mcp' && state.create.mcpAdd !== null) {
        void doMcpAdd(join(root, state.create.origName ?? state.create.name), state.create.mcpAdd, 'create');
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
        if (e.updating === null) void doUpdateAll(agentDir, 'main');
        else {
          const pkg = catalog.packages.find((p) => p.name === e.updating);
          if (pkg) void doUpdateOne(pkg.source);
        }
      }
    }

    if (state.mcp !== null) {
      const m = state.mcp;
      if (m.view === 'submitting' && prevMcp !== null && prevMcp.view === 'add' && m.form !== null) {
        void doMcpAdd(agentDir, m.form, 'main');
      } else if (m.view === 'removing' && prevMcp !== null && prevMcp.view === 'confirm-remove' && m.removing !== null) {
        const r = removeMcpEntry(agentDir, m.removing);
        const msg = r.ok ? t(state.language, 'status.mcp-removed', { name: m.removing }) : t(state.language, 'status.mcp-remove-error');
        statusMsg = msg;
        if (r.ok) reloadCatalog();
        state = reducer(state, { type: 'mcp-result', ok: r.ok, message: msg, scope: 'main' }, names, twoColumns());
        repaint();
      }
    }

    if (prevTab !== 'extensions' && state.tab === 'extensions' && state.ext === null && (state.pkgCheck === 'idle' || state.recheckUpdates)) {
      void checkUpdates(agentDir, 'main');
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
        mcp: cr.mcp
          .map((n) => catalog.mcp.find((s) => s.name === n))
          .filter((s): s is McpServer => s !== undefined),
      };
      const res = cr.mode === 'edit'
        ? updateEnvironment(root, cr.origName ?? cr.name, req, { allTools: catalog.tools, allSkills: catalog.skills, agentDir }, state.language)
        : createEnvironment(root, req, agentDir, state.language);
      const message = res.ok ? res.path : res.error;
      state = reducer(state, { type: 'create-result', ok: res.ok, message }, names, twoColumns());
    }

    if (state.create && state.create.view === 'deleting') {
      const name = state.create.name;
      const res = deleteEnvironment(root, name, state.language);
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
      if (!res.ok) statusMsg = t(state.language, 'status.pi-launch', { err: res.message });
    }

    if (state.colorToggle !== prevColor || state.recheckUpdates !== prevRecheck || state.language !== prevLang) {
      saveAppSettings(root, { color: state.colorToggle, recheckUpdates: state.recheckUpdates, language: state.language });
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
