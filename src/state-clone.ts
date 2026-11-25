import { validateName } from './create.js';
import { t } from './i18n.js';
import { isPrintable } from './state-mcp.js';
import { MAX_NAME } from './state-form.js';
import { realNamesOf } from './state.js';
import type { AppState, Action, ReducerCtx } from './state.js';

/**
 * Суб-экран «Клонирование окружения» на вкладке «Окружения»: поле имени копии
 * и источник. `pending` — Enter нажат и копирование ждёт исполнения в эффект-слое
 * (`run-side.ts`), который снимает его результатом `clone-result`.
 */
export interface CloneState {
  /** Имя окружения-источника. */
  srcName: string;
  /** Путь источника: окружение может лежать вне `<root>` (основной агент). */
  srcPath: string;
  /** Имя копии; редактируется печатными клавишами, как строка «Имя» формы. */
  name: string;
  caret: number;
  pending: boolean;
  error: string | null;
}

export function freshClone(srcName: string, srcPath: string, lang: string): CloneState {
  const name = t(lang, 'clone.name-default', { name: srcName }).slice(0, MAX_NAME);
  return { srcName, srcPath, name, caret: name.length, pending: false, error: null };
}

/**
 * Машина суб-экрана клонирования (вызывается, когда tab === 'envs' && clone !== null).
 * null не возвращает ни для какой клавиши: непроцессированные клавиши не должны
 * уходить в общую машину (иначе Esc вышел бы из приложения, а TAB — на другую вкладку).
 */
export function cloneMachine(state: AppState, action: Action, ctx: ReducerCtx): AppState | null {
  const cl = state.clone!;
  if (action === 'esc') return { ...state, clone: null };
  if (action === 'tab' || action === 'ctrlc') return state; // суб-экран не меняет вкладку; Ctrl+C — на уровне reducer
  if (cl.pending) return state; // копирование уже исполняется эффектом
  if (action === 'left') return { ...state, clone: { ...cl, caret: Math.max(0, cl.caret - 1) } };
  if (action === 'right') return { ...state, clone: { ...cl, caret: Math.min(cl.name.length, cl.caret + 1) } };
  if (action === 'backspace') {
    if (cl.caret === 0) return state;
    const name = cl.name.slice(0, cl.caret - 1) + cl.name.slice(cl.caret);
    return { ...state, clone: { ...cl, name, caret: cl.caret - 1, error: null } };
  }
  if (action === 'enter') {
    const err = validateName(cl.name, realNamesOf(ctx), state.language);
    return err !== null
      ? { ...state, clone: { ...cl, error: err } }
      : { ...state, clone: { ...cl, pending: true } };
  }
  if (isPrintable(action)) {
    if (cl.name.length >= MAX_NAME) return state;
    const name = cl.name.slice(0, cl.caret) + action + cl.name.slice(cl.caret);
    return { ...state, clone: { ...cl, name, caret: cl.caret + 1, error: null } };
  }
  return state; // ↑/↓/Space/X/R в суб-экране ничего не делают
}

/**
 * Результат копирования: успех — суб-экран закрыт, курсор на копии (иначе в границах
 * списка); ошибка — суб-экран остаётся открытым с текстом, имя можно поправить.
 */
export function applyCloneResult(
  state: AppState,
  action: { ok: boolean; message: string; name?: string },
  ctx: ReducerCtx,
): AppState {
  if (state.clone === null) return state;
  if (!action.ok) return { ...state, clone: { ...state.clone, pending: false, error: action.message } };
  // Индекс копии — по строкам списка целиком (`envNames`), как их нумерует экран. Ищем с конца:
  // синтетическая основная запись стоит первой и может совпадать по имени с обычным окружением.
  const at = action.name === undefined ? -1 : ctx.envNames.lastIndexOf(action.name);
  const selected = at >= 0 ? at : Math.max(0, Math.min(state.selected, ctx.envNames.length - 1));
  return { ...state, clone: null, selected };
}
