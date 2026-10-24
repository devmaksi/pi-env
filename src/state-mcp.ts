import { validateMcpForm, type McpFormFields, type McpLiveReport, type McpServer, type McpType } from './mcp.js';
import type { AppState, Action } from './state.js';

/** Печатаемый символ (не управляющий): 0x21..0x7e. */
export function isPrintable(a: Action): a is string {
  return typeof a === 'string' && a.length === 1 && a.charCodeAt(0) >= 0x21 && a.charCodeAt(0) <= 0x7e;
}

/** Поля окна добавления MCP (данные) + UI-состояние формы. */
export type McpFormAdd = McpFormFields & {
  cursor: number;
  caret: number;
  error: string | null;
};

/** Подэкраны вкладки «MCP». */
export type McpTabView = 'add' | 'submitting' | 'confirm-remove' | 'removing';

export interface McpTab {
  view: McpTabView;
  form: McpFormAdd | null;
  removing: string | null;
}

/** Строки формы добавления по типу сервера. */
export function mcpFormRows(type: McpType): string[] {
  return type === 'stdio'
    ? ['name', 'type', 'command', 'args', 'env', 'cwd', 'description', 'exposure', 'action']
    : ['name', 'type', 'url', 'description', 'exposure', 'action'];
}

/** Результат шага формы добавления: обновлённая форма / закрыть / отправить. */
export type McpFormStep =
  | { kind: 'form'; form: McpFormAdd }
  | { kind: 'close' }
  | { kind: 'submit' };

export type McpExposure = 'codemode' | 'deferred' | 'direct' | 'hidden';
export const MCP_TYPES: readonly McpType[] = ['stdio', 'http'];
export const MCP_EXPOSURES: readonly McpExposure[] = ['codemode', 'deferred', 'direct', 'hidden'];

/** Закрытые списки значений строк формы: строка → варианты (cycle по ←/→). */
export const MCP_ENUM_ROWS: Record<string, readonly string[]> = {
  type: MCP_TYPES,
  exposure: MCP_EXPOSURES,
};

/** Варианты enum-строки формы или null, если строка не enum (текст/действие). */
export function enumValues(row: string): readonly string[] | null {
  return MCP_ENUM_ROWS[row] ?? null;
}

/** Текстовые строки формы (редактируются вводом). */
export const TEXT_ROWS = ['name', 'command', 'args', 'env', 'cwd', 'description', 'url'] as const;
type TextField = (typeof TEXT_ROWS)[number];

/** Чистая форма добавления MCP. */
export function freshMcpForm(): McpFormAdd {
  return {
    name: '', type: 'stdio', command: '', args: '', url: '', env: '', cwd: '', description: '', exposure: 'codemode',
    cursor: 0, caret: 0, error: null,
  };
}

/** Пустое состояние вкладки «MCP» с переопределением полей. */
export function freshMcpTab(partial: Partial<McpTab>): McpTab {
  return { view: 'add', form: null, removing: null, ...partial };
}

/**
 * Шаг формы добавления MCP. null — клавиша не относится к форме
 * (управляющие — обрабатываются общей машиной).
 */
export function mcpFormStep(form: McpFormAdd, action: Action, language: string): McpFormStep | null {
  const rows = mcpFormRows(form.type);
  const row = rows[form.cursor];
  const textRow = TEXT_ROWS.includes(row as TextField);
  if (action === 'up' || action === 'down') {
    const delta = action === 'up' ? -1 : 1;
    return { kind: 'form', form: { ...form, cursor: Math.min(rows.length - 1, Math.max(0, form.cursor + delta)) } };
  }
  if (action === 'left' || action === 'right') {
    const delta = action === 'left' ? -1 : 1;
    const vals = enumValues(row);
    if (vals !== null) {
      // имя enum-строки совпадает с именем поля формы (MCP_ENUM_ROWS: type, exposure)
      const i = vals.indexOf(form[row as keyof McpFormAdd] as string);
      const next = vals[(Math.max(0, i) + delta + vals.length) % vals.length];
      return { kind: 'form', form: { ...form, [row]: next } as unknown as McpFormAdd };
    }
    if (!textRow) return { kind: 'form', form };
    const v = form[row as TextField];
    const caret = Math.min(v.length, Math.max(0, form.caret + delta));
    return { kind: 'form', form: { ...form, caret } };
  }
  if (action === 'enter') {
    if (row === 'action') {
      const error = validateMcpForm(form, language);
      if (error !== null) return { kind: 'form', form: { ...form, error } };
      return { kind: 'submit' };
    }
    return { kind: 'form', form };
  }
  if (action === 'backspace') {
    if (!textRow) return { kind: 'form', form };
    const v = form[row as TextField];
    return { kind: 'form', form: { ...form, [row]: v.slice(0, -1), caret: Math.max(0, form.caret - 1) } as McpFormAdd };
  }
  if (action === 'esc') {
    return { kind: 'close' };
  }
  if (isPrintable(action)) {
    if (!textRow) return { kind: 'form', form };
    const v = form[row as TextField];
    const caret = Math.min(v.length, form.caret);
    return { kind: 'form', form: { ...form, [row]: v.slice(0, caret) + action + v.slice(caret), caret: caret + 1 } as McpFormAdd };
  }
  return null;
}

/** Имена MCP для списка формы: окружение (сортированы) + только-в-main (сортированы). */
export function mcpListNames(envMcp: McpServer[], mainMcp: McpServer[]): string[] {
  const names = [...envMcp.map((s) => s.name)].sort();
  const inEnv = new Set(names);
  for (const n of [...mainMcp.map((s) => s.name)].sort()) if (!inEnv.has(n)) names.push(n);
  return names;
}

/**
 * Машина вкладки «MCP» (вызывается, когда tab === 'mcp' && mcp !== null).
 * null — непроцессированные клавиши (такие как tab) падают в общую машину.
 */
export function mcpMachine(state: AppState, action: Action): AppState | null {
  const mcp = state.mcp!;
  if (mcp.view === 'add' && mcp.form !== null) {
    const step = mcpFormStep(mcp.form, action, state.language);
    if (step !== null) {
      if (step.kind === 'form') return { ...state, mcp: { ...mcp, form: step.form } };
      if (step.kind === 'close') return { ...state, mcp: null };
      return { ...state, mcp: { ...mcp, view: 'submitting' } };
    }
    return null; // в общую машину
  }
  if (mcp.view === 'confirm-remove') {
    if (action === 'esc') return { ...state, mcp: null };
    if (action === 'enter') return { ...state, mcp: { ...mcp, view: 'removing' } };
    return null; // в общую машину
  }
  // submitting/removing — клавиши процесс не отменяют
  return state;
}

/**
 * Результат проверки живого статуса (вкладка «MCP»): отчёт — по содержимому stdout
 * (pi mcp list выходит 1 при неподключённых серверах); null — ошибка проверки,
 * прежний отчёт остаётся видимым.
 */
export function applyMcpLiveMain(
  state: AppState,
  action: { report: McpLiveReport | null },
): AppState {
  if (action.report === null) return { ...state, mcpCheck: 'error' };
  return { ...state, mcpCheck: 'done', mcpLive: action.report };
}
/** R — перезапуск проверки живого статуса: только когда виден список вкладки «MCP». */
export function onRefreshMcp(state: AppState): AppState {
  if (state.tab !== 'mcp' || state.sub !== null || state.ext !== null || state.mcp !== null) return state;
  return state.mcpCheck === 'checking' ? state : { ...state, mcpCheck: 'checking' };
}
