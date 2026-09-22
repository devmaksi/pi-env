export type Tab = 'envs' | 'settings' | 'about';
export type Sub = 'create' | 'run' | null;
export type Key =
  | 'up' | 'down' | 'left' | 'right'
  | 'tab' | 'enter' | 'space' | 'esc' | 'ctrlc';

export interface AppState {
  tab: Tab;
  focus: 'left' | 'right';
  selected: number;
  sub: Sub;
  colorToggle: boolean;
  quit: boolean;
}

export const TABS: readonly Tab[] = ['envs', 'settings', 'about'];
export const SETTINGS_COUNT = 2;

export function initialState(): AppState {
  return { tab: 'envs', focus: 'left', selected: 0, sub: null, colorToggle: true, quit: false };
}

export function listLength(tab: Tab, envCount: number): number {
  if (tab === 'envs') return envCount + 1; // окружения + «Создать»
  if (tab === 'settings') return SETTINGS_COUNT;
  return 0;
}

/**
 * Переход состояния по нажатой клавише. Чистая функция.
 */
export function reducer(state: AppState, key: Key, envCount: number, twoColumns: boolean): AppState {
  if (key === 'ctrlc') return { ...state, quit: true };
  if (key === 'esc') {
    if (state.sub !== null) return { ...state, sub: null };
    return { ...state, quit: true };
  }
  if (key === 'tab') {
    const idx = TABS.indexOf(state.tab);
    const next = TABS[(idx + 1) % TABS.length];
    return { ...state, tab: next, focus: 'left', selected: 0, sub: null };
  }
  if (key === 'up' || key === 'down') {
    if (state.sub !== null) return state;
    const len = listLength(state.tab, envCount);
    if (len === 0) return state;
    const delta = key === 'up' ? -1 : 1;
    const selected = Math.min(len - 1, Math.max(0, state.selected + delta));
    return { ...state, selected };
  }
  if (key === 'left' || key === 'right') {
    if (state.tab !== 'envs' || state.sub !== null || !twoColumns) return state;
    return { ...state, focus: state.focus === 'left' ? 'right' : 'left' };
  }
  if (key === 'enter') {
    if (state.sub !== null || state.tab !== 'envs') return state;
    if (state.selected < envCount) return { ...state, sub: 'run' };
    return { ...state, sub: 'create' };
  }
  if (key === 'space') {
    if (state.tab !== 'settings' || state.sub !== null || state.selected !== 1) return state;
    return { ...state, colorToggle: !state.colorToggle };
  }
  return state;
}
