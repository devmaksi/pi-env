import { test } from 'node:test';
import assert from 'node:assert';
import { parseKeys } from '../src/terminal.js';

test('parseKeys: стрелки', () => {
  assert.deepEqual(parseKeys(Buffer.from([0x1b, 0x5b, 0x41]), 0).keys, ['up']);
  assert.deepEqual(parseKeys(Buffer.from([0x1b, 0x5b, 0x42]), 0).keys, ['down']);
  assert.deepEqual(parseKeys(Buffer.from([0x1b, 0x5b, 0x43]), 0).keys, ['right']);
  assert.deepEqual(parseKeys(Buffer.from([0x1b, 0x5b, 0x44]), 0).keys, ['left']);
});

test('parseKeys: esc, enter, tab, space, ctrlc', () => {
  assert.deepEqual(parseKeys(Buffer.from([0x1b]), 0).keys, ['esc']);
  assert.deepEqual(parseKeys(Buffer.from([0x0d]), 0).keys, ['enter']);
  assert.deepEqual(parseKeys(Buffer.from([0x0a]), 0).keys, ['enter']);
  assert.deepEqual(parseKeys(Buffer.from([0x09]), 0).keys, ['tab']);
  assert.deepEqual(parseKeys(Buffer.from([0x20]), 0).keys, ['space']);
  assert.deepEqual(parseKeys(Buffer.from([0x03]), 0).keys, ['ctrlc']);
});

test('parseKeys: последовательность разрезана по чанкам', () => {
  const first = parseKeys(Buffer.from([0x1b, 0x5b]), 0);
  assert.deepEqual(first.keys, []);
  const second = parseKeys(Buffer.from([0x41]), first.esc);
  assert.deepEqual(second.keys, ['up']);
});

test('parseKeys: неизвестная CSI-последовательность игнорируется', () => {
  assert.deepEqual(parseKeys(Buffer.from([0x1b, 0x5b, 0x4f]), 0).keys, []);
});
