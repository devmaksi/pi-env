import { test } from 'node:test';
import assert from 'node:assert';
import { lstatSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runSideEffects, type Loop, type PrevSnap } from '../src/run-side.js';
import {
  initialState, emptyCatalog, freshCreate, freshExt, freshMcpForm, freshMcpTab, freshTrash,
  type AppState, type Catalog, type CreateState, type Environment, type McpServer,
} from '../src/state.js';
import { writeMcpFile } from '../src/mcp.js';
import { t } from '../src/i18n.js';
import { listTrash } from '../src/trash.js';

const PKG_A = { source: 'npm:pkg-a', name: 'pkg-a', path: '/p', version: null, description: null, extensions: [], skills: [] };
const CATALOG: Catalog = { ...emptyCatalog(), packages: [PKG_A] };
const ENV0: Environment = { name: 'e0', path: '/root/e0', details: { hasSettings: true, model: null, tools: [], skills: [], packages: [], mcp: [], settingsError: null, mcpError: null, mcpSkipped: [] } };

/** Фиксированный снимок до обработки клавиши. */
const prev = (p: Partial<PrevSnap>): PrevSnap => ({ view: null, ext: null, mcp: null, tab: 'envs', mcpCheck: 'idle', createMcpCheck: 'idle', cancelRequested: false, ...p });

function makeLoop(initial: AppState, root = '/root', agentDir = '/agent', envs: Environment[] = [ENV0]) {
  let state = initial;
  const log: string[] = [];
  const loop: Loop = {
    root, agentDir,
    term: {} as Loop['term'],
    state: () => state,
    setState: (n) => { state = n; },
    catalog: () => CATALOG,
    status: (m) => { log.push('status:' + (m ?? 'null')); },
    twoColumns: () => true,
    envs: () => envs,
    repaint: () => { log.push('repaint'); },
    reloadCatalog: () => { log.push('reloadCatalog'); },
    checkUpdates: (d, s) => { log.push(`checkUpdates:${d}:${s}`); },
    loadPackageCatalog: () => { log.push('loadPackageCatalog'); },
    doRemove: (src) => { log.push('doRemove:' + src); },
    doUpdateAll: (d, s) => { log.push(`doUpdateAll:${d}:${s}`); },
    doUpdateOne: (src) => { log.push('doUpdateOne:' + src); },
    doInstall: (d, src, env) => { log.push(`doInstall:${d}:${src}:${env}`); },
    doMcpAdd: (d, f, s) => { log.push(`doMcpAdd:${d}:${f.name}:${s}`); },
    doMcpCheck: (d, s) => { log.push(`doMcpCheck:${d}:${s}`); },
    cancelBusy: () => { log.push('cancelBusy'); },
    trashNames: () => [],
    invalidate: () => { log.push('invalidate'); },
    storeFile: () => null,
  };
  return { loop, log, get state() { return state; } };
}

const cr = (p: Partial<CreateState>): AppState => ({ ...initialState(CATALOG), sub: 'create', create: { ...freshCreate(), ...p } });
const srvDocs: McpServer = { name: 'docs', type: 'stdio', command: 'c', args: [], env: {}, headers: {} };

async function run(initial: AppState, p: Partial<PrevSnap>, root = '/root', agentDir = '/agent', envs: Environment[] = [ENV0]) {
  const h = makeLoop(initial, root, agentDir, envs);
  await runSideEffects(h.loop, envs, prev(p));
  return h;
}

function tmp() {
  const dir = mkdtempSync(join(tmpdir(), 'pienv-'));
  tmpDirs.push(dir);
  return dir;
}
const tmpDirs: string[] = [];
test.after(() => { for (const d of tmpDirs) rmSync(d, { recursive: true, force: true }); });

test('create: confirm-remove → removing — doRemove по источнику пакета', async () => {
  const h = await run(cr({ view: 'removing', removing: 'pkg-a' }), { view: 'confirm-remove'});
  assert.deepEqual(h.log, ['doRemove:npm:pkg-a']);
});

test('create: packages → updating — doUpdateAll по каталогу окружения', async () => {
  const h = await run(cr({ view: 'updating', name: 'new' }), { view: 'packages'});
  assert.deepEqual(h.log, ['doUpdateAll:/agent:create']);
});

test('create: вход в packages (edit) — проверка обновлений окружения', async () => {
  const h = await run(cr({ view: 'packages', mode: 'edit', origName: 'e0' }), { view: 'form'});
  assert.deepEqual(h.log, ['checkUpdates:/root/e0:create']);
});

test('create: вход в install — загрузка каталога pi.dev', async () => {
  const h = await run(cr({ view: 'install', installStatus: 'loading' }), { view: 'packages'});
  assert.deepEqual(h.log, ['loadPackageCatalog']);
});

test('create: installing — pi install в каталог окружения', async () => {
  const h = await run(cr({ view: 'installing', installing: 'x', name: 'e1' }), { view: 'install'});
  assert.deepEqual(h.log, ['doInstall:/root/e1:npm:x:e1']);
});

test('create: mcp-op copy — MCP main-агента копируется в окружение', async () => {
  const root = tmp(); const agentDir = tmp();
  writeMcpFile(agentDir, [srvDocs]);
  const h = await run(cr({ view: 'mcp-op', name: 'e1', mcpOp: { name: 'docs', kind: 'copy' } }), { view: 'mcp'}, root, agentDir);
  assert.ok(existsSync(join(root, 'e1', 'mcp.json')));
  assert.match(readFileSync(join(root, 'e1', 'mcp.json'), 'utf8'), /docs/);
  assert.deepEqual(h.state.create?.envMcp.map((m) => m.name), ['docs']);
  assert.ok(h.log.includes('repaint'));
});

test('create: mcp-op remove — запись окружения удалена', async () => {
  const root = tmp(); const agentDir = tmp(); const envDir = join(root, 'e1');
  writeMcpFile(agentDir, [srvDocs]); writeMcpFile(envDir, [srvDocs]);
  const h = await run(cr({ view: 'mcp-op', name: 'e1', mode: 'edit', origName: 'e1', mcpOp: { name: 'docs', kind: 'remove' } }), { view: 'mcp'}, root, agentDir);
  assert.deepEqual(h.state.create?.envMcp, []);
  assert.ok(h.log.includes('repaint'));
});

test('create: mcp-submitting — pi mcp add в каталог окружения', async () => {
  const form = { ...freshMcpForm(), name: 'srv' };
  const h = await run(cr({ view: 'mcp-submitting', name: 'e1', mcpAdd: form }), { view: 'mcp'});
  assert.deepEqual(h.log, ['doMcpAdd:/root/e1:srv:create']);
});

test('ext: вход во вкладку (catalog, loading) — загрузка каталога', async () => {
  const h = await run({ ...initialState(CATALOG), tab: 'extensions', ext: freshExt({ view: 'catalog', catalogStatus: 'loading' }) }, { tab: 'envs' });
  assert.deepEqual(h.log, ['loadPackageCatalog']);
});

test('ext: installing — pi install глобально (envName null)', async () => {
  const h = await run({ ...initialState(CATALOG), tab: 'extensions', ext: freshExt({ view: 'installing', installing: 'y' }) }, { tab: 'extensions', ext: freshExt({ view: 'catalog' }) });
  assert.deepEqual(h.log, ['doInstall:/agent:npm:y:null']);
});

test('ext: confirm-remove → removing — doRemove', async () => {
  const h = await run({ ...initialState(CATALOG), tab: 'extensions', ext: freshExt({ view: 'removing', removing: 'pkg-a' }) }, { tab: 'extensions', ext: freshExt({ view: 'confirm-remove' }) });
  assert.deepEqual(h.log, ['doRemove:npm:pkg-a']);
});

test('ext: updating «Обновить все» — doUpdateAll main', async () => {
  const h = await run({ ...initialState(CATALOG), tab: 'extensions', ext: freshExt({ view: 'updating', updating: null }) }, { tab: 'extensions' });
  assert.deepEqual(h.log, ['doUpdateAll:/agent:main']);
});

test('ext: updating пакета — doUpdateOne', async () => {
  const h = await run({ ...initialState(CATALOG), tab: 'extensions', ext: freshExt({ view: 'updating', updating: 'pkg-a' }) }, { tab: 'extensions' });
  assert.deepEqual(h.log, ['doUpdateOne:npm:pkg-a']);
});

test('mcp-вкладка: submitting после add — doMcpAdd main', async () => {
  const h = await run({ ...initialState(CATALOG), tab: 'mcp', mcp: freshMcpTab({ view: 'submitting', form: { ...freshMcpForm(), name: 'srv' } }) }, { tab: 'mcp', mcp: freshMcpTab({ view: 'add' }) });
  assert.deepEqual(h.log, ['doMcpAdd:/agent:srv:main']);
});

test('mcp-вкладка: confirm-remove → removing — удаление из mcp.json, перечитка каталога', async () => {
  const agentDir = tmp();
  writeMcpFile(agentDir, [srvDocs]);
  const h = await run({ ...initialState(CATALOG), tab: 'mcp', mcp: freshMcpTab({ view: 'removing', removing: 'docs' }) }, { tab: 'mcp', mcp: freshMcpTab({ view: 'confirm-remove' }) }, '/root', agentDir);
  assert.ok(!existsSync(join(agentDir, 'mcp.json')));
  assert.ok(h.log.includes('reloadCatalog'));
  assert.equal(h.state.mcp, null);
});

test('вход во вкладку «Расширения» — проверка обновлений main-агента', async () => {
  const h = await run({ ...initialState(CATALOG), tab: 'extensions', pkgCheck: 'idle' }, { tab: 'envs' });
  assert.deepEqual(h.log, ['checkUpdates:/agent:main']);
});

test('recheckUpdates: повторная проверка при pkgCheck done', async () => {
  const h = await run({ ...initialState(CATALOG), tab: 'extensions', pkgCheck: 'done', recheckUpdates: true }, { tab: 'envs' });
  assert.deepEqual(h.log, ['checkUpdates:/agent:main']);
});

test('pkgCheck done без recheck — повторной проверки нет', async () => {
  const h = await run({ ...initialState(CATALOG), tab: 'extensions', pkgCheck: 'done', recheckUpdates: false }, { tab: 'envs' });
  assert.deepEqual(h.log, []);
});

test('вкладка уже «Расширения» — recheck не срабатывает', async () => {
  const h = await run({ ...initialState(CATALOG), tab: 'extensions', pkgCheck: 'idle' }, { tab: 'extensions' });
  assert.deepEqual(h.log, []);
});

test('ничего не происходит в покое: списки, submitting/deleting/run вне переходов', async () => {
  const h = await run({ ...initialState(CATALOG), tab: 'envs', sub: 'run', selected: 5 }, { tab: 'settings' });
  assert.deepEqual(h.log, []);
  const h2 = await run(cr({ view: 'form' }), { view: 'form'});
  assert.deepEqual(h2.log, []);
});

// --- живой статус MCP: запуск pi mcp list ---

const mcpTab = (p: Partial<AppState>): AppState => ({ ...initialState(CATALOG), tab: 'mcp', ...p });
const editForm = (p: Partial<CreateState>): AppState => ({
  ...initialState(CATALOG), sub: 'create',
  create: { ...freshCreate(), mode: 'edit', origName: 'e0', name: 'e0', view: 'mcp', ...p },
});

test('вкладка «MCP»: первый вход — проверка по main-агенту', async () => {
  const h = await run(mcpTab({}), { tab: 'envs' });
  assert.deepEqual(h.log, ['doMcpCheck:/agent:main']);
  assert.equal(h.state.mcpCheck, 'checking');
});

test('вкладка «MCP»: повторный вход без recheckMcp — проверки нет', async () => {
  const h = await run(mcpTab({ mcpCheck: 'done' }), { tab: 'envs', mcpCheck: 'done' });
  assert.deepEqual(h.log, []);
});

test('вкладка «MCP»: recheckMcp — проверка при каждом входе', async () => {
  const h = await run(mcpTab({ mcpCheck: 'done', recheckMcp: true }), { tab: 'envs', mcpCheck: 'done' });
  assert.deepEqual(h.log, ['doMcpCheck:/agent:main']);
});

test('вкладка «MCP»: R (mcpCheck idle → checking) — запуск проверки', async () => {
  const h = await run(mcpTab({ mcpCheck: 'checking' }), { tab: 'mcp', mcpCheck: 'idle' });
  assert.deepEqual(h.log, ['doMcpCheck:/agent:main']);
});

test('форма edit: вход в список MCP — проверка по каталогу окружения', async () => {
  const h = await run(editForm({}), { view: 'form' });
  assert.deepEqual(h.log, ['doMcpCheck:/root/e0:create']);
});

test('форма create: вход в список MCP — проверка по main-агенту', async () => {
  const h = await run({ ...initialState(CATALOG), sub: 'create', create: { ...freshCreate(), view: 'mcp' } }, { view: 'form' });
  assert.deepEqual(h.log, ['doMcpCheck:/agent:create']);
});

test('форма: открыта форма добавления MCP — проверки нет', async () => {
  const h = await run(editForm({ mcpAdd: freshMcpForm() }), { view: 'mcp' });
  assert.deepEqual(h.log, []);
});

test('delete: deleting-вид переносит окружение в .trash и ставит статус', async () => {
  const root = tmp();
  mkdirSync(join(root, 'e0'));
  writeFileSync(join(root, 'e0', 'settings.json'), '{}');
  const h = await run(cr({ view: 'deleting', name: 'e0', mode: 'edit', origName: 'e0' }), { view: 'confirm-delete' }, root);
  assert.equal(listTrash(root).length, 1);
  assert.equal(existsSync(join(root, 'e0')), false);
  assert.ok(h.log.some((l) => l.startsWith('status:') && l.includes('корзину')));
});

const tr = (over: Parameters<typeof freshTrash>[0]): AppState =>
  ({ ...initialState(CATALOG), selected: 1, trash: freshTrash(over) });

test('trash: pending restore — каталог вернулся в корень, запись исчезла из .trash, статус восстановлено', async () => {
  const root = tmp();
  mkdirSync(join(root, '.trash', 'e1@1000'), { recursive: true });
  writeFileSync(join(root, '.trash', 'e1@1000', 'settings.json'), '{}');
  const h = await run(tr({ pending: { kind: 'restore', dirName: 'e1@1000' } }), {}, root);
  assert.equal(existsSync(join(root, 'e1', 'settings.json')), true);
  assert.deepEqual(listTrash(root), []);
  assert.ok(h.log.some((l) => l.startsWith('status:') && l.includes('восстановлено')));
  assert.equal(h.state.trash!.pending, null);
});

test('trash: pending delete — запись удалена из .trash безвозвратно, статус «навсегда»', async () => {
  const root = tmp();
  mkdirSync(join(root, '.trash', 'e1@1000'), { recursive: true });
  const h = await run(tr({ pending: { kind: 'delete', dirName: 'e1@1000' } }), {}, root);
  assert.equal(existsSync(join(root, '.trash', 'e1@1000')), false);
  assert.ok(h.log.some((l) => l.startsWith('status:') && l.includes('совсем')));
  assert.equal(h.state.trash!.pending, null);
});

test('trash: pending restore при занятом имени — запись остаётся в .trash, статус — ошибка, pending снят', async () => {
  const root = tmp();
  mkdirSync(join(root, '.trash', 'e1@1000'), { recursive: true });
  mkdirSync(join(root, 'e1'));
  const h = await run(tr({ pending: { kind: 'restore', dirName: 'e1@1000' } }), {}, root);
  assert.equal(existsSync(join(root, '.trash', 'e1@1000')), true);
  assert.equal(listTrash(root).length, 1);
  assert.ok(h.log.some((l) => l.startsWith('status:') && l.includes('занято')));
  assert.equal(h.state.trash!.pending, null);
});

test('trash: без pending — никаких файловых операций и repaint', async () => {
  const root = tmp();
  mkdirSync(join(root, '.trash', 'e1@1000'), { recursive: true });
  const h = await run(tr({}), {}, root);
  assert.deepEqual(h.log, []);
  assert.equal(listTrash(root).length, 1);
});

test('Esc в busy-вью: cancelBusy вызван ровно один раз', async () => {
  const h = await run(
    { ...initialState(CATALOG), tab: 'extensions', ext: freshExt({ view: 'updating' }) },
    { tab: 'extensions', ext: freshExt({ view: 'updating' }), cancelRequested: true },
  );
  assert.equal(h.log.filter((l) => l === 'cancelBusy').length, 1);
});

test('cancelRequested false — cancelBusy не вызван', async () => {
  const h = await run(
    { ...initialState(CATALOG), tab: 'extensions', ext: freshExt({ view: 'updating' }) },
    { tab: 'extensions', ext: freshExt({ view: 'updating' }) },
  );
  assert.equal(h.log.filter((l) => l === 'cancelBusy').length, 0);
});

test('отмена не порождает новых команд', async () => {
  const h = await run(
    { ...initialState(CATALOG), tab: 'extensions', ext: freshExt({ view: 'updating' }) },
    { tab: 'extensions', ext: freshExt({ view: 'updating' }), cancelRequested: true },
  );
  assert.equal(h.log.filter((l) => l.startsWith('doUpdateAll')).length, 0);
  assert.equal(h.log.filter((l) => l === 'cancelBusy').length, 1);
});

// --- Инвалидация кэша снимка окружений (src/env-cache.ts): каждая мутация обязана её позвать ---

test('мутации формы инвалидируют кэш: создание и удаление в корзину', async () => {
  const root = tmp(); const agentDir = tmp();
  const made = await run(cr({ view: 'submitting', name: 'new' }), { view: 'form' }, root, agentDir);
  assert.ok(existsSync(join(root, 'new')));
  assert.ok(made.log.includes('invalidate'), made.log.join(','));

  mkdirSync(join(root, 'e1'));
  const del = await run(cr({ view: 'deleting', mode: 'edit', name: 'e1', origName: 'e1' }), { view: 'form' }, root, agentDir);
  assert.equal(listTrash(root).length, 1);
  assert.ok(del.log.includes('invalidate'), del.log.join(','));
});

test('корзина: restore и «удалить совсем» инвалидируют кэш', async () => {
  const r1 = tmp();
  mkdirSync(join(r1, '.trash', 'e1@1000'), { recursive: true });
  const h1 = await run(tr({ pending: { kind: 'restore', dirName: 'e1@1000' } }), {}, r1);
  assert.ok(h1.log.includes('invalidate'), h1.log.join(','));

  const r2 = tmp();
  mkdirSync(join(r2, '.trash', 'e2@2000'), { recursive: true });
  const h2 = await run(tr({ pending: { kind: 'delete', dirName: 'e2@2000' } }), {}, r2);
  assert.ok(h2.log.includes('invalidate'), h2.log.join(','));
});

test('MCP-операции инвалидируют кэш: copy/remove в форме и удаление на вкладке', async () => {
  const root = tmp(); const agentDir = tmp();
  writeMcpFile(agentDir, [srvDocs]);
  const copy = await run(cr({ view: 'mcp-op', name: 'e1', mcpOp: { name: 'docs', kind: 'copy' } }), { view: 'mcp' }, root, agentDir);
  assert.ok(copy.log.includes('invalidate'), copy.log.join(','));

  const rm = await run(cr({ view: 'mcp-op', name: 'e1', mode: 'edit', origName: 'e1', mcpOp: { name: 'docs', kind: 'remove' } }), { view: 'mcp' }, root, agentDir);
  assert.ok(rm.log.includes('invalidate'), rm.log.join(','));

  const agent2 = tmp();
  writeMcpFile(agent2, [srvDocs]);
  const tab = await run({ ...initialState(CATALOG), tab: 'mcp', mcp: freshMcpTab({ view: 'removing', removing: 'docs' }) }, { tab: 'mcp', mcp: freshMcpTab({ view: 'confirm-remove' }) }, '/root', agent2);
  assert.ok(tab.log.includes('invalidate'), tab.log.join(','));
});

test('без мутаций инвалидация не зовётся', async () => {
  const h = await run(cr({ view: 'form' }), { view: 'form' });
  assert.ok(!h.log.includes('invalidate'));
});

test('клон: pending — копирование каталога, инвалидация кэша и курсор на копии', async () => {
  const root = tmp();
  const src = join(root, 'e0');
  mkdirSync(join(src, 'own'), { recursive: true });
  writeFileSync(join(src, 'settings.json'), '{}');
  writeFileSync(join(src, 'own', 'notes.txt'), 'mine');
  const env = (name: string): Environment => ({ ...ENV0, name, path: join(root, name) });
  // снимок окружений «как после перечитки»: копия появляется после копирования
  const snapshot = (): Environment[] => [env('e0'), ...(existsSync(join(root, 'e0-copy')) ? [env('e0-copy')] : [])];
  const st: AppState = { ...initialState(CATALOG), clone: { srcName: 'e0', srcPath: join(root, 'e0'), name: 'e0-copy', caret: 7, pending: true, error: null } };
  const h = await run(st, {}, root, '/agent', snapshot());
  assert.equal(readFileSync(join(root, 'e0-copy', 'own', 'notes.txt'), 'utf8'), 'mine');
  assert.ok(h.log.includes('invalidate'));
});

test('клон: занятое имя — ошибка в суб-экране и в статусе, копирования нет', async () => {
  const root = tmp();
  mkdirSync(join(root, 'e0'), { recursive: true });
  mkdirSync(join(root, 'e0-copy'), { recursive: true });
  writeFileSync(join(root, 'e0-copy', 'marker.txt'), 'KEEP');
  const env = (name: string): Environment => ({ ...ENV0, name, path: join(root, name) });
  const st: AppState = { ...initialState(CATALOG), clone: { srcName: 'e0', srcPath: join(root, 'e0'), name: 'e0-copy', caret: 7, pending: true, error: null } };
  const h = await run(st, {}, root, '/agent', [env('e0'), env('e0-copy')]);
  assert.ok(h.state.clone !== null);
  assert.equal(h.state.clone!.error, t('ru', 'err.name-exists'));
  assert.ok(h.log.some((l) => l.includes(t('ru', 'err.name-exists'))), h.log.join('|'));
  assert.equal(readFileSync(join(root, 'e0-copy', 'marker.txt'), 'utf8'), 'KEEP');
});

test('клон: курсор после успеха — на копии (снимок перечитан)', async () => {
  const root = tmp();
  mkdirSync(join(root, 'e0'), { recursive: true });
  writeFileSync(join(root, 'e0', 'settings.json'), '{}');
  const env = (name: string): Environment => ({ ...ENV0, name, path: join(root, name) });
  let copied = false;
  const st: AppState = { ...initialState(CATALOG), clone: { srcName: 'e0', srcPath: join(root, 'e0'), name: 'e0-copy', caret: 7, pending: true, error: null } };
  const h = makeLoop(st, root, '/agent', []);
  // снимок пересчитывается после инвалидации: так живёт реальный `Loop.envs()`
  const origInvalidate = h.loop.invalidate;
  h.loop.invalidate = () => { origInvalidate(); copied = existsSync(join(root, 'e0-copy')); };
  (h.loop as unknown as { envs: () => Environment[] }).envs = () =>
    (copied ? [env('e0'), env('e0-copy')] : [env('e0')]);
  await runSideEffects(h.loop, [env('e0')], prev({}));
  assert.equal(h.state.clone, null);
  assert.equal(h.state.selected, 1);
});

test('клон: источник — по пути вне корня (основной агент), копия появляется в корне', async () => {
  const root = tmp();
  const agent = tmp();
  const src = join(agent, 'agent');
  mkdirSync(join(src, 'own'), { recursive: true });
  writeFileSync(join(src, 'settings.json'), '{}');
  writeFileSync(join(src, 'own', 'notes.txt'), 'main agent');
  const env = (name: string, path: string): Environment => ({ ...ENV0, name, path, main: name === 'agent' });
  const st: AppState = {
    ...initialState(CATALOG),
    clone: { srcName: 'agent', srcPath: src, name: 'from-main', caret: 9, pending: true, error: null },
  };
  const h = await run(st, {}, root, agent, [env('agent', src)]);
  assert.equal(readFileSync(join(root, 'from-main', 'own', 'notes.txt'), 'utf8'), 'main agent');
  assert.ok(h.log.includes('invalidate'));
});

// ─── хранилище каталога моделей ───────────────────────────────────────

function storeSetup() {
  const root = tmp();
  const envDir = join(root, 'e0');
  mkdirSync(envDir, { recursive: true });
  const storeDir = join(root, '.store', 'models');
  mkdirSync(storeDir, { recursive: true });
  const storeFile = join(storeDir, 'models.json');
  writeFileSync(storeFile, JSON.stringify({ providers: { shared: { models: {} } } }));
  const env: Environment = {
    name: 'e0', path: envDir,
    details: { hasSettings: true, model: null, tools: [], skills: [], packages: [], mcp: [], settingsError: null, mcpError: null, mcpSkipped: [], modelsLink: 'off' },
  };
  return { root, envDir, storeFile, env };
}

function storeLoop(setup: ReturnType<typeof storeSetup>, initial: AppState, agentDir?: string) {
  const h = makeLoop(initial, setup.root, agentDir ?? join(setup.root, 'main-agent'), [setup.env]);
  h.loop.storeFile = () => setup.storeFile;
  return h;
}

const storeForm = (p: Partial<CreateState>): AppState => ({
  ...cr({ view: 'store-op', mode: 'edit', origName: 'e0', ...p }),
  language: 'ru',
});

test('store: включение — своя копия в корзину файлов, models.json становится симлинком', async () => {
  const setup = storeSetup();
  writeFileSync(join(setup.envDir, 'models.json'), '{"own":true}');
  const h = storeLoop(setup, storeForm({ store: false }));
  await runSideEffects(h.loop, [setup.env], prev({ view: 'form' }));
  assert.ok(lstatSync(join(setup.envDir, 'models.json')).isSymbolicLink());
  assert.equal(readFileSync(join(setup.envDir, 'models.json'), 'utf8'), readFileSync(setup.storeFile, 'utf8'));
  const entries = listTrash(setup.root);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].kind, 'file');
  assert.ok(entries[0].dirName.startsWith('e0--models.json@'));
  assert.ok(h.log.includes('invalidate'));
  assert.ok(h.log.some((l) => l === 'status:' + t('ru', 'status.store-linked')), h.log.join('|'));
  assert.equal(h.state.create!.store, true);
  assert.equal(h.state.create!.view, 'form');
});

test('store: выключение — вместо симлинка обычная копия общего файла', async () => {
  const setup = storeSetup();
  symlinkSync(setup.storeFile, join(setup.envDir, 'models.json'));
  const h = storeLoop(setup, storeForm({ store: true }));
  await runSideEffects(h.loop, [setup.env], prev({ view: 'form' }));
  assert.ok(!lstatSync(join(setup.envDir, 'models.json')).isSymbolicLink());
  assert.equal(readFileSync(join(setup.envDir, 'models.json'), 'utf8'), readFileSync(setup.storeFile, 'utf8'));
  assert.ok(h.log.some((l) => l === 'status:' + t('ru', 'status.store-unlinked')), h.log.join('|'));
  assert.equal(h.state.create!.store, false);
});

test('store: каталог main-агента вне root — своя копия в снимок хранилища, не в корзину', async () => {
  const setup = storeSetup();
  const agentDir = mkdtempSync(join(tmpdir(), 'pienv-agent-'));
  tmpDirs.push(agentDir);
  writeFileSync(join(agentDir, 'models.json'), '{"own":true}');
  const h = storeLoop(setup, storeForm({ store: false, main: true }), agentDir);
  await runSideEffects(h.loop, [setup.env], prev({ view: 'form' }));
  assert.ok(lstatSync(join(agentDir, 'models.json')).isSymbolicLink());
  const snaps = readdirSync(join(setup.root, '.store', 'models')).filter((f) => f.startsWith('models.json.bak-'));
  assert.equal(snaps.length, 1);
  assert.equal(readFileSync(join(setup.root, '.store', 'models', snaps[0]), 'utf8'), '{"own":true}');
  assert.equal(listTrash(setup.root).length, 0);
});

test('store: при создании окружения файловых операций нет — только флаг', async () => {
  const setup = storeSetup();
  const h = storeLoop(setup, { ...cr({ view: 'store-op', store: false }), language: 'ru' });
  await runSideEffects(h.loop, [setup.env], prev({ view: 'form' }));
  assert.equal(h.state.create!.store, true);
  assert.equal(existsSync(join(setup.root, 'e0', 'models.json')), false);
  assert.ok(!h.log.includes('invalidate'));
});

test('store: нет общего файла (хранилище выключено) — ошибка, флаг не меняется', async () => {
  const setup = storeSetup();
  const h = storeLoop(setup, storeForm({ store: false }));
  h.loop.storeFile = () => null;
  await runSideEffects(h.loop, [setup.env], prev({ view: 'form' }));
  assert.equal(h.state.create!.store, false);
  assert.equal(h.state.create!.view, 'form');
  assert.ok(h.log.some((l) => l === 'status:' + t('ru', 'err.store-no-source')), h.log.join('|'));
});

test('trash: запись файла восстанавливается в окружение и удаляется совсем по kind ветки', async () => {
  const setup = storeSetup();
  const entry = 'e0--models.json@12345';
  const filesDir = join(setup.root, '.trash', 'files');
  mkdirSync(filesDir, { recursive: true });
  writeFileSync(join(filesDir, entry), '{"own":true}');
  // восстановление
  let st = { ...initialState(CATALOG), language: 'ru', trash: freshTrash({ pending: { kind: 'restore', dirName: entry } }) };
  let h = makeLoop(st, setup.root, join(setup.root, 'main-agent'), [setup.env]);
  await runSideEffects(h.loop, [setup.env], prev({ view: null }));
  assert.equal(readFileSync(join(setup.envDir, 'models.json'), 'utf8'), '{"own":true}');
  assert.ok(h.log.some((l) => l.includes('status:')), h.log.join('|'));
  // удалить совсем
  writeFileSync(join(filesDir, entry), '{"own":true}');
  st = { ...initialState(CATALOG), language: 'ru', trash: freshTrash({ pending: { kind: 'delete', dirName: entry } }) };
  h = makeLoop(st, setup.root, join(setup.root, 'main-agent'), [setup.env]);
  await runSideEffects(h.loop, [setup.env], prev({ view: null }));
  assert.equal(existsSync(join(filesDir, entry)), false);
});
