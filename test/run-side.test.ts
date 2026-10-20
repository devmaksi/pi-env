import { test } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runSideEffects, type Loop, type PrevSnap } from '../src/run-side.js';
import {
  initialState, emptyCatalog, freshCreate, freshExt, freshMcpForm, freshMcpTab,
  type AppState, type Catalog, type CreateState, type Environment, type McpServer,
} from '../src/state.js';
import { writeMcpFile } from '../src/mcp.js';

const PKG_A = { source: 'npm:pkg-a', name: 'pkg-a', path: '/p', version: null, description: null, extensions: [], skills: [] };
const CATALOG: Catalog = { ...emptyCatalog(), packages: [PKG_A] };
const ENV0: Environment = { name: 'e0', path: '/root/e0', details: { hasSettings: true, model: null, tools: [], skills: [], packages: [], mcp: [] } };

/** Фиксированный снимок до обработки клавиши. */
const prev = (p: Partial<PrevSnap>): PrevSnap => ({ view: null, ext: null, mcp: null, tab: 'envs', ...p });

function makeLoop(initial: AppState, root = '/root', agentDir = '/agent') {
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
    envs: () => [ENV0],
    repaint: () => { log.push('repaint'); },
    reloadCatalog: () => { log.push('reloadCatalog'); },
    checkUpdates: (d, s) => { log.push(`checkUpdates:${d}:${s}`); },
    loadPackageCatalog: () => { log.push('loadPackageCatalog'); },
    doRemove: (src) => { log.push('doRemove:' + src); },
    doUpdateAll: (d, s) => { log.push(`doUpdateAll:${d}:${s}`); },
    doUpdateOne: (src) => { log.push('doUpdateOne:' + src); },
    doInstall: (d, src, env) => { log.push(`doInstall:${d}:${src}:${env}`); },
    doMcpAdd: (d, f, s) => { log.push(`doMcpAdd:${d}:${f.name}:${s}`); },
  };
  return { loop, log, get state() { return state; } };
}

const cr = (p: Partial<CreateState>): AppState => ({ ...initialState(CATALOG), sub: 'create', create: { ...freshCreate(), ...p } });
const srvDocs: McpServer = { name: 'docs', type: 'stdio', command: 'c', args: [], env: {}, headers: {} };

async function run(initial: AppState, p: Partial<PrevSnap>, root = '/root', agentDir = '/agent') {
  const h = makeLoop(initial, root, agentDir);
  await runSideEffects(h.loop, [ENV0], prev(p));
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
