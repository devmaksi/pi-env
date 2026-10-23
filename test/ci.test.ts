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

// «Node.js ≥ 20», «Node LTS 20», «Node >= 20.6.0», «node -v (must be ≥ 20)» —
// любая форма, где документ обещает Node-линию 20
const STALE_FLOOR = /Node(?:\.js)?[^\n]{0,24}?\b20\b[.\d]*/gi;

const staleFloorClaims = (text: string): string[] =>
  [...text.matchAll(STALE_FLOOR)].map((m) => m[0].trim());

test('engines: минимальная Node — 22.19.0 (как у pi)', () => {
  assert.match(repo('package.json'), /"node":\s*">=22\.19\.0"/);
});

test('доки не обещают Node ниже engines', () => {
  const floor = enginesMajor();
  assert.equal(floor, 22);
  for (const f of DOCS) {
    const text = repo(f);
    for (const claim of staleFloorClaims(text)) {
      assert.fail(`${f}: обещает Node 20 — «${claim}»`);
    }
    assert.match(text, /22\.19/, `${f}: нет упоминания 22.19`);
  }
});

test('страховка доков ловит обещание Node 20 в разной форме', () => {
  const forms = [
    '**Требования:** Node.js ≥ 20 и установленный CLI',
    'Check: `node -v` (must be >= 20) and `npm -v`.',
    '**Stack:** Node LTS 20, TypeScript',
    'Node.js >= 20.6.0',
  ];
  for (const form of forms) {
    assert.ok(staleFloorClaims(form).length > 0, `не поймано: ${form}`);
  }
  assert.deepEqual(staleFloorClaims('Node.js ≥ 22.19 (как у pi 1.3/1.4)'), []);
});

const WORKFLOWS = ['.github/workflows/ci.yml', '.github/workflows/publish.yml'];

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

test('ci.yml и publish.yml вызывают tests.yml и не дублируют матрицу', () => {
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

test('publish.yml: публикация заперта тестами', () => {
  const y = repo('.github/workflows/publish.yml');
  const jobs = y.slice(y.indexOf('\njobs:'));
  const body = jobs.slice(jobs.indexOf('\n  publish:'));
  assert.ok(jobs.includes('\n  publish:'), 'publish.yml: нет джоба publish');
  assert.match(y, /uses:\s*\.\/\.github\/workflows\/tests\.yml/);
  assert.match(body, /needs:\s*test/);
  assert.ok(
    body.indexOf('needs:') < body.indexOf('npm publish'),
    'publish.yml: needs: test должен стоять до npm publish',
  );
});

test('publish.yml: ловушки публикации не потеряны', () => {
  const y = repo('.github/workflows/publish.yml');
  assert.match(y, /id-token:\s*write/);
  assert.match(y, /npm publish --provenance --access public/);
  assert.match(y, /npm install -g npm@11/);
  assert.match(y, /runs-on:\s*ubuntu-24\.04/);
  assert.match(y, /registry-url:\s*https:\/\/registry\.npmjs\.org/);
});
