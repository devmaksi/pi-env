import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const repo = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), 'utf8');

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
