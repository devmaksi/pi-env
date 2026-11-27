import { existsSync, writeSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { withShutdown } from './shutdown.js';
import {
  packageConflicts, pkgIdentity, realEnvNames, storeRegistryGaps,
  type Environment, type PackageConflict, type RegistryGap,
} from './environments.js';
import { createScanCache } from './env-cache.js';
import { repairModelsLink, repairStoreRootLinks, rewritePackages, storeModelsFile, storeRegistrySources, storeRoot, STORE_ROOTS, type StoreResult } from './store.js';
import { loadAppSettings, saveAppSettings } from './appsettings.js';
import { listProviders, loadCatalog, fetchPackageCatalog, normalizePkgSource, type CatalogPkg } from './catalog.js';
import { computeLayout } from './layout.js';
import { frameKey, paintFrame, type PrevFrame } from './diff.js';
import { createThrottle, type Throttle, type ThrottleDeps } from './throttle.js';
import { createTicker } from './ticker.js';
import { createStoreLock, targetsStore } from './oplock.js';
import { render } from './render.js';
import { patchSettings, readSettings } from './create.js';
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
  /** Каталог main-агента; по умолчанию `PI_CODING_AGENT_DIR ?? ~/.pi/agent` — тесты задают явно. */
  agentDir?: string;
}

export async function run(root: string, term: Term = createTerm(), deps: RunDeps = {}): Promise<void> {
  /** Последний записанный на экран кадр (для построчного диффа); null — писать целиком. */
  let prevFrame: PrevFrame | null = null;
  const agentDir = deps.agentDir ?? defaultAgentDir();
  let catalog = loadCatalog(agentDir);
  const app = loadAppSettings(root);
  const lang0 = app.language ?? defaultLang(localeCodes());
  // Хранилище доступно всегда: по умолчанию `<root>/.store`, переезжает настройкой `storeDir`
  // или `PI_ENV_STORE`. Окружение подключается к нему сам — без переключателя «вообще».
  const storeDir = storeRoot(root, app.storeDir, process.env.PI_ENV_STORE);
  const storeFile = storeModelsFile(storeDir);
  let storePackages = loadCatalog(storeDir).packages;
  // `<store>`: пакет объявлен окружениями общего хранилища, но не установлен в нём.
  // Это остаток отменённого или провалившегося шага в хранилище, в том числе после
  // разрешения конфликта: конфликта в снимке уже нет, и вход `S` выбора победителя
  // был бы слепым — поэтому `S` без конфликта на строке открывает приведение реестра.
  let storeGaps: RegistryGap[] = [];
  let state: AppState = { ...initialState(catalog, storePackages), colorToggle: app.color, recheckUpdates: app.recheckUpdates, recheckMcp: app.recheckMcp, language: lang0 };
  let statusMsg: string | null = null;
  /** Снимок окружений и корзины: перечитывается при смене подписи дерева или после инвалидации. */
  const cache = createScanCache(root, agentDir, {}, storeDir);

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

  // Один процесс, пишущий в общее хранилище: его корни — общие для всех окружений, два npm
  // одновременно портят манифест и дерево на весь парк агентов.
  const storeLock = createStoreLock(
    (dir) => targetsStore(dir, storeDir),
    () => { statusMsg = t(state.language, 'status.store-busy'); repaint(); },
  );

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
  // Разрывы читаются по снимку и журналу,
  // поэтому после создания кэша и журнала.
  storeGaps = readStoreGaps();
  state = { ...state, storeGaps };

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

  /**
   * Строки списка окружений в порядке экрана (основная запись включена) — это пространство
   * индексов курсора: `renderEnvList` нумерует по нему и «Создать», и «Корзина».
   */
  function envRows(envs: Environment[] = load().envs): string[] {
    return envs.map((e) => e.name);
  }

  /** Имена обычных окружений (без основной записи) — проверка уникальности имён. */
  function realNames(envs: Environment[] = load().envs): string[] {
    return realEnvNames(envs);
  }

  /** Имена записей корзины (`dirName` из `.trash`). */
  function trashNames(): string[] {
    return cache.get().trash.map((e) => e.dirName);
  }

  /**
   * Контекст reducer: строки списка, корзина и имена для уникальности — по умолчанию свежие.
   * Именованные поля, а не три позиционных `string[]`: переставленные местами список строк и
   * список имён компилируются и воспроизводят ровно этот дефект.
   */
  function rctx(over: {
    rows?: string[]; tnames?: string[]; names?: string[]; conflicts?: PackageConflict[]; gaps?: RegistryGap[];
  } = {}): ReducerCtx {
    return makeCtx(
      over.rows ?? envRows(), twoColumns(), over.tnames ?? trashNames(), over.names ?? realNames(),
      over.conflicts ?? packageConflicts(load().envs), over.gaps ?? storeGaps,
    );
  }

  function readStoreGaps(): RegistryGap[] {
    const registry = storeRegistrySources(storeDir);
    return registry === null ? [] : storeRegistryGaps(load().envs, registry);
  }

  /**
   * Перечитывает каталог main-агента (формы, MCP) и реестр общего хранилища
   * (вкладка «Расширения»); при ошибке соответствующий список остаётся старый.
   */
  function reloadCatalog(): void {
    try {
      catalog = loadCatalog(agentDir);
    } catch (err) {
      log('catalog', `${agentDir}: ${errText(err)}`);
      /* каталог не перечитан — остаётся старый */
    }
    try {
      storePackages = loadCatalog(storeDir).packages;
    } catch (err) {
      log('catalog', `${storeDir}: ${errText(err)}`);
    }
    storeGaps = readStoreGaps();
    state = { ...state, catalog, storePackages, storeGaps };
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
    const got = await storeLock.attempt(targetDir, () => startOp((signal) => piUpdateAll(targetDir, signal, runCmdFn), 'busy'));
    if (!got.ran) return;
    const r = got.value;
    if (r.ok) statusMsg = t(state.language, 'status.ext-updated');
    afterPiCommand(r, { type: 'update-result', ok: r.ok, message: r.ok ? t(state.language, 'status.ext-updated') : cmdFailureText(r, state.language, 'status.update-error', null) }, targetDir, scope);
  }

  async function doRemove(dir: string, source: string): Promise<void> {
    const got = await storeLock.attempt(dir, () => startOp((signal) => piRemove(dir, source, signal, runCmdFn), 'busy'));
    if (!got.ran) return;
    const r = got.value;
    if (r.ok) statusMsg = t(state.language, 'status.ext-removed', { name: source });
    afterPiCommand(r, { type: 'remove-result', ok: r.ok, message: r.ok ? source : cmdFailureText(r, state.language, 'status.remove-error', source) }, dir, 'main');
  }

  async function doUpdateOne(dir: string, source: string): Promise<void> {
    const got = await storeLock.attempt(dir, () => startOp((signal) => piUpdateOne(dir, source, signal, runCmdFn), 'busy'));
    if (!got.ran) return;
    const r = got.value;
    if (r.ok) statusMsg = t(state.language, 'status.updated', { name: source });
    afterPiCommand(r, { type: 'update-result', ok: r.ok, message: r.ok ? source : cmdFailureText(r, state.language, 'status.update-error', source) }, dir, 'main');
  }

  /**
   * Доноска реестра хранилища: `pi install` по очереди (параллельные установки спорили бы
   * за `package.json` хранилища). Провал одной — остаток не ставится, в статусе команда.
   */
  async function doStoreInstallSources(sources: string[]): Promise<void> {
    for (const source of sources) {
      const got = await storeLock.attempt(storeDir, () => startOp((signal) => piInstall(storeDir, source, signal, runCmdFn), 'busy'));
      if (!got.ran) return;
      const r = got.value;
      if (!r.ok) {
        statusMsg = t(state.language, 'status.store-partial-install', { name: source });
        break;
      }
    }
    reloadCatalog();
    void checkUpdates(storeDir, 'main');
    repaint();
  }

  async function doInstall(installDir: string, source: string, envName: string | null): Promise<void> {
    const got = await storeLock.attempt(installDir, () => startOp((signal) => piInstall(installDir, source, signal, runCmdFn), 'busy'));
    if (!got.ran) return;
    const r = got.value;
    if (r.ok) statusMsg = t(state.language, 'status.installed', { name: source });
    let sources: string[] | undefined;
    if (r.ok) {
      if (envName !== null) {
        const settings = readSettings(join(root, envName)) ?? {};
        sources = (settings.packages ?? []).map((s) => normalizePkgSource(s, catalog.packages));
      } else {
        reloadCatalog();
        void checkUpdates(storeDir, 'main');
      }
    }
    state = reducer(state, { type: 'install-result', ok: r.ok, message: r.ok ? source : cmdFailureText(r, state.language, 'status.install-error', source), sources }, rctx());
    repaint();
  }

  /**
   * Разрешение конфликта источников пакета (один выбор — «победитель»):
   * (а) `settings.packages` каждого окружения, объявившего это имя (основной агент — тоже,
   *     его каталог лежит вне `<root>`), переписывается точечно; (б) хранилище приводится
   *     к тому же источнику: `pi remove` проигравшего (только если он в реестре) и
   *     `pi install` победителя — последовательно, под замком хранилища.
   *
   * Порядок выбран так, чтобы отмена в хранилище не оставляла невидимого поломанного
   * состояния: объявления уже единые, а реестр на проигравшем — это `missingPackages` у
   * окружений и «осиротевший» пакет на вкладке, то есть видимые ⚠, которые лечатся
   * повторной операцией. Реестр правят сами `pi remove`/`pi install` — своего писателя нет.
   */
  async function doResolveConflict(name: string, winner: string, mode: 'conflict' | 'store' = 'conflict'): Promise<void> {
    const lang = state.language;
    const okText = (envCount: number): string => (mode === 'conflict'
      ? t(lang, 'status.conflict-resolved', { name, winner, envs: envCount })
      : t(lang, 'status.registry-repaired', { name, winner }));
    const failText = (v: string): string => (mode === 'conflict'
      ? t(lang, 'status.conflict-error', { name, v })
      : t(lang, 'status.registry-repair-error', { name, v }));
    const finish = (ok: boolean, message: string): void => {
      statusMsg = message;
      state = reducer(state, { type: 'resolve-result', ok, message }, rctx());
      repaint();
    };
    if (winner === '') {
      finish(false, failText(t(lang, 'err.conflict-no-source')));
      return;
    }
    const envs = load().envs;
    const group = envs.filter((e) => e.details.packages.some((s) => pkgIdentity(s) === name));
    try {
      for (const e of group) {
        const next = rewritePackages(e.details.packages, name, winner);
        if (sameSources(next, e.details.packages)) continue;
        patchSettings(e.path, { packages: next });
      }
    } catch (err) {
      log('store', `конфликт «${name}»: settings.json — ${errText(err)}`);
      finish(false, failText(errText(err)));
      return;
    }
    cache.invalidate(); // settings.json окружений группы переписаны

    const registry = storeRegistrySources(storeDir);
    const losers = registry.filter((s) => pkgIdentity(s) === name && s !== winner);
    const needInstall = !registry.includes(winner);
    const got = await storeLock.attempt(storeDir, async (): Promise<string | null> => {
      for (const loser of losers) {
        const r = await startOp((signal) => piRemove(storeDir, loser, signal, runCmdFn), 'busy');
        if (!r.ok) return cmdFailureText(r, lang, 'status.remove-error', loser);
      }
      if (!needInstall) return null;
      const r = await startOp((signal) => piInstall(storeDir, winner, signal, runCmdFn), 'busy');
      return r.ok ? null : cmdFailureText(r, lang, 'status.install-error', winner);
    });
    if (!got.ran) {
      // Замок занят: причину уже сказал `onRefuse` (status.store-busy) — экран закрываем.
      state = reducer(state, { type: 'resolve-result', ok: false, message: '' }, rctx());
      repaint();
      return;
    }
    reloadCatalog();
    void checkUpdates(storeDir, 'main');
    const failed = got.value;
    finish(failed === null, failed === null ? okText(group.length) : failText(failed));
  }

  function sameSources(a: string[], b: string[]): boolean {
    return a.length === b.length && a.every((s, i) => s === b[i]);
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
    root, agentDir, storeDir, term,
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
    doRemove: (dir, source) => { void doRemove(dir, source); },
    doUpdateAll: (dir, scope) => { void doUpdateAll(dir, scope); },
    doUpdateOne: (dir, source) => { void doUpdateOne(dir, source); },
    doInstall: (dir, source, envName) => { void doInstall(dir, source, envName); },
    doResolveConflict: (name, winner, mode) => { void doResolveConflict(name, winner, mode); },
    storeInstallSources: (sources) => { void doStoreInstallSources(sources); },
    doMcpAdd: (dir, form, scope) => { void doMcpAdd(dir, form, scope); },
    doMcpCheck: (dir, scope) => { void doMcpCheck(dir, scope); },
    cancelBusy: () => cancelBusy(),
    invalidate: () => cache.invalidate(),
    storeFile: () => storeFile,
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
    const rows = envRows(envs);
    const names = realNames(envs);
    const tnames = trashNames();
    const prev: PrevSnap = { cancelRequested: false, view: state.create?.view ?? null, ext: state.ext, mcp: state.mcp, tab: state.tab, mcpCheck: state.mcpCheck, createMcpCheck: state.create?.mcpCheck ?? 'idle', selfCheck: state.selfCheck };
    const row = envs[state.selected];
    if (key === 'c' && state.tab === 'envs' && state.sub === null && state.trash === null && state.clone === null && row !== undefined) {
      // `C` на основной строке — форма создания из основного: дерево агентского каталога
      // (sessions/, install/releases, tmp/) не копируется.
      state = row.main === true
        ? reducer(state, { type: 'create-open', fromMain: true }, rctx({ rows, tnames, names }))
        : reducer(state, { type: 'clone-start', name: row.name, path: row.path }, rctx({ rows, tnames, names }));
    } else if (key === 'e' && state.tab === 'envs' && state.sub === null && state.trash === null && state.clone === null && row !== undefined) {
      const settings = readSettings(row.path) ?? {};
      state = reducer(state, {
        type: 'edit-start', name: row.name, path: row.path, main: row.main === true, settings,
        mcp: readMcpServers(row.path),
        store: row.details.modelsLink === 'linked',
        storeRoots: row.details.rootLinks.npm !== 'off' || row.details.rootLinks.git !== 'off',
        storeBroken: row.details.modelsLink === 'broken'
          || row.details.rootLinks.npm === 'broken' || row.details.rootLinks.git === 'broken',
        enabledModels: settings.enabledModels ?? [],
        modelCatalog: listProviders(row.path),
      }, rctx({ rows, tnames, names }));
    } else if ((key === 'r' || key === 'R') && state.tab === 'envs' && state.sub === null && state.trash === null && state.clone === null && row !== undefined) {
      // `R` на вкладке окружений — починка битых симлинков общего хранилища (модели и пакеты).
      const file = storeFile;
      const rootsBroken = row.details.rootLinks.npm === 'broken' || row.details.rootLinks.git === 'broken';
      if ((file !== null && row.details.modelsLink === 'broken') || rootsBroken) {
        let r: StoreResult = { ok: true };
        if (file !== null && row.details.modelsLink === 'broken') r = repairModelsLink(row.path, file, agentDir, state.language);
        if (r.ok && rootsBroken) r = repairStoreRootLinks(row.path, storeDir, STORE_ROOTS, state.language);
        cache.invalidate();
        statusMsg = r.ok ? t(state.language, 'status.store-repaired') : r.error;
      }
    } else {
      state = reducer(state, key, rctx({ rows, tnames, names, conflicts: packageConflicts(envs) }));
    }
    // Заявка на отмену считается после reducer: экран процесса — тот, что стал текущим.
    prev.cancelRequested = key === 'esc' && busyProcessView(state);
    if (state.colorToggle !== prevColor || state.recheckUpdates !== prevRecheck || state.recheckMcp !== prevRecheckMcp || state.language !== prevLang) {
      saveAppSettings(root, { color: state.colorToggle, recheckUpdates: state.recheckUpdates, recheckMcp: state.recheckMcp, storeDir: app.storeDir, language: state.language });
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
