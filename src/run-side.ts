import { join } from 'node:path';
import { cloneEnvironment, createEnvironment, updateEnvironmentAt } from './create.js';
import { copyMcpEntry, removeMcpEntry, readMcpServers } from './mcp.js';
import { deleteTrashForever, moveToTrash, restoreTrash } from './trash.js';
import { t } from './i18n.js';
import { reducer, makeCtx } from './state.js';
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
  status(msg: string | null): void;
  twoColumns(): boolean;
  envs(): Environment[];
  repaint(): void;
  reloadCatalog(): void;
  checkUpdates(targetDir: string, scope: 'main' | 'create'): void;
  loadPackageCatalog(): void;
  doRemove(source: string): void;
  doUpdateAll(targetDir: string, scope: 'main' | 'create'): void;
  doUpdateOne(source: string): void;
  doInstall(installDir: string, source: string, envName: string | null): void;
  doMcpAdd(dir: string, form: McpFormAdd, scope: 'main' | 'create'): void;
  doMcpCheck(dir: string, scope: 'main' | 'create'): void;
  /** Снять процесс, которому принадлежит текущий busy-экран (Esc). */
  cancelBusy(): void;
  /** Имена записей корзины из кэша снимка (без повторного обхода диска). */
  trashNames(): string[];
  /** Сбросить кэш снимка окружений (после любой мутации конфигов). */
  invalidate(): void;
  runSelfUpdate(): void;
  loadChangelog(): void;
}

/** Контекст reducer для side-effect-хуков (имена записей корзины — для суб-экрана «Корзина»). */
function rctx(loop: Loop, envNames: string[]): ReducerCtx {
  return makeCtx(envNames, loop.twoColumns(), loop.trashNames());
}

/** Имена обычных окружений из снимка: основная запись в проверке имён не участвует. */
function envNames(loop: Loop): string[] {
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
    loop.checkUpdates(loop.agentDir, 'main');
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
  const name = pending.dirName.split('@')[0] ?? pending.dirName;
  const r = pending.kind === 'restore'
    ? restoreTrash(loop.root, pending.dirName, lang)
    : deleteTrashForever(loop.root, pending.dirName, lang);
  loop.invalidate(); // корзина меняет и окружения, и список записей
  const message = r.ok
    ? t(lang, pending.kind === 'restore' ? 'status.trash-restored' : 'status.trash-deleted', { name })
    : r.error;
  loop.status(message);
  // Имена окружений — свежие (после восстановления их стало больше): по ним reducer держит курсор на «Корзина».
  loop.setState(reducer(loop.state(), { type: 'trash-result', ok: r.ok, message }, rctx(loop, envNames(loop))));
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
  const res = cloneEnvironment(loop.root, cl.srcPath, cl.name, envNames(loop), lang);
  loop.invalidate(); // в списке окружений появился клон
  const message = res.ok ? t(lang, 'status.env-cloned', { name: cl.name }) : res.error;
  loop.status(message);
  // Имена окружений — свежие (после инвалидации их стало больше): по ним reducer ставит курсор на копию.
  loop.setState(reducer(loop.state(), { type: 'clone-result', ok: res.ok, message, name: cl.name }, rctx(loop, envNames(loop))));
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
  if (v === 'removing' && prevView === 'confirm-remove') {
    const pkg = cr.removing !== null ? loop.catalog().packages.find((p) => p.name === cr.removing) : undefined;
    if (pkg) loop.doRemove(pkg.source);
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
    loop.doInstall(loop.agentDir, 'npm:' + (e.installing ?? ''), null);
  } else if (e.view === 'removing' && prevExt !== null && prevExt.view === 'confirm-remove') {
    const pkg = loop.catalog().packages.find((p) => p.name === e.removing);
    if (pkg) loop.doRemove(pkg.source);
  } else if (e.view === 'updating' && prevExt === null) {
    if (e.updating === null) {
      loop.doUpdateAll(loop.agentDir, 'main');
      return;
    }
    const pkg = loop.catalog().packages.find((p) => p.name === e.updating);
    if (pkg) loop.doUpdateOne(pkg.source);
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

function doSubmit(loop: Loop, names: string[]): void {
  const cr = loop.state().create;
  if (cr === null || cr.view !== 'submitting') return;
  const cat = loop.catalog();
  const req = buildCreateRequest(cat, cr);
  const lang = loop.state().language;
  const res = cr.mode === 'edit'
    // Основное окружение: имя каталога и ресурсы (extensions/, skills/) не трогаются,
    // settings.json правится точечно.
    ? updateEnvironmentAt(formInstallDir(loop), req, { allTools: cat.tools, allSkills: cat.skills },
      { rename: !cr.main, syncResources: !cr.main, modelSource: cr.main ? undefined : loop.agentDir }, lang)
    : createEnvironment(loop.root, req, loop.agentDir, lang);
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
  loop.setState(reducer(loop.state(), { type: 'run-result', ok: res.ok }, rctx(loop, envNames(loop))));
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
