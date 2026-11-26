import { test } from 'node:test';
import assert from 'node:assert';
import { render, visibleWidth } from '../src/render.js';
import { initialState, freshCreate, freshEdit, type AppState, type CreateState } from '../src/state.js';
import { emptyCatalog } from '../src/state.js';
import { t } from '../src/i18n.js';

const base = { root: '/root', useColor: false, status: null, envs: [] as never[] };

/** Форма редактирования окружения с указанным состоянием связи хранилища. */
function editForm(over: Partial<CreateState>): AppState {
  const cr: CreateState = { ...freshEdit('e0', {}, emptyCatalog()), ...over };
  return { ...initialState(), sub: 'create', create: cr, tab: 'envs' };
}

const rowsOf = (s: string): string[] => s.split('\n');

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
