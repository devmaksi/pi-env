import { test } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, readdirSync, existsSync, symlinkSync, lstatSync, readlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateName, createEnvironment, readSettings, updateEnvironment, updateEnvironmentAt, cloneEnvironment } from '../src/create.js';
import { t } from '../src/i18n.js';
import { listSkills } from '../src/catalog.js';

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

test('updateEnvironment: коллизия пакетных скиллов — снятый скилл удаляется', () => {
  const root = tmpDir();
  const agent = tmpDir();
  try {
    for (const pkg of ['pkg-a', 'pkg-b']) {
      const dir = join(agent, 'npm', 'node_modules', pkg, 'skills', 'dup');
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'SKILL.md'), `# ${pkg}`);
      writeFileSync(
        join(agent, 'npm', 'node_modules', pkg, 'package.json'),
        JSON.stringify({ name: pkg, version: '1.0.0', pi: { skills: ['./skills'] } }),
      );
    }
    writeFileSync(join(agent, 'settings.json'), JSON.stringify({ packages: ['npm:pkg-a', 'npm:pkg-b'] }));
    const skills = listSkills(agent);
    assert.deepEqual(skills.map((s) => s.name).sort(), ['dup', 'pkg-b/dup']);

    const res = createEnvironment(root, { name: 'env', skills }, agent);
    assert.equal(res.ok, true);
    const envDir = join(root, 'env');
    assert.deepEqual(readdirSync(join(envDir, 'skills')).sort(), ['dup', 'pkg-b-dup']);
    assert.deepEqual(readSettings(envDir)!.skills, ['skills/dup', 'skills/pkg-b-dup']);

    const upd = updateEnvironment(
      root, 'env',
      { name: 'env', skills: skills.filter((s) => s.name === 'dup') },
      { allTools: [], allSkills: skills, agentDir: agent },
    );
    assert.equal(upd.ok, true);
    assert.deepEqual(readdirSync(join(envDir, 'skills')).sort(), ['dup']);
    assert.deepEqual(readSettings(envDir)!.skills, ['skills/dup']);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(agent, { recursive: true, force: true });
  }
});

test('updateEnvironment: свой скилл и пакетный одного имени — снятие удаляет свой', () => {
  const root = tmpDir();
  const agent = tmpDir();
  try {
    mkdirSync(join(agent, 'skills', 'dup'), { recursive: true });
    writeFileSync(join(agent, 'skills', 'dup', 'SKILL.md'), 'own');
    const pkgSkill = join(agent, 'npm', 'node_modules', 'pkg-b', 'skills', 'dup');
    mkdirSync(pkgSkill, { recursive: true });
    writeFileSync(join(pkgSkill, 'SKILL.md'), 'pkg');
    writeFileSync(
      join(agent, 'npm', 'node_modules', 'pkg-b', 'package.json'),
      JSON.stringify({ name: 'pkg-b', version: '1.0.0', pi: { skills: ['./skills'] } }),
    );
    writeFileSync(join(agent, 'settings.json'), JSON.stringify({ packages: ['npm:pkg-b'] }));
    const skills = listSkills(agent);
    assert.deepEqual(skills.map((s) => s.name).sort(), ['dup', 'pkg-b/dup']);

    assert.equal(createEnvironment(root, { name: 'env', skills }, agent).ok, true);
    const envDir = join(root, 'env');
    assert.deepEqual(readdirSync(join(envDir, 'skills')).sort(), ['dup', 'pkg-b-dup']);

    const upd = updateEnvironment(
      root, 'env',
      { name: 'env', skills: skills.filter((s) => s.name !== 'dup') },
      { allTools: [], allSkills: skills, agentDir: agent },
    );
    assert.equal(upd.ok, true);
    assert.deepEqual(readdirSync(join(envDir, 'skills')).sort(), ['pkg-b-dup']);
    assert.deepEqual(readSettings(envDir)!.skills, ['skills/pkg-b-dup']);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(agent, { recursive: true, force: true });
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
    }, {
      allTools: [
        { name: 't1.ts', path: join(agent, 'extensions', 't1.ts') },
        { name: 't2.ts', path: join(agent, 'extensions', 't2.ts') },
      ],
      allSkills: [
        { name: 's1', path: join(agent, 'skills', 's1') },
        { name: 's2', path: join(agent, 'skills', 's2') },
      ],
    });
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
    const res = updateEnvironment(root, 'env1', { name: 'env1', defaultProvider: 'cpp' }, { allTools: [], allSkills: [] });
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
    const res = updateEnvironment(root, 'old', { name: 'new' }, { allTools: [], allSkills: [] });
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
    const res = updateEnvironment(root, 'old', { name: 'new' }, { allTools: [], allSkills: [] });
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
    const res = updateEnvironment(root, 'nope', { name: 'nope' }, { allTools: [], allSkills: [] });
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
      const res = updateEnvironment(root, 'env1', { name: 'env1' }, { allTools: [], allSkills: [] });
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

    const res = updateEnvironment(root, 'env1', { name: 'env1' }, { allTools: [], allSkills: [], agentDir: agent });
    assert.equal(res.ok, true);
    assert.equal(readFileSync(join(envDir, 'models.json'), 'utf8'), '{"providers":{"cpp":{}}}');
    assert.equal(readFileSync(join(envDir, 'models-store.json'), 'utf8'), '{"llama.cpp":{"models":[]}}');
    assert.equal(readFileSync(join(envDir, 'auth.json'), 'utf8'), '{}');
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(agent, { recursive: true, force: true });
  }
});



test('validateName: ошибки на английском', () => {
  assert.equal(validateName('', [], 'en'), 'Enter an environment name');
  assert.equal(validateName('a b', [], 'en'), 'Name: Latin letters, digits, "_" and "-" only');
  assert.equal(validateName('prod', ['prod'], 'en'), 'An environment with this name already exists');
});

/** Относительный набор путей и содержимое дерева: копия обязана совпасть побайтово. */
function tree(dir: string, rel = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const r = rel === '' ? e.name : rel + '/' + e.name;
    if (e.isDirectory()) Object.assign(out, tree(join(dir, e.name), r));
    else out[r] = readFileSync(join(dir, e.name), 'utf8');
  }
  return out;
}

/** Окружение-источник с файлами, которых нет в каталоге main-агента. */
function makeSource(root: string, name: string): string {
  const dir = join(root, name);
  mkdirSync(join(dir, 'extensions'), { recursive: true });
  mkdirSync(join(dir, 'skills', 'one'), { recursive: true });
  mkdirSync(join(dir, 'own'), { recursive: true });
  writeFileSync(join(dir, 'settings.json'), JSON.stringify({ defaultModel: 'm' }));
  writeFileSync(join(dir, 'mcp.json'), JSON.stringify({ servers: { a: { type: 'stdio', command: 'x' } } }));
  writeFileSync(join(dir, 'models.json'), '{}');
  writeFileSync(join(dir, 'extensions', 'a.ts'), '// tool');
  writeFileSync(join(dir, 'skills', 'one', 'SKILL.md'), '# skill');
  writeFileSync(join(dir, 'own', 'notes.txt'), 'mine');
  return dir;
}

test('cloneEnvironment: копирует дерево как есть, включая свои файлы', () => {
  const root = tmpDir();
  try {
    const src = makeSource(root, 'src');
    const res = cloneEnvironment(root, join(root, 'src'), 'dst', ['src'], 'ru');
    assert.equal(res.ok, true);
    assert.equal(res.ok && res.path, join(root, 'dst'));
    assert.deepEqual(tree(join(root, 'dst')), tree(src));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// Клон включённого окружения обязан оставаться включённым: разыменованные общие корни
// означают сотни МБ копии и тихий выход из хранилища.
test('cloneEnvironment: симлинки пакетных корней сохраняются симлинками, битый симлинк не роняет клон', () => {
  const root = tmpDir();
  try {
    const src = makeSource(root, 'src');
    mkdirSync(join(root, '.store', 'npm', 'node_modules', 'pkg-a'), { recursive: true });
    symlinkSync(join(root, '.store', 'npm'), join(src, 'npm'), 'dir');
    symlinkSync(join(src, 'nothing-here'), join(src, 'broken-link'), 'file');
    const res = cloneEnvironment(root, src, 'dst', ['src'], 'ru');
    assert.equal(res.ok, true, res.ok ? '' : res.error);
    const dst = join(root, 'dst');
    assert.ok(lstatSync(join(dst, 'npm')).isSymbolicLink(), 'общий корень клона — тот же симлинк');
    assert.equal(readlinkSync(join(dst, 'npm')), join(root, '.store', 'npm'));
    assert.ok(lstatSync(join(dst, 'broken-link')).isSymbolicLink(), 'битый симлинк перенесён, а не обрывает клон');
    assert.equal(existsSync(join(dst, 'npm', 'node_modules', 'pkg-a')), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('cloneEnvironment: занятое имя — ошибка, существующее окружение не тронуто', () => {
  const root = tmpDir();
  try {
    makeSource(root, 'src');
    makeSource(root, 'dst');
    writeFileSync(join(root, 'dst', 'settings.json'), 'ORIGINAL');
    const res = cloneEnvironment(root, join(root, 'src'), 'dst', ['src', 'dst'], 'ru');
    assert.equal(res.ok, false);
    assert.equal(res.ok ? '' : res.error, t('ru', 'err.name-exists'));
    assert.equal(readFileSync(join(root, 'dst', 'settings.json'), 'utf8'), 'ORIGINAL');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('cloneEnvironment: невалидное и пустое имя — ошибка validateName', () => {
  const root = tmpDir();
  try {
    makeSource(root, 'src');
    assert.equal(cloneEnvironment(root, join(root, 'src'), 'пло хое', ['src'], 'ru').ok, false);
    assert.equal(cloneEnvironment(root, join(root, 'src'), '', ['src'], 'ru').ok, false);
    assert.equal(existsSync(join(root, 'dst')), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('cloneEnvironment: источника нет — err.not-found', () => {
  const root = tmpDir();
  try {
    const res = cloneEnvironment(root, join(root, 'nope'), 'dst', [], 'ru');
    assert.equal(res.ok, false);
    assert.equal(res.ok ? '' : res.error, t('ru', 'err.not-found'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('cloneEnvironment: сбой копирования не оставляет неполной копии', () => {
  const root = tmpDir();
  try {
    const src = makeSource(root, 'src');
    // Сбой вводится инжекцией копии: права доступа под root не работают, а симлинки теперь
    // сохраняются и копирование не прерывают.
    const res = cloneEnvironment(root, join(root, 'src'), 'dst', ['src'], 'ru', () => { throw new Error('EIO'); });
    assert.equal(res.ok, false);
    assert.equal(res.ok ? '' : res.error, t('ru', 'err.clone', { name: 'dst' }));
    assert.equal(existsSync(join(root, 'dst')), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});


test('updateEnvironmentAt: сохраняет поля settings.json, которых не касались', () => {
  const root = tmpDir();
  try {
    const envDir = join(root, 'env1');
    mkdirSync(envDir, { recursive: true });
    writeFileSync(join(envDir, 'settings.json'), JSON.stringify({
      defaultModel: 'm1',
      theme: 'solarized',
      enableSkillCommands: false,
      enablePromptCommands: true,
    }));
    const res = updateEnvironmentAt(envDir, { name: 'env1', defaultProvider: 'cpp', defaultModel: 'm2' },
      { allTools: [], allSkills: [] }, { rename: true, syncResources: true });
    assert.equal(res.ok, true);
    const settings = JSON.parse(readFileSync(join(envDir, 'settings.json'), 'utf8'));
    assert.equal(settings.defaultProvider, 'cpp');
    assert.equal(settings.defaultModel, 'm2');
    assert.equal(settings.theme, 'solarized');
    assert.equal(settings.enableSkillCommands, false);
    assert.equal(settings.enablePromptCommands, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('updateEnvironmentAt: rename:false — переименование игнорируется, каталог на месте', () => {
  const root = tmpDir();
  try {
    const envDir = join(root, 'agent');
    mkdirSync(envDir, { recursive: true });
    const res = updateEnvironmentAt(envDir, { name: 'other' }, { allTools: [], allSkills: [] },
      { rename: false, syncResources: true });
    assert.equal(res.ok, true);
    assert.equal(res.path, envDir);
    assert.ok(existsSync(envDir));
    assert.equal(existsSync(join(root, 'other')), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('updateEnvironmentAt: syncResources:false — extensions/ и skills/ не тронуты', () => {
  const root = tmpDir();
  try {
    const envDir = join(root, 'agent');
    mkdirSync(join(envDir, 'extensions'), { recursive: true });
    mkdirSync(join(envDir, 'skills', 'keep'), { recursive: true });
    writeFileSync(join(envDir, 'extensions', 'tool.ts'), 'KEEP');
    writeFileSync(join(envDir, 'skills', 'keep', 'SKILL.md'), 'KEEP');
    writeFileSync(join(envDir, 'settings.json'),
      JSON.stringify({ extensions: ['/abs/tool.ts'], skills: ['~/shared/skills'] }));
    const res = updateEnvironmentAt(envDir, { name: 'agent', defaultProvider: 'p', defaultModel: 'm' },
      { allTools: [], allSkills: [] }, { rename: false, syncResources: false });
    assert.equal(res.ok, true);
    assert.equal(readFileSync(join(envDir, 'extensions', 'tool.ts'), 'utf8'), 'KEEP');
    assert.equal(readFileSync(join(envDir, 'skills', 'keep', 'SKILL.md'), 'utf8'), 'KEEP');
    const settings = JSON.parse(readFileSync(join(envDir, 'settings.json'), 'utf8'));
    assert.deepEqual(settings.extensions, ['/abs/tool.ts']);
    assert.deepEqual(settings.skills, ['~/shared/skills']);
    assert.equal(settings.packages, undefined);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('updateEnvironmentAt: отсутствует каталог — ошибка, создания нет', () => {
  const root = tmpDir();
  try {
    const res = updateEnvironmentAt(join(root, 'gone'), { name: 'gone' }, { allTools: [], allSkills: [] },
      { rename: true, syncResources: true });
    assert.equal(res.ok, false);
    assert.equal(existsSync(join(root, 'gone')), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

const created: string[] = [];
function mk(): string {
  const dir = mkdtempSync(join(tmpdir(), 'pi-env-store-'));
  created.push(dir);
  return dir;
}
test.after(() => { for (const d of created) rmSync(d, { recursive: true, force: true }); });

// ─── хранилище каталога моделей и выбор моделей ───────────────────────

test('enabledModels: выбор пикера пишется в settings.json и стирается пустым списком', () => {
  const root = mk();
  const res = createEnvironment(root, { name: 'e1', defaultProvider: 'p', defaultModel: 'm', enabledModels: ['p/m', 'p/o'] });
  assert.ok(res.ok);
  let raw = JSON.parse(readFileSync(join(root, 'e1', 'settings.json'), 'utf8'));
  assert.deepEqual(raw.enabledModels, ['p/m', 'p/o']);
  const upd = updateEnvironmentAt(join(root, 'e1'), { name: 'e1', enabledModels: [] },
    { allTools: [], allSkills: [] }, { rename: true, syncResources: false, storeModels: false });
  assert.ok(upd.ok);
  raw = JSON.parse(readFileSync(join(root, 'e1', 'settings.json'), 'utf8'));
  assert.equal('enabledModels' in raw, false);
});

test('enabledModels: не трогается, если выбор не меняли', () => {
  const root = mk();
  mkdirSync(join(root, 'e2'), { recursive: true });
  writeFileSync(join(root, 'e2', 'settings.json'), JSON.stringify({ enabledModels: ['p/m'] }, null, 2));
  updateEnvironmentAt(join(root, 'e2'), { name: 'e2' }, { allTools: [], allSkills: [] },
    { rename: true, syncResources: false, storeModels: false });
  const raw = JSON.parse(readFileSync(join(root, 'e2', 'settings.json'), 'utf8'));
  assert.deepEqual(raw.enabledModels, ['p/m']);
});

test('createEnvironment со хранилищем: models.json — симлинк, models-store.json и auth.json — свои', () => {
  const root = mk();
  const agent = mk();
  writeFileSync(join(agent, 'models.json'), '{"shared":true}');
  writeFileSync(join(agent, 'models-store.json'), '{"personal":true}');
  writeFileSync(join(agent, 'auth.json'), '{"token":"t"}');
  const storeDir = join(root, '.store', 'models');
  mkdirSync(storeDir, { recursive: true });
  const storeFile = join(storeDir, 'models.json');
  writeFileSync(storeFile, '{"shared":true}');
  const res = createEnvironment(root, { name: 'e3' }, agent, 'ru', { storeFile, storeModels: true });
  assert.ok(res.ok);
  assert.ok(lstatSync(join(root, 'e3', 'models.json')).isSymbolicLink());
  assert.equal(readFileSync(join(root, 'e3', 'models.json'), 'utf8'), '{"shared":true}');
  assert.ok(!lstatSync(join(root, 'e3', 'models-store.json')).isSymbolicLink());
  assert.ok(existsSync(join(root, 'e3', 'auth.json')));
});

test('updateEnvironmentAt при включённом хранилище не копирует models.json поверх симлинка', () => {
  const root = mk();
  const agent = mk();
  writeFileSync(join(agent, 'models.json'), '{"agent":true}');
  const storeDir = join(root, '.store', 'models');
  mkdirSync(storeDir, { recursive: true });
  const storeFile = join(storeDir, 'models.json');
  writeFileSync(storeFile, '{"shared":true}');
  mkdirSync(join(root, 'e4'), { recursive: true });
  symlinkSync(storeFile, join(root, 'e4', 'models.json'));
  const res = updateEnvironmentAt(join(root, 'e4'), { name: 'e4' },
    { allTools: [], allSkills: [], agentDir: agent }, { rename: true, syncResources: false, modelSource: agent, storeFile, storeModels: true });
  assert.ok(res.ok);
  assert.ok(lstatSync(join(root, 'e4', 'models.json')).isSymbolicLink());
  assert.equal(readFileSync(join(root, 'e4', 'models.json'), 'utf8'), '{"shared":true}');
  assert.equal(existsSync(join(agent, 'models.json')), true);
});

test('updateEnvironmentAt при выключенном хранилище возвращает обычную копию каталога', () => {
  const root = mk();
  const agent = mk();
  writeFileSync(join(agent, 'models.json'), '{"agent":true}');
  mkdirSync(join(root, 'e5'), { recursive: true });
  const res = updateEnvironmentAt(join(root, 'e5'), { name: 'e5' },
    { allTools: [], allSkills: [], agentDir: agent }, { rename: true, syncResources: false, modelSource: agent, storeModels: false });
  assert.ok(res.ok);
  assert.ok(!lstatSync(join(root, 'e5', 'models.json')).isSymbolicLink());
  assert.equal(readFileSync(join(root, 'e5', 'models.json'), 'utf8'), '{"agent":true}');
});

test('createEnvironment с пакетным хранилищем: npm/ и git/ — симлинки на хранилище', () => {
  const root = tmpDir();
  const agent = tmpDir();
  const store = join(root, '.store');
  const storeFile = join(store, 'models', 'models.json');
  writeFileSync(join(agent, 'models.json'), '{"providers":{}}');
  const res = createEnvironment(root, { name: 'e4' }, agent, 'ru', { storeFile, storeModels: true, storeDir: store, storeRoots: true });
  assert.equal(res.ok, true, res.error);
  assert.equal(lstatSync(join(root, 'e4', 'npm')).isSymbolicLink(), true);
  assert.equal(lstatSync(join(root, 'e4', 'git')).isSymbolicLink(), true);
  assert.ok(existsSync(join(store, 'npm')), 'общие корни созданы');
});

test('createEnvironment без пакетного хранилища: своих npm/ и git/ нет', () => {
  const root = tmpDir();
  const agent = tmpDir();
  const res = createEnvironment(root, { name: 'e5' }, agent, 'ru', {});
  assert.equal(res.ok, true, res.error);
  assert.equal(existsSync(join(root, 'e5', 'npm')), false);
  assert.equal(existsSync(join(root, 'e5', 'git')), false);
});
