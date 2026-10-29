"""One line for a start file Python can't read, before pytest or the program runs it.

`make check NN` and `make run NN` run this first (Makefile CHECK_py and RUN_py):

    uv run python -m agent.syntax missions/NN-name/start.py "make check NN"

A file that parses prints nothing and exits 0. One that doesn't exits 1 with one line that
names the file (from the project root), the line and Python's own message, and the command to
run again, in place of the pytest collection traceback or the interpreter's.
"""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Optional


def doesnt_run(shown: str, where: str, again: str) -> str:
    """The line itself: `where` is "line N Error: message" (or a one-line reason)."""
    return f"Your Python file doesn't run: {shown}:{where}. Fix it and run {again} again."


def problem(path: Path, shown: str, again: str) -> Optional[str]:
    """The line for `path` when Python can't parse it, else None. `shown` is the path to print."""
    try:
        source = path.read_bytes()
    except OSError as err:
        return doesnt_run(shown, f"it couldn't be read ({err.strerror or err})", again)
    try:
        text = source.decode("utf-8")
    except UnicodeDecodeError:
        return doesnt_run(shown, "it isn't UTF-8 text (save it as UTF-8, plain text)", again)
    try:
        compile(text, str(path), "exec")
    except SyntaxError as err:  # IndentationError and TabError are SyntaxErrors too
        return doesnt_run(shown, f"{err.lineno} {type(err).__name__}: {err.msg}", again)
    return None


def main(argv: list[str]) -> int:
    if not argv:
        print("usage: python -m agent.syntax <missions/NN-name/start.py> [command to run again]", file=sys.stderr)
        return 2
    path = Path(argv[0])
    again = argv[1] if len(argv) > 1 else "make check NN"
    # The path is given from python/ (where make runs it); the line shows it from the project root.
    shown = str(path) if path.is_absolute() or str(path).startswith("python/") else f"python/{path.as_posix()}"
    line = problem(path, shown, again)
    if line:
        print(line, file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
