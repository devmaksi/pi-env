import { test } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateName, createEnvironment, readSettings, updateEnvironment, deleteEnvironment } from '../src/create.js';

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
test('createEnvironment: каталог моделей копируется из main-агента', () => {
  const root = tmpDir();
  const agent = tmpDir();
  const modelsJson = '{"providers":{"cpp":{"models":[{"id":"Qwen3.8-27B"}]}}}';
  const storeJson = '{"llama.cpp":{"models":[{"id":"Qwen3.8-27B"}]}}';
  try {
    writeFileSync(join(agent, 'models.json'), modelsJson);
    writeFileSync(join(agent, 'models-store.json'), storeJson);
    writeFileSync(join(agent, 'auth.json'), '{"llama.cpp":{}}');

    const res = createEnvironment(root, {
      name: 'env1',
      defaultProvider: 'llama.cpp',
      defaultModel: 'Qwen3.8-27B',
    }, agent);
    assert.equal(res.ok, true);
    const envDir = join(root, 'env1');
    assert.equal(readFileSync(join(envDir, 'models.json'), 'utf8'), modelsJson);
    assert.equal(readFileSync(join(envDir, 'models-store.json'), 'utf8'), storeJson);
    assert.equal(readFileSync(join(envDir, 'auth.json'), 'utf8'), '{"llama.cpp":{}}');
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(agent, { recursive: true, force: true });
  }
});

test('createEnvironment: каталога моделей в main-агенте нет — файлы не создаются', () => {
  const root = tmpDir();
  const agent = tmpDir();
  try {
    const res = createEnvironment(root, { name: 'env1' }, agent);
    assert.equal(res.ok, true);
    assert.equal(existsSync(join(root, 'env1', 'models.json')), false);
    assert.equal(existsSync(join(root, 'env1', 'models-store.json')), false);
    assert.equal(existsSync(join(root, 'env1', 'auth.json')), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(agent, { recursive: true, force: true });
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

test('readSettings: нет файла — null', () => {
  const root = tmpDir();
  try {
    assert.equal(readSettings(join(root, 'nope')), null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('readSettings: битый JSON — null', () => {
  const root = tmpDir();
  try {
    mkdirSync(join(root, 'env1'));
    writeFileSync(join(root, 'env1', 'settings.json'), '{oops');
    assert.equal(readSettings(join(root, 'env1')), null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('readSettings: валидный файл — поля', () => {
  const root = tmpDir();
  try {
    mkdirSync(join(root, 'env1'));
    writeFileSync(join(root, 'env1', 'settings.json'),
      JSON.stringify({ defaultProvider: 'cpp', defaultModel: 'm1', packages: ['npm:a'], noise: 1 }));
    assert.deepEqual(readSettings(join(root, 'env1')),
      { defaultProvider: 'cpp', defaultModel: 'm1', packages: ['npm:a'] });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('updateEnvironment: синхронизация — новое копируется, снятое удаляется, чужое остаётся', () => {
  const root = tmpDir();
  const agent = tmpDir();
  try {
    mkdirSync(join(agent, 'extensions'), { recursive: true });
    writeFileSync(join(agent, 'extensions', 't1.ts'), 'one');
    writeFileSync(join(agent, 'extensions', 't2.ts'), 'two');
    mkdirSync(join(agent, 'skills', 's1'), { recursive: true });
    writeFileSync(join(agent, 'skills', 's1', 'SKILL.md'), 'S1');
    mkdirSync(join(agent, 'skills', 's2'), { recursive: true });
    writeFileSync(join(agent, 'skills', 's2', 'SKILL.md'), 'S2');

    const envDir = join(root, 'env1');
    mkdirSync(join(envDir, 'extensions'), { recursive: true });
    mkdirSync(join(envDir, 'skills', 's1'), { recursive: true });
    writeFileSync(join(envDir, 'extensions', 't1.ts'), 'one');
    writeFileSync(join(envDir, 'extensions', 'alien.txt'), 'keep me');
    writeFileSync(join(envDir, 'skills', 's1', 'SKILL.md'), 'S1');
    writeFileSync(join(envDir, 'settings.json'), '{}');

    const res = updateEnvironment(root, 'env1', {
      name: 'env1',
      defaultProvider: 'cpp',
      defaultModel: 'm1',
      tools: [{ name: 't2.ts', path: join(agent, 'extensions', 't2.ts') }],
      skills: [{ name: 's2', path: join(agent, 'skills', 's2') }],
      packages: ['npm:a'],
    },
    [
      { name: 't1.ts', path: join(agent, 'extensions', 't1.ts') },
      { name: 't2.ts', path: join(agent, 'extensions', 't2.ts') },
    ],
    [
      { name: 's1', path: join(agent, 'skills', 's1') },
      { name: 's2', path: join(agent, 'skills', 's2') },
    ]);
    assert.equal(res.ok, true);

    assert.equal(existsSync(join(envDir, 'extensions', 't1.ts')), false);
    assert.equal(readFileSync(join(envDir, 'extensions', 't2.ts'), 'utf8'), 'two');
    assert.equal(existsSync(join(envDir, 'extensions', 'alien.txt')), true);
    assert.equal(existsSync(join(envDir, 'skills', 's1')), false);
    assert.equal(readFileSync(join(envDir, 'skills', 's2', 'SKILL.md'), 'utf8'), 'S2');

    const settings = JSON.parse(readFileSync(join(envDir, 'settings.json'), 'utf8'));
    assert.equal(settings.defaultProvider, 'cpp');
    assert.equal(settings.defaultModel, 'm1');
    assert.deepEqual(settings.extensions, ['extensions/alien.txt', 'extensions/t2.ts']);
    assert.deepEqual(settings.skills, ['skills/s2']);
    assert.deepEqual(settings.packages, ['npm:a']);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(agent, { recursive: true, force: true });
  }
});

test('updateEnvironment: модель без провайдера — оба поля убираются', () => {
  const root = tmpDir();
  try {
    const envDir = join(root, 'env1');
    mkdirSync(envDir, { recursive: true });
    writeFileSync(join(envDir, 'settings.json'),
      JSON.stringify({ defaultProvider: 'cpp', defaultModel: 'm1' }));
    const res = updateEnvironment(root, 'env1', { name: 'env1', defaultProvider: 'cpp' }, [], []);
    assert.equal(res.ok, true);
    const settings = JSON.parse(readFileSync(join(envDir, 'settings.json'), 'utf8'));
    assert.equal(settings.defaultProvider, undefined);
    assert.equal(settings.defaultModel, undefined);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('updateEnvironment: переименование каталога', () => {
  const root = tmpDir();
  try {
    const envDir = join(root, 'old');
    mkdirSync(envDir, { recursive: true });
    writeFileSync(join(envDir, 'settings.json'), '{}');
    const res = updateEnvironment(root, 'old', { name: 'new' }, [], []);
    assert.equal(res.ok, true);
    assert.equal(existsSync(join(root, 'old')), false);
    assert.ok(existsSync(join(root, 'new', 'settings.json')));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('updateEnvironment: новое имя занято — ошибка, каталог не тронут', () => {
  const root = tmpDir();
  try {
    mkdirSync(join(root, 'old'), { recursive: true });
    mkdirSync(join(root, 'new'), { recursive: true });
    const res = updateEnvironment(root, 'old', { name: 'new' }, [], []);
    assert.equal(res.ok, false);
    if (!res.ok) assert.match(res.error, /уже есть/i);
    assert.ok(existsSync(join(root, 'old')));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('updateEnvironment: окружение не найдено — ошибка', () => {
  const root = tmpDir();
  try {
    const res = updateEnvironment(root, 'nope', { name: 'nope' }, [], []);
    assert.equal(res.ok, false);
    if (!res.ok) assert.match(res.error, /не найдено/i);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('updateEnvironment: абсолютный путь в extensions не синхронизируется и не удаляется', () => {
  const root = tmpDir();
  const agent = tmpDir();
  try {
    const file = join(tmpdir(), 'pi-env-abs-' + Date.now() + '.ts');
    writeFileSync(file, 'abs');
    try {
      const envDir = join(root, 'env1');
      mkdirSync(join(envDir, 'extensions'), { recursive: true });
      writeFileSync(join(envDir, 'extensions', 'abs.ts'), 'abs');
      writeFileSync(join(envDir, 'settings.json'),
        JSON.stringify({ extensions: [file] }));
      const res = updateEnvironment(root, 'env1', { name: 'env1' }, [], []);
      assert.equal(res.ok, true);
      assert.ok(existsSync(join(envDir, 'extensions', 'abs.ts')));
      const settings = JSON.parse(readFileSync(join(envDir, 'settings.json'), 'utf8'));
      assert.deepEqual(settings.extensions, ['extensions/abs.ts']);
    } finally {
      rmSync(file, { force: true });
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(agent, { recursive: true, force: true });
  }
});

test('updateEnvironment: каталог моделей синхронизируется из main-агента', () => {
  const root = tmpDir();
  const agent = tmpDir();
  try {
    const envDir = join(root, 'env1');
    mkdirSync(envDir);
    writeFileSync(join(envDir, 'models.json'), '{"old":1}');
    writeFileSync(join(agent, 'models.json'), '{"providers":{"cpp":{}}}');
    writeFileSync(join(agent, 'models-store.json'), '{"llama.cpp":{"models":[]}}');
    writeFileSync(join(agent, 'auth.json'), '{}');

    const res = updateEnvironment(root, 'env1', { name: 'env1' }, [], [], agent);
    assert.equal(res.ok, true);
    assert.equal(readFileSync(join(envDir, 'models.json'), 'utf8'), '{"providers":{"cpp":{}}}');
    assert.equal(readFileSync(join(envDir, 'models-store.json'), 'utf8'), '{"llama.cpp":{"models":[]}}');
    assert.equal(readFileSync(join(envDir, 'auth.json'), 'utf8'), '{}');
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(agent, { recursive: true, force: true });
  }
});

test('deleteEnvironment: каталог удаляется вместе с содержимым', () => {
  const root = tmpDir();
  try {
    const envDir = join(root, 'env1');
    mkdirSync(join(envDir, 'skills', 's1'), { recursive: true });
    writeFileSync(join(envDir, 'settings.json'), '{}');
    const res = deleteEnvironment(root, 'env1');
    assert.equal(res.ok, true);
    assert.equal(existsSync(envDir), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('deleteEnvironment: не найдено — ошибка', () => {
  const root = tmpDir();
  try {
    const res = deleteEnvironment(root, 'nope');
    assert.equal(res.ok, false);
    if (!res.ok) assert.match(res.error, /не найдено/i);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
