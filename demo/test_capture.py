"""Тесты сценария дубля и CLI съёмки."""

import json
import os
import struct
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path

from demo.capture import (
    gif_canvas, output_path, parse_args, pinned_exit_output, pinned_language,
    pinned_last_changelog, pi_env_processes, require_no_pi_env_running, take_cast_path,
)
from demo.ptycast import DOWN, ENTER, ESC, UP
from demo.script import DEMO_ENVS, STEPS_TO_FIRST, STEPS_TO_SECOND, UP_CLAMP, take

REPO = Path(__file__).resolve().parent.parent


class TakeScriptTest(unittest.TestCase):
    def test_en_take_waits_for_english_ui_marker(self):
        steps = take("en")
        self.assertEqual(len(steps), 6)
        self.assertEqual(steps[1].wait_for, "Environments")
        self.assertEqual(steps[3].wait_for, "Environments")
        self.assertEqual(steps[2].wait_for, "[Extensions]")
        self.assertEqual(steps[4].wait_for, "[Extensions]")

    def test_ru_take_waits_for_russian_ui_marker(self):
        self.assertEqual(take("ru")[1].wait_for, "Окружения")
        self.assertEqual(take("ru")[3].wait_for, "Окружения")

    def test_first_step_types_the_command_then_enter(self):
        self.assertEqual(take("en")[0].keys, tuple("pi-env") + ("\r",))

    def test_navigation_and_exit_keys(self):
        steps = take("en")
        self.assertEqual(steps[1].keys, (UP,) * UP_CLAMP + (DOWN,) * STEPS_TO_FIRST + (ENTER,))
        self.assertEqual(steps[3].keys, (UP,) * UP_CLAMP + (DOWN,) * STEPS_TO_SECOND + (ENTER,))
        self.assertEqual(steps[2].keys, tuple("/quit") + (ENTER,))
        self.assertEqual(steps[5].keys, (ESC,))

    def test_read_pause_is_the_only_long_delay(self):
        steps = take("en")
        self.assertEqual((steps[2].wait_for, steps[2].before), ("[Extensions]", 4.0))
        self.assertEqual((steps[4].wait_for, steps[4].before), ("[Extensions]", 3.0))
        self.assertLess(max(step.per_key for step in steps), 1.0)
        self.assertLess(max(step.after for step in steps), 2.0)

    def test_demo_envs_are_the_documented_pair(self):
        self.assertEqual(DEMO_ENVS, ("dev-supo", "Test"))
        self.assertEqual((STEPS_TO_FIRST, STEPS_TO_SECOND), (2, 7))


class PinnedLastChangelogTest(unittest.TestCase):
    def test_last_changelog_version_is_pinned_and_restored(self):
        with tempfile.TemporaryDirectory() as d:
            env = Path(d) / "dev-supo"
            env.mkdir()
            original = b'{"defaultModel": "m"}\n'
            (env / "settings.json").write_bytes(original)
            with pinned_last_changelog([env], "1.4.0"):
                saved = json.loads((env / "settings.json").read_text(encoding="utf-8"))
                self.assertEqual(saved["lastChangelogVersion"], "1.4.0")
                self.assertEqual(saved["defaultModel"], "m")
            self.assertEqual((env / "settings.json").read_bytes(), original)

class GifInfoTest(unittest.TestCase):
    def test_gif_canvas_comes_from_the_logical_screen_descriptor(self):
        blob = (b"GIF89a" + struct.pack("<HHHH", 883, 739, 0, 0)
                + b"\x00" + b"\x21\xf9\x04\x01\x00\x00\x00\x00")
        with tempfile.TemporaryDirectory() as d:
            path = Path(d) / "x.gif"
            path.write_bytes(blob)
            self.assertEqual(gif_canvas(path), (883, 739))

    def test_non_gif_is_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            path = Path(d) / "x.gif"
            path.write_bytes(b"not a gif at all")
            with self.assertRaises(ValueError):
                gif_canvas(path)



class OutputPathTest(unittest.TestCase):
    def test_suffix_rule_no_suffix_for_english(self):
        self.assertEqual(output_path("en"), REPO / "docs" / "demo.gif")
        self.assertEqual(output_path("ru"), REPO / "docs" / "demo.ru.gif")


class PinnedLanguageTest(unittest.TestCase):
    def test_language_is_pinned_then_restored_byte_for_byte(self):
        original = b'{\n  "color": true,\n  "language": "ru"\n}\n'
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            (root / ".pi-env.json").write_bytes(original)
            with pinned_language(root, "en"):
                saved = json.loads((root / ".pi-env.json").read_text(encoding="utf-8"))
                self.assertEqual(saved["language"], "en")
                self.assertIs(saved["color"], True)
            self.assertEqual((root / ".pi-env.json").read_bytes(), original)

    def test_absent_file_is_created_and_removed(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            with pinned_language(root, "ru"):
                saved = json.loads((root / ".pi-env.json").read_text(encoding="utf-8"))
                self.assertEqual(saved["language"], "ru")
            self.assertFalse((root / ".pi-env.json").exists())

    def test_restore_happens_even_when_the_body_raises(self):
        original = b'{"language": "ru"}\n'
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            (root / ".pi-env.json").write_bytes(original)
            with self.assertRaises(RuntimeError):
                with pinned_language(root, "en"):
                    raise RuntimeError("съёмка упала")
            self.assertEqual((root / ".pi-env.json").read_bytes(), original)


class PinnedExitOutputTest(unittest.TestCase):
    def test_resume_hint_is_injected_and_restored(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            env = root / "dev-supo"
            env.mkdir()
            original = b'{"defaultModel": "m"}\n'
            (env / "settings.json").write_bytes(original)
            with pinned_exit_output([env]):
                saved = json.loads((env / "settings.json").read_text(encoding="utf-8"))
                self.assertEqual(saved["fullscreenExitOutput"], "resume-hint")
                self.assertEqual(saved["defaultModel"], "m")
            self.assertEqual((env / "settings.json").read_bytes(), original)


class CliArgsTest(unittest.TestCase):
    def test_defaults(self):
        args = parse_args([])
        self.assertEqual(args.langs, ["en", "ru"])
        self.assertEqual((args.cols, args.rows), (90, 32))
        self.assertEqual(args.font_size, 16)
        self.assertEqual(args.fps_cap, 24)
        self.assertEqual(args.idle_limit, 2.0)
        self.assertTrue(args.alt_fix)
        self.assertFalse(args.resume_hint)

    def test_lang_list_and_flags(self):
        args = parse_args(["--langs", "ru", "--no-alt-fix", "--resume-hint",
                           "--idle-time-limit", "4", "--keep-cast"])
        self.assertEqual(args.langs, ["ru"])
        self.assertFalse(args.alt_fix)
        self.assertTrue(args.resume_hint)
        self.assertEqual(args.idle_limit, 4.0)
        self.assertTrue(args.keep_cast)


class PiEnvProcessGuardTest(unittest.TestCase):
    def test_our_own_ancestors_are_not_reported(self):
        reported = {pid for pid, _ in pi_env_processes()}
        self.assertNotIn(os.getpid(), reported)
        self.assertNotIn(os.getppid(), reported)

    def test_foreign_pi_env_is_reported_and_take_is_refused(self):
        child = subprocess.Popen(["bash", "-c", "exec -a pi-env sleep 3"],
                                 stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            deadline = time.monotonic() + 3
            found = []
            while time.monotonic() < deadline:
                found = [pid for pid, _ in pi_env_processes() if pid == child.pid]
                if found:
                    break
                time.sleep(0.1)
            self.assertEqual(found, [child.pid])
            with self.assertRaises(SystemExit):
                require_no_pi_env_running()
        finally:
            child.terminate()
            child.wait()

    def test_process_mentioning_the_repo_path_is_not_pi_env(self):
        child = subprocess.Popen(
            ["bash", "-c", f"exec -a tail tail -f {REPO}/TODO.md"],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            time.sleep(0.6)
            reported = {pid for pid, _ in pi_env_processes()}
            self.assertNotIn(child.pid, reported)
        finally:
            child.terminate()
            child.wait()

    def test_process_named_like_pi_env_but_not_pi_env_is_not_reported(self):
        child = subprocess.Popen(["bash", "-c", "exec -a pi-env-todo sleep 3"],
                                 stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            time.sleep(0.6)
            reported = {pid for pid, _ in pi_env_processes()}
            self.assertNotIn(child.pid, reported)
        finally:
            child.terminate()
            child.wait()


class TakeCastNameTest(unittest.TestCase):
    def test_take_cast_names(self):
        with tempfile.TemporaryDirectory() as d:
            out_dir = Path(d)
            ok = take_cast_path(out_dir, "en")
            failed = take_cast_path(out_dir, "ru", failed=True)
            self.assertEqual(ok.name, "en.cast")
            self.assertEqual(failed.name, "ru-failed.cast")


if __name__ == "__main__":
    unittest.main()
