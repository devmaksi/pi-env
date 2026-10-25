import { test } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run } from '../src/run.js';
import { parseChangelog } from '../src/selfupdate.js';
import type { SelfUpdate } from '../src/selfupdate-net.js';
import { t } from '../src/i18n.js';
import type { Term } from '../src/terminal.js';

const painted: string[] = [];
const copied: string[] = [];
const dirs: string[] = [];

function tmpRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'pienv-'));
  dirs.push(dir);
  return dir;
}

/** Фейковый терминал: собирает строки кадров и вызовы copy(). */
function fakeTerm(keys: string[]): Term {
  let next = 0;
  return {
    noColor: true,
    start() {},
    stop() {},
    width: () => 80,
    height: () => 24,
    key: async () => keys[next++] ?? 'ctrlc',
    onResize() {},
    paint: (p) => {
      painted.push(...(p.kind === 'full' ? p.lines : p.rows.map((r) => r.text)));
      return true;
    },
    screenKnown: () => true,
    copy: (text) => { copied.push(text); },
  };
}

const INFO: SelfUpdate = { latest: '0.2.4', installed: '0.2.3', kind: 'npm-global', checkedAt: 1_700_000_000_000 };

test('сквозной прогон: selfCheck → вкладка → Enter → копирование команды', async () => {
  painted.length = 0;
  copied.length = 0;
  const agentDir = tmpRoot();
  const prevAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  try {
    // envs → extensions → mcp → settings → update, затем ↓×4 на строку команды
    await run(tmpRoot(), fakeTerm(['tab', 'tab', 'tab', 'tab', 'down', 'down', 'down', 'down', 'enter', 'ctrlc']), {
      selfCheck: async () => INFO,
      changelog: async () => parseChangelog('## [0.2.4] — 2026-11-01\n- new tab\n'),
    });
  } finally {
    if (prevAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = prevAgentDir;
  }
  const command = 'npm i -g @devmaksi/pi-env@latest';
  assert.ok(painted.some((l) => l.includes(command)), 'команда обновления показана');
  assert.ok(painted.some((l) => l.includes('new tab')), 'чейнджлог показан');
  assert.deepEqual(copied, [command]);
  assert.ok(painted.some((l) => l.includes(t('ru', 'status.update-available', { latest: '0.2.4' }))));
});

test('сквозной прогон без deps: вкладки «Обновление» нет', async () => {
  painted.length = 0;
  copied.length = 0;
  const agentDir = tmpRoot();
  const prevAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  try {
    await run(tmpRoot(), fakeTerm(['tab', 'tab', 'tab', 'tab', 'tab', 'ctrlc']));
  } finally {
    if (prevAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = prevAgentDir;
  }
  assert.equal(painted.some((l) => l.includes('Обновление')), false);
  assert.deepEqual(copied, []);
});

for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
