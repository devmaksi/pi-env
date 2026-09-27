import { test } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateName, createEnvironment } from '../src/create.js';

function tmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'pi-env-create-'));
}

test('validateName: корректные имена', () => {
  assert.equal(validateName('prod', []), null);
  assert.equal(validateName('a-b_2', []), null);
});

test('validateName: ошибки', () => {
  assert.match(validateName('', [])!, /имя/i);
  assert.match(validateName('a b', []), /буквы/i);
  assert.match(validateName('апрод', []), /буквы/i);
  assert.match(validateName('a.b', []), /буквы/i);
  assert.match(validateName('prod', ['prod']), /уже есть/i);
});

test('createEnvironment: базовое окружение без опций', () => {
  const root = tmpDir();
  try {
    const res = createEnvironment(root, { name: 'env1' });
    assert.equal(res.ok, true);
    const settings = JSON.parse(readFileSync(join(root, 'env1', 'settings.json'), 'utf8'));
    assert.deepEqual(settings, {});
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('createEnvironment: модель + инструменты + скиллы + пакеты', () => {
  const root = tmpDir();
  const agentDir = tmpDir();
  try {
    mkdirSync(join(agentDir, 'extensions'), { recursive: true });
    writeFileSync(join(agentDir, 'extensions', 'searxng.ts'), 'console.log(1)');
    mkdirSync(join(agentDir, 'skills', 'own-skill'), { recursive: true });
    writeFileSync(join(agentDir, 'skills', 'own-skill', 'SKILL.md'), '# skill');

    const res = createEnvironment(root, {
      name: 'env2',
      defaultProvider: 'cpp',
      defaultModel: 'Bonsai-2',
      tools: [{ name: 'searxng.ts', path: join(agentDir, 'extensions', 'searxng.ts') }],
      skills: [{ name: 'own-skill', path: join(agentDir, 'skills', 'own-skill') }],
      packages: ['npm:pkg-a'],
    });
    assert.equal(res.ok, true);

    const envDir = join(root, 'env2');
    const settings = JSON.parse(readFileSync(join(envDir, 'settings.json'), 'utf8'));
    assert.equal(settings.defaultProvider, 'cpp');
    assert.equal(settings.defaultModel, 'Bonsai-2');
    assert.deepEqual(settings.extensions, ['extensions/searxng.ts']);
    assert.deepEqual(settings.skills, ['skills/own-skill']);
    assert.deepEqual(settings.packages, ['npm:pkg-a']);

    assert.equal(
      readFileSync(join(envDir, 'extensions', 'searxng.ts'), 'utf8'),
      'console.log(1)',
    );
    assert.equal(
      readFileSync(join(envDir, 'skills', 'own-skill', 'SKILL.md'), 'utf8'),
      '# skill',
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(agentDir, { recursive: true, force: true });
  }
});

test('createEnvironment: коллизия скиллов по имени — второй получает суффикс', () => {
  const root = tmpDir();
  const a = tmpDir();
  const b = tmpDir();
  try {
    mkdirSync(join(a, 's', 'dup'), { recursive: true });
    writeFileSync(join(a, 's', 'dup', 'SKILL.md'), 'A');
    mkdirSync(join(b, 's', 'dup'), { recursive: true });
    writeFileSync(join(b, 's', 'dup', 'SKILL.md'), 'B');
    const res = createEnvironment(root, {
      name: 'env3',
      skills: [
        { name: 'dup', path: join(a, 's', 'dup') },
        { name: 'dup', path: join(b, 's', 'dup') },
      ],
    });
    assert.equal(res.ok, true);
    const envDir = join(root, 'env3');
    const names = readdirSync(join(envDir, 'skills'));
    assert.equal(names.length, 2);
    assert.equal(readFileSync(join(envDir, 'skills', names[0], 'SKILL.md'), 'utf8'), 'A');
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(a, { recursive: true, force: true });
    rmSync(b, { recursive: true, force: true });
  }
});

test('createEnvironment: имя уже занято — ошибка, каталог не создаётся', () => {
  const root = tmpDir();
  try {
    mkdirSync(join(root, 'env1'));
    const res = createEnvironment(root, { name: 'env1' });
    assert.equal(res.ok, false);
    if (!res.ok) assert.match(res.error, /уже есть/i);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('createEnvironment: пустое имя — ошибка', () => {
  const root = tmpDir();
  try {
    const res = createEnvironment(root, { name: '  ' });
    assert.equal(res.ok, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
