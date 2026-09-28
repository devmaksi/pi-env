import { homedir } from 'node:os';
import { join } from 'node:path';
import { scan, Environment } from './environments.js';
import { loadCatalog, ToolItem, SkillItem } from './catalog.js';
import { computeLayout } from './layout.js';
import { render } from './render.js';
import { createEnvironment, type CreateRequest } from './create.js';
import { AppState, initialState, Key, reducer } from './state.js';
import { createTerm, Term } from './terminal.js';

function defaultAgentDir(): string {
  return process.env.PI_CODING_AGENT_DIR ?? join(homedir(), '.pi', 'agent');
}

/**
 * Цикл приложения: чтение клавиши → reducer → отрисовка.
 * Побочный эффект: отправка формы создания (submitting) вызывает
 * createEnvironment и возвращает результат в reducer.
 */
export async function run(root: string): Promise<void> {
  const term: Term = createTerm();
  const catalog = loadCatalog(defaultAgentDir());
  let state: AppState = initialState(catalog);

  function load(): { envs: Environment[]; status: string | null } {
    const scanned = scan(root);
    if (scanned === null) {
      return { envs: [], status: `Окружения не найдены в ${root}` };
    }
    return { envs: scanned, status: null };
  }

  function twoColumns(): boolean {
    return computeLayout({ width: term.width(), height: term.height() }).twoColumns;
  }

  function dispatch(key: Key): void {
    const { envs } = load();
    state = reducer(state, key, envs.map((e) => e.name), twoColumns());
    if (state.create && state.create.view === 'submitting') {
      const cr = state.create;
      const req: CreateRequest = {
        name: cr.name,
        defaultProvider: cr.provider ?? undefined,
        defaultModel: cr.model ?? undefined,
        tools: cr.tools
          .map((n) => catalog.tools.find((t) => t.name === n))
          .filter((t): t is ToolItem => t !== undefined),
        skills: cr.skills
          .map((n) => catalog.skills.find((s) => s.name === n))
          .filter((s): s is SkillItem => s !== undefined),
        packages: cr.packages,
      };
      const res = createEnvironment(root, req);
      const message = res.ok ? res.path : res.error;
      state = reducer(state, { type: 'create-result', ok: res.ok, message }, envs.map((e) => e.name), twoColumns());
    }
  }

  function repaint(): void {
    const { envs, status } = load();
    const w = term.width();
    const h = term.height();
    term.clear();
    process.stdout.write(render({
      state,
      envs,
      root,
      width: w,
      height: h,
      useColor: state.colorToggle && !term.noColor,
      status,
    }));
  }

  term.onResize(repaint);
  term.start();
  repaint();

  for (;;) {
    const key = await term.key();
    dispatch(key as Key);
    if (state.quit) break;
    repaint();
  }
  term.stop();
}
