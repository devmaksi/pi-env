import { test } from 'node:test';
import assert from 'node:assert';
import { render, visibleWidth } from '../src/render.js';
import { initialState, freshCreate, freshEdit, type AppState, type CreateState } from '../src/state.js';
import { emptyCatalog, ROW_STORE, formRows } from '../src/state.js';
import { formReducer, storeEnableIntent } from '../src/state-form.js';
import { t } from '../src/i18n.js';

const base = { root: '/root', useColor: false, status: null, envs: [] as never[] };

/** Форма редактирования окружения с указанным состоянием связи хранилища. */
function editForm(over: Partial<CreateState>): AppState {
  const cr: CreateState = { ...freshEdit('e0', {}, emptyCatalog()), ...over };
  return { ...initialState(), sub: 'create', create: cr, tab: 'envs' };
}

const rowsOf = (s: string): string[] => s.split('\n');

test('Enter на «Хранилище»: подтверждение в обе стороны, из partial — тоже подтверждение', () => {
  const rows = formRows('edit', false);
  const at = (over: Partial<CreateState>): CreateState | null =>
    formReducer({ ...freshEdit('e0', {}, emptyCatalog()), cursor: ROW_STORE, ...over },
      'enter', ['e0'], 'ru');
  assert.equal(at({ store: false, storeRoots: false, storeBroken: false })!.view, 'store-confirm');
  assert.equal(at({ store: true, storeRoots: true, storeBroken: false })!.view, 'store-confirm');
  assert.equal(at({ store: true, storeRoots: false, storeBroken: false })!.view, 'store-confirm');
});

test('storeEnableIntent: partial и broken — достройка связи, выключение только из linked', () => {
  assert.equal(storeEnableIntent('off'), true);
  assert.equal(storeEnableIntent('partial'), true);
  assert.equal(storeEnableIntent('broken'), true);
  assert.equal(storeEnableIntent('linked'), false);
});

test('строка «Хранилище»: все корни связаны', () => {
  const s = render({ state: editForm({ store: true, storeRoots: true, storeBroken: false }), width: 80, height: 16, ...base });
  assert.ok(rowsOf(s).some((r) => r.includes(t('ru', 'store.linked'))), s);
});

test('строка «Хранилище»: частичное состояние', () => {
  const s = render({ state: editForm({ store: true, storeRoots: false, storeBroken: false }), width: 80, height: 16, ...base });
  assert.ok(rowsOf(s).some((r) => r.includes(t('ru', 'store.partial'))), s);
});

test('строка «Хранилище»: связь оборвана', () => {
  const s = render({ state: editForm({ store: true, storeRoots: true, storeBroken: true }), width: 80, height: 16, ...base });
  assert.ok(rowsOf(s).some((r) => r.includes(t('ru', 'store.broken'))), s);
});

test('строка «Хранилище»: выключено', () => {
  const s = render({ state: editForm({ store: false, storeRoots: false, storeBroken: false }), width: 80, height: 16, ...base });
  assert.ok(rowsOf(s).some((r) => r.includes(t('ru', 'store.off'))), s);
});

test('форма создания: хранилище включено по умолчанию', () => {
  const cr = freshCreate();
  assert.equal(cr.store, true);
  assert.equal(cr.storeRoots, true);
  const s = render({ state: { ...initialState(), sub: 'create', create: cr }, width: 80, height: 16, ...base });
  assert.ok(rowsOf(s).some((r) => r.includes(t('ru', 'store.linked'))), s);
});
