/**
 * Построчный дифф кадра: что из нового кадра нужно писать на экран.
 * Чистые функции — кадр это `string[]` ровно `height` строк фиксированной
 * ширины (то, что отдаёт `render()`), сравнение байтовое: равная строка
 * значит, что на экране уже и нужный текст, и нужный стиль.
 */

export interface FrameKey {
  width: number;
  height: number;
  twoColumns: boolean;
}

export interface PrevFrame {
  lines: string[];
  key: FrameKey;
}

/** Строка кадра, которую нужно записать; row — экранная строка (1-based) = индекс + 1. */
export interface PaintOp {
  row: number;
  text: string;
}

export interface FrameDiff {
  full: boolean;
  ops: PaintOp[];
}

/** Что писать: весь кадр (после clear) или только изменённые строки. */
export type FramePatch = { kind: 'full'; lines: string[] } | { kind: 'rows'; rows: PaintOp[] };

export interface FrameSink {
  /** Возвращает true, только если кадр действительно написан. */
  paint(patch: FramePatch): boolean;
}

export function frameKey(width: number, height: number, twoColumns: boolean): FrameKey {
  return { width, height, twoColumns };
}

/**
 * Кадры одинаковой раскладки сравниваются построчно. Полный кадр — когда предыдущего
 * кадра нет, раскладка (или размер) другая, либо кадры разной длины: строки предыдущего
 * добиты до другой ширины и сравнивать их бессмысленно.
 */
export function diffFrames(prev: PrevFrame | null, next: string[], key: FrameKey): FrameDiff {
  const sameShape = prev !== null
    && prev.key.width === key.width
    && prev.key.height === key.height
    && prev.key.twoColumns === key.twoColumns
    && prev.lines.length === next.length;
  if (prev === null || !sameShape) return { full: true, ops: [] };
  const ops: PaintOp[] = [];
  for (let i = 0; i < next.length; i++) {
    if (prev.lines[i] !== next[i]) ops.push({ row: i + 1, text: next[i] });
  }
  return { full: false, ops };
}

/**
 * Дифф + запись одним вызовом. Ничего не пишется (и sink не вызывается), когда
 * кадр совпадает. Если запись не удалась (терминалом владеет дочерний `pi`) —
 * `null`: следующий репок обязан быть полным.
 */
export function paintFrame(
  prev: PrevFrame | null,
  lines: string[],
  key: FrameKey,
  sink: FrameSink,
): PrevFrame | null {
  const diff = diffFrames(prev, lines, key);
  if (!diff.full && diff.ops.length === 0) return prev;
  const patch: FramePatch = diff.full ? { kind: 'full', lines } : { kind: 'rows', rows: diff.ops };
  return sink.paint(patch) ? { lines, key } : null;
}
