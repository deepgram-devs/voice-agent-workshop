"""The examples run offline against the mission 00 replay. `make ci` runs this (`make unit`)."""

import json
import os
import socket
import subprocess
import sys
import threading

from agent.common import PROJECT_ROOT
from agent.testing import HARNESS, _node


def test_first_settings_sends_settings_first_and_saves_the_voice(tmp_path):
    dump = tmp_path / "session.json"
    harness = subprocess.Popen(
        [_node(), str(HARNESS), "replay", "00", "greeting", "--dump", str(dump)],
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
    )
    try:
        # Read until READY, as testing._run does: Node may print a warning first.
        lines = []
        for line in harness.stdout:
            if line.startswith("READY "):
                ready = line.strip()
                break
            lines.append(line)
        else:
            # The harness exited before READY: its own output (a Node.js line, say) says why.
            raise AssertionError("".join(lines))
        env = {k: v for k, v in os.environ.items() if k not in ("WORKSHOP_TOKEN", "WORKSHOP_URL")}
        env.update(DEEPGRAM_API_KEY="replay-check-no-real-key", DEEPGRAM_AGENT_URL=ready[6:])
        wav = tmp_path / "voice.wav"
        run = subprocess.run(
            [sys.executable, str(PROJECT_ROOT / "python" / "examples" / "first_settings.py"), str(wav)],
            env=env, stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=30,
        )
        harness.wait(timeout=10)
    finally:
        harness.kill()
    assert run.returncode == 0, run.stdout + run.stderr
    assert "[ready]" in run.stdout and "assistant: Hi there." in run.stdout
    assert wav.read_bytes()[:4] == b"RIFF"
    events = json.loads(dump.read_text())["events"]
    client = [e["frame"]["type"] for e in events if e.get("dir") == "client" and "frame" in e]
    assert client[0] == "Settings"


def test_first_settings_takes_a_converse_url_with_a_trailing_slash(tmp_path):
    """DEEPGRAM_AGENT_URL may end in /v1/agent/converse/: the SDK adds that path once, not twice."""
    server = socket.socket()
    server.bind(("127.0.0.1", 0))
    server.listen(1)
    paths = []

    def accept() -> None:
        conn, _ = server.accept()
        with conn:
            paths.append(conn.recv(4096).decode("latin-1").split(" ")[1])

    threading.Thread(target=accept, daemon=True).start()
    env = {k: v for k, v in os.environ.items() if not k.startswith(("DEEPGRAM_", "WORKSHOP_"))}
    env.update(DEEPGRAM_API_KEY="x-test-key", DEEPGRAM_AGENT_URL=f"ws://127.0.0.1:{server.getsockname()[1]}/v1/agent/converse/")
    try:
        run = subprocess.run(
            [sys.executable, str(PROJECT_ROOT / "python" / "examples" / "first_settings.py"), str(tmp_path / "voice.wav")],
            env=env, stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=30,
        )
    finally:
        server.close()
    assert paths == ["/v1/agent/converse"], run.stdout + run.stderr


def test_first_settings_with_a_curly_quoted_key_says_so_and_never_prints_it(tmp_path):
    """A key pasted with curly quotes: exit 2 with the line, before any connection,
    and never the key."""
    server = socket.socket()
    server.bind(("127.0.0.1", 0))
    server.listen(1)
    connections = []

    def accept() -> None:
        try:
            conn, _ = server.accept()
        except OSError:
            return
        connections.append(1)
        conn.close()

    threading.Thread(target=accept, daemon=True).start()
    marker = "leakprobe0123456789abcdef"
    env = {k: v for k, v in os.environ.items() if not k.startswith(("DEEPGRAM_", "WORKSHOP_"))}
    env.update(
        # Built from code points: this file stays ASCII.
        DEEPGRAM_API_KEY=chr(0x201C) + marker + chr(0x201D),
        DEEPGRAM_AGENT_URL=f"ws://127.0.0.1:{server.getsockname()[1]}",
        WORKSHOP_TOKEN="",
        WORKSHOP_URL="",
    )
    try:
        run = subprocess.run(
            [sys.executable, str(PROJECT_ROOT / "python" / "examples" / "first_settings.py"), str(tmp_path / "voice.wav")],
            env=env, stdin=subprocess.DEVNULL, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=30,
        )
    finally:
        server.close()
    out = run.stdout + run.stderr
    assert run.returncode == 2, out
    assert run.stderr.strip() == (
        "DEEPGRAM_API_KEY has a character a key can't have (a curly quote or a hidden space, "
        "often from copy and paste). Copy it again as plain text."
    )
    assert marker not in out and chr(0x201C) not in out and "Traceback" not in out, out
    assert connections == []


def test_first_settings_with_nothing_listening_is_one_line_and_no_traceback(tmp_path):
    """Nothing answers at DEEPGRAM_AGENT_URL: the helpers' one line, exit 2, no traceback,
    and never the address."""
    probe = socket.socket()
    probe.bind(("127.0.0.1", 0))
    port = probe.getsockname()[1]
    probe.close()  # a port nothing listens on
    env = {k: v for k, v in os.environ.items() if not k.startswith(("DEEPGRAM_", "WORKSHOP_"))}
    env.update(DEEPGRAM_API_KEY="x-test-key", DEEPGRAM_AGENT_URL=f"ws://127.0.0.1:{port}", WORKSHOP_TOKEN="", WORKSHOP_URL="")
    run = subprocess.run(
        [sys.executable, str(PROJECT_ROOT / "python" / "examples" / "first_settings.py"), str(tmp_path / "voice.wav")],
        env=env, stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=30,
    )
    out = run.stdout + run.stderr
    assert run.returncode == 2, out
    assert run.stderr.strip() == "Could not reach the agent: connection refused. Check DEEPGRAM_AGENT_URL.", out
    assert "Traceback" not in out and str(port) not in out


EX_EMPTY = ("DEEPGRAM_API_KEY is empty in .env (this folder). Set it: this example runs "
            "on your own key only (make run takes a workshop token too). "
            "make check NN runs offline with no key.")
EX_NOENV = ("No Deepgram credentials. Copy .env.example to .env and set DEEPGRAM_API_KEY "
            "(free key: https://console.deepgram.com/signup): this example runs on "
            "your own key only (make run takes a workshop token too).")


def test_first_settings_with_no_key_asks_for_a_key_and_never_the_token_lines(tmp_path):
    """No key, with the two token lines set: the example reads the key only, so it says so in its
    own words (the `is empty` form with the project's .env present, else the `No Deepgram
    credentials` form), exit 2, and never asks for the token lines it ignores."""
    env = {k: v for k, v in os.environ.items() if not k.startswith(("DEEPGRAM_", "WORKSHOP_"))}
    env.update(DEEPGRAM_API_KEY="", DEEPGRAM_AGENT_URL="ws://127.0.0.1:9",
               WORKSHOP_TOKEN="wst_unit-test-token", WORKSHOP_URL="ws://127.0.0.1:9/sdk")
    run = subprocess.run(
        [sys.executable, str(PROJECT_ROOT / "python" / "examples" / "first_settings.py"),
         str(tmp_path / "voice.wav")],
        env=env, stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=30,
    )
    out = run.stdout + run.stderr
    assert run.returncode == 2, out
    expected = EX_EMPTY if (PROJECT_ROOT / ".env").is_file() else EX_NOENV
    assert run.stderr.strip() == expected, out
    assert "WORKSHOP" not in out and "/code page" not in out and "Traceback" not in out, out
