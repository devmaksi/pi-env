import { test } from 'node:test';
import assert from 'node:assert';
import { createTerm } from '../src/terminal.js';
import type { FramePatch } from '../src/diff.js';
import { withFakeTermStreams } from './fake-streams.js';

const FULL: FramePatch = { kind: 'full', lines: ['a', 'b'] };
const ROWS: FramePatch = { kind: 'rows', rows: [{ row: 4, text: 'x' }] };

test('paint: полный кадр — один write с ESC[2J, ESC[H и строками через \\n', () => {
  withFakeTermStreams((writes) => {
    const term = createTerm();
    term.start();
    const before = writes.length;
    assert.equal(term.paint(FULL), true);
    assert.equal(writes.length, before + 1, 'полный кадр — одна запись');
    const frame = writes[before];
    assert.ok(frame.includes('\x1b[2J'), 'кадр очищается');
    assert.ok(frame.includes('\x1b[H'), 'курсор ставится в начало');
    assert.ok(frame.includes('a\nb'), 'строки кадра через перевод строки');
    term.stop();
  });
});

test('paint: rows-патч — один write с ESC[<row>;1H, текстом и ESC[K', () => {
  withFakeTermStreams((writes) => {
    const term = createTerm();
    term.start();
    term.paint(FULL);
    const before = writes.length;
    assert.equal(term.paint(ROWS), true);
    assert.equal(writes.length, before + 1, 'частичный кадр — одна запись');
    const patch = writes[before];
    assert.ok(patch.includes('\x1b[4;1H'), 'абсолютный CUP на строку кадра');
    assert.ok(patch.includes('x'), 'текст изменённой строки');
    assert.ok(patch.includes('\x1b[K'), 'хвост прошлой строки стирается');
    assert.ok(!patch.includes('\x1b[2J'), 'кадр не очищается целиком');
    term.stop();
  });
});

test('paint: screenKnown false до полного кадра → rows-патч молчит и возвращает false', () => {
  withFakeTermStreams((writes) => {
    const term = createTerm();
    term.start();
    assert.equal(term.screenKnown(), false, 'сразу после start() экран неизвестен');
    const before = writes.length;
    assert.equal(term.paint(ROWS), false);
    assert.equal(writes.length, before, 'на свежий alt-экран частичные строки не пишутся');
    term.stop();
  });
});

test('paint: после полного кадра screenKnown true', () => {
  withFakeTermStreams((writes) => {
    const term = createTerm();
    term.start();
    term.paint(FULL);
    assert.equal(term.screenKnown(), true);
    assert.equal(term.paint(ROWS), true);
    term.stop();
  });
});

test('paint: stop() → start() → screenKnown снова false', () => {
  withFakeTermStreams((writes) => {
    const term = createTerm();
    term.start();
    term.paint(FULL);
    term.stop();
    term.start();
    assert.equal(term.screenKnown(), false, 'возврат из дочернего pi: alt-буфер свежий');
    const before = writes.length;
    assert.equal(term.paint(ROWS), false);
    assert.equal(writes.length, before);
    assert.equal(term.paint(FULL), true);
    assert.equal(term.screenKnown(), true);
    term.stop();
  });
});

test('paint: при остановленном терминале (после stop()) молчит и возвращает false', () => {
  withFakeTermStreams((writes) => {
    const term = createTerm();
    term.start();
    term.paint(FULL);
    term.stop();
    const before = writes.length;
    assert.equal(term.paint(ROWS), false);
    assert.equal(term.paint(FULL), false);
    assert.equal(writes.length, before, 'терминалом владеет дочерний pi — вывода нет');
  });
});

test('paint: частичный кадр не ломает идемпотентный stop() (escape-коды alt-screen один раз)', () => {
  withFakeTermStreams((writes, raw) => {
    const term = createTerm();
    term.start();
    term.paint(FULL);
    term.paint(ROWS);
    term.stop();
    term.stop();
    assert.equal(writes.filter((w) => w.includes('\x1b[?1049l')).length, 1);
    assert.deepEqual(raw, [true, false]);
  });
});
