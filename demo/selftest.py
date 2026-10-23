"""Самопроверка PTY-стенда: alt-screen + рамка + 256-цвет → cast → GIF через agg.

Нужна ровно один раз: она показывает, что agg переносит наш cast в GIF и что
переходы pi-env в alt-буфер (`\\x1b[?1049h` / `\\x1b[?1049l`) не портят кадр.
"""

from __future__ import annotations

import subprocess
from pathlib import Path

from demo.ptycast import Step, ensure_agg, record, render_agg, write_cast

REPO = Path(__file__).resolve().parent.parent
AGG = REPO / "demo" / "bin" / "agg"
FONT_DIR = Path.home() / ".local" / "share" / "fonts" / "NerdFonts"
FONT_FAMILY = "JetBrainsMono Nerd Font"
COLS, ROWS = 90, 26

SHELL_ENV = {
    "PATH": "/usr/local/bin:/usr/bin:/bin",
    "TERM": "xterm-256color",
    "LANG": "C.UTF-8",
    "HISTFILE": "/dev/null",
    "PS1": "",
}

# Программа, ведущая себя как pi-env: alt-буфер, рамка, стрелки, секции ресурсов.
PROGRAM = (
    "printf '\\033[?1049h'; "
    "printf '\\033[38;5;75m├─┤ ↑↓ ←→ ▌ alt-screen line\\033[0m\\r\\n'; "
    "printf '\\033[1m[Skills]\\033[0m   \\033[38;5;250msupo-brainstorming, ask-user, obsidian\\033[0m\\r\\n'; "
    "printf '\\033[1m[Extensions]\\033[0m \\033[38;5;250m  pkg-a, pkg-b, searxng-search.ts\\033[0m\\r\\n'; "
    "sleep 1; "
    "printf '\\033[?1049l'; "
    "printf 'main screen restored\\r\\n'; exit"
)


def selftest(out_dir: Path) -> Path:
    """Снять служебный дубль и вернуть путь к GIF; кадр и размер — в stdout."""

    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    cast = out_dir / "selftest.cast"
    gif = out_dir / "selftest.gif"

    chunks = record(
        ["bash", "--norc", "--noprofile", "-c", PROGRAM],
        cwd=REPO, cols=COLS, rows=ROWS, env=SHELL_ENV,
        steps=[Step(keys=(), wait_for="alt-screen line", per_key=0.0, after=0.5)],
        marker_timeout=10,
    )
    write_cast(chunks, cast, width=COLS, height=ROWS, title="selftest")
    render_agg(cast, gif, ensure_agg(AGG), font_dir=FONT_DIR, font_family=FONT_FAMILY,
               font_size=16, fps_cap=24, idle_limit=2)

    info = subprocess.run(["identify", "-format", "%w %h %p %b", str(gif)],
                          capture_output=True, text=True, check=True).stdout.strip()
    print(f"{gif} {info}")
    return gif


if __name__ == "__main__":
    selftest(REPO / "demo" / "out")
