import { test } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadAppSettings, saveAppSettings } from '../src/appsettings.js';

test('loadAppSettings: нет файла — дефолты', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pienv-'));
  try {
    assert.deepEqual(loadAppSettings(dir), { color: true, recheckUpdates: false, language: null });
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test('loadAppSettings: битый JSON — дефолты', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pienv-'));
  try {
    writeFileSync(join(dir, '.pi-env.json'), '{бит');
    assert.deepEqual(loadAppSettings(dir), { color: true, recheckUpdates: false, language: null });
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test('loadAppSettings: неполные поля — отсутствующие по дефолту', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pienv-'));
  try {
    writeFileSync(join(dir, '.pi-env.json'), JSON.stringify({ color: false }));
    assert.deepEqual(loadAppSettings(dir), { color: false, recheckUpdates: false, language: null });
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test('saveAppSettings: запись и чтение обратно', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pienv-'));
  try {
    saveAppSettings(dir, { color: false, recheckUpdates: true, language: null });
    assert.deepEqual(loadAppSettings(dir), { color: false, recheckUpdates: true, language: null });
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test('language: roundtrip и битые значения', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pienv-'));
  try {
    saveAppSettings(dir, { color: true, recheckUpdates: false, language: 'en' });
    assert.deepEqual(loadAppSettings(dir), { color: true, recheckUpdates: false, language: 'en' });
    writeFileSync(join(dir, '.pi-env.json'), JSON.stringify({ language: 42 }));
    assert.deepEqual(loadAppSettings(dir), { color: true, recheckUpdates: false, language: null });
    writeFileSync(join(dir, '.pi-env.json'), JSON.stringify({ language: 'de' }));
    assert.equal(loadAppSettings(dir).language, 'de'); // проверка на существование файла — в рантайме
  } finally {
    rmSync(dir, { recursive: true });
  }
});
