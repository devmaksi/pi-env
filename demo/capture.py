"""CLI съёмки демо-GIF: дубль pi-env в PTY → cast → GIF через agg.

Перед дублем скрипт закрепляет язык интерфейса в `<root>/.pi-env.json` и после
дубля восстанавливает файл побайтно. pi-env должен быть закрыт: иначе он может
перезаписать язык своим состоянием прямо во время съёмки.
"""

from __future__ import annotations

import argparse
import contextlib
import struct
import json
import os
import re
import shutil
import struct
import subprocess
import sys
from collections.abc import Iterator, Sequence
from pathlib import Path, PurePosixPath

from demo.ptycast import ensure_agg, record, render_agg, write_cast
from demo.script import DEMO_ENVS, take

REPO = Path(__file__).resolve().parent.parent
AGG = REPO / "demo" / "bin" / "agg"
FONT_DIR = Path.home() / ".local" / "share" / "fonts" / "NerdFonts"
FONT_FAMILY = "JetBrainsMono Nerd Font"
SETTINGS_FILE = ".pi-env.json"
LANG_MARKERS = {"en": "Environments", "ru": "Окружения"}


def output_path(lang: str) -> Path:
    """Без суффикса — английский клип, с суффиксом — остальные языки."""

    return REPO / "docs" / ("demo.gif" if lang == "en" else f"demo.{lang}.gif")


def parse_args(argv: Sequence[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Съёмка демо-GIF интерфейса pi-env")
    parser.add_argument("--langs", default="en,ru", help="языки дублей: en,ru")
    parser.add_argument("--out", help="перезаписать путь результата (только для одного языка)")
    parser.add_argument("--root", default=str(Path.home() / ".pi-env"), help="корень окружений")
    parser.add_argument("--cols", type=int, default=90)
    parser.add_argument("--rows", type=int, default=32)
    parser.add_argument("--font-dir", default=str(FONT_DIR))
    parser.add_argument("--font-family", default=FONT_FAMILY)
    parser.add_argument("--font-size", type=int, default=16)
    parser.add_argument("--fps-cap", type=int, default=24)
    parser.add_argument("--idle-time-limit", type=float, default=2.0, dest="idle_limit")
    parser.add_argument("--keep-cast", action="store_true", dest="keep_cast")
    parser.add_argument("--no-alt-fix", action="store_false", dest="alt_fix")
    parser.add_argument("--resume-hint", dest="resume_hint", action="store_true",
                        help="временно поставить fullscreenExitOutput=resume-hint в снимаемых окружениях")
    parser.add_argument("--allow-busy", dest="allow_busy", action="store_true",
                        help="снимать даже при открытом pi-env (не рекомендуется)")
    parser.add_argument("--pi-version", dest="pi_version",
                        help="какой lastChangelogVersion подставить в снимаемые окружения")
    parser.add_argument("--marker-timeout", type=float, default=40.0, dest="marker_timeout")
    parser.add_argument("--selftest", action="store_true", help="проверка стенда вместо дубля")
    args = parser.parse_args(argv)
    args.langs = [item.strip() for item in args.langs.split(",") if item.strip()]
    for lang in args.langs:
        if lang not in LANG_MARKERS:
            parser.error(f"неизвестный язык дубля: {lang}")
    if args.out and len(args.langs) != 1:
        parser.error("--out можно использовать только с одним языком в --langs")
    return args


@contextlib.contextmanager
def pinned_language(root: Path, lang: str) -> Iterator[None]:
    """Поставить language = lang в `<root>/.pi-env.json` и вернуть файл как был."""

    path = Path(root) / SETTINGS_FILE
    original = path.read_bytes() if path.exists() else None
    try:
        settings = json.loads(original) if original else {}
        settings["language"] = lang
        path.write_text(json.dumps(settings, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        yield
    finally:
        if original is None:
            path.unlink(missing_ok=True)
        else:
            path.write_bytes(original)


@contextlib.contextmanager
def pinned_exit_output(env_dirs: Sequence[Path]) -> Iterator[None]:
    """Поставить fullscreenExitOutput = resume-hint в settings.json снимаемых окружений."""

    saved: list[tuple[Path, bytes | None]] = []
    try:
        for env_dir in env_dirs:
            path = Path(env_dir) / "settings.json"
            original = path.read_bytes() if path.exists() else None
            saved.append((path, original))
            settings = json.loads(original) if original else {}
            settings["fullscreenExitOutput"] = "resume-hint"
            path.write_text(json.dumps(settings, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        yield
    finally:
        for path, original in saved:
            if original is None:
                path.unlink(missing_ok=True)
            else:
                path.write_bytes(original)


def _ancestor_pids() -> set[int]:
    """Наши предки: их командные строки содержат путь репозитория, но это не pi-env."""

    pids: set[int] = set()
    pid = os.getpid()
    while pid > 1 and pid not in pids:
        pids.add(pid)
        try:
            fields = Path(f"/proc/{pid}/stat").read_text(encoding="utf-8").split(") ", 1)[1].split()
        except (OSError, IndexError):
            break
        parent = int(fields[1])
        if parent == pid:
            break
        pid = parent
    pids.add(1)
    return pids


def pi_env_processes() -> list[tuple[int, str]]:
    """Открытые pi-env вне нашего дерева процессов."""

    found = subprocess.run(["pgrep", "-f", "pi-env"], capture_output=True, text=True)
    if found.returncode != 0:
        return []
    ancestors = _ancestor_pids()
    busy: list[tuple[int, str]] = []
    for token in found.stdout.split():
        pid = int(token)
        if pid in ancestors:
            continue
        try:
            cmdline = Path(f"/proc/{pid}/cmdline").read_bytes().replace(b"\x00", b" ").decode("utf-8", "replace").strip()
        except OSError:
            continue
        tokens = cmdline.split()
        if any(PurePosixPath(token).name == "pi-env" for token in tokens):
            busy.append((pid, cmdline))
    return busy


def require_no_pi_env_running() -> None:
    busy = pi_env_processes()
    if busy:
        listing = "\n".join(f"  {pid}: {cmdline}" for pid, cmdline in busy)
        raise SystemExit(
            "закрой pi-env перед съёмкой — он может перезаписать язык настроек прямо в дубле:\n"
            f"{listing}\n(если закрывать не нужно, снимай с --allow-busy)"
        )


def take_env(root: Path, lang: str) -> dict[str, str]:
    """Окружение дубля: настоящий TERM, чтобы pi-env и pi красились; история не пачкается."""

    return {
        "PATH": os.environ.get("PATH", "/usr/bin:/bin"),
        "HOME": os.environ.get("HOME", str(Path.home())),
        "USER": os.environ.get("USER", "user"),
        "TERM": "xterm-256color",
        "COLORTERM": "truecolor",
        "LANG": "en_US.UTF-8" if lang == "en" else "ru_RU.UTF-8",
        "PS1": "~/Project/pi-env \\$ ",
        "HISTFILE": "/dev/null",
        "PI_ENV_ROOT": str(root),
    }


def gif_canvas(gif: Path) -> tuple[int, int]:
    """Размер холста GIF из логического дескриптора экрана (кадры agg меньше холста)."""

    data = Path(gif).read_bytes()
    if data[:6] not in (b"GIF87a", b"GIF89a"):
        raise ValueError(f"{gif} — не GIF")
    return struct.unpack("<HH", data[6:10])


def describe(gif: Path) -> str:
    width, height = gif_canvas(gif)
    frames = len(subprocess.run(["identify", str(gif)], capture_output=True,
                               text=True).stdout.splitlines())
    return f"{width}×{height} px, {frames} кадров, {gif.stat().st_size // 1024} КБ"


@contextlib.contextmanager
def pinned_last_changelog(env_dirs: Sequence[Path], version: str) -> Iterator[None]:
    """Поставить lastChangelogVersion в settings.json снимаемых окружений.

    Иначе pi перед списком ресурсов печатает блок «что нового в версии», и в кадре
    остаётся он, а не `[Skills]` / `[Extensions]`.
    """

    saved: list[tuple[Path, bytes | None]] = []
    try:
        for env_dir in env_dirs:
            path = Path(env_dir) / "settings.json"
            original = path.read_bytes() if path.exists() else None
            saved.append((path, original))
            settings = json.loads(original) if original else {}
            settings["lastChangelogVersion"] = version
            path.write_text(json.dumps(settings, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        yield
    finally:
        for path, original in saved:
            if original is None:
                path.unlink(missing_ok=True)
            else:
                path.write_bytes(original)


def installed_pi_version() -> str | None:
    """Версия установленного pi — чтобы заглушить его changelog-блок на время дубля."""

    try:
        result = subprocess.run(["pi", "--version"], capture_output=True, text=True, timeout=20)
    except (OSError, subprocess.TimeoutExpired):
        return None
    match = re.search(r"\d+\.\d+(?:\.\d+)?", result.stdout or "")
    return match.group(0) if match else None


def take_cast_path(out_dir: Path, lang: str, failed: bool = False) -> Path:
    """Имя cast-файла дубля; сорванный дубль сохраняется с суффиксом -failed."""

    suffix = "-failed" if failed else ""
    return Path(out_dir) / f"{lang}{suffix}.cast"


def record_take(args: argparse.Namespace, lang: str) -> Path:
    root = Path(args.root)
    out = Path(args.out) if args.out else output_path(lang)
    out.parent.mkdir(parents=True, exist_ok=True)
    out_dir = REPO / "demo" / "out"
    out_dir.mkdir(parents=True, exist_ok=True)
    cast = take_cast_path(out_dir, lang)

    if not args.allow_busy:
        require_no_pi_env_running()

    env_dirs = [root / name for name in DEMO_ENVS]
    pi_version = args.pi_version or installed_pi_version()
    chunks = None
    try:
        with pinned_language(root, lang):
            with pinned_exit_output(env_dirs) if args.resume_hint else contextlib.nullcontext():
                with pinned_last_changelog(env_dirs, pi_version) if pi_version else contextlib.nullcontext():
                    chunks = record(["bash", "--norc", "--noprofile"], cwd=REPO,
                                    cols=args.cols, rows=args.rows, env=take_env(root, lang),
                                    steps=take(lang), marker_timeout=args.marker_timeout)
    except TimeoutError as exc:
        chunks = getattr(exc, "chunks", None)
        if chunks:
            postmortem = take_cast_path(out_dir, lang, failed=True)
            write_cast(chunks, postmortem, width=args.cols, height=args.rows,
                       title=f"pi-env demo ({lang}) — сорванный дубль", alt_fix=args.alt_fix)
            print(f"{lang}: сорванный дубль сохранён в {postmortem}", file=sys.stderr)
        raise

    write_cast(chunks, cast, width=args.cols, height=args.rows, title=f"pi-env demo ({lang})",
               alt_fix=args.alt_fix)
    render_agg(cast, out, ensure_agg(AGG), font_dir=Path(args.font_dir),
               font_family=args.font_family, font_size=args.font_size,
               fps_cap=args.fps_cap, idle_limit=args.idle_limit)
    print(f"{lang}: {out} — {describe(out)}")
    if not args.keep_cast:
        cast.unlink(missing_ok=True)
    return out


def main(argv: Sequence[str]) -> int:
    args = parse_args(argv)
    if args.selftest:
        from demo.selftest import selftest
        selftest(REPO / "demo" / "out")
        return 0
    for lang in args.langs:
        record_take(args, lang)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
