import { test } from 'node:test';
import assert from 'node:assert';
import {
  diffFrames, paintFrame, frameKey,
  type FrameKey, type FramePatch, type PrevFrame,
} from '../src/diff.js';
import { render } from '../src/render.js';
import { initialState, emptyCatalog, type AppState, type Environment } from '../src/state.js';

const K = frameKey(80, 24, true);
const prev = (lines: string[], key: FrameKey = K): PrevFrame => ({ lines, key });

/** Записывающий сток: собирает патчи, всегда пишет (или всегда отказывается). */
function recordingSink(writes: boolean) {
  const patches: FramePatch[] = [];
  return { patches, paint(patch: FramePatch): boolean { patches.push(patch); return writes; } };
}

test('diffFrames: первого кадра нет → полный кадр', () => {
  assert.deepEqual(diffFrames(null, ['a', 'b'], K), { full: true, ops: [] });
});

test('diffFrames: идентичный кадр → без операций', () => {
  const d = diffFrames(prev(['a', 'b']), ['a', 'b'], K);
  assert.equal(d.full, false);
  assert.deepEqual(d.ops, []);
});

test('diffFrames: changed rows = только изменённые, row = индекс + 1', () => {
  const d = diffFrames(prev(['a', 'b', 'c']), ['a', 'B', 'c'], K);
  assert.equal(d.full, false);
  assert.deepEqual(d.ops, [{ row: 2, text: 'B' }]);
});

test('diffFrames: ANSI-код внутри строки = часть строки', () => {
  const d = diffFrames(prev(['a', 'b']), ['a', 'b\x1b[0m'], K);
  assert.equal(d.ops.length, 1);
  assert.deepEqual(d.ops, [{ row: 2, text: 'b\x1b[0m' }]);
});

test('diffFrames: другой key (width/height/twoColumns) → full', () => {
  const lines = ['a', 'b'];
  assert.equal(diffFrames(prev(lines, K), lines, frameKey(81, 24, true)).full, true);
  assert.equal(diffFrames(prev(lines, K), lines, frameKey(80, 25, true)).full, true);
  assert.equal(diffFrames(prev(lines, K), lines, frameKey(80, 24, false)).full, true);
});

test('diffFrames: разная длина кадра → full', () => {
  assert.equal(diffFrames(prev(['a', 'b']), ['a'], K).full, true);
  assert.equal(diffFrames(prev(['a']), ['a', 'b'], K).full, true);
});

test('paintFrame: пустой дифф → sink не вызывается, prev сохранён', () => {
  const p = prev(['a', 'b']);
  const sink = recordingSink(true);
  assert.equal(paintFrame(p, ['a', 'b'], K, sink), p);
  assert.deepEqual(sink.patches, []);
});

test('paintFrame: полный кадр → патч {kind:"full"} и новый prev', () => {
  const sink = recordingSink(true);
  const next = paintFrame(null, ['a', 'b'], K, sink);
  assert.deepEqual(sink.patches, [{ kind: 'full', lines: ['a', 'b'] }]);
  assert.deepEqual(next, { lines: ['a', 'b'], key: K });
});

test('paintFrame: изменённые строки → патч {kind:"rows"} только они', () => {
  const sink = recordingSink(true);
  const next = paintFrame(prev(['a', 'b', 'c']), ['a', 'B', 'c'], K, sink);
  assert.deepEqual(sink.patches, [{ kind: 'rows', rows: [{ row: 2, text: 'B' }] }]);
  assert.deepEqual(next, { lines: ['a', 'B', 'c'], key: K });
});

test('paintFrame: sink.paint вернул false → prev = null', () => {
  const sink = recordingSink(false);
  assert.equal(paintFrame(prev(['a']), ['a', 'b'], K, sink), null);
  assert.equal(paintFrame(prev(['a']), ['B'], K, sink), null);
});

// ——— кадры настоящим render() ———

const env = (name: string): Environment => ({
  name,
  path: '/r/' + name,
  details: { hasSettings: true, model: null, tools: [], skills: [], packages: [], mcp: [] },
});

const frame = (selected: number, envs: Environment[]): string[] =>
  render({
    state: { ...initialState(emptyCatalog()), selected } as AppState,
    envs, root: '/r', width: 80, height: 24, useColor: false, status: null,
  }).split('\n');

test('render: сдвиг курсора в коротком списке → ровно две изменённые строки', () => {
  const envs = [env('e0'), env('e1')];
  const d = diffFrames(prev(frame(0, envs)), frame(1, envs), K);
  assert.equal(d.full, false);
  assert.deepEqual(d.ops.map((o) => o.row), [3, 4]);
});

test('render: список длиннее кадра → меняется окно скролла, ops покрывает все изменённые строки', () => {
  const envs = Array.from({ length: 30 }, (_, i) => env('e' + i));
  const before = frame(0, envs);
  const after = frame(25, envs);
  const d = diffFrames(prev(before), after, K);
  assert.equal(d.full, false);
  assert.ok(d.ops.length > 2, 'окно скролла меняет не две строки');
  for (const op of d.ops) {
    assert.equal(op.text, after[op.row - 1], `патч строки ${op.row} несёт строку нового кадра`);
    assert.notEqual(before[op.row - 1], op.text, `строка ${op.row} действительно отличается`);
  }
  const changed = new Set(d.ops.map((o) => o.row));
  for (const row of [1, 2, 23, 24]) {
    assert.ok(!changed.has(row), `строка ${row} (таб-бар/разделитель/футер) не должна меняться`);
  }
});

test('render: строки с cupBorder сохраняют row = индекс + 1', () => {
  const lines = frame(0, [env('e0'), env('e1')]);
  let cupFound = 0;
  lines.forEach((line, i) => {
    for (const m of line.matchAll(/\x1b\[(\d+);(\d+)H/g)) {
      cupFound++;
      assert.equal(Number(m[1]), i + 1, `CUP в строке ${i + 1} указывает на неё же`);
    }
  });
  assert.ok(cupFound > 0, 'в кадре есть границы, дорисованные CUP');
});
