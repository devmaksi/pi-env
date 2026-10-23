"""PTY-стенд съёмки: реальная сессия в настоящем PTY → asciinema cast v2.

Модуль не знает ни про pi-env, ни про сценарий дубля: он умеет только
запустить программу в PTY, отправлять клавиши по маркерам вывода и записать
поток в формате cast v2 для рендера `agg`.
"""

from __future__ import annotations

import fcntl
import json
import os
import pty
import signal
import struct
import subprocess
import termios
import threading
import time
import urllib.request
from dataclasses import dataclass
from pathlib import Path

AGG_URL = "https://github.com/asciinema/agg/releases/download/v1.9.0/agg-x86_64-unknown-linux-gnu"

DOWN = "\x1b[B"
UP = "\x1b[A"
ENTER = "\r"
ESC = "\x1b"

TAIL_LIMIT = 4096
ERROR_TAIL_LIMIT = 2000
WAIT_SEARCH_LIMIT = 300_000   # как далеко искать маркер: pi перерисовывает весь кадр
ALT_SCREEN_ON = "\x1b[?1049h"
ALT_SCREEN_OFF = "\x1b[?1049l"
ALT_SCREEN_REPLACEMENT = "\x1b[H\x1b[2J"

Chunk = tuple[float, str]


@dataclass(frozen=True)
class Step:
    """Один шаг сценария: дождаться маркера, потом набрать клавиши."""

    keys: tuple[str, ...]
    wait_for: str | tuple[str, ...] | None = None
    per_key: float = 0.08
    before: float = 0.0   # пауза между найденным маркером и клавишами: время прочитать кадр
    after: float = 0.0


def _terminate_process_group(proc: subprocess.Popen) -> None:
    """Остановить всю группу процессов: оболочку, pi-env и дочерний pi.

    Оболочка запускается с `start_new_session=True`. Прежний `proc.terminate()`
    убивал только оболочку, и сорванный дубль оставлял висящий `pi-env` без
    терминала (проверено на живом примере: он переживал уничтожение оболочки).
    """

    try:
        pgid = os.getpgid(proc.pid)
    except (ProcessLookupError, PermissionError):
        pgid = None

    if pgid is not None:
        for sig, limit in ((signal.SIGTERM, 0.4), (signal.SIGKILL, 0.3)):
            try:
                os.killpg(pgid, sig)
            except ProcessLookupError:
                break
            deadline = time.monotonic() + limit
            alive = True
            while alive and time.monotonic() < deadline:
                try:
                    os.killpg(pgid, 0)
                except ProcessLookupError:
                    alive = False
                    break
                time.sleep(0.05)
            if not alive:
                break

    try:
        proc.wait(timeout=1)
    except subprocess.TimeoutExpired:
        pass

def record(
    argv: list[str],
    cwd: Path,
    cols: int,
    rows: int,
    env: dict[str, str],
    steps: list[Step],
    *,
    marker_timeout: float = 25.0,
    exit_grace: float = 2.0,
) -> list[Chunk]:
    """Запустить argv в PTY размером cols×rows, отработать steps, вернуть поток вывода.

    Каждый кусок — (секунды от старта, декодированный текст). Маркер ищется по
    накопленному хвосту всего потока, а не по одному куску: ANSI и UTF-8 приходят
    разрезанными.
    """

    master, slave = pty.openpty()
    fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))
    proc = subprocess.Popen(
        argv, stdin=slave, stdout=slave, stderr=slave,
        close_fds=True, cwd=str(cwd), env=env, start_new_session=True,
    )
    os.close(slave)

    chunks: list[Chunk] = []
    lock = threading.Lock()
    eof = threading.Event()
    started = time.monotonic()

    def reader() -> None:
        try:
            while True:
                data = os.read(master, 65536)
                if not data:
                    break
                with lock:
                    chunks.append((time.monotonic() - started,
                                   data.decode("utf-8", errors="replace")))
        except OSError:
            pass
        finally:
            eof.set()

    thread = threading.Thread(target=reader, daemon=True)
    thread.start()

    def tail(limit: int = TAIL_LIMIT) -> str:
        with lock:
            text = "".join(chunk for _, chunk in chunks)
        return text[-limit:]

    def wait_for(marker: str | tuple[str, ...], start: int) -> None:
        markers = (marker,) if isinstance(marker, str) else tuple(marker)
        deadline = time.monotonic() + marker_timeout
        while time.monotonic() < deadline:
            with lock:
                window = "".join(text for _, text in chunks[start:])
            if len(window) > WAIT_SEARCH_LIMIT:
                window = window[-WAIT_SEARCH_LIMIT:]
            if any(item in window for item in markers):
                return
            time.sleep(0.05)
        error = TimeoutError(
            f"маркер {markers!r} не появился за {marker_timeout} с; "
            f"хвост вывода: {tail(ERROR_TAIL_LIMIT)!r}"
        )
        error.chunks = list(chunks)
        raise error

    window_start = 0
    try:
        for step in steps:
            if step.wait_for is not None:
                wait_for(step.wait_for, window_start)
            window_start = len(chunks)
            if step.before > 0:
                time.sleep(step.before)
            for key in step.keys:
                if eof.is_set() and proc.poll() is not None:
                    raise RuntimeError(
                        f"процесс завершился до отправки клавиш {key!r}; "
                        f"хвост вывода: {tail(ERROR_TAIL_LIMIT)!r}"
                    )
                try:
                    os.write(master, key.encode())
                except OSError as exc:
                    raise RuntimeError(
                        f"PTY закрылся при отправке {key!r}: {exc}; "
                        f"хвост вывода: {tail(ERROR_TAIL_LIMIT)!r}"
                    ) from exc
                if step.per_key:
                    time.sleep(step.per_key)
            if step.after:
                time.sleep(step.after)
        eof.wait(timeout=exit_grace)
    finally:
        _terminate_process_group(proc)
        try:
            os.close(master)
        except OSError:
            pass
        thread.join(timeout=2)

    return chunks


def write_cast(
    chunks: list[Chunk],
    path: Path,
    *,
    width: int,
    height: int,
    title: str,
    alt_fix: bool = True,
) -> None:
    """Записать поток как asciinema cast v2 (заголовок + события [time, "o", text]).

    alt_fix=True меняет переходы в alt-буфер на «очистить экран и писать в тот же
    экран»: agg рисует терминальный поток, и alt-буфер ему не нужен — картинка та же.
    """

    lines = [json.dumps(
        {"version": 2, "width": width, "height": height,
         "timestamp": int(time.time()), "title": title},
        ensure_ascii=False,
    )]
    for at, text in chunks:
        if alt_fix:
            text = text.replace(ALT_SCREEN_ON, ALT_SCREEN_REPLACEMENT).replace(ALT_SCREEN_OFF, "")
        lines.append(json.dumps([round(at, 6), "o", text], ensure_ascii=False))
    Path(path).write_text("\n".join(lines) + "\n", encoding="utf-8")


def ensure_agg(dest: Path) -> Path:
    """Скачать готовый бинарник agg, если его ещё нет."""

    dest = Path(dest)
    if not dest.exists():
        dest.parent.mkdir(parents=True, exist_ok=True)
        urllib.request.urlretrieve(AGG_URL, dest)
        dest.chmod(0o755)
    return dest


def render_agg(
    cast: Path,
    out: Path,
    agg: Path,
    *,
    font_dir: Path,
    font_family: str,
    font_size: int,
    fps_cap: int,
    idle_limit: float,
) -> Path:
    """Отрендерить cast в GIF готовым agg (флаги — из `agg --help` 1.9.0)."""

    subprocess.run(
        [str(agg),
         "--font-dir", str(font_dir),
         "--font-family", font_family,
         "--font-size", str(font_size),
         "--fps-cap", str(fps_cap),
         "--idle-time-limit", str(idle_limit),
         str(cast), str(out)],
        check=True,
    )
    return Path(out)
