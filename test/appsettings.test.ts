import { test } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadAppSettings, saveAppSettings } from '../src/appsettings.js';

test('loadAppSettings: нет файла — дефолты', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pienv-'));
  try {
    assert.deepEqual(loadAppSettings(dir), { color: true, recheckUpdates: false });
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test('loadAppSettings: битый JSON — дефолты', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pienv-'));
  try {
    writeFileSync(join(dir, '.pi-env.json'), '{бит');
    assert.deepEqual(loadAppSettings(dir), { color: true, recheckUpdates: false });
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test('loadAppSettings: неполные поля — отсутствующие по дефолту', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pienv-'));
  try {
    writeFileSync(join(dir, '.pi-env.json'), JSON.stringify({ color: false }));
    assert.deepEqual(loadAppSettings(dir), { color: false, recheckUpdates: false });
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test('saveAppSettings: запись и чтение обратно', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pienv-'));
  try {
    saveAppSettings(dir, { color: false, recheckUpdates: true });
    assert.deepEqual(loadAppSettings(dir), { color: false, recheckUpdates: true });
  } finally {
    rmSync(dir, { recursive: true });
  }
});
