import { test } from 'node:test';
import assert from 'node:assert';
import { render, scrollTop, catalogPickerLines } from '../src/render.js';
import { computeLayout } from '../src/layout.js';
import { initialState, freshExt, freshCreate, type AppState, type Catalog } from '../src/state.js';
import { Environment } from '../src/environments.js';

const envs: Environment[] = [
  { name: 'dev', path: '/root/dev', details: { hasSettings: true, model: 'p1/m1', tools: ['tool1.ts'], skills: ['sk-a'], packages: ['npm:pkg-a'] } },
  { name: 'prod', path: '/root/prod', details: { hasSettings: false, model: null, tools: [], skills: [], packages: [] } },
];

const base = { root: '/root', useColor: false, status: null };

test('слишком малый терминал — предупреждение', () => {
  const s = render({ state: initialState(), envs, width: 20, height: 4, ...base });
  assert.equal(s, 'Терминал слишком мал');
});

test('широкий режим: рамка, таб-бар, разделитель', () => {
  const s = render({ state: initialState(), envs, width: 62, height: 10, ...base });
  const lines = s.split('\n');
  assert.equal(lines.length, 10);
  for (const line of lines) assert.equal(line.length, 62);
  assert.ok(lines[0].includes('Окружения'));
  assert.ok(lines[0].includes('Настройки'));
  assert.ok(lines[0].includes('О программе'));
  assert.ok(lines[1].includes('┬'));
});

test('широкий режим: список, курсор, детализация в инфо-панели', () => {
  const s = render({ state: initialState(), envs, width: 62, height: 16, ...base });
  assert.ok(s.includes('> dev'));
  assert.ok(s.includes('  prod'));
  assert.ok(s.includes('Создать'));
  assert.ok(s.includes('Путь: /root/dev'));
  assert.ok(s.includes('settings.json ✓'));
  assert.ok(s.includes('Модель: p1/m1'));
  assert.ok(s.includes('Инструменты: 1'));
  assert.ok(s.includes('tool1.ts'));
  assert.ok(s.includes('Скиллы: 1'));
  assert.ok(s.includes('sk-a'));
  assert.ok(s.includes('Расширения: 1'));
  assert.ok(s.includes('pkg-a')); // без префикса npm:
  assert.ok(!s.includes('Детализация — этап 2'));
});

test('детализация: длинные списки обрезаются, модель без settings.json — «—»', () => {
  const many = { name: 'big', path: '/root/big', details: { hasSettings: false, model: null, tools: ['a', 'b', 'c', 'd', 'e', 'f'], skills: [], packages: [] } };
  const s = render({ state: initialState(), envs: [many], width: 62, height: 16, ...base });
  assert.ok(s.includes('Инструменты: 6'));
  assert.ok(s.includes('  a'));
  assert.ok(s.includes('  d'));
  assert.ok(!s.includes('  e'));
  assert.ok(s.includes('+2 ещё'));
  assert.ok(s.includes('Модель: —'));
});

test('узкий режим: нет правого столбца', () => {
  const s = render({ state: initialState(), envs, width: 40, height: 10, ...base });
  const lines = s.split('\n');
  assert.equal(lines.length, 10);
  assert.ok(!lines[1].includes('┬'));
  assert.ok(!s.includes('Путь:'));
  assert.ok(s.includes('> dev'));
});

test('суб-экран запуска больше не рендерится', () => {
  const s = render({ state: { ...initialState(), sub: 'run' }, envs, width: 62, height: 10, ...base });
  assert.ok(!s.includes('Запуск окружения'));
});

test('вкладка настроек: каталог, цвет и перепроверка обновлений', () => {
  const s = render({ state: { ...initialState(), tab: 'settings', selected: 1 }, envs, width: 62, height: 10, ...base });
  assert.ok(s.includes('Корневой каталог: /root'));
  assert.ok(s.includes('Цветной вывод: [x]'));
  assert.ok(s.includes('Перепроверка обновлений: [ ]'));
  assert.ok(!s.includes('Подробные настройки — этап 2'));
});

test('вкладка настроек: перепроверка включена — [x]', () => {
  const s = render({ state: { ...initialState(), tab: 'settings', selected: 2, recheckUpdates: true }, envs, width: 62, height: 10, ...base });
  assert.ok(s.includes('Перепроверка обновлений: [x]'));
});

test('без цвета: активная вкладка помечается [..]', () => {
  const s = render({ state: initialState(), envs, width: 62, height: 10, ...base });
  const tabLine = s.split('\n')[0];
  assert.ok(tabLine.includes('[Окружения]'));
  assert.ok(tabLine.includes('Настройки'));
  assert.ok(!s.includes('\x1b'));
});

test('без цвета: выбранный пункт настроек помечается >', () => {
  const s = render({ state: { ...initialState(), tab: 'settings', selected: 1 }, envs, width: 62, height: 10, ...base });
  assert.ok(s.includes('> Цветной вывод'));
  assert.ok(!s.includes('> Корневой каталог'));
});

test('выбранный пункт подсвечивается цветом', () => {
  const s = render({ state: initialState(), envs, width: 62, height: 10, root: '/root', useColor: true, status: null });
  assert.ok(s.includes('\x1b[7m'));
});

test('статус-строка показывает ошибку', () => {
  const s = render({ state: initialState(), envs, width: 62, height: 10, root: '/root', useColor: false, status: 'Окружения не найдены в /root' });
  assert.ok(s.includes('Окружения не найдены в /root'));
});

// Каждый \x1b в строке должен начинать полную CSI-последовательность
function assertNoDanglingAnsi(line: string): void {
  let i = 0;
  while (i < line.length) {
    if (line[i] !== '\x1b') {
      i++;
      continue;
    }
    const m = /^\x1b\[[0-9;]*[a-zA-Z]/.exec(line.slice(i));
    assert.ok(m, `обрыв ANSI-последовательности: ${JSON.stringify(line)}`);
    i += m[0].length;
  }
}

test('узкий цветной вывод: ANSI не обрывается, рамка цела', () => {
  const s = render({ state: initialState(), envs, width: 30, height: 8, root: '/root', useColor: true, status: null });
  const lines = s.split('\n');
  assert.equal(lines.length, 8);
  for (const line of lines) {
    assertNoDanglingAnsi(line);
    // видимая ширина каждой строки равна ширине кадра
    assert.equal(line.replace(/\x1b\[[0-9;]*m/g, '').length, 30);
  }
});

// Позиция символа по видимому индексу (ANSI-последовательности не учитываются)
function visibleIndex(line: string, v: number): number {
  let count = 0;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '\x1b') {
      const m = /^\x1b\[[0-9;]*[a-zA-Z]/.exec(line.slice(i));
      if (m) {
        i += m[0].length - 1;
        continue;
      }
    }
    count++;
    if (count === v) return i;
  }
  return -1;
}

test('средняя граница подсвечивается при фокусе правой колонки', () => {
  const L = computeLayout({ width: 80, height: 10 });
  const s = render({ state: { ...initialState(), focus: 'right' }, envs, width: 80, height: 10, root: '/root', useColor: true, status: null });
  const line = s.split('\n').find((l) => l.includes('> dev'));
  assert.ok(line);
  const mid = visibleIndex(line, 2 + L.leftWidth); // видимая позиция средней границы (левая граница + левая колонка)
  assert.equal(line[mid], '│');
  assert.equal(line.slice(mid - 4, mid), '\x1b[1m');
});

test('вкладка «О программе» в широком режиме не делится на две колонки', () => {
  const s = render({ state: { ...initialState(), tab: 'about' }, envs, width: 62, height: 10, ...base });
  const lines = s.split('\n');
  assert.equal(lines.length, 10);
  assert.ok(!lines[1].includes('┬')); // разделитель не делит экран пополам
  const strip = (l: string) => l.replace(/\x1b\[[0-9;]*m/g, '');
  for (let i = 2; i < lines.length - 2; i++) {
    // ровно две границы: средней перегородки нет
    assert.equal(strip(lines[i]).split('│').length - 1, 2);
  }
  // строка не обрезана на половине ширины
  assert.ok(s.includes('CLI для управления окружениями pi'));
});

const extCatalog: Catalog = {
  providers: [],
  tools: [],
  skills: [],
  packages: [
    { source: 'npm:pkg-a', name: 'pkg-a', path: '/p/a', version: '1.0.0', description: 'Пакет A', extensions: ['./index.ts'], skills: [] },
  ],
};

test('вкладка «Расширения»: список пакетов, кнопки, инфо-панель', () => {
  const s = render({ state: { ...initialState(extCatalog), tab: 'extensions' as const }, envs, width: 100, height: 12, ...base });
  assert.ok(s.includes('[Расширения]'));
  assert.ok(s.includes('pkg-a'));
  assert.ok(s.includes('Обновить все'));
  assert.ok(s.includes('Установить'));
  assert.ok(s.includes('Источник: npm:pkg-a'));
  assert.ok(s.includes('Версия: 1.0.0'));
});

test('вкладка «Расширения»: курсор на «Установить» — подсказка каталога', () => {
  const s = render({ state: { ...initialState(extCatalog), tab: 'extensions' as const, selected: 2 }, envs, width: 100, height: 12, ...base });
  assert.ok(s.includes('pi.dev/packages'));
});

test('вкладка «Расширения»: каталог — загрузка, ошибка, список с инфо-панелью', () => {
  const loading = render({ state: { ...initialState(extCatalog), tab: 'extensions' as const, ext: freshExt() }, envs, width: 100, height: 12, ...base });
  assert.ok(loading.includes('Загрузка'));
  const err = render({ state: { ...initialState(extCatalog), tab: 'extensions' as const, ext: freshExt({ catalogStatus: 'error' }) }, envs, width: 100, height: 12, ...base });
  assert.ok(err.includes('Не удалось загрузить'));
  const items = [{ name: 'pi-a', types: ['extension'], downloads: 100, description: 'Описание A', author: 'author-x' }];
  const ready = render({ state: { ...initialState(extCatalog), tab: 'extensions' as const, ext: freshExt({ catalogStatus: 'ready', catalog: items }) }, envs, width: 100, height: 14, ...base });
  assert.ok(ready.includes('Установка расширения'));
  assert.ok(ready.includes('pi-a'));
  assert.ok(ready.includes('Загрузок: 100'));
  assert.ok(ready.includes('Описание A'));
  assert.ok(ready.includes('pi install npm:pi-a'));
});

test('вкладка «Расширения»: пометки процессов и подтверждение удаления', () => {
  const installing = render({ state: { ...initialState(extCatalog), tab: 'extensions' as const, ext: freshExt({ view: 'installing', installing: 'pi-a' }) }, envs, width: 100, height: 10, ...base });
  assert.ok(installing.includes('Установка: pi-a…'));
  const upd = render({ state: { ...initialState(extCatalog), tab: 'extensions' as const, ext: freshExt({ view: 'updating', updating: 'pkg-a' }) }, envs, width: 100, height: 10, ...base });
  assert.ok(upd.includes('Обновление: pkg-a…'));
  const updAll = render({ state: { ...initialState(extCatalog), tab: 'extensions' as const, ext: freshExt({ view: 'updating' }) }, envs, width: 100, height: 10, ...base });
  assert.ok(updAll.includes('Обновление…'));
  const rm = render({ state: { ...initialState(extCatalog), tab: 'extensions' as const, ext: freshExt({ view: 'removing' }) }, envs, width: 100, height: 10, ...base });
  assert.ok(rm.includes('Удаление…'));
  const conf = render({ state: { ...initialState(extCatalog), tab: 'extensions' as const, ext: freshExt({ view: 'confirm-remove', removing: 'pkg-a' }) }, envs, width: 100, height: 10, ...base });
  assert.ok(conf.includes('Удалить расширение «pkg-a»?'));
  assert.ok(conf.includes('Enter — подтвердить'));
});

test('пустой список окружений: без разделителя, «Создать» на нуле', () => {
  const s = render({ state: initialState(), envs: [], width: 62, height: 10, ...base });
  assert.ok(s.includes('> Создать'));
  assert.ok(s.includes('Выберите окружение'));
  const sepLines = s.split('\n').filter((l) => l.includes('─'));
  assert.equal(sepLines.length, 1); // только разделитель под таб-баром
});

test('узкий режим на вкладке «Расширения»: правый столбец слит, статус в футере', () => {
  const st = { ...initialState(extCatalog), tab: 'extensions' as const };
  // height 14: contentRows 10 — слитая инфо-панель (строки 7+) влезает в кадр
  const s = render({ state: st, envs, width: 40, height: 14, root: '/root', useColor: false, status: 'проверка' });
  assert.ok(!s.split('\n')[1].includes('┬'));
  assert.ok(s.includes('Обновить все'));
  assert.ok(s.includes('Источник:')); // строка инфо-панели, слитая в левый столбец
  assert.ok(s.includes('проверка'));
});

test('форма создания в цвете: ANSI не обрывается', () => {
  const st: AppState = { ...initialState(), sub: 'create', create: freshCreate() };
  const s = render({ state: st, envs, width: 62, height: 10, root: '/root', useColor: true, status: null });
  for (const line of s.split('\n')) assertNoDanglingAnsi(line);
});

test('вкладка «Расширения» без пакетов: пусто и только кнопки', () => {
  const st = { ...initialState(), tab: 'extensions' as const };
  const s = render({ state: st, envs, width: 62, height: 10, ...base });
  assert.ok(s.includes('— пусто —'));
  assert.ok(s.includes('Установить'));
  assert.ok(!s.includes('Источник:'));
});

test('scrollTop: окно стоит, пока курсор в кадре; затем скроллится', () => {
  assert.equal(scrollTop(0, 100, 20), 0);
  assert.equal(scrollTop(19, 100, 20), 0);
  assert.equal(scrollTop(20, 100, 20), 1);
  assert.equal(scrollTop(50, 100, 20), 31);
  assert.equal(scrollTop(99, 100, 20), 80);
  assert.equal(scrollTop(-1, 100, 20), 0);
  assert.equal(scrollTop(5, 15, 20), 0); // список короче окна
});

test('длинный каталог: окно скроллится, курсор виден, верхние строки ушли', () => {
  const items = Array.from({ length: 30 }, (_, i) => ({
    name: 'pkg' + String(i).padStart(2, '0'),
    types: [] as string[],
    downloads: 0,
    description: null,
    author: null,
  }));
  const st = { ...initialState(), tab: 'extensions' as const, ext: freshExt({ catalogStatus: 'ready' as const, catalog: items, cursor: 25 }) };
  const s = render({ state: st, envs, width: 100, height: 12, ...base });
  assert.ok(s.includes('> pkg25'));
  assert.ok(!s.includes('pkg00'));
  assert.ok(!s.includes('pkg17'));
  assert.ok(s.includes('pkg18')); // первая видимая: left = [title, pkg00..], top = 19 → left[19] = pkg18
});

test('каталог: поисковая строка, «Найдено: N», «Ничего не найдено»', () => {
  const items = [
    { name: 'pi-a', types: ['extension'], downloads: 5, description: 'A', author: null },
    { name: 'pi-b', types: [], downloads: 4, description: null, author: null },
  ];
  const st = { ...initialState(), tab: 'extensions' as const, ext: freshExt({ catalogStatus: 'ready' as const, catalog: items, query: 'pi' }) };
  const s = render({ state: st, envs, width: 100, height: 12, ...base });
  assert.ok(s.includes('Поиск: pi▌'));
  assert.ok(s.includes('Найдено: 2'));
  const no = render({ state: { ...initialState(), tab: 'extensions' as const, ext: freshExt({ catalogStatus: 'ready' as const, catalog: items, query: 'zzz' }) }, envs, width: 100, height: 12, ...base });
  assert.ok(no.includes('Ничего не найдено'));
  assert.ok(no.includes('Найдено: 0'));
});

test('каталог с поисковой строкой: окно корректно, курсор на нижней границе, ресайз', () => {
  const items = Array.from({ length: 30 }, (_, i) => ({
    name: 'pkg' + String(i).padStart(2, '0'),
    types: [] as string[],
    downloads: 0,
    description: null,
    author: null,
  }));
  const st = { ...initialState(), tab: 'extensions' as const, ext: freshExt({ catalogStatus: 'ready' as const, catalog: items, cursor: 25 }) };
  const s = render({ state: st, envs, width: 100, height: 12, ...base });
  assert.ok(s.includes('> pkg25'));
  assert.ok(s.includes('pkg18')); // первая видимая: left = [title, поиск, pkg00..], top = 20
  assert.ok(!s.includes('pkg17'));
  assert.ok(!s.includes('pkg00'));
  const tall = render({ state: st, envs, width: 100, height: 40, ...base });
  assert.ok(tall.includes('> pkg25'));
  assert.ok(tall.includes('pkg00')); // высокий кадр — весь список
});

test('пикер каталога: прогресс загрузки — счётчик страниц, без прогресса — без счётчика', () => {
  const L = computeLayout({ width: 80, height: 10 });
  const withProgress = catalogPickerLines([], '', 'loading', 0, L, false, { loaded: 5, total: 108 });
  assert.ok(withProgress.left.some((l) => l.includes('Загрузка каталога… 5/108')));
  const noProgress = catalogPickerLines([], '', 'loading', 0, L, false, null);
  assert.ok(noProgress.left.some((l) => l.includes('Загрузка каталога…') && !l.includes('/')));
});
