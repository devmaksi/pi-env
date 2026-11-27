import { test } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { conflictSources, scan, withMain, realEnvNames, packageConflicts, pkgIdentity, storeOrphanNames, storePackageUsage, storeRegistryGaps, type Environment } from '../src/environments.js';
import { rewritePackages } from '../src/store.js';
import { patchSettings } from '../src/create.js';
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

// Идентичность повторяет pi (getPackageIdentity): scope — часть имени, версия и ref
// отброшены. Иначе pi-env видел бы один пакет там, где у pi два разных пакета.
test('pkgIdentity: идентичность пакета как у pi', () => {
  assert.equal(pkgIdentity('npm:pi-open-tui'), 'npm:pi-open-tui');
  assert.equal(pkgIdentity('npm:@wangjq4214/pi-open-tui'), 'npm:@wangjq4214/pi-open-tui');
  assert.equal(pkgIdentity('npm:@sfroment/pi-obsidian@1.2.3'), 'npm:@sfroment/pi-obsidian');
  assert.equal(pkgIdentity('npm:pi-zentui@^2.0'), 'npm:pi-zentui');
  assert.equal(pkgIdentity('git:github.com/obra/superpowers'), 'git:github.com/obra/superpowers');
  assert.equal(pkgIdentity('git:github.com/obra/superpowers@v1'), 'git:github.com/obra/superpowers');
  assert.equal(pkgIdentity('git:https://github.com/obra/superpowers.git'), 'git:github.com/obra/superpowers');
  assert.equal(pkgIdentity('git:ssh://git@github.com/obra/superpowers'), 'git:github.com/obra/superpowers');
  assert.equal(pkgIdentity('git:git@github.com:obra/superpowers.git'), 'git:github.com/obra/superpowers');
  assert.equal(pkgIdentity('./tools/pi-local'), 'path:./tools/pi-local');
  assert.notEqual(pkgIdentity('git:github.com/a/pi-x'), pkgIdentity('git:gitlab.com/a/pi-x'));
});

test('storePackageUsage: запись реестра без версии и объявление с версией — один пакет', () => {
  const root = mkEnvRoot([['dev-supo', ['npm:@sfroment/pi-obsidian@1.2.3']]]);
  try {
    assert.deepEqual(storePackageUsage(scan(root)!, 'npm:@sfroment/pi-obsidian'), ['dev-supo']);
  } finally {
    rmSync(root, { recursive: true });
  }
});

test('packageConflicts: один пакет (идентичность pi) — разные объявления видны', () => {
  const root = mkEnvRoot([
    ['dev-supo', ['npm:pi-open-tui']],
    ['dev-vtb', ['npm:pi-open-tui@0.4.6']],
    ['search', ['npm:pi-open-tui']],
  ]);
  try {
    assert.deepEqual(packageConflicts(scan(root)!), [{
      name: 'npm:pi-open-tui',
      declarations: [
        { env: 'dev-supo', source: 'npm:pi-open-tui' },
        { env: 'dev-vtb', source: 'npm:pi-open-tui@0.4.6' },
        { env: 'search', source: 'npm:pi-open-tui' },
      ],
    }]);
  } finally {
    rmSync(root, { recursive: true });
  }
});

// Пакеты разных издателей у pi лежат в разных npm/node_modules (<имя> и @scope/<имя>):
// это два установленных пакета, а не конфликт источников одного имени.
test('packageConflicts: scoped- и unscoped-объявление одного имени — разные пакеты', () => {
  const root = mkEnvRoot([
    ['dev-supo', ['npm:pi-open-tui']],
    ['dev-vtb', ['npm:@wangjq4214/pi-open-tui']],
    ['dev-java', ['npm:pi-open-tui']],
  ]);
  try {
    assert.deepEqual(packageConflicts(scan(root)!), []);
  } finally {
    rmSync(root, { recursive: true });
  }
});

// Настоящий конфликт одного пакета: pin против актуальной версии, ref против HEAD.
// Репозиторий на другом хосте — другой пакет pi (другой каталог в git/).
test('packageConflicts: pin-версия и ref того же пакета — конфликт, другой хост — нет', () => {
  const root = mkEnvRoot([
    ['dev-supo', ['npm:pi-zentui']],
    ['admin', ['npm:pi-zentui@2.0.3']],
    ['a', ['git:github.com/obra/superpowers']],
    ['b', ['git:github.com/obra/superpowers@v1']],
    ['c', ['git:gitlab.com/obra/superpowers']],
  ]);
  try {
    assert.deepEqual(packageConflicts(scan(root)!).map((c) => c.name),
      ['git:github.com/obra/superpowers', 'npm:pi-zentui']);
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
    assert.deepEqual(env.details.missingPackages, ['npm:absent-pkg']);
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
    assert.deepEqual(storePackageUsage(scan(root)!, 'npm:pi-zentui'), ['admin', 'dev-supo']);
    assert.deepEqual(storePackageUsage(scan(root)!, 'npm:pi-ssh-remote'), []);
    assert.deepEqual(storePackageUsage(scan(root)!, 'npm:@sfroment/pi-obsidian'), ['dev-supo']);
    // то же последнее имя у другого издателя — другой пакет, счётчик его считать не должен
    assert.deepEqual(storePackageUsage(scan(root)!, 'npm:pi-obsidian'), []);
  } finally {
    rmSync(root, { recursive: true });
  }
});

// Осиротевший пакет: реестр хранилища его помнит, а объявлений не осталось ни у кого
// (окружение уехало в корзину или с него сняли отметку) — его надо убрать из реестра.
test('storeOrphanNames: имена реестра без объявлений во всех окружениях', () => {
  const root = mkEnvRoot([['dev-supo', ['npm:pi-zentui']], ['test-ai', []]]);
  try {
    const envs = scan(root)!;
    assert.deepEqual(
      storeOrphanNames(envs, ['npm:pi-zentui', 'npm:pi-ssh-remote', 'npm:pi-old-ext']),
      ['npm:pi-old-ext', 'npm:pi-ssh-remote'],
    );
  } finally {
    rmSync(root, { recursive: true });
  }
});

test('storeOrphanNames: запись реестра с версией — не сирота при объявлении с версией', () => {
  const root = mkEnvRoot([['dev-supo', ['npm:@sfroment/pi-obsidian@1.2.3']]]);
  try {
    assert.deepEqual(storeOrphanNames(scan(root)!, ['npm:@sfroment/pi-obsidian', 'npm:@sfroment/pi-gone']), ['npm:@sfroment/pi-gone']);
  } finally {
    rmSync(root, { recursive: true });
  }
});

test('storeOrphanNames: основной агент тоже пользователь пакета', () => {
  const root = mkEnvRoot([['test-ai', []]]);
  const agent = mkdtempSync(join(tmpdir(), 'pienv-agent-'));
  try {
    mkdirSync(join(agent, 'x'), { recursive: true });
    writeFileSync(join(agent, 'x', 'settings.json'), JSON.stringify({ packages: ['npm:pi-zentui'] }));
    const envs = withMain(scan(root)!, join(agent, 'x'));
    assert.deepEqual(storeOrphanNames(envs, ['npm:pi-zentui', 'npm:pi-ssh-remote']), ['npm:pi-ssh-remote']);
  } finally {
    rmSync(root, { recursive: true });
    rmSync(agent, { recursive: true });
  }
});

// Суб-экран выбора победителя показывает уникальные источники: 4 объявления — 2 варианта,
// иначе окружения с одним источником плодили бы одинаковые строки.
test('conflictSources: объявления группы сжаты до уникальных источников с окружениями', () => {
  const root = mkEnvRoot([
    ['dev-java', ['npm:pi-open-tui']],
    ['dev-supo', ['npm:pi-open-tui']],
    ['search', ['npm:pi-open-tui']],
    ['dev-vtb', ['npm:pi-open-tui@0.4.6']],
  ]);
  try {
    const [conf] = packageConflicts(scan(root)!);
    assert.deepEqual(conflictSources(conf), [
      { source: 'npm:pi-open-tui', envs: ['dev-java', 'dev-supo', 'search'] },
      { source: 'npm:pi-open-tui@0.4.6', envs: ['dev-vtb'] },
    ]);
  } finally {
    rmSync(root, { recursive: true });
  }
});

// Критерий «после разрешения packageConflicts пуст»: правка объявлений и перечитка снимка.
test('разрешение конфликта: переписка объявлений убирает конфликт из перечитанного снимка', () => {
  const root = mkEnvRoot([
    ['dev-java', ['npm:pi-open-tui', 'npm:pi-zentui']],
    ['dev-vtb', ['npm:pi-open-tui@0.4.6', 'npm:@wangjq4214/pi-open-tui']],
  ]);
  try {
    assert.equal(packageConflicts(scan(root)!).length, 1);
    const winner = 'npm:pi-open-tui';
    for (const e of scan(root)!) patchSettings(e.path, { packages: rewritePackages(e.details.packages, 'npm:pi-open-tui', winner) });
    const after = scan(root)!;
    assert.deepEqual(packageConflicts(after), []);
    assert.deepEqual(after.find((e) => e.name === 'dev-java')!.details.packages, ['npm:pi-open-tui', 'npm:pi-zentui']);
    // пакет другого издателя к группе не относится и остаётся как был
    assert.deepEqual(after.find((e) => e.name === 'dev-vtb')!.details.packages, ['npm:pi-open-tui', 'npm:@wangjq4214/pi-open-tui']);
  } finally {
    rmSync(root, { recursive: true });
  }
});


// ─── разрыв реестра хранилища: пакет объявлен окружениями, но не установлен в <store> ───

const detG = (over: Partial<Environment['details']> = {}): Environment['details'] => ({
  hasSettings: true, model: null, tools: [], skills: [], packages: [], mcp: [],
  settingsError: null, mcpError: null, mcpSkipped: [],
  modelsLink: 'off', rootLinks: { npm: 'off', git: 'off' }, missingPackages: [], ...over,
});
// Пакетные корни окружения смотрят в хранилище — его объявления обязан содержать реестр.
const shared = (name: string, packages: string[]): Environment =>
  ({ name, path: '/root/' + name, details: detG({ packages, rootLinks: { npm: 'linked', git: 'linked' } }) });
// Свои npm/git: в общий реестр такой пакет не просится.
const own = (name: string, packages: string[]): Environment =>
  ({ name, path: '/root/' + name, details: detG({ packages }) });

test('storeRegistryGaps: реестр стоит на другом источнике — разрыв с обоими объявлениями', () => {
  const envs = [shared('dev-supo', ['npm:pi-open-tui']), shared('dev-vtb', ['npm:pi-open-tui'])];
  assert.deepEqual(storeRegistryGaps(envs, ['npm:pi-open-tui@0.4.6']), [
    { identity: 'npm:pi-open-tui', declared: 'npm:pi-open-tui', registered: ['npm:pi-open-tui@0.4.6'] },
  ]);
});

test('storeRegistryGaps: объявление совпало с реестром — разрыва нет', () => {
  assert.deepEqual(storeRegistryGaps([shared('dev-supo', ['npm:pi-zentui'])], ['npm:pi-zentui']), []);
});

test('storeRegistryGaps: пакета нет в реестре вовсе — registered пусто', () => {
  assert.deepEqual(storeRegistryGaps([shared('e0', ['npm:pi-new'])], ['npm:pi-other']), [
    { identity: 'npm:pi-new', declared: 'npm:pi-new', registered: [] },
  ]);
});

// Разные объявления одного пакета — это конфликт: его лечит выбор победителя человеком,
// а не автоматический выбор одного из них экраном приведения.
test('storeRegistryGaps: разные объявления одного пакета — не разрыв (это конфликт)', () => {
  const envs = [shared('a', ['npm:pi-open-tui']), shared('b', ['npm:pi-open-tui@0.4.6'])];
  assert.deepEqual(storeRegistryGaps(envs, ['npm:pi-open-tui@0.4.6']), []);
});

test('storeRegistryGaps: окружение вне хранилища не даёт разрыва', () => {
  assert.deepEqual(storeRegistryGaps([own('e0', ['npm:pi-own'])], ['npm:pi-store-pkg']), []);
});

// Scope — часть идентичности пакета (как у pi): реестр с `npm:pi-open-tui` не покрывает
// `npm:@wangjq4214/pi-open-tui`, поэтому разрыв считается по пакету, а не по короткому имени.
test('storeRegistryGaps: scoped- и unscoped-объявление — разные пакеты', () => {
  assert.deepEqual(storeRegistryGaps([shared('a', ['npm:@wangjq4214/pi-open-tui'])], ['npm:pi-open-tui']), [
    { identity: 'npm:@wangjq4214/pi-open-tui', declared: 'npm:@wangjq4214/pi-open-tui', registered: [] },
  ]);
});
