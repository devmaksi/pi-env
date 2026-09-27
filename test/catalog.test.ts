import { test } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { listProviders } from '../src/catalog.js';

function makeAgentDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'pi-env-test-'));
  return dir;
}

test('listProviders: объединяет models.json и models-store.json', () => {
  const dir = makeAgentDir();
  try {
    writeFileSync(
      join(dir, 'models.json'),
      JSON.stringify({
        providers: {
          cpp: { models: [{ id: 'Qwen3.8-27B' }, { id: 'Zed-1' }] },
          local: { models: [{ id: 'Qwen3.6-35B-A3B-FP8' }] },
        },
      }),
    );
    writeFileSync(
      join(dir, 'models-store.json'),
      JSON.stringify({
        llama: { models: [{ id: 'Kwaipilot_KAT-Coder-V2.5', name: 'Kwaipilot' }] },
        // дублирующийся провайдер — модель добавляется один раз
        cpp: { models: [{ id: 'Qwen3.8-27B' }, { id: 'Bonsai-2' }] },
      }),
    );
    const providers = listProviders(dir);
    assert.deepEqual(
      providers.map((p) => p.name),
      ['cpp', 'llama', 'local'],
    );
    const cpp = providers.find((p) => p.name === 'cpp')!;
    assert.deepEqual(
      cpp.models.map((m) => m.id),
      ['Bonsai-2', 'Qwen3.8-27B', 'Zed-1'],
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('listProviders: отсутствующие файлы — пустой список', () => {
  const dir = makeAgentDir();
  try {
    assert.deepEqual(listProviders(dir), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('listProviders: битый JSON пропускается, читаемый остаётся', () => {
  const dir = makeAgentDir();
  try {
    writeFileSync(join(dir, 'models.json'), '{не json');
    writeFileSync(
      join(dir, 'models-store.json'),
      JSON.stringify({ openai: { models: [{ id: 'gpt-4o' }] } }),
    );
    const providers = listProviders(dir);
    assert.deepEqual(providers.map((p) => p.name), ['openai']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
