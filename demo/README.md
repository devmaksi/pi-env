# Съёмка демо-GIF

Инструмент DEV-зоны: он не попадает в npm-тарбелл (`files` = `dist`, `pi`) и не имеет
runtime-зависимостей. Снимает настоящий `pi-env` с настоящим дочерним `pi` в настоящем
PTY и пишет поток как asciinema cast v2, который рендерит готовый `agg`.

## Как это устроено

- `demo/ptycast.py` — PTY-стенд: `record()` запускает программу в PTY нужного размера,
  отправляет клавиши (каждая — отдельная запись) и ждёт перед ними маркер в потоке;
  `write_cast()` пишет cast v2; `render_agg()` вызывает `agg`; `ensure_agg()` скачивает
  бинарник, если его нет.
- `demo/selftest.py` — самопроверка стенда: alt-screen, рамка, стрелки, секции
  `[Skills]` / `[Extensions]` → cast → GIF.
- `demo/test_ptycast.py` — тесты формата cast, alt-фикса, ожидания по маркеру и рендера.
- `demo/script.py`, `demo/capture.py` — сценарий дубля и CLI съёмки.

## Проверка стенда

```bash
python3 -m unittest demo.test_ptycast          # 8 тестов
python3 -m demo.selftest                        # demo/out/selftest.gif
```

## Флаги agg (1.9.0) — имена взяты из `agg --help`

Флага `--fps` и флага `--font` у agg нет; в стенде используются:

| Флаг | Значение в съёмке |
|---|---|
| `--font-dir` | `~/.local/share/fonts/NerdFonts` |
| `--font-family` | `JetBrainsMono Nerd Font` |
| `--font-size` | `16` |
| `--fps-cap` | `24` |
| `--idle-time-limit` | `2` |

Ещё пригодятся при монтаже: `--theme` (`asciinema`, `dracula`, `github-dark`, …),
`--line-height`, `--last-frame-duration`, `--select` (вырезка кадров, например
`--select 3..90%`), `--no-loop`, `--speed`, `--cols`/`--rows`.

## Что нужно знать про alt-буфер и просмотр кадров

- pi-env входит в alt-экран (`src/terminal.ts:123`) и выходит из него (`:135`). В cast
  эти переходы по умолчанию заменяются: `\x1b[?1049h` → `\x1b[H\x1b[2J`, `\x1b[?1049l` →
  пусто (`write_cast(..., alt_fix=True)`, `--no-alt-fix` отключает). Картинка та же, но
  рендеру не нужен второй буфер.
- agg при `JetBrainsMono Nerd Font` печатает предупреждение «first font family … is not
  monospaced» — это его эвристика к Nerd-варианту шрифта. Проверено на пробном кадре с
  рамкой `┌─┐│└┘`, цифрами и стрелками: сетка и стыки рамки ровные, предупреждение
  оставляем. Альтернативы, если понадобится: `Fira Code`, `DejaVu Sans Mono`,
  `Liberation Mono` (все monospace по `fc-list`).
- Кадры GIF для просмотра вытаскивать только с композицией: `convert demo/out/x.gif
  -coalesce demo/out/frame-%d.png`. Одиночный кадр `x.gif[N]` без `-coalesce` показывает
  частичный патч кадра и выглядит испорченным — это способ просмотра, а не запись.
- Длительности кадров: `identify -format "%[delay]"` эта сборка ImageMagick не умеет;
  читать `identify -verbose demo/out/x.gif | grep -n Delay`.
