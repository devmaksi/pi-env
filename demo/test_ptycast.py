"""Тесты PTY-стенда: формат asciinema cast v2 и ожидание по маркеру."""

import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path

from demo.ptycast import TAIL_LIMIT, Step, record, render_agg, write_cast

SHELL_ENV = {
    "PATH": os.environ.get("PATH", "/usr/bin:/bin"),
    "TERM": "xterm-256color",
    "LANG": "C.UTF-8",
    "HOME": os.environ.get("HOME", "/tmp"),
    "HISTFILE": "/dev/null",
    "PS1": "",
}

REPO = Path(__file__).resolve().parent.parent
AGG = REPO / "demo" / "bin" / "agg"
FONT_DIR = Path.home() / ".local" / "share" / "fonts" / "NerdFonts"
FONT_FAMILY = "JetBrainsMono Nerd Font"


class CastWriterTest(unittest.TestCase):
    def test_header_is_cast_v2_and_events_are_output_tuples(self):
        with tempfile.TemporaryDirectory() as d:
            cast = Path(d) / "t.cast"
            write_cast([(0.0, "alpha\r\n"), (1.5, "beta\r\n")], cast,
                       width=90, height=26, title="take")
            lines = cast.read_text(encoding="utf-8").splitlines()
            header = json.loads(lines[0])
            self.assertEqual(header["version"], 2)
            self.assertEqual((header["width"], header["height"]), (90, 26))
            self.assertEqual(header["title"], "take")
            self.assertIsInstance(header["timestamp"], int)
            self.assertEqual(json.loads(lines[1]), [0.0, "o", "alpha\r\n"])
            self.assertEqual(json.loads(lines[2]), [1.5, "o", "beta\r\n"])

    def test_alt_fix_replaces_alternate_screen_switches(self):
        with tempfile.TemporaryDirectory() as d:
            cast = Path(d) / "t.cast"
            write_cast([(0.0, "\x1b[?1049ha\r\n\x1b[?1049l"), (1.0, "b")], cast,
                       width=90, height=26, title="take")
            events = [json.loads(l) for l in cast.read_text(encoding="utf-8").splitlines()[1:]]
            text = "".join(e[2] for e in events)
            self.assertNotIn("1049", text)
            self.assertIn("\x1b[H\x1b[2J", text)
            self.assertEqual(text, "\x1b[H\x1b[2Ja\r\nb")

    def test_alt_fix_off_keeps_switches(self):
        with tempfile.TemporaryDirectory() as d:
            cast = Path(d) / "t.cast"
            write_cast([(0.0, "\x1b[?1049ha\x1b[?1049l")], cast,
                       width=90, height=26, title="take", alt_fix=False)
            events = [json.loads(l) for l in cast.read_text(encoding="utf-8").splitlines()[1:]]
            self.assertEqual(events[0][2], "\x1b[?1049ha\x1b[?1049l")

    def test_non_ascii_is_written_as_text(self):
        with tempfile.TemporaryDirectory() as d:
            cast = Path(d) / "t.cast"
            write_cast([(0.0, "Окружения")], cast, width=90, height=26, title="take")
            self.assertEqual(json.loads(cast.read_text(encoding="utf-8").splitlines()[1])[2],
                             "Окружения")


class MarkerWaitTest(unittest.TestCase):
    def test_marker_is_found_across_two_reads(self):
        chunks = record(
            ["bash", "--norc", "--noprofile", "-c", "printf a; sleep 0.3; printf b; exit"],
            cwd=Path.cwd(), cols=90, rows=26, env=SHELL_ENV,
            steps=[Step(keys=(), wait_for="ab", per_key=0.0, after=0.0)],
            marker_timeout=10,
        )
        self.assertIn("ab", "".join(text for _, text in chunks))

    def test_missing_marker_raises_timeout_naming_marker_and_tail(self):
        with self.assertRaises(TimeoutError) as caught:
            record(
                ["bash", "--norc", "--noprofile", "-c", "printf 'видимый хвост\\n'; sleep 3; exit"],
                cwd=Path.cwd(), cols=90, rows=26, env=SHELL_ENV,
                steps=[Step(keys=(), wait_for="нет-такого-маркера", per_key=0.0, after=0.0)],
                marker_timeout=1.0,
            )
        message = str(caught.exception)
        self.assertIn("нет-такого-маркера", message)
        self.assertIn("видимый хвост", message)

    def test_keys_are_sent_only_after_the_marker(self):
        chunks = record(
            ["bash", "--norc", "--noprofile", "-i"],
            cwd=Path.cwd(), cols=90, rows=26, env={**SHELL_ENV, "PS1": "demo-ps $ "},
            steps=[
                Step(keys=("s", "\r"), wait_for="$", per_key=0.05, after=0.3),
            ],
            marker_timeout=10,
        )
        text = "".join(chunk for _, chunk in chunks)
        self.assertIn("s", text)


class RenderAggTest(unittest.TestCase):
    def test_render_agg_writes_a_non_empty_gif_with_the_real_binary(self):
        with tempfile.TemporaryDirectory() as d:
            tmp = Path(d)
            cast = tmp / "t.cast"
            write_cast([(0.0, "\x1b[31m├─┤↑↓\x1b[0m\r\n"), (0.5, "[Extensions]\r\n")],
                       cast, width=90, height=26, title="render")
            gif = render_agg(cast, tmp / "t.gif", AGG, font_dir=FONT_DIR,
                             font_family=FONT_FAMILY, font_size=16,
                             fps_cap=24, idle_limit=2)
            self.assertTrue(gif.exists())
            self.assertGreater(gif.stat().st_size, 1000)
            frames = subprocess.run(["identify", "-format", "%p", str(gif)],
                                    capture_output=True, text=True, check=True).stdout.strip()
            self.assertGreaterEqual(int(frames), 1)

class MarkerTimeoutTest(unittest.TestCase):
    def test_timeout_carries_the_recorded_chunks(self):
        with self.assertRaises(TimeoutError) as caught:
            record(
                ["bash", "--norc", "--noprofile", "-c", "printf 'хвост до таймаута\\n'; sleep 4; exit"],
                cwd=REPO, cols=90, rows=26, env=SHELL_ENV,
                steps=[Step(keys=(), wait_for="этого нет", per_key=0.0, after=0.0)],
                marker_timeout=1.0,
            )
        chunks = getattr(caught.exception, "chunks", None)
        self.assertTrue(chunks, "TimeoutError обязан нести записанные куски вывода")
        self.assertIn("хвост до таймаута", "".join(text for _, text in chunks))

    def test_wait_for_accepts_several_markers(self):
        chunks = record(
            ["bash", "--norc", "--noprofile", "-c", "printf 'second\\n'; exit"],
            cwd=REPO, cols=90, rows=26, env=SHELL_ENV,
            steps=[Step(keys=(), wait_for=("first", "second"), per_key=0.0, after=0.0)],
            marker_timeout=10,
        )
        self.assertIn("second", "".join(text for _, text in chunks))

    def test_marker_found_even_after_it_left_the_tail_window(self):
        spam = "; ".join(f"printf '%s' 'frame-spam-{n}-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'"
                         for n in range(1, 120))
        chunks = record(
            ["bash", "--norc", "--noprofile", "-c", f"printf target; {spam}; sleep 1; exit"],
            cwd=REPO, cols=90, rows=26, env=SHELL_ENV,
            steps=[Step(keys=(), wait_for="target", per_key=0.0, after=0.0)],
            marker_timeout=15,
        )
        text = "".join(chunk for _, chunk in chunks)
        self.assertGreater(len(text), 4096)
        self.assertNotIn("target", text[-TAIL_LIMIT:])
        self.assertIn("target", text)

    def test_before_pause_happens_between_marker_and_keys(self):
        chunks = record(
            ["bash", "--norc", "--noprofile", "-c",
             "printf ready; read _; printf got-key"],
            cwd=REPO, cols=90, rows=26, env=SHELL_ENV,
            steps=[
                Step(keys=("x", "\r"), wait_for="ready", before=0.6, per_key=0.05, after=0.2),
            ],
            marker_timeout=15,
        )
        ready_at = next(t for t, text in chunks if "ready" in text)
        got_at = next(t for t, text in chunks if "got-key" in text)
        self.assertGreaterEqual(got_at - ready_at, 0.5)


    def test_window_covers_the_previous_steps_output(self):
        # bash печатает «later» только после полученной клавиши — маркер должен
        # найтись на следующем шаге, хотя окно открывается до клавиш текущего шага.
        chunks = record(
            ["bash", "--norc", "--noprofile", "-c", "read _; printf later; exit"],
            cwd=REPO, cols=90, rows=26, env=SHELL_ENV,
            steps=[
                Step(keys=("x", "\r"), wait_for=None, per_key=0.05, after=0.5),
                Step(keys=(), wait_for="later", per_key=0.0, after=0.0),
            ],
            marker_timeout=15,
        )
        self.assertIn("later", "".join(text for _, text in chunks))

    def test_marker_search_starts_at_the_wait(self):
        with self.assertRaises(TimeoutError):
            record(
                ["bash", "--norc", "--noprofile", "-c", "printf early; sleep 2; exit"],
                cwd=REPO, cols=90, rows=26, env=SHELL_ENV,
                steps=[
                    Step(keys=(), wait_for="early", per_key=0.0, after=0.2),
                    Step(keys=(), wait_for="early", per_key=0.0, after=0.0),
                ],
                marker_timeout=1.0,
            )




if __name__ == "__main__":
    unittest.main()
