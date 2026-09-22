import { test } from 'node:test';
import assert from 'node:assert';
import { computeLayout, WIDE_MIN, NARROW_MIN, LOW_MIN } from '../src/layout.js';

test('порог двух колонок — 62', () => {
  assert.equal(WIDE_MIN, 62);
  assert.equal(computeLayout({ width: 62, height: 24 }).twoColumns, true);
  assert.equal(computeLayout({ width: 61, height: 24 }).twoColumns, false);
});

test('ширины колонок закрывают внутреннюю ширину', () => {
  const L = computeLayout({ width: 100, height: 24 });
  assert.equal(L.leftWidth + L.rightWidth + 1, 98);
  assert.equal(L.leftWidth, 49);
  assert.equal(L.rightWidth, 48);
});

test('одна колонка', () => {
  const L = computeLayout({ width: 40, height: 24 });
  assert.equal(L.twoColumns, false);
  assert.equal(L.leftWidth, 38);
  assert.equal(L.rightWidth, 0);
});

test('константы узкого/низкого терминала', () => {
  assert.equal(NARROW_MIN, 30);
  assert.equal(LOW_MIN, 8);
});
