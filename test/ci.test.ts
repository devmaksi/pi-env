import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const repo = (rel: string): string => {
  const path = fileURLToPath(new URL(`../${rel}`, import.meta.url));
  assert.ok(existsSync(path), `нет файла ${rel}`);
  return readFileSync(path, 'utf8');
};

const enginesMajor = (): number => {
  const m = /"engines"\s*:\s*\{\s*"node"\s*:\s*">=\s*(\d+)/.exec(repo('package.json'));
  assert.ok(m, 'package.json: нет engines.node');
  return Number(m[1]);
};

const DOCS = ['README.md', 'README.en.md', 'docs/installation.md', 'docs/installation.en.md',
  'docs/development.md', 'docs/development.en.md', 'AGENTS.md'];

test('engines: минимальная Node — 22.19.0 (как у pi)', () => {
  assert.match(repo('package.json'), /"node":\s*">=22\.19\.0"/);
});

test('доки не обещают Node ниже engines', () => {
  const floor = enginesMajor();
  assert.equal(floor, 22);
  for (const f of DOCS) {
    const text = repo(f);
    assert.doesNotMatch(text, /≥\s*20\b/, `${f}: обещает Node 20`);
    assert.doesNotMatch(text, /Node(?:\.js)?\s*>=\s*20\b/, `${f}: обещает Node 20`);
    assert.match(text, /22\.19/, `${f}: нет упоминания 22.19`);
  }
});

// publish.yml попадает в список вместе с его гейтом (Task 3 плана)
const WORKFLOWS = ['.github/workflows/ci.yml'];

const matrixNodes = (): number[] => {
  const m = /node:\s*\[([\d,\s]+)\]/.exec(repo('.github/workflows/tests.yml'));
  assert.ok(m, 'tests.yml: нет матрицы node');
  return m[1].split(',').map((s) => Number(s.trim()));
};

test('tests.yml: реюз-воркфлоу проверки с матрицей 22/24', () => {
  const y = repo('.github/workflows/tests.yml');
  assert.match(y, /^on:\s*workflow_call$/m);
  assert.match(y, /runs-on:\s*ubuntu-24\.04/);
  assert.deepEqual(matrixNodes(), [22, 24]);
  for (const step of ['npm ci', 'npm run build', 'npm test']) {
    assert.match(y, new RegExp(`run:\\s*${step.replace(' ', '\\s')}`));
  }
});

test('матрица tests.yml покрывает engines', () => {
  const floor = enginesMajor();
  const nodes = matrixNodes();
  assert.ok(nodes.length >= 2, 'матрица должна покрывать больше одной Node-линии');
  for (const n of nodes) assert.ok(n >= floor, `tests.yml: Node ${n} младше engines ${floor}`);
});

test('ci.yml вызывает tests.yml и не дублирует матрицу', () => {
  for (const f of WORKFLOWS) {
    const y = repo(f);
    assert.match(y, /uses:\s*\.\/\.github\/workflows\/tests\.yml/);
    assert.doesNotMatch(y, /matrix:/, `${f}: своя матрица — источник правды снова два`);
  }
});

test('tests.yml: least privilege — без write и id-token', () => {
  const y = repo('.github/workflows/tests.yml');
  assert.match(y, /permissions:\s*\n\s*contents:\s*read/);
  assert.doesNotMatch(y, /id-token|contents:\s*write/);
});
