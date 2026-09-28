import { test } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { listProviders, listCustomTools, listPackages, listSkills } from '../src/catalog.js';

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
