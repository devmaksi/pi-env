import { join } from 'node:path';
import { createEnvironment, updateEnvironment, deleteEnvironment } from './create.js';
import { copyMcpEntry, removeMcpEntry, readMcpServers } from './mcp.js';
import { t } from './i18n.js';
import { reducer, makeCtx } from './state.js';
import { buildCreateRequest } from './pi-actions.js';
import { launchPi } from './pirun.js';
import type { Catalog } from './catalog.js';
import type { Environment } from './environments.js';
import type { AppState, CreateView, ExtState, McpFormAdd, McpTab, Tab, ReducerCtx } from './state.js';
import type { Term } from './terminal.js';

/** Снимок суб-экранов и вкладки до обработки клавиши. */
export interface PrevSnap {
  view: CreateView | null;
  ext: ExtState | null;
  mcp: McpTab | null;
  tab: Tab;
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
}

/** Контекст reducer для side-effect-хуков. */
function rctx(loop: Loop, envNames: string[]): ReducerCtx {
  return makeCtx(envNames, loop.twoColumns());
}

/** Хуки переходов после reducer — 1-в-1 с телом прежнего dispatch. */
export async function runSideEffects(loop: Loop, envs: Environment[], prev: PrevSnap): Promise<void> {
  const names = envs.map((e) => e.name);
  hooksCreate(loop, prev.view, names);
  hooksExt(loop, prev.ext);
  hooksMcp(loop, prev.mcp, names);
  if (prev.tab !== 'extensions' && loop.state().tab === 'extensions' && loop.state().ext === null &&
      (loop.state().pkgCheck === 'idle' || loop.state().recheckUpdates)) {
    loop.checkUpdates(loop.agentDir, 'main');
  }
  doSubmit(loop, names);
  doDelete(loop, names);
  await doRun(loop, envs);
}

/** Каталог агента для формы: окружение (edit) или main-агент (create, окружение ещё не существует). */
function formTargetDir(loop: Loop): string {
  const cr = loop.state().create!;
  return cr.mode === 'edit' ? join(loop.root, cr.origName ?? cr.name) : loop.agentDir;
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
    loop.doInstall(join(loop.root, envName), 'npm:' + (cr.installing ?? ''), envName);
  } else if (v === 'mcp-op' && cr.mcpOp !== null) {
    mcpOpSync(loop, cr.mcpOp, names);
  } else if (v === 'mcp-submitting' && prevView === 'mcp' && cr.mcpAdd !== null) {
    loop.doMcpAdd(join(loop.root, cr.origName ?? cr.name), cr.mcpAdd, 'create');
  }
}

function mcpOpSync(loop: Loop, op: { name: string; kind: 'copy' | 'remove' }, names: string[]): void {
  const cr = loop.state().create!;
  const envDir = join(loop.root, cr.origName ?? cr.name);
  const r = op.kind === 'copy' ? copyMcpEntry(loop.agentDir, envDir, op.name) : removeMcpEntry(envDir, op.name);
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
    loop.setState(reducer(loop.state(), { type: 'mcp-result', ok: r.ok, message: msg, scope: 'main' }, rctx(loop, names)));
    loop.repaint();
  }
}

function doSubmit(loop: Loop, names: string[]): void {
  const cr = loop.state().create;
  if (cr === null || cr.view !== 'submitting') return;
  const cat = loop.catalog();
  const req = buildCreateRequest(cat, cr);
  const res = cr.mode === 'edit'
    ? updateEnvironment(loop.root, cr.origName ?? cr.name, req, { allTools: cat.tools, allSkills: cat.skills, agentDir: loop.agentDir }, loop.state().language)
    : createEnvironment(loop.root, req, loop.agentDir, loop.state().language);
  const message = res.ok ? res.path : res.error;
  loop.setState(reducer(loop.state(), { type: 'create-result', ok: res.ok, message }, rctx(loop, names)));
}

function doDelete(loop: Loop, names: string[]): void {
  const cr = loop.state().create;
  if (cr === null || cr.view !== 'deleting') return;
  const name = cr.name;
  const res = deleteEnvironment(loop.root, name, loop.state().language);
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
  loop.setState(reducer(loop.state(), { type: 'run-result', ok: res.ok }, rctx(loop, envs.map((e) => e.name))));
  if (!res.ok) loop.status(t(loop.state().language, 'status.pi-launch', { err: res.message }));
}
