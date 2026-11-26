import { test } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { scan, withMain, realEnvNames, packageConflicts, pkgNameOfSource, storePackageUsage } from '../src/environments.js';
import { symlinkSync } from 'node:fs';

test('scan: отсутствующий корень → null', () => {
  assert.equal(scan('/nonexistent/pi-env-path'), null);
});

test('scan: пустой корень → []', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pienv-'));
  try {
    assert.deepEqual(scan(dir), []);
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test('scan: только каталоги, сортировка, пустая детализация', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pienv-'));
  try {
    mkdirSync(join(dir, 'b'));
    mkdirSync(join(dir, 'a'));
    mkdirSync(join(dir, 'a', 'skills'));
    mkdirSync(join(dir, 'a', 'extensions'));
    writeFileSync(join(dir, 'a', 'settings.json'), '{}');
    writeFileSync(join(dir, 'file.txt'), 'x');
    assert.deepEqual(scan(dir), [
      { name: 'a', path: join(dir, 'a'), details: { hasSettings: true, model: null, tools: [], skills: [], packages: [], mcp: [], settingsError: null, mcpError: null, mcpSkipped: [], modelsLink: 'off', rootLinks: { npm: 'off', git: 'off' }, missingPackages: [] } },
      { name: 'b', path: join(dir, 'b'), details: { hasSettings: false, model: null, tools: [], skills: [], packages: [], mcp: [], settingsError: null, mcpError: null, mcpSkipped: [], modelsLink: 'off', rootLinks: { npm: 'off', git: 'off' }, missingPackages: [] } },
    ]);
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test('scan: детализация — модель, инструменты, скиллы, пакеты', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pienv-'));
  try {
    mkdirSync(join(dir, 'dev', 'skills', 'sk-a'), { recursive: true });
    mkdirSync(join(dir, 'dev', 'skills', 'sk-b'), { recursive: true });
    mkdirSync(join(dir, 'dev', 'extensions'), { recursive: true });
    writeFileSync(join(dir, 'dev', 'extensions', 'tool1.ts'), 'x');
    writeFileSync(join(dir, 'dev', 'settings.json'),
      JSON.stringify({ defaultProvider: 'p1', defaultModel: 'm1', packages: ['npm:pkg-a'] }));
    assert.deepEqual(scan(dir), [
      {
        name: 'dev',
        path: join(dir, 'dev'),
        details: { hasSettings: true, model: 'p1/m1', tools: ['tool1.ts'], skills: ['sk-a', 'sk-b'], packages: ['npm:pkg-a'], mcp: [], settingsError: null, mcpError: null, mcpSkipped: [], modelsLink: 'off', rootLinks: { npm: 'off', git: 'off' }, missingPackages: [] },
      },
    ]);
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test('scan: битый settings.json — hasSettings true, прочее пусто, settingsError с текстом', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pienv-'));
  try {
    mkdirSync(join(dir, 'dev'));
    writeFileSync(join(dir, 'dev', 'settings.json'), '{битый json');
    const [env] = scan(dir)!;
    assert.equal(env.details.hasSettings, true);
    assert.equal(env.details.model, null);
    assert.deepEqual(env.details.packages, []);
    assert.ok(typeof env.details.settingsError === 'string' && env.details.settingsError !== '');
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test('scan: mcp.json окружения — имена в details.mcp', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pienv-'));
  try {
    mkdirSync(join(dir, 'dev'));
    writeFileSync(join(dir, 'dev', 'mcp.json'),
      JSON.stringify({ mcpServers: { browsermcp: { command: 'npx' } } }));
    assert.deepEqual(scan(dir), [
      { name: 'dev', path: join(dir, 'dev'), details: { hasSettings: false, model: null, tools: [], skills: [], packages: [], mcp: ['browsermcp'], settingsError: null, mcpError: null, mcpSkipped: [], modelsLink: 'off', rootLinks: { npm: 'off', git: 'off' }, missingPackages: [] } },
    ]);
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test('scan: битый mcp.json — mcpError с текстом, список пуст', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pienv-'));
  try {
    mkdirSync(join(dir, 'dev'));
    writeFileSync(join(dir, 'dev', 'mcp.json'), '{не json');
    const [env] = scan(dir)!;
    assert.deepEqual(env.details.mcp, []);
    assert.deepEqual(env.details.mcpSkipped, []);
    assert.ok(typeof env.details.mcpError === 'string' && env.details.mcpError !== '');
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test('scan: битая запись mcp.json — имя в mcpSkipped, остальные читаются', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pienv-'));
  try {
    mkdirSync(join(dir, 'dev'));
    writeFileSync(join(dir, 'dev', 'mcp.json'),
      JSON.stringify({ mcpServers: { browsermcp: { command: 'npx' }, broken: 'строка' } }));
    const [env] = scan(dir)!;
    assert.deepEqual(env.details.mcp, ['browsermcp']);
    assert.deepEqual(env.details.mcpSkipped, ['broken']);
    assert.equal(env.details.mcpError, null);
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test('scan: .trash не показывается как окружение', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pienv-'));
  try {
    mkdirSync(join(dir, '.trash', 'e1@1000'), { recursive: true });
    assert.deepEqual(scan(dir), []);
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test('scan: каталоги с точкой в начале пропускаются, обычные — нет', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pienv-'));
  try {
    mkdirSync(join(dir, '.hidden'));
    writeFileSync(join(dir, '.pi-env.json'), '{}');
    mkdirSync(join(dir, 'ok'));
    assert.deepEqual(scan(dir).map((e) => e.name), ['ok']);
  } finally {
    rmSync(dir, { recursive: true });
  }
});

const dirs: string[] = [];
test.after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

function tmpDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'pienv-'));
  dirs.push(d);
  return d;
}

/** Корень с одним окружением-каталогом `<root>/<name>`. */
function tmpFixtureWithEnv(name: string): string {
  const d = tmpDir();
  mkdirSync(join(d, name));
  return d;
}

/** Отдельный каталог main-агента с settings.json. */
function tmpAgentDir(settings: unknown): string {
  const d = tmpDir();
  writeFileSync(join(d, 'settings.json'), JSON.stringify(settings));
  return d;
}

test('withMain: агентский каталог внутри корня — пометка на существующей строке', () => {
  const root = tmpFixtureWithEnv('dev');
  const out = withMain(scan(root)!, join(root, 'dev'));
  assert.deepEqual(out.map((e) => [e.name, e.main === true]), [['dev', true]]);
});

test('withMain: каталог вне корня — первой строкой, name = basename, main: true', () => {
  const root = tmpFixtureWithEnv('dev');
  const agent = tmpAgentDir({ defaultProvider: 'p', defaultModel: 'm' });
  const out = withMain(scan(root)!, agent);
  assert.deepEqual(out.map((e) => e.name), [basename(agent), 'dev']);
  assert.equal(out[0].main, true);
  assert.equal(out[0].details.model, 'p/m');
});

test('withMain: битый settings.json агентского каталога → settingsError в деталях', () => {
  const root = tmpFixtureWithEnv('dev');
  const agent = tmpDir();
  writeFileSync(join(agent, 'settings.json'), '{ битый');
  const out = withMain(scan(root)!, agent);
  assert.equal(out[0].main, true);
  assert.notEqual(out[0].details.settingsError, null);
});

test('withMain: несуществующий агентский каталог → запись есть, details пустые', () => {
  const root = tmpFixtureWithEnv('dev');
  const out = withMain(scan(root)!, join(tmpDir(), 'gone'));
  assert.equal(out.length, 2);
  assert.equal(out[0].main, true);
  assert.equal(out[0].details.hasSettings, false);
  assert.deepEqual(out[0].details.tools, []);
});

test('scan: у обычных окружений main не проставлен', () => {
  assert.equal(scan(tmpFixtureWithEnv('dev'))[0].main, undefined);
});

test('realEnvNames: основная запись исключена', () => {
  const root = tmpFixtureWithEnv('dev');
  assert.deepEqual(realEnvNames(withMain(scan(root)!, join(root, 'dev'))), []);
});

test("scan с каталогом хранилища: linked / broken / off", () => {
  const root = tmpFixtureWithEnv('dev');
  const storeDir = join(root, '.store');
  const storeFile = join(storeDir, 'models', 'models.json');
  mkdirSync(join(storeFile, '..'), { recursive: true });
  writeFileSync(storeFile, '{"providers":{}}');
  symlinkSync(storeFile, join(root, 'dev', 'models.json'));
  assert.equal(scan(root, storeDir)![0].details.modelsLink, 'linked');
  rmSync(storeFile);
  assert.equal(scan(root, storeDir)![0].details.modelsLink, 'broken');
  assert.equal(scan(root)![0].details.modelsLink, 'off', 'без хранилища — своего файла достаточно');
});

test("withMain: основная запись получает modelsLink из файла хранилища", () => {
  const root = tmpFixtureWithEnv('dev');
  const storeDir = join(root, '.store');
  const storeFile = join(storeDir, 'models', 'models.json');
  mkdirSync(join(storeFile, '..'), { recursive: true });
  writeFileSync(storeFile, '{"providers":{}}');
  const agent = join(tmpDir(), 'agent');   // вне <root> — синтетическая запись
  mkdirSync(agent, { recursive: true });
  symlinkSync(storeFile, join(agent, 'models.json'));
  const out = withMain(scan(root)!, agent, storeDir);
  assert.equal(out[0].main, true);
  assert.equal(out[0].details.modelsLink, 'linked');
});

// --- Подрез 2a: связь пакетных корней, конфликты источников, отсутствующие пакеты ---

test('pkgNameOfSource: имя пакета из объявления', () => {
  assert.equal(pkgNameOfSource('npm:pi-open-tui'), 'pi-open-tui');
  assert.equal(pkgNameOfSource('npm:@wangjq4214/pi-open-tui'), 'pi-open-tui');
  assert.equal(pkgNameOfSource('npm:@sfroment/pi-obsidian@1.2.3'), 'pi-obsidian');
  assert.equal(pkgNameOfSource('git:github.com/obra/superpowers'), 'superpowers');
  assert.equal(pkgNameOfSource('git:github.com/obra/superpowers@v1'), 'superpowers');
  assert.equal(pkgNameOfSource('./tools/pi-local'), 'pi-local');
});

test('storePackageUsage: имя из package.json (со scope) — тот же ключ сравнения', () => {
  const root = mkEnvRoot([['dev-supo', ['npm:@sfroment/pi-obsidian']]]);
  try {
    assert.deepEqual(storePackageUsage(scan(root)!, '@sfroment/pi-obsidian'), ['dev-supo']);
  } finally {
    rmSync(root, { recursive: true });
  }
});

test('packageConflicts: одно имя — разные объявления видны', () => {
  const root = mkEnvRoot([
    ['dev-supo', ['npm:pi-open-tui']],
    ['dev-vtb', ['npm:@wangjq4214/pi-open-tui']],
    ['search', ['npm:pi-open-tui']],
  ]);
  try {
    assert.deepEqual(packageConflicts(scan(root)!), [{
      name: 'pi-open-tui',
      declarations: [
        { env: 'dev-supo', source: 'npm:pi-open-tui' },
        { env: 'dev-vtb', source: 'npm:@wangjq4214/pi-open-tui' },
        { env: 'search', source: 'npm:pi-open-tui' },
      ],
    }]);
  } finally {
    rmSync(root, { recursive: true });
  }
});

test('packageConflicts: одинаковые объявления одного имени — конфликта нет', () => {
  const root = mkEnvRoot([['a', ['npm:pi-zentui']], ['b', ['npm:pi-zentui']]]);
  try {
    assert.deepEqual(packageConflicts(scan(root)!), []);
  } finally {
    rmSync(root, { recursive: true });
  }
});

test('scan: rootLinks по каталогу хранилища и missingPackages против реестра', () => {
  const root = mkEnvRoot([['dev', ['npm:pi-zentui', 'npm:absent-pkg']]]);
  try {
    const store = join(root, '.store');
    mkdirSync(join(store, 'npm'), { recursive: true });
    writeFileSync(join(store, 'settings.json'), JSON.stringify({ packages: ['npm:pi-zentui'] }));
    symlinkSync(join(store, 'npm'), join(root, 'dev', 'npm'), 'dir');
    const env = scan(root, store)!.find((e) => e.name === 'dev')!;
    assert.deepEqual(env.details.rootLinks, { npm: 'linked', git: 'off' });
    assert.deepEqual(env.details.missingPackages, ['absent-pkg']);
    // без хранилища — rootLinks все off и missingPackages пустые
    const plain = scan(root)!.find((e) => e.name === 'dev')!;
    assert.deepEqual(plain.details.rootLinks, { npm: 'off', git: 'off' });
    assert.deepEqual(plain.details.missingPackages, []);
  } finally {
    rmSync(root, { recursive: true });
  }
});

function mkEnvRoot(pkgs: Array<[string, string[]]>): string {
  const root = mkdtempSync(join(tmpdir(), 'pienv-'));
  for (const [name, sources] of pkgs) {
    mkdirSync(join(root, name), { recursive: true });
    writeFileSync(join(root, name, 'settings.json'), JSON.stringify({ packages: sources }));
  }
  return root;
}

test('storePackageUsage: имена окружений, объявивших пакет по имени node_modules', () => {
  const root = mkEnvRoot([
    ['dev-supo', ['npm:pi-zentui', 'npm:@sfroment/pi-obsidian']],
    ['admin', ['npm:pi-zentui@2.0.3']],
    ['test-ai', []],
  ]);
  try {
    assert.deepEqual(storePackageUsage(scan(root)!, 'pi-zentui'), ['admin', 'dev-supo']);
    assert.deepEqual(storePackageUsage(scan(root)!, 'pi-ssh-remote'), []);
  } finally {
    rmSync(root, { recursive: true });
  }
});
