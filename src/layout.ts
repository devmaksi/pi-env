export interface Size {
  width: number;
  height: number;
}

export interface Layout {
  twoColumns: boolean;
  leftWidth: number;
  rightWidth: number;
}

export const WIDE_MIN = 62;
export const NARROW_MIN = 30;
export const LOW_MIN = 8;

/**
 * Раскладка: две колонки при ширине >= WIDE_MIN, иначе одна.
 * leftWidth + rightWidth + 1 === width - 2 (разделитель между колонками).
 */
export function computeLayout(size: Size): Layout {
  const inner = size.width - 2;
  const twoColumns = size.width >= WIDE_MIN;
  const leftWidth = twoColumns ? Math.floor(inner / 2) : inner;
  const rightWidth = twoColumns ? inner - leftWidth - 1 : 0;
  return { twoColumns, leftWidth, rightWidth };
}
