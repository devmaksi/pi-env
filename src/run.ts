import { scan, Environment } from './environments.js';
import { computeLayout } from './layout.js';
import { render } from './render.js';
import { AppState, initialState, Key, reducer } from './state.js';
import { createTerm, Term } from './terminal.js';

/**
 * Цикл приложения: чтение клавиши → reducer → отрисовка.
 */
export async function run(root: string): Promise<void> {
  const term: Term = createTerm();
  let state: AppState = initialState();

  function load(): { envs: Environment[]; status: string | null } {
    const scanned = scan(root);
    if (scanned === null) {
      return { envs: [], status: `Окружения не найдены в ${root}` };
    }
    return { envs: scanned, status: null };
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
    const { envs } = load();
    state = reducer(state, key as Key, envs.length, computeLayout({ width: term.width(), height: term.height() }).twoColumns);
    if (state.quit) break;
    repaint();
  }
  term.stop();
}
