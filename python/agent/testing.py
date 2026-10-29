"""Runs a mission against the check harness (tools/replay-server) from pytest.

    replay: the harness plays a recorded conversation; no key, no network.
    live:   the harness relays to the real API and checks what really happened.

Mission tests stay a few lines long; see missions/00-first-words/test_00.py.
"""

from __future__ import annotations

import asyncio
import importlib.util
import json
import os
import re
import shutil
from dataclasses import dataclass
from pathlib import Path
from types import ModuleType

from .common import PROJECT_ROOT, SetupError, credentials_problem, describe_error, load_env, run_async

HARNESS = PROJECT_ROOT / "tools" / "replay-server" / "harness.mjs"
REPLAY_KEY = "replay-check-no-real-key"


@dataclass
class Verdict:
    passed: bool
    report: str


def mission_name(test_file: str) -> str:
    return Path(test_file).resolve().parent.name


def target() -> str:
    """Which file a check runs: start.py (yours, the default) or solution.py."""
    value = os.environ.get("MISSION_TARGET", "start").strip() or "start"
    if value not in ("start", "solution"):
        raise ValueError("MISSION_TARGET must be start or solution")
    return value


def target_path(test_file: str) -> Path:
    """The file a check runs: python/missions/NN-name/start.py (or solution.py)."""
    return Path(test_file).resolve().parent / f"{target()}.py"


def cant_load(test_file: str, err: BaseException) -> str:
    """One line for a start file that can't be imported: a syntax error, or an error in a
    line that runs at import (`SURPRISE_ME = true`, say). Names your file from the project
    root, the line, Python's message, and the command to run again: the one make hands in
    WORKSHOP_AGAIN (Makefile CHECK_py and LIVE_py: SDK= when it mattered, the docker compose
    prefix in Docker), or `make check NN` when pytest runs by hand."""
    from .syntax import doesnt_run

    path = target_path(test_file)
    shown = path.relative_to(PROJECT_ROOT) if path.is_relative_to(PROJECT_ROOT) else path
    again = os.environ.get("WORKSHOP_AGAIN", "").strip() or f"make check {mission_name(test_file)[:2]}"
    if isinstance(err, SyntaxError) and err.lineno:
        return doesnt_run(str(shown), f"{err.lineno} {type(err).__name__}: {err.msg}", again)
    # The last frame in your file is where it went wrong.
    line = None
    tb = err.__traceback__
    while tb is not None:
        if Path(tb.tb_frame.f_code.co_filename) == path:
            line = tb.tb_lineno
        tb = tb.tb_next
    where = f"{line} " if line else ""
    return doesnt_run(str(shown), f"{where}{type(err).__name__}: {err}", again)


def load_target(test_file: str) -> ModuleType:
    path = target_path(test_file)
    spec = importlib.util.spec_from_file_location(f"mission_{mission_name(test_file).replace('-', '_')}_{target()}", path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    try:
        spec.loader.exec_module(module)
    except Exception as err:
        # Your file can't be imported: one line that says where, in place of the collection traceback.
        problem = cant_load(test_file, err)
    else:
        return module
    import pytest

    pytest.fail(problem, pytrace=False)  # outside the except: no "during handling of" chain


def _node() -> str:
    node = shutil.which("node")
    if not node:
        raise RuntimeError("The checks need Node.js 20.19+ or 22.12+ (you have none). Install Node.js 22 from https://nodejs.org, then run make setup again.")
    if not (HARNESS.parent / "node_modules").exists():
        raise RuntimeError("The check harness isn't installed. Run make setup in the voice-agent-workshop folder.")
    return node


def replay_scenarios(test_file: str) -> list[str]:
    import subprocess

    out = subprocess.run([_node(), str(HARNESS), "list", mission_name(test_file)], capture_output=True, text=True)
    if out.returncode != 0:
        # The harness's own line says why (a Node.js outside its range, say): pass it on.
        raise RuntimeError(
            (out.stderr or out.stdout).strip()
            # A negative return code is the signal that stopped it (Python's convention).
            or f"The check harness stopped ({f'signal {-out.returncode}' if out.returncode < 0 else f'exit {out.returncode}'}) without a message. Run make setup, then try again."
        )
    return json.loads(out.stdout)["replay"]


def live_hint(test_file: str) -> str:
    """The second line when `make live` has no credentials: what it needs, and the offline check."""
    nn = mission_name(test_file)[:2]
    return (
        "make live talks to the real agent, so it needs DEEPGRAM_API_KEY in .env (or WORKSHOP_URL and "
        f"WORKSHOP_TOKEN from the workshop's /code page). make check {nn} runs offline with no key."
    )


def where_to_edit(test_file: str, report: str) -> str:
    """One line naming your file, at the first TODO the report says failed: the place to work.
    With that TODO's comment gone (or no TODO in the report, as for a wrong `version`), the line
    is build_settings(), where every mission's Settings are built."""
    path = target_path(test_file)
    shown = path.relative_to(PROJECT_ROOT) if path.is_relative_to(PROJECT_ROOT) else path
    failed = re.search(r"FAIL\s+TODO (\d+)", report)
    if not path.exists():
        return f"Your file: {shown}"
    lines = path.read_text(encoding="utf-8").splitlines()
    if failed:
        todo = re.compile(rf"(#|//)\s*TODO {failed.group(1)}\b")
        for n, text in enumerate(lines, 1):
            if todo.search(text):
                return f"Your file: {shown}:{n} (TODO {failed.group(1)})"
    settings = next((n for n, text in enumerate(lines, 1) if re.match(r"\s*def build_settings\b", text)), None)
    if settings is None or not re.search(r"^\s*FAIL\s", report, re.M):
        return f"Your file: {shown}"
    if failed:
        return f"Your file: {shown}:{settings} (TODO {failed.group(1)}; its # TODO comment is gone, so start at build_settings())"
    return f"Your file: {shown}:{settings} (build_settings())"


def _report(lines: list[str]) -> str:
    """The harness output a person reads: its READY and VERDICT lines are for this code only."""
    return "\n".join(ln for ln in lines if not ln.startswith(("READY ", "VERDICT "))).strip("\n")


async def _run(mode: str, test_file: str, module: ModuleType, scenario: str | None) -> Verdict:
    load_env()
    if mode == "live":
        # Fail at once, before the harness waits for a program that can't connect.
        problem = credentials_problem(mission=mission_name(test_file))
        if problem:
            return Verdict(False, f"{problem}\n{live_hint(test_file)}")
    args = [str(HARNESS), mode, mission_name(test_file)] + ([scenario] if scenario else [])
    args += ["--source", str(target_path(test_file))]  # read for old API field names
    if mode == "live" and os.environ.get("RECORD_FIXTURE"):
        # Mission authors: save this live run as a fixture (see CONTRIBUTING.md).
        args += ["--record", str(Path(os.environ["RECORD_FIXTURE"]).resolve())]
    proc = await asyncio.create_subprocess_exec(_node(), *args, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT)
    stdout = proc.stdout
    assert stdout
    lines: list[str] = []
    url = None
    while url is None:
        raw = await stdout.readline()
        if not raw:
            break
        line = raw.decode().rstrip()
        lines.append(line)
        if line.startswith("READY "):
            url = line.split(" ", 1)[1]
    if url is None:
        await proc.wait()
        return Verdict(False, _report(lines))

    async def drain() -> None:
        while raw := await stdout.readline():
            lines.append(raw.decode().rstrip())

    reader = asyncio.create_task(drain())
    key = REPLAY_KEY if mode == "replay" else None  # live: your DEEPGRAM_API_KEY, forwarded by the harness
    client_error = None
    setup_error = None
    try:
        await asyncio.wait_for(
            run_async(
                module.build_settings, getattr(module, "on_event", None),
                url=url, api_key=key, interactive=False, replay=mode == "replay",
            ),
            timeout=120,
        )
    except SetupError as err:
        # Your program couldn't start (no credentials, a bad URL): say so first, and stop
        # the harness now rather than let it wait for a connection that won't come.
        setup_error = str(err)
        proc.terminate()
    except Exception as err:  # the harness verdict explains most failures; keep this for the rest
        # describe_error: never the exception as is, which for SDK errors carries the
        # request headers.
        client_error = f"your program stopped with {describe_error(err)}"
    await proc.wait()
    await reader
    if setup_error:
        # A setup line ends on its own fix; the hint is for missing credentials only.
        return Verdict(False, setup_error)
    verdict_line = next((ln for ln in reversed(lines) if ln.startswith("VERDICT ")), None)
    verdict = json.loads(verdict_line[len("VERDICT "):]) if verdict_line else {"pass": False}
    report = _report(lines)
    if client_error:
        report += f"\n{client_error}"
    passed = bool(verdict.get("pass")) and client_error is None
    if not passed and not verdict.get("stopped"):  # a refused session: nothing in your file to change
        report += f"\n{where_to_edit(test_file, report)}"
    return Verdict(passed, report)


async def check_replay(test_file: str, module: ModuleType, scenario: str) -> Verdict:
    return await _run("replay", test_file, module, scenario)


async def check_live(test_file: str, module: ModuleType) -> Verdict:
    return await _run("live", test_file, module, None)
