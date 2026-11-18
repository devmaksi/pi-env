import { existsSync, writeSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { withShutdown } from './shutdown.js';
import { type Environment } from './environments.js';
import { createScanCache } from './env-cache.js';
import { loadAppSettings, saveAppSettings } from './appsettings.js';
import { loadCatalog, fetchPackageCatalog, normalizePkgSource, type CatalogPkg } from './catalog.js';
import { computeLayout } from './layout.js';
import { frameKey, paintFrame, type PrevFrame } from './diff.js';
import { createThrottle, type Throttle, type ThrottleDeps } from './throttle.js';
import { createTicker } from './ticker.js';
import { render } from './render.js';
import { readSettings } from './create.js';
import { parseMcpList, readMcpServers } from './mcp.js';
import { AppState, busyProcessView, initialState, Key, reducer, type Action, type McpFormAdd, makeCtx, type ReducerCtx } from './state.js';
import { createTerm, Term } from './terminal.js';
import { defaultLang, localeCodes, t } from './i18n.js';
import { piUpdateAll, piUpdateOne, piRemove, piInstall, piMcpAdd, piMcpList, npmOutdated, cmdFailureText } from './pi-actions.js';
import { runCmd, type RunFn } from './cmd.js';
import { runSideEffects, type Loop, type PrevSnap } from './run-side.js';
import { changelogRows, type ChangelogEntry } from './selfupdate.js';
import type { SelfUpdate, VersionRange } from './selfupdate-net.js';
import { dedupedLog, type DebugLogFn } from './debuglog.js';

function defaultAgentDir(): string {
  return process.env.PI_CODING_AGENT_DIR ?? join(homedir(), '.pi', 'agent');
}

/**
 * Сбой TUI: локализованная строка + stack — в stderr (терминал восстанавливает withShutdown).
 * Запись — через fd 2 синхронно: `process.stderr.write` асинхронен для пайпа, а
 * `withShutdown` выходит сразу, и сообщение об ошибке могло бы потеряться.
 */
export function reportCrash(
  err: unknown,
  lang: string,
  write: (s: string) => void = (s) => { writeSync(2, s); },
): void {
  const detail = err instanceof Error ? (err.stack ?? err.message) : String(err);
  try {
    write(t(lang, 'crash.terminal') + '\n' + detail + '\n');
  } catch { /* сток недоступен — терминал уже восстановлен, дальше молча */ }
}

/** Окно схлопывания прогресс-репоков (загрузка каталога pi.dev). */
export const PROGRESS_THROTTLE_MS = 70;

/** Прогресс-репок: `createThrottle` с инжектируемыми часами и таймерами (тестируется без пауз). */
export function makeProgressPainter(
  repaint: () => void,
  ms: number,
  now: () => number,
  setTimer: ThrottleDeps['setTimer'],
): Throttle {
  return createThrottle(repaint, { ms, now, setTimer });
}

/**
 * Цикл приложения: чтение клавиши → reducer → побочные эффекты → отрисовка.
 * Побочные эффекты — в run-side.ts (хуки переходов, submit/delete/run),
 * команды pi/npm — в pi-actions.ts; запуск дочернего pi — в pirun.ts.
 */
export interface RunDeps {
  /** Есть ли более свежая версия pi-env; по умолчанию — не проверять (тесты идут офлайн). */
  selfCheck?: () => Promise<SelfUpdate | null>;
  /** Записи чейнджлога пропущенных релизов; по умолчанию — не загружать. */
  changelog?: (lang: string, secondary: string, range: VersionRange) => Promise<ChangelogEntry[] | null>;
  /**
   * Журнал отладки (`PI_ENV_DEBUG=1` → `<root>/.pi-env.log`); по умолчанию — ничего
   * не пишется, поэтому сквозные тесты `run()` не оставляют файлов.
   */
  debugLog?: DebugLogFn;
  /** Слой запуска внешних процессов; по умолчанию настоящий `runCmd`, тесты подставляют фейк. */
  cmd?: RunFn;
}

export async function run(root: string, term: Term = createTerm(), deps: RunDeps = {}): Promise<void> {
  /** Последний записанный на экран кадр (для построчного диффа); null — писать целиком. */
  let prevFrame: PrevFrame | null = null;
  const agentDir = defaultAgentDir();
  let catalog = loadCatalog(agentDir);
  const app = loadAppSettings(root);
  const lang0 = app.language ?? defaultLang(localeCodes());
  let state: AppState = { ...initialState(catalog), colorToggle: app.color, recheckUpdates: app.recheckUpdates, recheckMcp: app.recheckMcp, language: lang0 };
  let statusMsg: string | null = null;
  /** Снимок окружений и корзины: перечитывается при смене подписи дерева или после инвалидации. */
  const cache = createScanCache(root);

  /**
   * Активные внешние процессы. `cancelOp` — тот, которому принадлежит busy-экран (его снимает
   * Esc), `inflight` — все процессы цикла (их снимает выход).
   */
  const runCmdFn: RunFn = deps.cmd ?? runCmd;
  const inflight = new Set<AbortController>();
  let cancelOp: AbortController | null = null;
  /** Загрузка каталога pi.dev (не pi-процесс, но тоже снимается при выходе). */
  let catalogFetch: AbortController | null = null;

  /** Время старта последней видимой операции и число операций — для счётчика «⏳ N с». */
  let opStartedAt: number | null = null;
  let opCount = 0;

  function setOpSeconds(sec: number | null): void {
    if (state.opSeconds !== sec) state = { ...state, opSeconds: sec };
  }

  const opTicker = createTicker(() => {
    if (opStartedAt === null) {
      setOpSeconds(null);
      return false;
    }
    const sec = Math.floor((Date.now() - opStartedAt) / 1000);
    if (state.opSeconds !== sec) {
      setOpSeconds(sec);
      repaint();
    }
    return true;
  }, {
    setTimer: (ms, cb) => {
      const h = setTimeout(cb, ms);
      h.unref(); // счётчик не держит процесс
    },
  });

  async function startOp<T>(make: (signal: AbortSignal) => Promise<T>, kind: 'busy' | 'bg'): Promise<T> {
    const controller = new AbortController();
    inflight.add(controller);
    opCount++;
    if (kind === 'busy') {
      cancelOp = controller;
      opStartedAt = Date.now();
      setOpSeconds(0);
    }
    opTicker.start();
    try {
      return await make(controller.signal);
    } finally {
      inflight.delete(controller);
      if (kind === 'busy' && cancelOp === controller) cancelOp = null;
      opCount--;
      // Любая внешняя команда (успех, провал, отмена, таймаут) могла тронуть конфиги — снимок невалиден.
      cache.invalidate();
      if (opCount === 0) {
        opStartedAt = null;
        setOpSeconds(null);
      }
    }
  }

  function cancelBusy(): void {
    cancelOp?.abort();
  }

  function cancelAll(): void {
    for (const c of inflight) c.abort();
  }
  /**
   * Журнал отладки: строки о сбоях, которые иначе исчезают в `catch {}`. Дедуп обязателен —
   * `load()` (а значит и `scan()`) вызывается дважды на каждое нажатие клавиши.
   */
  const log: DebugLogFn = dedupedLog(deps.debugLog ?? (() => {}));
  const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

  function load(): { envs: Environment[]; status: string | null } {
    const scanned = cache.get().envs;
    if (scanned === null) {
      log('scan', `корень ${root} не существует или не читается`);
      return { envs: [], status: t(state.language, 'status.not-found', { root }) };
    }
    for (const e of scanned) {
      const d = e.details;
      if (d.settingsError) log('env', `${e.name}: settings.json — ${d.settingsError}`);
      if (d.mcpError) log('env', `${e.name}: mcp.json — ${d.mcpError}`);
      if (d.mcpSkipped.length > 0) log('env', `${e.name}: mcp.json — не разобраны записи: ${d.mcpSkipped.join(', ')}`);
    }
    return { envs: scanned, status: null };
  }

  function twoColumns(): boolean {
    return computeLayout({ width: term.width(), height: term.height() }).twoColumns;
  }

  function envNames(): string[] {
    return load().envs.map((e) => e.name);
  }

  /** Контекст reducer: свежие имена окружений, записи корзины + раскладка. */
  function trashNames(): string[] {
    return cache.get().trash.map((e) => e.dirName);
  }

  function rctx(names?: string[], tnames?: string[]): ReducerCtx {
    return makeCtx(names ?? envNames(), twoColumns(), tnames ?? trashNames());
  }

  /** Перечитывает каталог main-агента; ошибка — остаётся старый. */
  function reloadCatalog(): void {
    try {
      catalog = loadCatalog(agentDir);
      state = { ...state, catalog };
    } catch (err) {
      log('catalog', `${agentDir}: ${errText(err)}`);
      /* каталог не перечитан — остаётся старый */
    }
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
    const r = await startOp((signal) => npmOutdated(npmDir, signal, runCmdFn), 'bg');
    finish(r.ok, r.latest);
  }

  async function doUpdateAll(targetDir: string, scope: 'main' | 'create'): Promise<void> {
    const r = await startOp((signal) => piUpdateAll(targetDir, signal, runCmdFn), 'busy');
    if (r.ok) statusMsg = t(state.language, 'status.ext-updated');
    afterPiCommand(r, { type: 'update-result', ok: r.ok, message: r.ok ? t(state.language, 'status.ext-updated') : cmdFailureText(r, state.language, 'status.update-error', null) }, targetDir, scope);
  }

  async function doRemove(source: string): Promise<void> {
    const r = await startOp((signal) => piRemove(agentDir, source, signal, runCmdFn), 'busy');
    if (r.ok) statusMsg = t(state.language, 'status.ext-removed', { name: source });
    afterPiCommand(r, { type: 'remove-result', ok: r.ok, message: r.ok ? source : cmdFailureText(r, state.language, 'status.remove-error', source) }, agentDir, 'main');
  }

  async function doUpdateOne(source: string): Promise<void> {
    const r = await startOp((signal) => piUpdateOne(agentDir, source, signal, runCmdFn), 'busy');
    if (r.ok) statusMsg = t(state.language, 'status.updated', { name: source });
    afterPiCommand(r, { type: 'update-result', ok: r.ok, message: r.ok ? source : cmdFailureText(r, state.language, 'status.update-error', source) }, agentDir, 'main');
  }

  async function doInstall(installDir: string, source: string, envName: string | null): Promise<void> {
    const r = await startOp((signal) => piInstall(installDir, source, signal, runCmdFn), 'busy');
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
    state = reducer(state, { type: 'install-result', ok: r.ok, message: r.ok ? source : cmdFailureText(r, state.language, 'status.install-error', source), sources }, rctx());
    repaint();
  }

  /**
   * pi mcp list --json: живой статус серверов каталога dir.
   * Успех — по содержимому stdout: код 1 — норма при неподключённых серверах.
   */
  async function doMcpCheck(dir: string, scope: 'main' | 'create'): Promise<void> {
    const r = await startOp((signal) => piMcpList(dir, signal, runCmdFn), 'bg');
    const report = parseMcpList(r.stdout);
    state = reducer(state, { type: 'mcp-live-result', ok: r.ok, message: r.stderr.trim(), scope, report }, rctx());
    repaint();
  }

  async function doMcpAdd(dir: string, form: McpFormAdd, scope: 'main' | 'create'): Promise<void> {
    const r = await startOp((signal) => piMcpAdd(dir, form, signal, runCmdFn), 'busy');
    const msg = r.ok ? t(state.language, 'status.mcp-added', { name: form.name }) : cmdFailureText(r, state.language, 'status.mcp-add-error', form.name);
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
    // Новая загрузка снимает предыдущую: оборванный пикер не должен докачивать страницы.
    catalogFetch?.abort();
    const fetch1 = new AbortController();
    catalogFetch = fetch1;
    inflight.add(fetch1);
    const paintProgress = makeProgressPainter(repaint, PROGRESS_THROTTLE_MS, () => Date.now(), (ms, cb) => {
      const h = setTimeout(cb, ms);
      h.unref(); // прогресс-таймер не держит процесс
      return () => clearTimeout(h);
    });
    let pkgs: CatalogPkg[] | null;
    try {
      pkgs = await fetchPackageCatalog(undefined, (loaded, total) => {
        if (id !== catalogLoadId) return;
        state = { ...state, catalogProgress: { loaded, total } };
        paintProgress.call();
      }, fetch1.signal);
    } catch (err) {
      if (!fetch1.signal.aborted) log('catalog', `pi.dev/packages: ${errText(err)}`);
      pkgs = null;
    } finally {
      inflight.delete(fetch1);
      if (catalogFetch === fetch1) catalogFetch = null;
    }
    if (id !== catalogLoadId) { paintProgress.cancel(); return; }
    state = { ...state, catalogProgress: null };
    if (state.ext !== null && state.ext.view === 'catalog' && state.ext.catalogStatus === 'loading') {
      state = { ...state, ext: { ...state.ext, catalog: pkgs ?? [], catalogStatus: pkgs === null ? 'error' : 'ready' } };
    } else if (state.create !== null && state.create.view === 'install' && state.create.installStatus === 'loading') {
      state = { ...state, create: { ...state.create, installCatalog: pkgs ?? [], installStatus: pkgs === null ? 'error' : 'ready' } };
    }
    paintProgress.cancel();
    repaint();
  }

  const selfCheckFn = deps.selfCheck ?? (async (): Promise<SelfUpdate | null> => null);
  const changelogFn = deps.changelog ?? (async (): Promise<ChangelogEntry[] | null> => null);
  let selfCheckId = 0;
  let changelogLoadId = 0;

  /** Номер последней доступной версии (один раз на запуск + по R на вкладке «Обновление»). */
  async function runSelfUpdate(): Promise<void> {
    const id = ++selfCheckId;
    let info: SelfUpdate | null;
    try {
      info = await selfCheckFn();
    } catch (err) {
      log('self-update', errText(err));
      info = null;
    }
    if (id !== selfCheckId) return;
    state = reducer(state, { type: 'self-update-result', info }, rctx());
    if (info !== null) statusMsg = t(state.language, 'status.update-available', { latest: info.latest });
    repaint();
    if (info !== null && state.tab === 'update' && state.updateUi !== null) await loadChangelog();
  }

  /** Записи чейнджлога пропущенных релизов для вкладки «Обновление». */
  async function loadChangelog(): Promise<void> {
    const info = state.selfUpdate;
    if (info === null || state.updateUi === null) return;
    const id = ++changelogLoadId;
    state = { ...state, updateUi: { ...state.updateUi, check: 'loading' } };
    repaint();
    const lang = state.language;
    let entries: ChangelogEntry[] | null;
    try {
      entries = await changelogFn(lang, lang === 'ru' ? 'en' : 'ru', { installed: info.installed, latest: info.latest });
    } catch (err) {
      log('changelog', errText(err));
      entries = null;
    }
    if (id !== changelogLoadId) return;
    state = reducer(state, { type: 'changelog-result', ok: entries !== null, rows: changelogRows(entries ?? []) }, rctx());
    if (entries === null) statusMsg = t(state.language, 'status.changelog-error');
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
    doMcpCheck: (dir, scope) => { void doMcpCheck(dir, scope); },
    cancelBusy: () => cancelBusy(),
    invalidate: () => cache.invalidate(),
    trashNames: () => trashNames(),
    runSelfUpdate: () => { void runSelfUpdate(); },
    loadChangelog: () => { void loadChangelog(); },
  };

  function applyKey(key: Key): { envs: Environment[]; prev: PrevSnap } {
    statusMsg = null;
    const prevColor = state.colorToggle;
    const prevRecheck = state.recheckUpdates;
    const prevRecheckMcp = state.recheckMcp;
    const prevLang = state.language;
    const { envs } = load();
    const names = envs.map((e) => e.name);
    const tnames = trashNames();
    const prev: PrevSnap = { cancelRequested: false, view: state.create?.view ?? null, ext: state.ext, mcp: state.mcp, tab: state.tab, mcpCheck: state.mcpCheck, createMcpCheck: state.create?.mcpCheck ?? 'idle', selfCheck: state.selfCheck };
    if (key === 'e' && state.tab === 'envs' && state.sub === null && state.trash === null && state.selected < envs.length) {
      const settings = readSettings(envs[state.selected].path) ?? {};
      state = reducer(state, { type: 'edit-start', name: envs[state.selected].name, settings, mcp: readMcpServers(envs[state.selected].path) }, rctx(names, tnames));
    } else {
      state = reducer(state, key, rctx(names, tnames));
    }
    // Заявка на отмену считается после reducer: экран процесса — тот, что стал текущим.
    prev.cancelRequested = key === 'esc' && busyProcessView(state);
    if (state.colorToggle !== prevColor || state.recheckUpdates !== prevRecheck || state.recheckMcp !== prevRecheckMcp || state.language !== prevLang) {
      saveAppSettings(root, { color: state.colorToggle, recheckUpdates: state.recheckUpdates, recheckMcp: state.recheckMcp, language: state.language });
    }
    return { envs, prev };
  }

  function repaint(): void {
    const { envs, status } = load();
    const w = term.width();
    const h = term.height();
    const lines = render({
      state,
      envs,
      root,
      width: w,
      height: h,
      useColor: state.colorToggle && !term.noColor,
      status: statusMsg ?? status,
      trashEntries: cache.get().trash,
    }).split('\n');
    const key = frameKey(w, h, computeLayout({ width: w, height: h }).twoColumns);
    // Экран неизвестен (первый кадр, resize, возврат из дочернего pi) → prevFrame не используется.
    prevFrame = paintFrame(term.screenKnown() ? prevFrame : null, lines, key, term);
  }

  await withShutdown(
    {
      stop: () => term.stop(),
      report: (err) => reportCrash(err, state.language),
      exit: (code) => process.exit(code),
      on: (event, handler) => process.on(event, handler),
      off: (event, handler) => process.off(event, handler),
    },
    async () => {
      term.onResize(repaint);
      term.start();
      repaint();
      void runSelfUpdate();
      for (;;) {
        const key = await term.key();
        const { envs, prev } = applyKey(key as Key);
        await runSideEffects(loop, envs, prev);
        if (state.quit) { cancelAll(); break; }
        repaint();
      }
    },
  );
}
