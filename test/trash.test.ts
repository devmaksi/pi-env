import { test } from 'node:test';
import assert from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  TRASH_DIR, TRASH_FILES_DIR, trashRoot, trashFilesRoot, listTrash, moveToTrash, restoreTrash,
  moveFileToTrash, restoreTrashFile, deleteTrashForever, deleteTrashFileForever, trashFileName, formatTs, trashLabel,
} from '../src/trash.js';
import { t } from '../src/i18n.js';

const tmpDirs: string[] = [];
function tmp(): string {
  const dir = mkdtempSync(join(tmpdir(), 'pienv-'));
  tmpDirs.push(dir);
  return dir;
}
test.after(() => { for (const d of tmpDirs) rmSync(d, { recursive: true, force: true }); });

/** Каталог окружения с settings.json; возвращает путь. */
function env(root: string, name: string): string {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'settings.json'), JSON.stringify({ defaultModel: 'm' }));
  return dir;
}

test('moveToTrash: каталог перенесён в .trash/<имя>@<ts>, окружения больше нет', () => {
  const root = tmp();
  const dir = env(root, 'e1');
  const res = moveToTrash(root, 'e1', 1000);
  assert.ok(res.ok);
  assert.equal(existsSync(dir), false);
  assert.equal(existsSync(join(root, TRASH_DIR, 'e1@1000')), true);
  assert.equal(res.path, join(root, TRASH_DIR, 'e1@1000'));
  assert.equal(
    JSON.parse(readFileSync(join(root, TRASH_DIR, 'e1@1000', 'settings.json'), 'utf8')).defaultModel,
    'm',
  );
});

test('moveToTrash: окружения нет — err.not-found', () => {
  const root = tmp();
  const res = moveToTrash(root, 'nope', 1000);
  assert.equal(res.ok, false);
  if (!res.ok) assert.equal(res.error, t('ru', 'err.not-found'));
});

test('listTrash: новые записи сверху; нет .trash — []', () => {
  const root = tmp();
  assert.deepEqual(listTrash(root), []);
  env(root, 'x'); moveToTrash(root, 'x', 1000);
  env(root, 'y'); moveToTrash(root, 'y', 3000);
  assert.deepEqual(listTrash(root).map((e) => e.dirName), ['y@3000', 'x@1000']);
});

test('listTrash: запись без метки (ts = null) — в конце списка', () => {
  const root = tmp();
  mkdirSync(join(trashRoot(root), 'no-ts'), { recursive: true });
  env(root, 'x'); moveToTrash(root, 'x', 1000);
  const list = listTrash(root);
  assert.deepEqual(list.map((e) => e.dirName), ['x@1000', 'no-ts']);
  assert.equal(list[1]!.ts, null);
  assert.equal(list[0]!.ts, 1000);
  assert.equal(list[0]!.name, 'x');
});

test('listTrash: .trash нет — [], без исключения', () => {
  assert.deepEqual(listTrash(tmp()), []);
});

test('restoreTrash: переносит обратно под исходным именем', () => {
  const root = tmp();
  env(root, 'e1'); moveToTrash(root, 'e1', 1000);
  const res = restoreTrash(root, 'e1@1000');
  assert.ok(res.ok);
  assert.equal(res.path, join(root, 'e1'));
  assert.equal(existsSync(join(root, 'e1', 'settings.json')), true);
  assert.deepEqual(listTrash(root), []);
});

test('restoreTrash: имя занято — ошибка err.trash-taken, запись остаётся в корзине', () => {
  const root = tmp();
  env(root, 'e1'); moveToTrash(root, 'e1', 1000);
  env(root, 'e1');
  const res = restoreTrash(root, 'e1@1000');
  assert.equal(res.ok, false);
  if (!res.ok) assert.equal(res.error, t('ru', 'err.trash-taken', { name: 'e1' }));
  assert.equal(existsSync(join(root, TRASH_DIR, 'e1@1000')), true);
});

test('restoreTrash: dirName с ".." или "/" — err.trash-bad-name, за пределами .trash ничего не трогается', () => {
  const root = tmp();
  env(root, 'e1');
  for (const bad of ['..', '.', 'x/../e1', 'a/b']) {
    const res = restoreTrash(root, bad);
    assert.equal(res.ok, false, bad);
    if (!res.ok) assert.equal(res.error, t('ru', 'err.trash-bad-name', { name: bad }));
  }
  assert.equal(existsSync(join(root, 'e1')), true);
});

test('deleteTrashForever: запись удалена из .trash безвозвратно', () => {
  const root = tmp();
  env(root, 'e1'); moveToTrash(root, 'e1', 1000);
  const res = deleteTrashForever(root, 'e1@1000');
  assert.ok(res.ok);
  assert.equal(existsSync(join(root, TRASH_DIR, 'e1@1000')), false);
  assert.deepEqual(listTrash(root), []);
});

test('deleteTrashForever: dirName с ".." — err.trash-bad-name', () => {
  const root = tmp();
  env(root, 'e1');
  const res = deleteTrashForever(root, '..');
  assert.equal(res.ok, false);
  if (!res.ok) assert.equal(res.error, t('ru', 'err.trash-bad-name', { name: '..' }));
  assert.equal(existsSync(join(root, 'e1')), true);
});

test('formatTs/trashLabel: "dev-supo · 2026-10-24 12:03"; без метки — только имя', () => {
  const ts = new Date(2026, 9, 24, 12, 3, 0).getTime();
  assert.equal(formatTs(ts), '2026-10-24 12:03');
  assert.equal(trashLabel({ dirName: 'dev-supo@' + ts, name: 'dev-supo', ts, path: '/r/.trash/dev-supo@' + ts }), 'dev-supo · 2026-10-24 12:03');
  assert.equal(trashLabel({ dirName: 'no-ts', name: 'no-ts', ts: null, path: '/r/.trash/no-ts' }), 'no-ts');
});

test('TRASH_DIR/trashRoot: корзина — скрытый каталог корня', () => {
  assert.equal(TRASH_DIR, '.trash');
  assert.equal(trashRoot('/r'), join('/r', '.trash'));
});

test("moveFileToTrash: файл окружения попадает в .trash/files и виден в списке", () => {
  const root = tmp();
  const dir = env(root, 'e1');
  writeFileSync(join(dir, 'models.json'), '{"providers":{}}');
  const res = moveFileToTrash(root, 'e1', 'models.json', 1_700_000_000_000, 'ru');
  assert.equal(res.ok, true);
  assert.equal(existsSync(join(dir, 'models.json')), false);
  assert.equal(existsSync(join(trashFilesRoot(root), 'e1--models.json@1700000000000')), true);
  const entries = listTrash(root);
  assert.deepEqual(entries.map((e) => [e.kind, e.name, e.fileName]), [['file', 'e1', 'models.json']]);
});

test("moveFileToTrash: нет файла — err.not-found, корзина не создаётся", () => {
  const root = tmp();
  env(root, 'e1');
  const res = moveFileToTrash(root, 'e1', 'models.json', 1_700_000_000_000, 'ru');
  assert.equal(res.ok, false);
  assert.equal(res.ok ? null : res.error, t('ru', 'err.not-found'));
  assert.deepEqual(listTrash(root), []);
});

test("restoreTrashFile: файл возвращается в своё окружение", () => {
  const root = tmp();
  const dir = env(root, 'e1');
  writeFileSync(join(dir, 'models.json'), '{"providers":{"a":{}}}');
  moveFileToTrash(root, 'e1', 'models.json', 1_700_000_000_000, 'ru');
  const res = restoreTrashFile(root, 'e1--models.json@1700000000000', 'ru');
  assert.equal(res.ok, true);
  assert.equal(readFileSync(join(dir, 'models.json'), 'utf8'), '{"providers":{"a":{}}}');
  assert.deepEqual(listTrash(root), []);
});

test("restoreTrashFile: занятый путь — ошибка, файл остаётся в корзине", () => {
  const root = tmp();
  const dir = env(root, 'e1');
  writeFileSync(join(dir, 'models.json'), '{"providers":{}}');
  moveFileToTrash(root, 'e1', 'models.json', 1_700_000_000_000, 'ru');
  writeFileSync(join(dir, 'models.json'), '{"providers":{"new":{}}}');
  const res = restoreTrashFile(root, 'e1--models.json@1700000000000', 'ru');
  assert.equal(res.ok, false);
  assert.equal(listTrash(root).length, 1);
});

test("listTrash: каталог .trash/files не становится записью корзины", () => {
  const root = tmp();
  env(root, 'e1');
  writeFileSync(join(join(root, 'e1'), 'models.json'), '{}');
  moveFileToTrash(root, 'e1', 'models.json', 1_700_000_000_000, 'ru');
  assert.deepEqual(listTrash(root).map((e) => e.name), ['e1']);
  assert.deepEqual(listTrash(root).map((e) => e.kind), ['file']);
});

test("listTrash: каталоги окружений идут перед файлами", () => {
  const root = tmp();
  const e2 = env(root, 'e2');
  writeFileSync(join(e2, 'models.json'), '{}');
  moveToTrash(root, 'e2', 1_700_000_000_002, 'ru');
  moveFileToTrash(root, 'e2', 'models.json', 1_700_000_000_001, 'ru').ok; // файла уже нет — ок-не-ок не важен
  const dirOnly = env(root, 'e3');
  writeFileSync(join(dirOnly, 'models.json'), '{}');
  moveFileToTrash(root, 'e3', 'models.json', 1_700_000_000_003, 'ru');
  assert.deepEqual(listTrash(root).map((e) => e.kind), ['dir', 'file']);
});

test("deleteTrashFileForever: файловая запись удалена совсем", () => {
  const root = tmp();
  const dir = env(root, 'e1');
  writeFileSync(join(dir, 'models.json'), '{}');
  moveFileToTrash(root, 'e1', 'models.json', 1_700_000_000_000, 'ru');
  assert.equal(deleteTrashFileForever(root, 'e1--models.json@1700000000000', 'ru').ok, true);
  assert.deepEqual(listTrash(root), []);
});

test("trashFileName/trashLabel: метка файловой записи — окружение, файл и дата", () => {
  assert.equal(trashFileName('e1', 'models.json', 1_700_000_000_000), 'e1--models.json@1700000000000');
  const root = tmp();
  const dir = env(root, 'e1');
  writeFileSync(join(dir, 'models.json'), '{}');
  moveFileToTrash(root, 'e1', 'models.json', 1_700_000_000_000, 'ru');
  const [entry] = listTrash(root);
  assert.equal(trashLabel(entry), `e1 · models.json · ${formatTs(1_700_000_000_000)}`);
});

test("TRASH_FILES_DIR: ветка файлов — внутри .trash", () => {
  assert.equal(TRASH_FILES_DIR, 'files');
  assert.equal(trashFilesRoot('/r'), join('/r', TRASH_DIR, TRASH_FILES_DIR));
});

test('корзина файлов: имя окружения с «--» разбирается по последнему разделителю', () => {
  const root = tmp();
  const dir = join(root, 'a--b');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'models.json'), '{"own":true}');
  const res = moveFileToTrash(root, 'a--b', 'models.json', 1234, 'ru');
  assert.ok(res.ok, res.error);
  const entries = listTrash(root);
  assert.equal(entries.length, 1);
  assert.equal(entries[0]!.name, 'a--b');
  assert.equal(entries[0]!.fileName, 'models.json');
  const back = restoreTrashFile(root, entries[0]!.dirName, 'ru');
  assert.ok(back.ok, back.error);
  assert.equal(readFileSync(join(dir, 'models.json'), 'utf8'), '{"own":true}');
});

test('корзина файлов: не-файл на месте models.json не переносится (иначе запись невидима в UI)', () => {
  const root = tmp();
  const dir = join(root, 'e0', 'models.json');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'inner'), 'x');
  const res = moveFileToTrash(root, 'e0', 'models.json', 100, 'ru');
  assert.equal(res.ok, false);
  assert.match(res.error!, new RegExp(t('ru', 'err.trash-not-file', { name: 'e0/models.json' }).slice(0, 12)));
  assert.equal(readFileSync(join(dir, 'inner'), 'utf8'), 'x');
  assert.equal(listTrash(root).length, 0);
});
