import type { AppState, Action, ReducerCtx } from './state.js';

/** Невыполненное действие хука: восстановить запись или удалить её совсем. */
export interface TrashPending {
  kind: 'restore' | 'delete';
  dirName: string;
}

/**
 * Суб-экран «Корзина» на вкладке «Окружения».
 * `cursor` — позиция в списке записей; `confirm` — имя каталога, удаление которого ждут
 * подтверждения; `pending` — действие, которое исполнит хук (`run-side.ts`) и снимет результатом.
 */
export interface TrashState {
  cursor: number;
  confirm: string | null;
  pending: TrashPending | null;
}

export function freshTrash(over: Partial<TrashState> = {}): TrashState {
  return { cursor: 0, confirm: null, pending: null, ...over };
}

function names(ctx: ReducerCtx): string[] {
  return ctx.trashNames ?? [];
}

/** Курсор в границах списка (пустой список — 0). */
function clampCursor(cursor: number, len: number): number {
  return len === 0 ? 0 : Math.max(0, Math.min(cursor, len - 1));
}

/**
 * Машина суб-экрана корзины (вызывается, когда tab === 'envs' && trash !== null).
 * null — непроцессированные клавиши (такие как tab) падают в общую машину.
 */
export function trashMachine(state: AppState, action: Action, ctx: ReducerCtx): AppState | null {
  const trash = state.trash!;
  const list = names(ctx);
  if (action === 'up' || action === 'down') {
    const cursor = clampCursor(trash.cursor + (action === 'up' ? -1 : 1), list.length);
    return cursor === trash.cursor ? state : { ...state, trash: { ...trash, cursor } };
  }
  if (action === 'esc') {
    return trash.confirm === null
      ? { ...state, trash: null }
      : { ...state, trash: { ...trash, confirm: null } };
  }
  if (action === 'enter') {
    if (trash.pending !== null) return state; // действие уже исполняется
    if (trash.confirm !== null) {
      return { ...state, trash: { ...trash, confirm: null, pending: { kind: 'delete', dirName: trash.confirm } } };
    }
    const dirName = list[trash.cursor];
    if (dirName === undefined) return state;
    return { ...state, trash: { ...trash, pending: { kind: 'restore', dirName } } };
  }
  if ((action === 'x' || action === 'X') && trash.confirm === null && trash.pending === null) {
    const dirName = list[trash.cursor];
    if (dirName === undefined) return state;
    return { ...state, trash: { ...trash, confirm: dirName } };
  }
  if (action === 'tab' || action === 'ctrlc') return null; // общая машина: смена вкладки / выход
  return state; // печатные символы, space, ←/→, R в суб-экране корзины ничего не делают
}

/** Результат восстановления/удаления: pending снят, курсоры в новых границах, суб-экран открыт.
 * Курсор списка окружений держим на строке «Корзина»: после восстановления окружений стало
 * больше, и без этого он съехал бы на «Создать» (Enter открыл бы форму создания). */
export function applyTrashResult(state: AppState, _action: { ok: boolean; message: string }, ctx: ReducerCtx): AppState {
  if (state.trash === null) return state;
  return {
    ...state,
    selected: ctx.envNames.length + 1, // «Корзина» — последняя строка списка окружений
    trash: { ...state.trash, pending: null, cursor: clampCursor(state.trash.cursor, names(ctx).length) },
  };
}
