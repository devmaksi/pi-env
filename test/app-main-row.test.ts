import { test } from 'node:test';
import assert from 'node:assert';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_APP_SETTINGS, saveAppSettings } from '../src/appsettings.js';
import { run } from '../src/run.js';
import { scan, withMain } from '../src/environments.js';
import { storeRegistrySources } from '../src/store.js';
import type { Term } from '../src/terminal.js';
import type { FramePatch } from '../src/diff.js';
import { t } from '../src/i18n.js';

const dirs: string[] = [];

/** Два окружения + две записи корзины; каталог main-агента вне `<root>` (отдельная строка). */
function tmpRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'pienv-'));
  dirs.push(dir);
  for (const n of ['e0', 'e1']) {
    mkdirSync(join(dir, n));
    writeFileSync(join(dir, n, 'settings.json'), JSON.stringify({ defaultModel: 'm' }));
  }
  mkdirSync(join(dir, '.trash', 'gone@1760000000000'), { recursive: true });
  mkdirSync(join(dir, '.trash', 'older@1750000000000'), { recursive: true });
  // Язык закрепляется настройкой корня: кадры сверяются с ru-словарём независимо от локали CI.
  saveAppSettings(dir, { ...DEFAULT_APP_SETTINGS, language: 'ru' });
  return dir;
}
test.after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

/**
 * Реальный цикл `run()`: список окружений = [Основной, e0, e1, Создать, Корзина].
 * Возвращает кадры перед каждой клавишей.
 */
async function drive(root: string, keys: string[]): Promise<string[][]> {
  const agent = mkdtempSync(join(tmpdir(), 'pienv-agent-'));
  dirs.push(agent);
  const saved = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agent;
  let next = 0;
  let running = false;
  let screenKnown = true;
  let screen: string[] = [];
  const shots: string[][] = [];
  const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '');
  const term: Term = {
    noColor: true,
    start() { running = true; screenKnown = true; },
    stop() { running = false; },
    width: () => 80,
    height: () => 24,
    key: async () => {
      shots.push(screen.map(strip));
      return keys[next++] ?? 'ctrlc';
    },
    onResize() {},
    paint(patch: FramePatch) {
      if (!running) return false;
      if (patch.kind === 'rows') {
        if (!screenKnown) return false;
        for (const r of patch.rows) screen[r.row - 1] = r.text;
      } else {
        screen = patch.lines.slice();
        screenKnown = true;
      }
      return true;
    },
    screenKnown: () => screenKnown,
    copy() {},
  };
  try {
    await run(root, term);
  } finally {
    if (saved === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = saved;
  }
  return shots;
}

const trashRow = (lang: string) => t(lang, 'envs.trash', { n: 2 });
test('app: основной агент отдельной строкой — ↓ доезжает до «Корзина (2)» и Enter открывает её', async () => {
  const root = tmpRoot();
  // rows: 0 Основной, 1 e0, 2 e1, 3 Создать, 4 Корзина
  const shots = await drive(root, ['down', 'down', 'down', 'down', 'enter', 'ctrlc']);
  // после четырёх ↓ курсор обязан стоять на «Корзина (2)»
  assert.ok(
    shots[4].some((l) => l.includes(`> ${trashRow('ru')}`)),
    `нет курсора на строке корзины:\n${shots[4].slice(0, 10).join('\n')}`,
  );
  const afterEnter = shots[5];
  assert.ok(afterEnter.some((l) => l.includes('gone')), 'суб-экран корзины не открылся');
});

test('app: Enter по строке «Создать» открывает форму создания, а не корзину', async () => {
  const root = tmpRoot();
  // три ↓ = курсор на «Создать» (индекс 3 из 0 Основной, 1 e0, 2 e1, 3 Создать, 4 Корзина)
  const shots = await drive(root, ['down', 'down', 'down', 'enter', 'ctrlc']);
  assert.ok(shots[3].some((l) => l.includes(`> ${t('ru', 'form.create')}`)), 'курсор не на «Создать»');
  const after = shots[4];
  assert.ok(after.some((l) => l.includes(t('ru', 'form.hint.space'))), 'форма создания не открылась');
  assert.ok(!after.some((l) => l.includes('gone')), 'Enter по «Создать» открыл корзину');
});

/**
 * Инвариант «что подсвечено, то и правится»: `E` берёт строку по тому же номеру, что и подсветка
 * (`envs[state.selected]`). До фикса список был короче подсвечиваемой области на строку, и этот
 * инвариант держался только случайно — после рефакторинга `applyKey` он обязан быть проверен.
 */
test('app: E правит именно подсвеченную строку, а не соседнюю', async () => {
  const root = tmpRoot();
  // ↓↓ = курсор на e1 (0 Основной, 1 e0, 2 e1) → E открывает форму правки e1
  const shots = await drive(root, ['down', 'down', 'e', 'ctrlc']);
  const form = shots[3];
  const nameRow = t('ru', 'form.name');
  assert.ok(form.some((l) => l.includes(`${nameRow}e1▌`)), `в форме не e1:\n${form.slice(0, 12).join('\n')}`);
  assert.ok(!form.some((l) => l.includes(`${nameRow}e0▌`)), 'форма открылась для e0');
});


test('app: первое включение хранилища на окружении поднимает и основной агент', async () => {
  const root = tmpRoot();
  writeFileSync(join(root, 'e0', 'settings.json'), JSON.stringify({ packages: ['npm:pi-zentui'] }));
  const agent = mkdtempSync(join(tmpdir(), 'pienv-agent-'));
  dirs.push(agent);
  writeFileSync(join(agent, 'models.json'), '{"providers":{}}');
  writeFileSync(join(agent, 'settings.json'), JSON.stringify({ packages: ['npm:pi-zentui'] }));
  mkdirSync(join(agent, 'npm', 'node_modules', 'pi-zentui'), { recursive: true });
  mkdirSync(join(agent, 'git'), { recursive: true });
  const saved = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agent;
  const keys = ['down', 'e', 'down', 'down', 'down', 'enter', 'enter', 'esc', 'ctrlc'];
  let next = 0;
  const term: Term = {
    noColor: true,
    start() {}, stop() {}, width: () => 80, height: () => 24,
    key: async () => keys[next++] ?? 'ctrlc',
    onResize() {}, paint() { return true; }, screenKnown: () => true, copy() {},
  };
  try {
    await run(root, term);
  } finally {
    if (saved === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = saved;
  }
  assert.equal(lstatSync(join(root, 'e0', 'npm')).isSymbolicLink(), true, 'окружение получило общий корень');
  assert.equal(lstatSync(join(agent, 'npm')).isSymbolicLink(), true, 'основной агент — тоже');
  assert.equal(lstatSync(join(agent, 'git')).isSymbolicLink(), true);
  assert.ok(existsSync(join(root, '.store', 'npm', 'node_modules', 'pi-zentui')), 'своё содержимое main переехало в хранилище');
  // Реестр хранилища заполнен переехавшими объявлениями — иначе каждое окружение показывало бы
  // «нет в реестре хранилища» на пакетах, которые уже лежат в общих корнях.
  const snap = withMain(scan(root, join(root, '.store'))!, agent);
  const e0 = snap.find((env) => env.name === 'e0')!;
  assert.deepEqual(e0.details.missingPackages, [], JSON.stringify(e0.details));
  const main = snap.find((env) => env.main === true)!;
  assert.deepEqual(main.details.missingPackages, [], JSON.stringify(main.details));
  assert.deepEqual(storeRegistrySources(join(root, '.store')), ['npm:pi-zentui']);
});
