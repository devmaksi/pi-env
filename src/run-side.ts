import { existsSync, lstatSync, mkdirSync, renameSync } from 'node:fs';
import { join, relative } from 'node:path';
import { cloneEnvironment, createEnvironment, updateEnvironmentAt } from './create.js';
import { copyMcpEntry, removeMcpEntry, readMcpServers } from './mcp.js';
import {
  deleteTrashFileForever, deleteTrashForever, moveFileToTrash, moveToTrash,
  restoreTrash, restoreTrashFile, trashEntryDisplayName, trashFileName, trashFilesRoot,
} from './trash.js';
import {
  archiveEnvModelsIntoStore, enableModelsStorage, restoreFromStoreSnapshot, unlinkModels,
  disableStoreRoots, enableStoreRoots, envRootDir, snapshotStoreManifest, STORE_ROOTS,
  storePackagesRoot, storeRegistrySources, storeRootSnapshotName, type StoreResult, type StoreRoot,
} from './store.js';
import { t } from './i18n.js';
import { reducer, makeCtx, storeSummaryOf } from './state.js';
import { buildCreateRequest } from './pi-actions.js';
import { launchPi } from './pirun.js';
import type { Catalog } from './catalog.js';
import { realEnvNames, type Environment } from './environments.js';
import type { AppState, CreateView, ExtState, McpFormAdd, McpTab, PkgCheck, Tab, UpdateCheck, ReducerCtx } from './state.js';
import type { Term } from './terminal.js';

/** Снимок суб-экранов и вкладки до обработки клавиши. */
export interface PrevSnap {
  /** Esc на экране процесса: процесс надо снять (заявку считает `run.ts` по `busyProcessView`). */
  cancelRequested: boolean;
  view: CreateView | null;
  ext: ExtState | null;
  mcp: McpTab | null;
  tab: Tab;
  mcpCheck: PkgCheck;
  createMcpCheck: PkgCheck;
  selfCheck: UpdateCheck;
}

/** Окно в состояние цикла запуска для обработчиков побочных эффектов. */
export interface Loop {
  root: string;
  agentDir: string;
  term: Term;
  state(): AppState;
  setState(next: AppState): void;
  catalog(): Catalog;
  /** Каталог общего хранилища: сюда идут `pi install/update/remove` вкладки «Расширения». */
  storeDir: string;
  status(msg: string | null): void;
  twoColumns(): boolean;
  envs(): Environment[];
  repaint(): void;
  reloadCatalog(): void;
  checkUpdates(targetDir: string, scope: 'main' | 'create'): void;
  loadPackageCatalog(): void;
  doRemove(dir: string, source: string): void;
  doUpdateAll(targetDir: string, scope: 'main' | 'create'): void;
  doUpdateOne(dir: string, source: string): void;
  doInstall(installDir: string, source: string, envName: string | null): void;
  doMcpAdd(dir: string, form: McpFormAdd, scope: 'main' | 'create'): void;
  doMcpCheck(dir: string, scope: 'main' | 'create'): void;
  /** Снять процесс, которому принадлежит текущий busy-экран (Esc). */
  cancelBusy(): void;
  /** Имена записей корзины из кэша снимка (без повторного обхода диска). */
  trashNames(): string[];
  /** Сбросить кэш снимка окружений (после любой мутации конфигов). */
  invalidate(): void;
  /** Общий файл каталога моделей; null — хранилище выключено. */
  storeFile(): string | null;
  /** `pi install` в хранилище по очереди (доноска реестра при включении хранилища). */
  storeInstallSources(sources: string[]): void;
  runSelfUpdate(): void;
  loadChangelog(): void;
}

/**
 * Контекст reducer для side-effect-хуков.
 * `envNames` — список окружений целиком (с основной записью): именно так строки нумерует
 * `renderEnvList`, и по ним живут курсор, «Создать» и «Корзина». `realNames` — имена обычных
 * окружений (`names`), по ним проверяется уникальность имени.
 */
function rctx(loop: Loop, names: string[]): ReducerCtx {
  const envs = loop.envs();
  return makeCtx(envs.map((e) => e.name), loop.twoColumns(), loop.trashNames(), names);
}

/** Имена обычных окружений (без основной записи) из снимка — для проверки уникальности имён. */
function realNames(loop: Loop): string[] {
  return realEnvNames(loop.envs());
}

/** Хуки переходов после reducer — 1-в-1 с телом прежнего dispatch. */
export async function runSideEffects(loop: Loop, envs: Environment[], prev: PrevSnap): Promise<void> {
  if (prev.cancelRequested) loop.cancelBusy();
  const names = realEnvNames(envs);
  hooksCreate(loop, prev.view, names);
  hooksExt(loop, prev.ext);
  hooksMcp(loop, prev.mcp, names);
  hooksMcpCheck(loop, prev);
  hooksUpdate(loop, prev);
  hooksTrash(loop);
  hooksClone(loop);
  hooksCopy(loop);
  if (prev.tab !== 'extensions' && loop.state().tab === 'extensions' && loop.state().ext === null &&
      (loop.state().pkgCheck === 'idle' || loop.state().recheckUpdates)) {
    loop.checkUpdates(loop.storeDir, 'main');
  }
  doSubmit(loop, names);
  doDelete(loop, names);
  await doRun(loop, envs);
}

/**
 * Действия суб-экрана «Корзина»: восстановление записи и «удалить совсем».
 * Синхронные файловые операции (как mcpOpSync): результат — в reducer и статус-строку.
 */
function hooksTrash(loop: Loop): void {
  const pending = loop.state().trash?.pending ?? null;
  if (pending === null) return;
  const lang = loop.state().language;
  // Запись корзины — каталог окружения или одиночный файл (ветка `.trash/files`).
  const isFile = existsSync(join(trashFilesRoot(loop.root), pending.dirName));
  const name = trashEntryDisplayName(pending.dirName);
  const r = pending.kind === 'restore'
    ? (isFile ? restoreTrashFile(loop.root, pending.dirName, lang) : restoreTrash(loop.root, pending.dirName, lang))
    : (isFile ? deleteTrashFileForever(loop.root, pending.dirName, lang) : deleteTrashForever(loop.root, pending.dirName, lang));
  loop.invalidate(); // корзина меняет и окружения, и список записей
  const message = r.ok
    ? t(lang, pending.kind === 'restore' ? 'status.trash-restored' : 'status.trash-deleted', { name })
    : r.error;
  loop.status(message);
  // Снимок свежий (после инвалидации): reducer по строкам `ctx.envNames` держит курсор на «Корзина»,
  // а `realNames` нужны ему только на проверку имён.
  loop.setState(reducer(loop.state(), { type: 'trash-result', ok: r.ok, message }, rctx(loop, realNames(loop))));
  loop.repaint();
}

/**
 * Клонирование окружения: суб-экран ждёт Enter (`clone.pending`) — копирование каталога
 * выполняется синхронно (как операции корзины) и снимается результатом `clone-result`.
 */
function hooksClone(loop: Loop): void {
  const cl = loop.state().clone;
  if (cl === null || !cl.pending) return;
  // Копирование каталога блокирует цикл (своя файловая операция, не дочерний процесс),
  // а окружение может весить сотни мегабайт: кадр с «Копирование…» показываем до него.
  loop.repaint();
  const lang = loop.state().language;
  const res = cloneEnvironment(loop.root, cl.srcPath, cl.name, realNames(loop), lang);
  loop.invalidate(); // в списке окружений появился клон
  const message = res.ok ? t(lang, 'status.env-cloned', { name: cl.name }) : res.error;
  loop.status(message);
  // Снимок свежий (после инвалидации): reducer по строкам `ctx.envNames` ставит курсор на копию.
  loop.setState(reducer(loop.state(), { type: 'clone-result', ok: res.ok, message, name: cl.name }, rctx(loop, realNames(loop))));
  loop.repaint();
}

/** Каталог, чьи обновления показывает форма: при создании — main-агент (окружение ещё
 * не создано), при правке обычного окружения — каталог окружения, при правке основного —
 * каталог main-агента. */
function formTargetDir(loop: Loop): string {
  const cr = loop.state().create!;
  if (cr.mode !== 'edit' || cr.main) return loop.agentDir;
  return join(loop.root, cr.origName ?? cr.name);
}

/** Каталог, в который форма устанавливает пакеты и добавляет MCP: при создании это уже
 *  созданный каталог нового окружения, при правке основного — каталог main-агента. */
function formInstallDir(loop: Loop): string {
  const cr = loop.state().create!;
  return cr.mode === 'edit' && cr.main ? loop.agentDir : join(loop.root, cr.origName ?? cr.name);
}

function hooksCreate(loop: Loop, prevView: CreateView | null, names: string[]): void {
  const cr = loop.state().create;
  if (cr === null) return;
  const v = cr.view;
  if (v === 'store-op' && prevView !== 'store-op') {
    storeOperation(loop, names);
  } else if (v === 'removing' && prevView === 'confirm-remove') {
    const pkg = cr.removing !== null ? loop.catalog().packages.find((p) => p.name === cr.removing) : undefined;
    if (pkg) loop.doRemove(formTargetDir(loop), pkg.source);
  } else if (v === 'updating' && prevView === 'packages') {
    loop.doUpdateAll(formTargetDir(loop), 'create');
  } else if (v === 'packages' && prevView === 'form' && cr.check !== 'checking') {
    loop.checkUpdates(formTargetDir(loop), 'create');
  } else if (v === 'install' && prevView === 'packages' && cr.installStatus === 'loading') {
    loop.loadPackageCatalog();
  } else if (v === 'installing' && prevView === 'install') {
    const envName = cr.origName ?? cr.name;
    loop.doInstall(formInstallDir(loop), 'npm:' + (cr.installing ?? ''), envName);
  } else if (v === 'mcp-op' && cr.mcpOp !== null) {
    mcpOpSync(loop, cr.mcpOp, names);
  } else if (v === 'mcp-submitting' && prevView === 'mcp' && cr.mcpAdd !== null) {
    loop.doMcpAdd(formInstallDir(loop), cr.mcpAdd, 'create');
  }
}

function mcpOpSync(loop: Loop, op: { name: string; kind: 'copy' | 'remove' }, names: string[]): void {
  const envDir = formInstallDir(loop);
  const r = op.kind === 'copy' ? copyMcpEntry(loop.agentDir, envDir, op.name) : removeMcpEntry(envDir, op.name);
  loop.invalidate(); // mcp.json окружения — часть снимка
  const list = readMcpServers(envDir);
  const okMsg = op.kind === 'copy'
    ? t(loop.state().language, 'status.mcp-copied', { name: op.name })
    : t(loop.state().language, 'status.mcp-removed', { name: op.name });
  const errMsg = op.kind === 'copy' ? t(loop.state().language, 'status.mcp-copy-error') : t(loop.state().language, 'status.mcp-remove-error');
  const message = r.ok ? okMsg : (r.error !== undefined ? errMsg + ': ' + r.error : errMsg);
  loop.status(message);
  loop.setState(reducer(loop.state(), { type: 'mcp-result', ok: r.ok, message, scope: 'create', list }, rctx(loop, names)));
  loop.repaint();
}

function hooksExt(loop: Loop, prevExt: ExtState | null): void {
  const e = loop.state().ext;
  if (e === null) return;
  if (e.view === 'catalog' && prevExt === null && e.catalogStatus === 'loading') {
    loop.loadPackageCatalog();
  } else if (e.view === 'installing' && prevExt !== null && prevExt.view === 'catalog') {
    loop.doInstall(loop.storeDir, 'npm:' + (e.installing ?? ''), null);
  } else if (e.view === 'removing' && prevExt !== null && prevExt.view === 'confirm-remove') {
    const pkg = loop.state().storePackages.find((p) => p.name === e.removing);
    if (pkg) loop.doRemove(loop.storeDir, pkg.source);
  } else if (e.view === 'updating' && prevExt === null) {
    if (e.updating === null) {
      loop.doUpdateAll(loop.storeDir, 'main');
      return;
    }
    const pkg = loop.state().storePackages.find((p) => p.name === e.updating);
    if (pkg) loop.doUpdateOne(loop.storeDir, pkg.source);
  }
}

function hooksMcp(loop: Loop, prevMcp: McpTab | null, names: string[]): void {
  const m = loop.state().mcp;
  if (m === null) return;
  if (m.view === 'submitting' && prevMcp !== null && prevMcp.view === 'add' && m.form !== null) {
    loop.doMcpAdd(loop.agentDir, m.form, 'main');
  } else if (m.view === 'removing' && prevMcp !== null && prevMcp.view === 'confirm-remove' && m.removing !== null) {
    const r = removeMcpEntry(loop.agentDir, m.removing);
    const msg = r.ok ? t(loop.state().language, 'status.mcp-removed', { name: m.removing }) : t(loop.state().language, 'status.mcp-remove-error');
    loop.status(msg);
    if (r.ok) loop.reloadCatalog();
    loop.invalidate();
    loop.setState(reducer(loop.state(), { type: 'mcp-result', ok: r.ok, message: msg, scope: 'main' }, rctx(loop, names)));
    loop.repaint();
  }
}

/**
 * Живой статус MCP: запуск `pi mcp list` — по R (переход mcpCheck → checking)
 * и при входе в список: первый вход (idle) или каждый, если включена
 * настройка «Перепроверять MCP».
 */
function hooksMcpCheck(loop: Loop, prev: PrevSnap): void {
  const st = loop.state();
  if (st.tab === 'mcp' && st.mcp === null) {
    if (st.mcpCheck === 'checking' && prev.mcpCheck !== 'checking') {
      loop.doMcpCheck(loop.agentDir, 'main');
      return;
    }
    if (prev.tab !== 'mcp' && (st.mcpCheck === 'idle' || st.recheckMcp)) startMcpCheck(loop, loop.agentDir, 'main');
    return;
  }
  const cr = st.create;
  if (st.sub !== 'create' || cr === null || cr.view !== 'mcp' || cr.mcpAdd !== null) return;
  if (cr.mcpCheck === 'checking' && prev.createMcpCheck !== 'checking') {
    loop.doMcpCheck(formTargetDir(loop), 'create');
    return;
  }
  if (prev.view !== 'mcp' && (cr.mcpCheck === 'idle' || st.recheckMcp)) startMcpCheck(loop, formTargetDir(loop), 'create');
}

/** Отметка «проверка идёт» (нужна для индикатора) и запуск команды. */
function startMcpCheck(loop: Loop, dir: string, scope: 'main' | 'create'): void {
  const st = loop.state();
  loop.setState(scope === 'main'
    ? { ...st, mcpCheck: 'checking' }
    : { ...st, create: { ...st.create!, mcpCheck: 'checking' } });
  loop.doMcpCheck(dir, scope);
}

/**
 * Переключение хранилища каталога моделей: включение — своя копия уходит в корзину
 * файлов (или в снимок хранилища для каталога main-агента) и ставится симлинк;
 * выключение — вместо симлинка обычная копия общего файла.
 */
/**
 * Строка «Хранилище»: один диалог включает и выключает оба среза — каталог моделей
 * (`models.json`) и пакетные корни (`npm`, `git`). Отдельных переключателей на корень нет:
 * частичная связь только показывается (`store.partial`), а лечится этим же диалогом или `R`.
 */
function storeOperation(loop: Loop, names: string[]): void {
  const cr = loop.state().create!;
  const lang = loop.state().language;
  const wanted = storeSummaryOf(cr) === 'off';
  // При создании окружения файловых операций нет: каталога ещё нет, флаги уйдут в createEnvironment.
  if (cr.mode !== 'edit') {
    loop.setState(reducer(loop.state(), { type: 'store-result', ok: true, message: '', store: wanted, storeRoots: wanted }, rctx(loop, names)));
    return;
  }
  const storeFile = loop.storeFile();
  if (storeFile === null) {
    // Общий файл — якорь хранилища: без него не включается ни один срез.
    const message = t(lang, 'err.store-no-source');
    loop.status(message);
    loop.setState(reducer(loop.state(), { type: 'store-result', ok: false, message, store: cr.store, storeRoots: cr.storeRoots }, rctx(loop, names)));
    return;
  }
  const dir = formInstallDir(loop);
  const envName = cr.origName ?? cr.name;
  const store = loop.storeDir;
  const now = Date.now();
  let res: StoreResult = { ok: true };
  if (wanted) {
    // Порядок: сначала общий файл моделей, потом свои пакетные корни (переезд в хранилище
    // при первом включении, иначе снимок `<корень>.from-<окружение>-<мс>`), и лишь затем симлинки.
    res = enableModelsStorage(dir, storeFile, loop.agentDir, lang, now,
        relative(loop.root, dir).startsWith('..')
          ? snapshotOwn(dir, storeFile, now, lang)
          : fileTrashOwn(loop.root, envName, now, lang));
    if (res.ok) {
      snapshotStoreManifest(store, now);
      res = enableStoreRoots(dir, store, STORE_ROOTS, lang, rootsOwn(dir, envName, store, now, lang));
    }
  } else {
    res = disableStoreRoots(dir, store, STORE_ROOTS, lang);
    if (res.ok) res = unlinkModels(dir, storeFile, lang);
  }
  const message = res.ok ? t(lang, wanted ? 'status.store-enabled' : 'status.store-disabled') : res.error;
  loop.status(message);
  loop.invalidate(); // менялись models.json и пакетные корни окружения (или их не стало)
  // Провал — флаги остаются прежними: файловое состояние не изменилось, врать про него нельзя.
  loop.setState(reducer(loop.state(), {
    type: 'store-result', ok: res.ok, message,
    store: res.ok ? wanted : cr.store,
    storeRoots: res.ok ? wanted : cr.storeRoots,
  }, rctx(loop, names)));
  if (res.ok && wanted) {
    // Доноска: объявления окружения, которых нет в реестре хранилища, ставятся в хранилище.
    const registry = new Set(storeRegistrySources(store));
    const missing = cr.packages.filter((src) => !registry.has(src));
    if (missing.length > 0) loop.storeInstallSources(missing);
  }
  loop.repaint();
}

/**
 * Куда деть своё содержимое пакетного корня при включении: при первом включении оно
 * переезжает в хранилище и становится общим, иначе это лишняя копия — снимок внутри
 * хранилища. В файловую корзину каталог класть нельзя (он там не виден).
 */
function rootsOwn(
  envDir: string, envName: string, storeDir: string, now: number, lang: string,
): { move: (root: StoreRoot) => StoreResult; undo: (root: StoreRoot) => void } {
  const snapshots = new Map<StoreRoot, string>();
  return {
    move: (root) => {
      const from = envRootDir(envDir, root);
      let st: ReturnType<typeof lstatSync> | undefined;
      try {
        st = lstatSync(from, { throwIfNoEntry: false });
      } catch {
        return { ok: false, error: t(lang, 'err.link-root') };
      }
      if (st === undefined || st === null) return { ok: true }; // своего содержимого нет — нечего переносить
      if (st.isSymbolicLink() || !st.isDirectory()) return { ok: false, error: t(lang, 'err.link-root') };
      const target = storePackagesRoot(storeDir, root);
      const dest = existsSync(target) ? join(storeDir, storeRootSnapshotName(root, envName, now)) : target;
      try {
        mkdirSync(storeDir, { recursive: true });
        renameSync(from, dest);
        snapshots.set(root, dest);
      } catch {
        return { ok: false, error: t(lang, 'err.link-root') };
      }
      return { ok: true };
    },
    undo: (root) => {
      const snap = snapshots.get(root);
      if (snap === undefined) return;
      try {
        renameSync(snap, envRootDir(envDir, root));
        snapshots.delete(root);
      } catch {
        /* содержимое осталось в хранилище — симлинк снят, потеря невозможна */
      }
    },
  };
}

/** Своя копия `models.json` окружения внутрь `<root>` — в корзину файлов, с откатом. */
function fileTrashOwn(root: string, envName: string, now: number, lang: string): { move: () => StoreResult; undo: () => void } {
  let entryName: string | null = null;
  return {
    move: () => {
      if (!ownRegularFile(join(root, envName))) return { ok: true }; // переносить нечего
      const r = moveFileToTrash(root, envName, 'models.json', now, lang);
      if (r.ok) entryName = trashFileName(envName, 'models.json', now);
      return r;
    },
    undo: () => { if (entryName !== null) restoreTrashFile(root, entryName, lang); },
  };
}

/** Своя копия каталога вне `<root>` (каталог main-агента) — в снимок хранилища, с откатом. */
function snapshotOwn(envDir: string, storeFile: string, now: number, lang: string): { move: () => StoreResult; undo: () => void } {
  let snapshot: string | null = null;
  return {
    move: () => {
      if (!ownRegularFile(envDir)) return { ok: true }; // архивировать нечего
      snapshot = archiveEnvModelsIntoStore(envDir, storeFile, now);
      return snapshot === null ? { ok: false, error: t(lang, 'err.models-link') } : { ok: true };
    },
    undo: () => { if (snapshot !== null) restoreFromStoreSnapshot(snapshot, envDir); },
  };
}

/** В окружении есть свой обычный `models.json` (не симлинк) — есть что убирать в корзину/снимок. */
function ownRegularFile(envDir: string): boolean {
  const st = lstatSync(join(envDir, 'models.json'), { throwIfNoEntry: false });
  return st !== undefined && st !== null && !st.isSymbolicLink();
}

function doSubmit(loop: Loop, names: string[]): void {
  const cr = loop.state().create;
  if (cr === null || cr.view !== 'submitting') return;
  const cat = loop.catalog();
  const req = buildCreateRequest(cat, cr);
  if (cr.modelsTouched) req.enabledModels = cr.modelsSel;
  const lang = loop.state().language;
  const store = { storeFile: loop.storeFile(), storeModels: cr.store, storeDir: loop.storeDir, storeRoots: cr.storeRoots };
  const res = cr.mode === 'edit'
    // Основное окружение: имя каталога и ресурсы (extensions/, skills/) не трогаются,
    // settings.json правится точечно.
    ? updateEnvironmentAt(formInstallDir(loop), req, { allTools: cat.tools, allSkills: cat.skills },
      {
        rename: !cr.main, syncResources: !cr.main, ...store,
        // После переключения хранилища каталог моделей уже разобран (симлинк или своя копия) —
        // copying из main-агента молча перезаписал бы результат.
        modelSource: cr.main || cr.storeTouched ? undefined : loop.agentDir,
      }, lang)
    : createEnvironment(loop.root, req, loop.agentDir, lang, store);
  const message = res.ok ? res.path : res.error;
  loop.invalidate(); // создано/переименовано/обновлено окружение
  loop.setState(reducer(loop.state(), { type: 'create-result', ok: res.ok, message }, rctx(loop, names)));
}

function doDelete(loop: Loop, names: string[]): void {
  const cr = loop.state().create;
  if (cr === null || cr.view !== 'deleting') return;
  const name = cr.name;
  // Защита основного агента: строки «Удалить» в его форме нет, этот путь — оборона.
  if (cr.main) {
    loop.setState(reducer(loop.state(), { type: 'delete-result', ok: false, message: t(loop.state().language, 'err.main-no-action') }, rctx(loop, names)));
    return;
  }
  const res = moveToTrash(loop.root, name, Date.now(), loop.state().language);
  loop.invalidate(); // окружение переехало в корзину
  if (res.ok) loop.status(t(loop.state().language, 'status.env-trashed', { name }));
  loop.setState(reducer(loop.state(), { type: 'delete-result', ok: res.ok, message: res.ok ? name : res.error }, rctx(loop, names)));
  if (res.ok) {
    const n = loop.envs().length;
    const st = loop.state();
    loop.setState({ ...st, selected: Math.max(0, Math.min(st.selected, n - 1)) });
  }
}

async function doRun(loop: Loop, envs: Environment[]): Promise<void> {
  const st = loop.state();
  if (!(st.sub === 'run' && st.tab === 'envs' && st.selected < envs.length)) return;
  const res = await launchPi(loop.term, envs[st.selected]);
  loop.invalidate(); // дочерний `pi` мог поменять конфиг окружения
  loop.setState(reducer(loop.state(), { type: 'run-result', ok: res.ok }, rctx(loop, realNames(loop))));
  if (!res.ok) loop.status(t(loop.state().language, 'status.pi-launch', { err: res.message }));
}

/**
 * Вкладка «Обновление»: R перечитывает реестр (reducer уже перевёл selfCheck в
 * loading), первый вход на вкладку грузит чейнджлог пропущенных релизов.
 */
function hooksUpdate(loop: Loop, prev: PrevSnap): void {
  const st = loop.state();
  if (st.selfUpdate === null || st.updateUi === null) return;
  if (st.selfCheck === 'loading' && prev.selfCheck !== 'loading') {
    loop.runSelfUpdate();
    return;
  }
  if (prev.tab !== 'update' && st.tab === 'update' && st.updateUi.rows.length === 0) loop.loadChangelog();
}

/** Enter на строке команды: копирование через OSC 52 и снятие запроса. */
function hooksCopy(loop: Loop): void {
  const ui = loop.state().updateUi;
  if (ui === null || ui.copyRequest === null) return;
  const text = ui.copyRequest;
  loop.term.copy(text);
  loop.status(t(loop.state().language, 'status.copied'));
  loop.setState({ ...loop.state(), updateUi: { ...ui, copyRequest: null } });
}
