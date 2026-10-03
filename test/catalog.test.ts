import { test } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { listProviders, listCustomTools, listPackages, listSkills, parseOutdated, parsePackageCatalog, normalizePkgSource, filterPackages, type PkgItem } from '../src/catalog.js';

function makeAgentDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'pi-env-test-'));
  return dir;
}

test('listProviders: объединяет models.json и models-store.json', () => {
  const dir = makeAgentDir();
  try {
    writeFileSync(
      join(dir, 'models.json'),
      JSON.stringify({
        providers: {
          cpp: { models: [{ id: 'Qwen3.8-27B' }, { id: 'Zed-1' }] },
          local: { models: [{ id: 'Qwen3.6-35B-A3B-FP8' }] },
        },
      }),
    );
    writeFileSync(
      join(dir, 'models-store.json'),
      JSON.stringify({
        llama: { models: [{ id: 'Kwaipilot_KAT-Coder-V2.5', name: 'Kwaipilot' }] },
        // дублирующийся провайдер — модель добавляется один раз
        cpp: { models: [{ id: 'Qwen3.8-27B' }, { id: 'Bonsai-2' }] },
      }),
    );
    const providers = listProviders(dir);
    assert.deepEqual(
      providers.map((p) => p.name),
      ['cpp', 'llama', 'local'],
    );
    const cpp = providers.find((p) => p.name === 'cpp')!;
    assert.deepEqual(
      cpp.models.map((m) => m.id),
      ['Bonsai-2', 'Qwen3.8-27B', 'Zed-1'],
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('listProviders: отсутствующие файлы — пустой список', () => {
  const dir = makeAgentDir();
  try {
    assert.deepEqual(listProviders(dir), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('listProviders: битый JSON пропускается, читаемый остаётся', () => {
  const dir = makeAgentDir();
  try {
    writeFileSync(join(dir, 'models.json'), '{не json');
    writeFileSync(
      join(dir, 'models-store.json'),
      JSON.stringify({ openai: { models: [{ id: 'gpt-4o' }] } }),
    );
    const providers = listProviders(dir);
    assert.deepEqual(providers.map((p) => p.name), ['openai']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

test('listProviders: trailing commas в каталоге допустимы (как в реальных файлах пи)', () => {
  const dir = makeAgentDir();
  try {
    writeFileSync(
      join(dir, 'models.json'),
      '{"providers": {"cpp": {"models": [{"id": "Bonsai-2"},],},},}',
    );
    const providers = listProviders(dir);
    assert.deepEqual(providers.map((p) => p.name), ['cpp']);
    assert.deepEqual(providers[0].models.map((m) => m.id), ['Bonsai-2']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
});

test('listCustomTools: файлы из extensions/ (директории пропускаются)', () => {
  const dir = makeAgentDir();
  try {
    mkdirSync(join(dir, 'extensions', 'subdir'), { recursive: true });
    writeFileSync(join(dir, 'extensions', 'searxng-search.ts'), '');
    writeFileSync(join(dir, 'extensions', 'notes.txt'), '');
    const tools = listCustomTools(dir);
    assert.deepEqual(
      tools.map((t) => t.name),
      ['notes.txt', 'searxng-search.ts'],
    );
    assert.ok(tools.every((t) => t.path.startsWith(dir)));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makePkg(base: string, pkgDir: string, pkg: object): string {
  const path = join(base, pkgDir);
  mkdirSync(path, { recursive: true });
  writeFileSync(join(path, 'package.json'), JSON.stringify(pkg));
  return path;
}

test('listPackages: npm- и локальные источники, поле pi', () => {
  const dir = makeAgentDir();
  try {
    makePkg(join(dir, 'npm', 'node_modules'), 'pkg-a', {
      name: 'pkg-a',
      version: '1.2.3',
      description: 'Тестовый пакет',
      pi: { extensions: ['./index.ts'], skills: ['./skills'] },
    });
    const localPath = makePkg(dir, 'local-pkg', { name: 'local-pkg', pi: { extensions: ['./exts'] } });
    writeFileSync(
      join(dir, 'settings.json'),
      JSON.stringify({ packages: ['npm:pkg-a', localPath, 'npm:missing-pkg'] }),
    );
    const pkgs = listPackages(dir);
    assert.deepEqual(
      pkgs.map((p) => p.name),
      ['local-pkg', 'pkg-a'],
    );
    const a = pkgs.find((p) => p.name === 'pkg-a')!;
    assert.equal(a.source, 'npm:pkg-a');
    assert.deepEqual(a.extensions, ['./index.ts']);
    assert.deepEqual(a.skills, ['./skills']);
    assert.equal(a.version, '1.2.3');
    assert.equal(a.description, 'Тестовый пакет');
    const l = pkgs.find((p) => p.name === 'local-pkg')!;
    assert.equal(l.version, null);
    assert.equal(l.description, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('listSkills: свои + пакетные, имя = каталог скилла', () => {
  const dir = makeAgentDir();
  try {
    mkdirSync(join(dir, 'skills', 'own-skill'), { recursive: true });
    makePkg(join(dir, 'npm', 'node_modules'), 'pkg-a', {
      name: 'pkg-a',
      pi: { skills: ['./skills'] },
    });
    mkdirSync(join(dir, 'npm', 'node_modules', 'pkg-a', 'skills', 'foo-skill'), { recursive: true });
    mkdirSync(join(dir, 'npm', 'node_modules', 'pkg-a', 'skills', 'bar-skill'), { recursive: true });
    writeFileSync(
      join(dir, 'settings.json'),
      JSON.stringify({ packages: ['npm:pkg-a'] }),
    );
    const skills = listSkills(dir);
    assert.deepEqual(
      skills.map((s) => s.name).sort(),
      ['bar-skill', 'foo-skill', 'own-skill'],
    );
    const foo = skills.find((s) => s.name === 'foo-skill')!;
    assert.ok(foo.path.endsWith('pkg-a/skills/foo-skill'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('listSkills: коллизия имён — добавляется префикс пакета', () => {
  const dir = makeAgentDir();
  try {
    mkdirSync(join(dir, 'skills', 'dup'), { recursive: true });
    makePkg(join(dir, 'npm', 'node_modules'), '@scope/pkg-a', {
      name: '@scope/pkg-a',
      pi: { skills: ['./skills'] },
    });
    mkdirSync(join(dir, 'npm', 'node_modules', '@scope', 'pkg-a', 'skills', 'dup'), { recursive: true });
    writeFileSync(
      join(dir, 'settings.json'),
      JSON.stringify({ packages: ['npm:@scope/pkg-a'] }),
    );
    const names = listSkills(dir).map((s) => s.name).sort();
    assert.deepEqual(names, ['dup', 'pkg-a/dup']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('parseOutdated: валидный JSON → имя → latest', () => {
  assert.deepEqual(
    parseOutdated('{"pkg-a":{"current":"1.0.0","latest":"2.0.0"},"pkg-b":{"latest":"1.1.0"}}'),
    { 'pkg-a': '2.0.0', 'pkg-b': '1.1.0' },
  );
});

test('parseOutdated: {}, мусорный JSON, массив, числовой latest, null → {}', () => {
  assert.deepEqual(parseOutdated('{}'), {});
  assert.deepEqual(parseOutdated('не json'), {});
  assert.deepEqual(parseOutdated('[1,2]'), {});
  assert.deepEqual(parseOutdated('{"a":{"latest":5}}'), {});
  assert.deepEqual(parseOutdated('null'), {});
});

const CATALOG_HTML = [
  '<html><body>',
  '<article class="surface-panel content-card" data-package-card="true" data-package-name="pi-mcp-adapter" data-package-types="extension" data-package-downloads="1287931" data-package-date="1790791514874" data-package-sort-name="pi-mcp-adapter"><div class="packages-card-body"><h3 class="packages-name"><a href="/packages/pi-mcp-adapter">pi-mcp-adapter</a></h3><p class="packages-desc">MCP (Model Context Protocol) adapter extension for Pi coding agent</p><div class="packages-meta"><span>nicobailon</span><span>1.3M/mo</span><span>1d ago</span></div></div></article>',
  '<article class="surface-panel content-card" data-package-card="true" data-package-name="@scope/skill-pkg" data-package-types="skill" data-package-downloads="42" data-package-date="1790791514874" data-package-sort-name="skill-pkg"><div class="packages-card-body"><h3 class="packages-name"><a href="/packages/@scope/skill-pkg">@scope/skill-pkg</a></h3><p class="packages-desc">A skill &amp; templates package</p><div class="packages-meta"><span>someone</span><span>42/mo</span><span>2d ago</span></div></div></article>',
  '<article class="surface-panel content-card" data-package-card="true" data-package-name="no-meta-pkg" data-package-types="" data-package-downloads="0" data-package-date="1790791514874" data-package-sort-name="no-meta-pkg"><div class="packages-card-body"><h3 class="packages-name"><a href="/packages/no-meta-pkg">no-meta-pkg</a></h3></div></article>',
  '</body></html>',
].join('');

test('parsePackageCatalog: карточки распадаются на имя/типы/загрузки/описание/автор', () => {
  const pkgs = parsePackageCatalog(CATALOG_HTML);
  assert.deepEqual(
    pkgs.map((p) => p.name),
    ['pi-mcp-adapter', '@scope/skill-pkg', 'no-meta-pkg'],
  );
  const a = pkgs.find((p) => p.name === 'pi-mcp-adapter')!;
  assert.deepEqual(a.types, ['extension']);
  assert.equal(a.downloads, 1_287_931);
  assert.equal(a.description, 'MCP (Model Context Protocol) adapter extension for Pi coding agent');
  assert.equal(a.author, 'nicobailon');
  const b = pkgs.find((p) => p.name === '@scope/skill-pkg')!;
  assert.deepEqual(b.types, ['skill']);
  assert.equal(b.description, 'A skill & templates package');
  assert.equal(b.author, 'someone');
});

test('parsePackageCatalog: сортировка по загрузкам (по убыванию)', () => {
  const pkgs = parsePackageCatalog(CATALOG_HTML);
  assert.ok(pkgs[0].downloads >= pkgs[1].downloads);
  assert.ok(pkgs[1].downloads >= pkgs[2].downloads);
});

test('parsePackageCatalog: отсутствующие описание/автор — null, загрузки — 0', () => {
  const pkgs = parsePackageCatalog(CATALOG_HTML);
  const c = pkgs.find((p) => p.name === 'no-meta-pkg')!;
  assert.equal(c.description, null);
  assert.equal(c.author, null);
  assert.equal(c.downloads, 0);
  assert.deepEqual(c.types, []);
});

test('parsePackageCatalog: мусорный/пустой HTML — пустой список', () => {
  assert.deepEqual(parsePackageCatalog(''), []);
  assert.deepEqual(parsePackageCatalog('<html><body>нет карточек</body></html>'), []);
  assert.deepEqual(parsePackageCatalog('<article data-package-card="true"></article>'), []);
});

test('normalizePkgSource: по источнику, по legacy-имени, чужой — как есть', () => {
  const pkgs: PkgItem[] = [
    { source: 'npm:pkg-a', name: 'pkg-a', path: '/p/a', version: '1.0.0', description: null, extensions: [], skills: [] },
  ];
  assert.equal(normalizePkgSource('npm:pkg-a', pkgs), 'npm:pkg-a');
  assert.equal(normalizePkgSource('pkg-a', pkgs), 'npm:pkg-a');
  assert.equal(normalizePkgSource('npm:other', pkgs), 'npm:other');
  assert.equal(normalizePkgSource('other', pkgs), 'other');
});

test('filterPackages: подстрока без учёта регистра; пустой/пробельный — весь список', () => {
  const pkgs = [
    { name: 'obsidian', types: [], downloads: 3, description: null, author: null },
    { name: 'pi-a', types: [], downloads: 2, description: null, author: null },
    { name: 'Zebra', types: [], downloads: 1, description: null, author: null },
  ];
  assert.deepEqual(filterPackages(pkgs, '').map((p) => p.name), ['obsidian', 'pi-a', 'Zebra']);
  assert.deepEqual(filterPackages(pkgs, '  ').map((p) => p.name), ['obsidian', 'pi-a', 'Zebra']);
  assert.deepEqual(filterPackages(pkgs, 'obs').map((p) => p.name), ['obsidian']);
  assert.deepEqual(filterPackages(pkgs, 'ZEB').map((p) => p.name), ['Zebra']);
  assert.deepEqual(filterPackages(pkgs, 'zzz'), []);
  assert.deepEqual(filterPackages(pkgs, 'пакет'), []); // кириллица — пусто, без исключений
});
