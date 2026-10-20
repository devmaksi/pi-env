import { validateMcpForm, type McpFormFields, type McpServer, type McpType } from './mcp.js';
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
  select: 'type' | 'exposure' | null;
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

/** Текстовые строки формы (редактируются вводом). */
export const TEXT_ROWS = ['name', 'command', 'args', 'env', 'cwd', 'description', 'url'] as const;
type TextField = (typeof TEXT_ROWS)[number];

/** Чистая форма добавления MCP. */
export function freshMcpForm(): McpFormAdd {
  return {
    name: '', type: 'stdio', command: '', args: '', url: '', env: '', cwd: '', description: '', exposure: 'codemode',
    cursor: 0, caret: 0, error: null, select: null,
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
    if (form.select === 'type') {
      const delta = action === 'up' ? -1 : 1;
      return { kind: 'form', form: { ...form, cursor: (form.cursor + delta + MCP_TYPES.length) % MCP_TYPES.length } };
    }
    if (form.select === 'exposure') {
      const delta = action === 'up' ? -1 : 1;
      return { kind: 'form', form: { ...form, cursor: (form.cursor + delta + MCP_EXPOSURES.length) % MCP_EXPOSURES.length } };
    }
    const delta = action === 'up' ? -1 : 1;
    return { kind: 'form', form: { ...form, cursor: Math.min(rows.length - 1, Math.max(0, form.cursor + delta)) } };
  }
  if (action === 'left' || action === 'right') {
    if (form.select !== null) {
      const n = form.select === 'type' ? MCP_TYPES.length : MCP_EXPOSURES.length;
      const delta = action === 'left' ? -1 : 1;
      return { kind: 'form', form: { ...form, cursor: (form.cursor + delta + n) % n } };
    }
    if (!textRow) return { kind: 'form', form };
    const v = form[row as TextField];
    const caret = Math.min(v.length, Math.max(0, form.caret + (action === 'left' ? -1 : 1)));
    return { kind: 'form', form: { ...form, caret } };
  }
  if (action === 'enter') {
    if (form.select === 'type') return { kind: 'form', form: { ...form, type: MCP_TYPES[form.cursor], select: null, cursor: rows.indexOf('type') } };
    if (form.select === 'exposure') return { kind: 'form', form: { ...form, exposure: MCP_EXPOSURES[form.cursor], select: null, cursor: rows.indexOf('exposure') } };
    if (row === 'type') return { kind: 'form', form: { ...form, select: 'type', cursor: form.type === 'http' ? 1 : 0 } };
    if (row === 'exposure') {
      const i = MCP_EXPOSURES.indexOf((form.exposure ?? '') as McpExposure);
      return { kind: 'form', form: { ...form, select: 'exposure', cursor: i === -1 ? 0 : i } };
    }
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
    if (form.select !== null) return { kind: 'form', form: { ...form, select: null } };
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
