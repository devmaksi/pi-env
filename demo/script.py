"""Сценарий дубля: последовательность клавиш и маркеров для обоих языков.

Навигация не полагается на «курсор помнит, где был»: перед каждым выбором список
прокручивается вверх запасом `↑` (упор в первую строку) и только затем считается
спуск. Так дубль не зависит от того, куда pi-env вернул курсор после выхода из pi.
"""

from __future__ import annotations

from demo.ptycast import DOWN, ENTER, ESC, UP, Step

DEMO_ENVS: tuple[str, str] = ("dev-supo", "Test")
STEPS_TO_FIRST = 2    # список: admin, dev-bigpower, dev-supo
STEPS_TO_SECOND = 7   # список: ... my(5), search(6), Test(7)
UP_CLAMP = 12         # запас ↑: курсор упирается в первую строку списка
UI_MARKER = {"en": "Environments", "ru": "Окружения"}
PI_MARKER = "[Extensions]"
PROMPT_MARKER = "pi-env $"
READ_PAUSE_FIRST = 4.0
READ_PAUSE_SECOND = 3.0
NAV_PER_KEY = 0.15


def take(lang: str) -> list[Step]:
    """Дубль: набор `pi-env` → `dev-supo` → `/quit` → `Test` → `/quit` → Esc.

    Пауза чтения стоит в шаге `/quit` до клавиш: кадр со списком ресурсов pi
    должен висеть столько, сколько его успевают прочитать.
    """

    marker = UI_MARKER[lang]
    to_first = (UP,) * UP_CLAMP + (DOWN,) * STEPS_TO_FIRST + (ENTER,)
    to_second = (UP,) * UP_CLAMP + (DOWN,) * STEPS_TO_SECOND + (ENTER,)
    return [
        Step(keys=tuple("pi-env") + (ENTER,), wait_for=PROMPT_MARKER, per_key=0.09, after=1.2),
        Step(keys=to_first, wait_for=marker, per_key=NAV_PER_KEY, after=0.6),
        Step(keys=tuple("/quit") + (ENTER,), wait_for=PI_MARKER, per_key=0.07,
             before=READ_PAUSE_FIRST, after=0.5),
        Step(keys=to_second, wait_for=marker, per_key=NAV_PER_KEY, after=0.6),
        Step(keys=tuple("/quit") + (ENTER,), wait_for=PI_MARKER, per_key=0.07,
             before=READ_PAUSE_SECOND, after=0.5),
        Step(keys=(ESC,), per_key=0.0, after=0.8),
    ]
