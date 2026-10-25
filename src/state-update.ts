/** Вкладка «Обновление»: динамический список вкладок и машина вкладки (чистые функции). */

import { updateCommands, type ChangelogRow } from './selfupdate.js';
import type { SelfUpdate } from './selfupdate-net.js';
import type { Action, AppState, Tab } from './state.js';

export type UpdateCheck = 'idle' | 'loading' | 'ready' | 'error';

export interface UpdateUi {
  cursor: number;
  check: UpdateCheck;
  rows: ChangelogRow[];
  /** Команда, которую пользователь попросил скопировать (Enter); null — не командная строка. */
  copyRequest: string | null;
}

export function freshUpdateUi(partial: Partial<UpdateUi> = {}): UpdateUi {
  return { cursor: 0, check: 'ready', rows: [], copyRequest: null, ...partial };
}

const BASE_TABS: readonly Tab[] = ['envs', 'extensions', 'mcp', 'settings', 'about'];

/** Первая строка списка команд (0 — версии, 1 — способ, 2 — подсказка, 3 — пустая). */
export const UPDATE_ROW_COMMANDS = 4;

/** Вкладки кадра: «Обновление» есть только когда найдена более свежая версия. */
export function tabsOf(state: AppState): Tab[] {
  if (state.selfUpdate === null) return [...BASE_TABS];
  const tabs = [...BASE_TABS];
  tabs.splice(BASE_TABS.length - 1, 0, 'update');
  return tabs;
}

export function updateListLength(state: AppState): number {
  if (state.selfUpdate === null) return 0;
  const rows = state.updateUi?.rows ?? [];
  return UPDATE_ROW_COMMANDS + updateCommands(state.selfUpdate.kind).length + 1 + Math.max(rows.length, 1);
}

export function selectedCommand(state: AppState): string | null {
  if (state.selfUpdate === null || state.updateUi === null) return null;
  const commands = updateCommands(state.selfUpdate.kind);
  const index = state.updateUi.cursor - UPDATE_ROW_COMMANDS;
  return index >= 0 && index < commands.length ? commands[index] : null;
}

export function onRefreshUpdate(state: AppState): AppState {
  if (state.selfUpdate === null || state.updateUi === null) return state;
  if (state.selfCheck === 'loading') return state;
  return { ...state, selfCheck: 'loading', updateUi: { ...state.updateUi, check: 'loading' } };
}

/** ↑/↓ по списку вкладки, Enter — копировать команду, R — перечитать чейнджлог. */
export function updateMachine(state: AppState, action: Action): AppState | null {
  const ui = state.updateUi;
  if (ui === null || state.selfUpdate === null) return null;
  if (action === 'up' || action === 'down') {
    const len = updateListLength(state);
    const cursor = Math.min(len - 1, Math.max(0, ui.cursor + (action === 'up' ? -1 : 1)));
    return cursor === ui.cursor ? state : { ...state, updateUi: { ...ui, cursor } };
  }
  if (action === 'enter') return { ...state, updateUi: { ...ui, copyRequest: selectedCommand(state) } };
  if (action === 'R') return onRefreshUpdate(state);
  return null;
}

/**
 * Результат проверки реестра. Когда вкладки под курсором больше нет —
 * переход на соседнюю того же индекса (для «Обновление» — «Настройки»).
 */
export function applySelfUpdateResult(state: AppState, info: SelfUpdate | null): AppState {
  if (info !== null) {
    return { ...state, selfUpdate: info, updateUi: freshUpdateUi({ check: 'ready' }), selfCheck: 'ready' };
  }
  const tabs = tabsOf({ ...state, selfUpdate: null });
  const tab = state.tab === 'update' ? tabs[Math.max(0, tabs.length - 2)] : state.tab;
  return { ...state, selfUpdate: null, updateUi: null, selfCheck: 'idle', tab, selected: 0 };
}

export function applyChangelogResult(state: AppState, ok: boolean, rows: ChangelogRow[]): AppState {
  if (state.updateUi === null) return state;
  return {
    ...state,
    selfCheck: ok ? 'ready' : 'error',
    updateUi: { ...state.updateUi, check: ok ? 'ready' : 'error', rows: ok ? rows : state.updateUi.rows },
  };
}
