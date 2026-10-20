import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { scan, Environment } from './environments.js';
import { loadAppSettings, saveAppSettings } from './appsettings.js';
import { loadCatalog, fetchPackageCatalog, normalizePkgSource, type CatalogPkg } from './catalog.js';
import { computeLayout } from './layout.js';
import { render } from './render.js';
import { readSettings } from './create.js';
import { readMcpServers } from './mcp.js';
import { AppState, initialState, Key, reducer, type Action, type McpFormAdd, makeCtx, type ReducerCtx } from './state.js';
import { createTerm, Term } from './terminal.js';
import { defaultLang, localeCodes, t } from './i18n.js';
import { piUpdateAll, piUpdateOne, piRemove, piInstall, piMcpAdd, npmOutdated } from './pi-actions.js';
import { runSideEffects, type Loop, type PrevSnap } from './run-side.js';

function defaultAgentDir(): string {
  return process.env.PI_CODING_AGENT_DIR ?? join(homedir(), '.pi', 'agent');
}

/**
 * Цикл приложения: чтение клавиши → reducer → побочные эффекты → отрисовка.
 * Побочные эффекты — в run-side.ts (хуки переходов, submit/delete/run),
 * команды pi/npm — в pi-actions.ts; запуск дочернего pi — в pirun.ts.
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

  /** Контекст reducer: свежие имена окружений + раскладка. */
  function rctx(names?: string[]): ReducerCtx {
    return makeCtx(names ?? envNames(), twoColumns());
  }

  /** Перечитывает каталог main-агента; ошибка — остаётся старый. */
  function reloadCatalog(): void {
    try {
      catalog = loadCatalog(agentDir);
      state = { ...state, catalog };
    } catch { /* каталог не перечитан — остаётся старый */ }
  }

  /** Общий финал pi-команды: результат в reducer, перечитка каталога, отрисовка. */
  function afterPiCommand(r: { ok: boolean }, action: Action, targetDir: string, scope: 'main' | 'create'): void {
    state = reducer(state, action, rctx());
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
      state = reducer(state, { type: 'updates-result', ok, latest, scope }, rctx());
      repaint();
    };
    if (!existsSync(npmDir)) {
      finish(true, {});
      return;
    }
    setChecking();
    const r = await npmOutdated(npmDir);
    finish(r.ok, r.latest);
  }

  async function doUpdateAll(targetDir: string, scope: 'main' | 'create'): Promise<void> {
    const r = await piUpdateAll(targetDir);
    if (r.ok) statusMsg = t(state.language, 'status.ext-updated');
    afterPiCommand(r, { type: 'update-result', ok: r.ok, message: r.ok ? t(state.language, 'status.ext-updated') : r.stderr || t(state.language, 'status.update-error') }, targetDir, scope);
  }

  async function doRemove(source: string): Promise<void> {
    const r = await piRemove(agentDir, source);
    if (r.ok) statusMsg = t(state.language, 'status.ext-removed', { name: source });
    afterPiCommand(r, { type: 'remove-result', ok: r.ok, message: r.ok ? source : r.stderr || t(state.language, 'status.remove-error') }, agentDir, 'main');
  }

  async function doUpdateOne(source: string): Promise<void> {
    const r = await piUpdateOne(agentDir, source);
    if (r.ok) statusMsg = t(state.language, 'status.updated', { name: source });
    afterPiCommand(r, { type: 'update-result', ok: r.ok, message: r.ok ? source : r.stderr || t(state.language, 'status.update-error') }, agentDir, 'main');
  }

  async function doInstall(installDir: string, source: string, envName: string | null): Promise<void> {
    const r = await piInstall(installDir, source);
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
    state = reducer(state, { type: 'install-result', ok: r.ok, message: r.ok ? source : r.stderr || t(state.language, 'status.install-error'), sources }, rctx());
    repaint();
  }

  async function doMcpAdd(dir: string, form: McpFormAdd, scope: 'main' | 'create'): Promise<void> {
    const r = await piMcpAdd(dir, form);
    const msg = r.ok ? t(state.language, 'status.mcp-added', { name: form.name }) : (r.stderr.trim() || t(state.language, 'status.mcp-add-error'));
    statusMsg = msg;
    state = reducer(state, { type: 'mcp-result', ok: r.ok, message: msg, scope, list: scope === 'create' ? readMcpServers(dir) : undefined }, rctx());
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

  const loop: Loop = {
    root, agentDir, term,
    state: () => state,
    setState: (next) => { state = next; },
    catalog: () => catalog,
    status: (msg) => { statusMsg = msg; },
    twoColumns,
    envs: () => load().envs,
    repaint: () => repaint(),
    reloadCatalog: () => reloadCatalog(),
    checkUpdates: (dir, scope) => { void checkUpdates(dir, scope); },
    loadPackageCatalog: () => { void loadPackageCatalog(); },
    doRemove: (source) => { void doRemove(source); },
    doUpdateAll: (dir, scope) => { void doUpdateAll(dir, scope); },
    doUpdateOne: (source) => { void doUpdateOne(source); },
    doInstall: (dir, source, envName) => { void doInstall(dir, source, envName); },
    doMcpAdd: (dir, form, scope) => { void doMcpAdd(dir, form, scope); },
  };

  function applyKey(key: Key): { envs: Environment[]; prev: PrevSnap } {
    statusMsg = null;
    const prevColor = state.colorToggle;
    const prevRecheck = state.recheckUpdates;
    const prevLang = state.language;
    const { envs } = load();
    const names = envs.map((e) => e.name);
    const prev: PrevSnap = { view: state.create?.view ?? null, ext: state.ext, mcp: state.mcp, tab: state.tab };
    if (key === 'e' && state.tab === 'envs' && state.sub === null && state.selected < envs.length) {
      const settings = readSettings(envs[state.selected].path) ?? {};
      state = reducer(state, { type: 'edit-start', name: envs[state.selected].name, settings, mcp: readMcpServers(envs[state.selected].path) }, rctx(names));
    } else {
      state = reducer(state, key, rctx(names));
    }
    if (state.colorToggle !== prevColor || state.recheckUpdates !== prevRecheck || state.language !== prevLang) {
      saveAppSettings(root, { color: state.colorToggle, recheckUpdates: state.recheckUpdates, language: state.language });
    }
    return { envs, prev };
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
    const { envs, prev } = applyKey(key as Key);
    await runSideEffects(loop, envs, prev);
    if (state.quit) break;
    repaint();
  }
  term.stop();
}
