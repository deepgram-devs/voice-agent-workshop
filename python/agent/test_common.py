"""Unit tests for the shared helpers. `make ci` runs them (`make unit`)."""

import socket
import threading
import time

from deepgram.core.api_error import ApiError

from agent.common import describe_error, redact

FAKE_KEY = "0123456789abcdef0123456789abcdef01234567"


def test_redact_masks_the_configured_key(monkeypatch):
    monkeypatch.setenv("DEEPGRAM_API_KEY", FAKE_KEY)
    assert FAKE_KEY not in redact(f"failed with {FAKE_KEY} in it")


def test_redact_masks_authorization_headers_in_any_shape(monkeypatch):
    monkeypatch.delenv("DEEPGRAM_API_KEY", raising=False)
    for text in (
        f"headers: {{'Authorization': 'Token {FAKE_KEY}', 'X-Fern': 'x'}}",
        f'{{"authorization": "Bearer {FAKE_KEY}"}}',
        f"Authorization: token {FAKE_KEY}",
        f"sent Token {FAKE_KEY}",
    ):
        out = redact(text)
        assert FAKE_KEY not in out, out
        assert "[redacted]" in out


def test_describe_error_never_prints_an_api_error(monkeypatch):
    monkeypatch.delenv("DEEPGRAM_API_KEY", raising=False)
    err = ApiError(status_code=401, headers={"Authorization": f"Token {FAKE_KEY}"}, body="bad")
    assert describe_error(err) == "Deepgram refused the connection (HTTP 401)"


def test_describe_error_keeps_ordinary_messages():
    assert describe_error(ValueError("bad id")) == "ValueError: bad id"


# ---- the workshop proxy path -------------------------------------------------

import pytest

from agent.common import SetupError, make_client, mission_of, workshop_base_url


def test_workshop_base_url_adds_the_mission_and_takes_https():
    assert workshop_base_url("https://speak.example.test/sdk/", "00-first-words") == "wss://speak.example.test/sdk/00-first-words"
    assert workshop_base_url("ws://localhost:8080/sdk/v1/agent/converse", None) == "ws://localhost:8080/sdk"
    with pytest.raises(SetupError, match="WORKSHOP_URL is empty"):
        workshop_base_url("", "00-first-words")


def test_a_workshop_url_without_sdk_says_so_and_a_local_one_keeps_http(monkeypatch):
    from agent.common import code_page

    monkeypatch.setenv("WORKSHOP_URL", "http://localhost:8103")
    with pytest.raises(SetupError, match=r"^WORKSHOP_URL should end in /sdk\. Copy both lines from http://localhost:8103/code into \.env\.$"):
        workshop_base_url("http://localhost:8103", "00-first-words")
    monkeypatch.setenv("WORKSHOP_URL", "ws://localhost:8103/sdk")
    assert code_page() == "http://localhost:8103/code"
    monkeypatch.setenv("WORKSHOP_URL", "wss://speak.example.test/sdk")
    assert code_page() == "https://speak.example.test/code"


def test_mission_of_reads_the_mission_folder():
    assert mission_of("/x/python/missions/04-polyglot/start.py") == "04-polyglot"
    assert mission_of("/x/python/agent/common.py") is None
    assert mission_of(None) is None


def test_make_client_uses_the_workshop_proxy_without_a_key(monkeypatch):
    monkeypatch.delenv("DEEPGRAM_API_KEY", raising=False)
    monkeypatch.delenv("DEEPGRAM_AGENT_URL", raising=False)
    monkeypatch.setenv("WORKSHOP_TOKEN", "wst_" + "a" * 43)
    monkeypatch.setenv("WORKSHOP_URL", "wss://speak.example.test/sdk")
    client = make_client(mission="00-first-words")
    wrapper = client._client_wrapper
    assert wrapper.get_environment().agent == "wss://speak.example.test/sdk/00-first-words"
    assert wrapper.get_headers()["Authorization"].lower() == "bearer wst_" + "a" * 43


def test_the_workshop_token_wins_over_a_key_in_the_shell(monkeypatch):
    # A DEEPGRAM_API_KEY exported for your own STT work never quietly takes over a workshop run.
    monkeypatch.setenv("DEEPGRAM_API_KEY", FAKE_KEY)
    monkeypatch.delenv("DEEPGRAM_AGENT_URL", raising=False)
    monkeypatch.setenv("WORKSHOP_TOKEN", "wst_" + "a" * 43)
    monkeypatch.setenv("WORKSHOP_URL", "wss://speak.example.test/sdk")
    wrapper = make_client(mission="00-first-words")._client_wrapper
    assert wrapper.get_environment().agent == "wss://speak.example.test/sdk/00-first-words"
    assert wrapper.get_headers()["Authorization"].lower() == "bearer wst_" + "a" * 43
    # The check harness (an explicit url) gets the same credential, and relays it on.
    assert make_client(url="ws://127.0.0.1:9")._client_wrapper.get_headers()["Authorization"].lower().startswith("bearer wst_")
    # With WORKSHOP_TOKEN empty, your key is used.
    monkeypatch.setenv("WORKSHOP_TOKEN", "")
    wrapper = make_client(mission="00-first-words")._client_wrapper
    assert wrapper.get_environment().agent == "wss://agent.deepgram.com"
    assert wrapper.get_headers()["Authorization"] == f"Token {FAKE_KEY}"


def test_your_key_is_used_when_the_token_has_no_workshop_url(monkeypatch):
    monkeypatch.setenv("DEEPGRAM_API_KEY", FAKE_KEY)
    monkeypatch.delenv("DEEPGRAM_AGENT_URL", raising=False)
    monkeypatch.setenv("WORKSHOP_TOKEN", "wst_" + "a" * 43)
    monkeypatch.setenv("WORKSHOP_URL", "")
    wrapper = make_client(mission="00-first-words")._client_wrapper
    assert wrapper.get_environment().agent == "wss://agent.deepgram.com"
    assert wrapper.get_headers()["Authorization"] == f"Token {FAKE_KEY}"


def test_uses_workshop_only_without_a_key_or_an_agent_url(monkeypatch):
    monkeypatch.delenv("DEEPGRAM_API_KEY", raising=False)
    monkeypatch.delenv("DEEPGRAM_AGENT_URL", raising=False)
    monkeypatch.setenv("WORKSHOP_TOKEN", "wst_" + "a" * 43)
    from agent.common import uses_workshop

    assert uses_workshop() is True
    assert uses_workshop(url="ws://127.0.0.1:9") is False
    monkeypatch.setenv("DEEPGRAM_API_KEY", FAKE_KEY)
    assert uses_workshop() is False  # a key and no WORKSHOP_URL: the key
    monkeypatch.setenv("WORKSHOP_URL", "wss://speak.example.test/sdk")
    assert uses_workshop() is True  # a key, a token and WORKSHOP_URL: the token
    monkeypatch.setenv("DEEPGRAM_AGENT_URL", "wss://agent.example.test")
    assert uses_workshop() is False


def test_a_workshop_token_never_goes_to_deepgram_agent_url(monkeypatch):
    monkeypatch.delenv("DEEPGRAM_API_KEY", raising=False)
    monkeypatch.setenv("WORKSHOP_TOKEN", "wst_" + "a" * 43)
    monkeypatch.setenv("WORKSHOP_URL", "wss://speak.example.test/sdk")
    monkeypatch.setenv("DEEPGRAM_AGENT_URL", "wss://agent.hidden.example.test")
    with pytest.raises(SetupError) as refused:
        make_client(mission="00-first-words")
    assert str(refused.value).startswith("DEEPGRAM_AGENT_URL needs your own DEEPGRAM_API_KEY.")
    assert "hidden" not in str(refused.value)
    assert "wst_" not in str(refused.value)
    # The check harness passes its own url; the token goes to it, as before.
    assert make_client(url="ws://127.0.0.1:9")._client_wrapper.get_environment().agent == "ws://127.0.0.1:9"
    # With a key of your own, DEEPGRAM_AGENT_URL is yours to set.
    monkeypatch.setenv("DEEPGRAM_API_KEY", FAKE_KEY)
    assert make_client()._client_wrapper.get_environment().agent == "wss://agent.hidden.example.test"


def test_a_bad_url_is_named_but_never_echoed():
    from agent.common import agent_base_url

    with pytest.raises(SetupError) as bad_agent:
        agent_base_url("agent.hidden.example.test")
    assert "DEEPGRAM_AGENT_URL must start with wss://" in str(bad_agent.value)
    assert "hidden" not in str(bad_agent.value)
    with pytest.raises(SetupError) as bad_workshop:
        workshop_base_url("speak.hidden.example.test/sdk", "00-first-words")
    assert "WORKSHOP_URL must start with wss://" in str(bad_workshop.value)
    assert "hidden" not in str(bad_workshop.value)


# ---- run_async against a local server ------------------------------------------

import asyncio
import json

from websockets.asyncio.server import serve

from agent.common import run_async

SETTINGS = {
    "audio": {"input": {"encoding": "linear16", "sample_rate": 16000}, "output": {"encoding": "linear16", "sample_rate": 24000}},
    "agent": {
        "listen": {"provider": {"type": "deepgram", "model": "nova-3"}},
        "think": {"provider": {"type": "open_ai", "model": "gpt-4o-mini"}, "prompt": "Be brief."},
        "speak": {"provider": {"type": "deepgram", "model": "aura-2-thalia-en"}},
    },
}


async def _refuse(connection, request):
    return connection.respond(401, "no\n")


async def test_a_refused_connection_is_a_setup_error_without_the_key(monkeypatch):
    monkeypatch.delenv("DEEPGRAM_API_KEY", raising=False)
    monkeypatch.delenv("DEEPGRAM_AGENT_URL", raising=False)
    monkeypatch.delenv("WORKSHOP_TOKEN", raising=False)
    async with serve(lambda ws: None, "127.0.0.1", 0, process_request=_refuse) as server:
        port = server.sockets[0].getsockname()[1]
        with pytest.raises(SetupError) as refused:
            await run_async(lambda: SETTINGS, url=f"ws://127.0.0.1:{port}", api_key=FAKE_KEY, interactive=False, quiet=True)
    message = str(refused.value)
    assert message == "Deepgram refused the connection (HTTP 401). Check DEEPGRAM_API_KEY."
    assert FAKE_KEY not in message


async def test_a_refused_workshop_token_names_the_token_without_printing_it(monkeypatch):
    token = "wst_" + "b" * 43
    monkeypatch.delenv("DEEPGRAM_API_KEY", raising=False)
    monkeypatch.setenv("DEEPGRAM_AGENT_URL", "")  # set and empty, so .env can't fill it in
    monkeypatch.setenv("WORKSHOP_TOKEN", token)
    async with serve(lambda ws: None, "127.0.0.1", 0, process_request=_refuse) as server:
        port = server.sockets[0].getsockname()[1]
        monkeypatch.setenv("WORKSHOP_URL", f"ws://127.0.0.1:{port}/sdk")
        with pytest.raises(SetupError) as refused:
            await run_async(lambda: SETTINGS, interactive=False, quiet=True, mission="00-first-words")
    message = str(refused.value)
    assert message.startswith("The workshop proxy refused the connection (HTTP 401). Check WORKSHOP_TOKEN")
    assert "turned off by workshop staff" in message
    assert token not in message


async def test_close_from_outside_on_event_ends_the_call(monkeypatch):
    monkeypatch.delenv("DEEPGRAM_AGENT_URL", raising=False)

    async def agent_server(ws):
        await ws.send(json.dumps({"type": "Welcome", "request_id": "r"}))
        async for message in ws:
            if isinstance(message, str) and json.loads(message).get("type") == "Settings":
                await ws.send(json.dumps({"type": "SettingsApplied"}))

    closers: list[asyncio.Task] = []

    async def on_event(agent, event):
        if event["type"] == "SettingsApplied":
            # A task of your own, outside on_event: nothing else would wake run()'s loop.
            async def hang_up():
                await asyncio.sleep(0.05)
                await agent.close()

            closers.append(asyncio.create_task(hang_up()))

    async with serve(agent_server, "127.0.0.1", 0) as server:
        port = server.sockets[0].getsockname()[1]
        agent = await asyncio.wait_for(
            run_async(lambda: SETTINGS, on_event, url=f"ws://127.0.0.1:{port}", api_key=FAKE_KEY, interactive=False, quiet=True),
            timeout=5,
        )
    assert agent.closed
    assert closers and closers[0].done()


def test_a_warning_line_carries_its_code():
    from agent.common import explain_warning

    replaced = {"type": "Warning", "code": "TOKEN_REPLACED", "description": "You made a new code-project token, so this one stopped."}
    assert explain_warning(replaced) == "[workshop] You made a new code-project token, so this one stopped. (TOKEN_REPLACED)"
    assert explain_warning({"type": "Warning", "description": "Heads up."}) == "Agent warning: Heads up."


def test_voice_prompt_added_prints_as_a_note():
    from agent.common import explain_warning, event_line, VOICE_PROMPT_NOTE

    warning = {"type": "Warning", "code": "VOICE_PROMPT_ADDED", "description": "Voice style instructions were added ahead of your system prompt."}
    assert explain_warning(warning) == VOICE_PROMPT_NOTE
    assert VOICE_PROMPT_NOTE.startswith("[note] ") and VOICE_PROMPT_NOTE.endswith("(VOICE_PROMPT_ADDED)")
    assert event_line(warning) == VOICE_PROMPT_NOTE


def test_the_thinking_concurrency_limit_says_what_to_do():
    from agent.common import explain_error, THINKING_BUSY_HINT, STOP_CODES

    busy = {"type": "Error", "code": "CONCURRENCY_LIMIT_REACHED", "description": "Concurrency limit reached."}
    assert explain_error(busy) == f"Agent error: Concurrency limit reached. (CONCURRENCY_LIMIT_REACHED)\n  {THINKING_BUSY_HINT}"
    assert "THINKING_MODEL" in THINKING_BUSY_HINT
    # Not a workshop stop: a later run can get a seat.
    assert "CONCURRENCY_LIMIT_REACHED" not in STOP_CODES


RESUMED_LINE = (
    "You picked up your saved progress on the workshop site, so this program's token stopped working. "
    "Get a new token on the /code page, put it in WORKSHOP_TOKEN, and run your program again."
)


def test_a_resume_stop_prints_the_whole_proxy_line(capsys):
    from agent.common import _print_event, explain_warning

    resumed = {"type": "Warning", "code": "SESSION_RESUMED", "description": RESUMED_LINE}
    assert explain_warning(resumed) == f"[workshop] {RESUMED_LINE} (SESSION_RESUMED)"
    _print_event(resumed)
    assert capsys.readouterr().out == f"[workshop] {RESUMED_LINE} (SESSION_RESUMED)\n"


# ---- listen model, workshop site, refusal lines ------------------------------------


def test_listen_provider_defaults_and_env(monkeypatch):
    from agent.common import listen_provider

    for name in ("LISTEN_MODEL", "LISTEN_VERSION", "WORKSHOP_TOKEN", "DEEPGRAM_AGENT_URL"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("DEEPGRAM_API_KEY", FAKE_KEY)
    assert listen_provider() == {"type": "deepgram", "model": "nova-3", "version": "v1"}
    monkeypatch.setenv("LISTEN_MODEL", "flux-general-en")
    monkeypatch.setenv("LISTEN_VERSION", "v2")
    assert listen_provider() == {"type": "deepgram", "model": "flux-general-en", "version": "v2"}
    monkeypatch.delenv("LISTEN_VERSION")
    assert listen_provider() == {"type": "deepgram", "model": "flux-general-en"}


def test_listen_provider_asks_for_the_proxy_model_with_a_token(monkeypatch):
    from agent.common import listen_provider

    for name in ("LISTEN_MODEL", "LISTEN_VERSION", "DEEPGRAM_API_KEY", "DEEPGRAM_AGENT_URL"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("WORKSHOP_TOKEN", "wst_" + "a" * 43)
    assert listen_provider() == {"type": "deepgram", "model": "flux-general-en", "version": "v2"}


def test_the_code_page_is_named_from_workshop_url(monkeypatch):
    from agent.common import code_page, workshop_site

    monkeypatch.setenv("WORKSHOP_URL", "wss://speak.example.test/sdk")
    assert workshop_site() == "https://speak.example.test"
    assert code_page() == "https://speak.example.test/code"
    monkeypatch.setenv("WORKSHOP_URL", "wss://speak.example.test/builders-lab/sdk/")
    assert workshop_site() == "https://speak.example.test/builders-lab"
    monkeypatch.setenv("WORKSHOP_URL", "https://speak.example.test/builders-lab/code")
    assert code_page() == "https://speak.example.test/builders-lab/code"
    monkeypatch.setenv("WORKSHOP_URL", "wss://speak.example.test/builders-lab/sdk/v1/agent/converse")
    assert workshop_site() == "https://speak.example.test/builders-lab"
    monkeypatch.setenv("WORKSHOP_URL", "wss://speak.example.test?x=1")
    assert workshop_site() == "https://speak.example.test"
    # A pasted mission page (or its step) or /resume names the site, not that page.
    monkeypatch.setenv("WORKSHOP_URL", "https://speak.example.test/builders-lab/m/first-words")
    assert code_page() == "https://speak.example.test/builders-lab/code"
    monkeypatch.setenv("WORKSHOP_URL", "https://speak.example.test/builders-lab/m/let-me-finish/the-knobs/")
    assert workshop_site() == "https://speak.example.test/builders-lab"
    monkeypatch.setenv("WORKSHOP_URL", "https://speak.example.test/resume")
    assert workshop_site() == "https://speak.example.test"
    monkeypatch.setenv("WORKSHOP_URL", "")
    assert workshop_site() is None
    assert code_page() == "the workshop site's /code page"


def test_a_404_from_the_proxy_says_it_is_closed_and_a_401_names_the_token(monkeypatch):
    from agent.common import refused_line, retryable_status

    monkeypatch.setenv("WORKSHOP_URL", "wss://speak.example.test/sdk")
    closed = refused_line(404, True)
    assert closed.startswith("The workshop proxy refused the connection (HTTP 404). The workshop proxy is closed")
    assert "DEEPGRAM_API_KEY" in closed and "make check 01" in closed and "`timing`" in closed
    token = refused_line(401, True)
    assert "Check WORKSHOP_TOKEN" in token and "https://speak.example.test/code" in token
    assert "closed" not in token
    assert refused_line(404, False) == "Deepgram refused the connection (HTTP 404)."
    assert [retryable_status(s) for s in (401, 404, 429, 500, 503, None)] == [False, False, True, True, True, False]


# ---- run_resilient against a local server ---------------------------------------------


async def test_run_resilient_reconnects_after_a_drop_and_sends_settings_again(monkeypatch):
    from agent.resilient import run_resilient_async

    monkeypatch.delenv("DEEPGRAM_AGENT_URL", raising=False)
    settings_seen = []

    async def agent_server(ws):
        await ws.send(json.dumps({"type": "Welcome", "request_id": "r"}))
        async for message in ws:
            if isinstance(message, str) and json.loads(message).get("type") == "Settings":
                settings_seen.append(message)
                await ws.send(json.dumps({"type": "SettingsApplied"}))
                if len(settings_seen) == 1:
                    ws.transport.abort()  # the network drops: no close frame
                else:
                    await ws.close(1000, "done")
                return

    waits, lines = [], []

    async def no_wait(seconds):
        waits.append(seconds)

    async with serve(agent_server, "127.0.0.1", 0) as server:
        port = server.sockets[0].getsockname()[1]
        agent = await asyncio.wait_for(
            run_resilient_async(
                lambda: SETTINGS, url=f"ws://127.0.0.1:{port}", api_key=FAKE_KEY, interactive=False, quiet=True,
                sleep=no_wait, log=lines.append,
            ),
            timeout=10,
        )
    assert len(settings_seen) == 2
    assert len(waits) == 1 and 1.0 <= waits[0] <= 1.25
    assert lines and lines[0].startswith("[reconnect] closed 1006")
    assert agent.close_code is None and not agent.hung_up


async def test_run_resilient_stops_on_a_refused_key(monkeypatch):
    from agent.resilient import run_resilient_async

    monkeypatch.delenv("DEEPGRAM_AGENT_URL", raising=False)
    monkeypatch.delenv("WORKSHOP_TOKEN", raising=False)
    waits = []

    async def no_wait(seconds):
        waits.append(seconds)

    async with serve(lambda ws: None, "127.0.0.1", 0, process_request=_refuse) as server:
        port = server.sockets[0].getsockname()[1]
        with pytest.raises(SetupError, match="HTTP 401"):
            await run_resilient_async(lambda: SETTINGS, url=f"ws://127.0.0.1:{port}", api_key=FAKE_KEY, interactive=False, quiet=True, sleep=no_wait)
    assert waits == []


def test_backoff_doubles_and_caps():
    from agent.resilient import backoff

    for attempt, base in ((1, 1), (2, 2), (3, 4), (4, 8), (5, 15), (9, 15)):
        assert base <= backoff(attempt) <= base * 1.25


# ---- the private close, LIVE_CLOSED --------------------------------------------------------


class _FakeWebsocket:
    def __init__(self):
        self.closed = False

    async def close(self):
        self.closed = True


async def test_close_sdk_socket_on_the_pinned_sdk_closes_the_websocket_underneath():
    from deepgram.agent.v1.socket_client import AsyncV1SocketClient

    from agent.common import close_sdk_socket

    ws = _FakeWebsocket()
    await close_sdk_socket(AsyncV1SocketClient(websocket=ws))
    assert ws.closed


async def test_close_sdk_socket_prefers_a_public_close():
    from agent.common import close_sdk_socket

    calls = []

    class Public:
        _websocket = None  # touching it would raise

        async def close(self):
            calls.append("public")

    await close_sdk_socket(Public())
    assert calls == ["public"]


def test_close_sdk_socket_is_the_only_private_close():
    from agent.common import PROJECT_ROOT

    source = (PROJECT_ROOT / "python" / "agent" / "common.py").read_text()
    assert source.count("._websocket.close()") == 1
    assert "TEMPORARY WORKAROUND" in source


@pytest.mark.parametrize("code", ["TALK_UNCONFIGURED", "TALK_PAUSED", "ONLINE_FULL", "LIVE_CLOSED"])
def test_a_workshop_refusal_is_one_line_with_its_next_step(code):
    from agent.common import STOP_CODES, TALK_MESSAGES, explain_error

    assert code in STOP_CODES
    line = explain_error({"type": "Error", "code": code, "description": "Run your program again shortly."})
    assert line == f"[workshop] Run your program again shortly. ({code})"
    # A frame without a description still says what to do.
    bare = explain_error({"type": "Error", "code": code})
    assert bare == f"[workshop] {TALK_MESSAGES[code]} ({code})" and "\n" not in bare
    assert "again" in bare or "DEEPGRAM_API_KEY" in bare


def test_the_pause_warning_is_one_workshop_line():
    from agent.common import explain_warning

    line = explain_warning({"type": "Warning", "code": "TALK_PAUSED", "description": "Workshop staff paused the live agent for a minute."})
    assert line == "[workshop] Workshop staff paused the live agent for a minute. (TALK_PAUSED)"
    assert explain_warning({"type": "Warning", "code": "FEATURE_OFF", "description": "off"}) == "Agent warning: off (FEATURE_OFF)"


async def test_run_resilient_stops_on_live_closed(monkeypatch):
    from agent.resilient import run_resilient_async

    monkeypatch.delenv("DEEPGRAM_AGENT_URL", raising=False)
    connections = []

    async def closed_proxy(ws):
        connections.append(1)
        await ws.send(json.dumps({"type": "Error", "code": "LIVE_CLOSED", "description": "closed"}))
        await ws.close(1013, "Live agent closed")

    waits = []

    async def no_wait(seconds):
        waits.append(seconds)

    async with serve(closed_proxy, "127.0.0.1", 0) as server:
        port = server.sockets[0].getsockname()[1]
        agent = await asyncio.wait_for(
            run_resilient_async(lambda: SETTINGS, url=f"ws://127.0.0.1:{port}", api_key=FAKE_KEY, interactive=False, quiet=True, sleep=no_wait),
            timeout=10,
        )
    assert agent.stop_code == "LIVE_CLOSED" and agent.close_code == 1013
    assert connections == [1] and waits == []


# ---- refusals, the pause and piped lines, end to end through run() ------------------

import os
import subprocess
import sys

def _run_script(settings: dict) -> str:
    return (
        "import sys; sys.argv = ['start.py', '--no-save']\n"
        "from agent.common import run\n"
        "run(lambda: " + repr(settings) + ")\n"
    )


async def _run_program(server, stdin: bytes = b"", settings: dict = SETTINGS):
    """Run a program through common.run() against `server`, with `stdin` piped in."""
    async with serve(server, "127.0.0.1", 0) as srv:
        port = srv.sockets[0].getsockname()[1]
        env = {**os.environ, "DEEPGRAM_API_KEY": FAKE_KEY, "DEEPGRAM_AGENT_URL": f"ws://127.0.0.1:{port}", "WORKSHOP_TOKEN": "", "WORKSHOP_URL": ""}
        proc = await asyncio.create_subprocess_exec(
            sys.executable, "-c", _run_script(settings), cwd=str(PROJECT_ROOT / "python"), env=env,
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
        )
        out, _ = await asyncio.wait_for(proc.communicate(stdin), timeout=20)
    return proc.returncode, out.decode()


@pytest.mark.parametrize("code", ["TALK_UNCONFIGURED", "TALK_PAUSED", "ONLINE_FULL", "LIVE_CLOSED"])
async def test_a_refused_session_prints_one_line_and_exits_non_zero(code):
    from agent.common import TALK_MESSAGES

    async def refusing_proxy(ws):
        await ws.send(json.dumps({"type": "Error", "code": code, "description": TALK_MESSAGES[code]}))
        await ws.close(1013, "Try again later")

    status, out = await _run_program(refusing_proxy)
    assert status == 1, out
    assert f"[workshop] {TALK_MESSAGES[code]} ({code})" in out
    assert "[closed]" not in out and "Type a line" not in out


async def test_a_staff_pause_mid_run_ends_cleanly():
    async def pausing_proxy(ws):
        await ws.send(json.dumps({"type": "Welcome", "request_id": "r"}))
        await ws.recv()
        await ws.send(json.dumps({"type": "SettingsApplied"}))
        await ws.send(json.dumps({"type": "Warning", "code": "TALK_PAUSED", "description": "Workshop staff paused the live agent for a minute. Run your program again shortly."}))
        await ws.close(1000, "Paused by staff")

    status, out = await _run_program(pausing_proxy, b"hello\n")  # a line in flight, so the end of input doesn't hang up first
    assert status == 0, out
    assert "[workshop] Workshop staff paused the live agent for a minute. Run your program again shortly. (TALK_PAUSED)" in out


async def test_piped_lines_go_one_at_a_time_and_the_end_of_input_hangs_up():
    got: list[str] = []

    async def agent_server(ws):
        await ws.send(json.dumps({"type": "Welcome", "request_id": "r"}))
        async for message in ws:
            if not isinstance(message, str):
                continue
            m = json.loads(message)
            if m["type"] == "Settings":
                await ws.send(json.dumps({"type": "SettingsApplied"}))
            elif m["type"] == "InjectUserMessage":
                got.append(m["content"])
                await asyncio.sleep(0.2)
                await ws.send(json.dumps({"type": "ConversationText", "role": "assistant", "content": f"reply {len(got)}"}))
                await ws.send(json.dumps({"type": "AgentAudioDone"}))

    status, out = await _run_program(agent_server, b"hello\n\nwhat can you do?\n")
    assert status == 0, out
    assert got == ["hello", "what can you do?"]
    assert "Reading your lines from the input" in out and "Type a line" not in out
    assert out.index("assistant: reply 1") < out.index("assistant: reply 2") < out.index("[bye] end of input, hanging up.")



async def test_piped_lines_wait_for_the_greeting_and_each_get_their_own_reply():
    # The greeting has audio, so its AgentAudioDone comes after SettingsApplied. Each piped
    # line waits for the turn before it to finish, so user and assistant lines alternate.
    loop = asyncio.get_running_loop()
    log: list[tuple[str, float]] = []

    async def agent_server(ws):
        await ws.send(json.dumps({"type": "Welcome", "request_id": "r"}))
        async for message in ws:
            if not isinstance(message, str):
                continue
            m = json.loads(message)
            if m["type"] == "Settings":
                await ws.send(json.dumps({"type": "SettingsApplied"}))
                await ws.send(json.dumps({"type": "ConversationText", "role": "assistant", "content": "Hi, I am Sam."}))
                await ws.send(b"\x00\x00" * 2400)
                await asyncio.sleep(0.4)  # the greeting is still playing
                log.append(("done", loop.time()))
                await ws.send(json.dumps({"type": "AgentAudioDone"}))
            elif m["type"] == "InjectUserMessage":
                log.append(("inject", loop.time()))
                n = sum(1 for kind, _ in log if kind == "inject")
                await ws.send(json.dumps({"type": "ConversationText", "role": "user", "content": m["content"]}))
                await ws.send(json.dumps({"type": "ConversationText", "role": "assistant", "content": f"reply {n}"}))
                await asyncio.sleep(0.2)
                log.append(("done", loop.time()))
                await ws.send(json.dumps({"type": "AgentAudioDone"}))

    settings = {**SETTINGS, "agent": {**SETTINGS["agent"], "greeting": "Hi, I am Sam."}}
    status, out = await _run_program(agent_server, b"one\ntwo\nthree\n", settings)
    assert status == 0, out
    turns = [line for line in out.splitlines() if line.startswith(("user: ", "assistant: "))]
    assert turns == [
        "assistant: Hi, I am Sam.",
        "user: one", "assistant: reply 1",
        "user: two", "assistant: reply 2",
        "user: three", "assistant: reply 3",
    ], out
    injects = [at for kind, at in log if kind == "inject"]
    dones = [at for kind, at in log if kind == "done"]
    assert len(injects) == 3 and len(dones) == 4
    for k, at in enumerate(injects):
        assert at >= dones[k], f"line {k + 1} went before turn {k} finished"
    assert out.index("assistant: reply 3") < out.index("[bye] end of input, hanging up.")


# ---- Replay lines, credentials, where to edit ------------


def test_replayed_lines_say_they_are_a_recording_and_errors_say_on_purpose():
    from agent.common import REPLAY_ERROR_NOTE, event_line

    err = {"type": "Error", "code": "INVALID_SETTINGS", "description": "Voice Agent component 'speak' is not authorized."}
    line = event_line(err, replay=True)
    assert line.startswith("[replay] Agent error: ")
    assert line.endswith(REPLAY_ERROR_NOTE)
    assert event_line(err) == "Agent error: Voice Agent component 'speak' is not authorized. (INVALID_SETTINGS)"
    assert event_line({"type": "SettingsApplied"}, replay=True) == "[replay] [ready] the agent has your settings."
    assert event_line({"type": "ConversationText", "role": "user", "content": " "}, replay=True) is None


def test_credentials_problem_and_the_credentials_note(monkeypatch):
    from agent.common import NO_CREDENTIALS, credentials_note, credentials_problem, no_credentials_line

    monkeypatch.delenv("DEEPGRAM_API_KEY", raising=False)
    monkeypatch.delenv("WORKSHOP_TOKEN", raising=False)
    monkeypatch.delenv("DEEPGRAM_AGENT_URL", raising=False)
    monkeypatch.setenv("WORKSHOP_URL", "wss://speak.example.test/sdk")
    assert credentials_problem() == no_credentials_line()
    assert credentials_problem(mission="03-no-dead-air") == no_credentials_line("03-no-dead-air")
    assert credentials_problem("explicit-key") is None
    # With no .env: copy it. With one (make setup's, key empty): set the key in it. Both name
    # the folder, the token lines, the /code page and the offline check with its number.
    missing = no_credentials_line("03-no-dead-air", has_env=False)
    assert missing == NO_CREDENTIALS
    assert missing.startswith("No Deepgram credentials. Copy .env.example to .env")
    empty = no_credentials_line("03-no-dead-air", has_env=True)
    assert empty == (
        "DEEPGRAM_API_KEY is empty in .env (this folder). Set it, or paste WORKSHOP_URL and WORKSHOP_TOKEN "
        "from the workshop's /code page. make check 03 runs offline with no key."
    )
    assert "Copy" not in empty
    assert no_credentials_line(has_env=True).endswith("make check NN runs offline with no key.")
    assert credentials_note() is None
    monkeypatch.setenv("WORKSHOP_TOKEN", "wst_unit-test-token")
    assert credentials_problem() is None
    assert credentials_note() is None
    monkeypatch.setenv("DEEPGRAM_API_KEY", FAKE_KEY)
    note = credentials_note()
    assert note == (
        "[credentials] Using your workshop token (the proxy); your DEEPGRAM_API_KEY is set too "
        "and waits for after the event. To run on it now, leave WORKSHOP_TOKEN empty."
    )
    monkeypatch.setenv("WORKSHOP_URL", "")
    note = credentials_note()
    assert note == "[credentials] Using your DEEPGRAM_API_KEY; your workshop token is not used because WORKSHOP_URL is empty."
    monkeypatch.setenv("DEEPGRAM_AGENT_URL", "wss://agent.example.test")
    assert credentials_note() == "[credentials] Using your DEEPGRAM_API_KEY; your workshop token is not used because DEEPGRAM_AGENT_URL is set."
    assert FAKE_KEY not in note and "wst_unit-test-token" not in note


async def test_a_message_the_sdk_cant_model_goes_out_raw_with_one_note(capsys):
    # Mission 03's thinking provider is newer than deepgram-sdk 7.12.0's models: the same
    # JSON goes out raw, and one [note] line says so, once per message type (Java prints
    # the same line; RunTest and TypedCoverageTest pin it there).
    from agent.common import Agent

    class FakeSocket:
        def __init__(self) -> None:
            self.raw: list[dict] = []

        async def _send(self, message: dict) -> None:
            self.raw.append(message)

        async def send_update_think(self, typed: object) -> None:
            raise AssertionError("a message the SDK can't model must go out raw, not typed")

    sock = FakeSocket()
    agent = Agent(sock)
    think = {"provider": {"type": "deepgram", "model": "a-model-id", "reasoning_mode": "none"}, "prompt": "Be brief."}
    await agent.update_think(think)
    await agent.update_think(think)
    assert sock.raw == [{"type": "UpdateThink", "think": think}] * 2, "the JSON arrives intact"
    assert capsys.readouterr().out == (
        "[note] UpdateThink sent as raw JSON: this SDK release has no field for part of it (the check reads it the same)\n"
    )
    await Agent(FakeSocket(), quiet=True).update_think(think)
    assert capsys.readouterr().out == ""


from agent.common import PROJECT_ROOT  # noqa: E402

MISSION_00_TEST = str(PROJECT_ROOT / "python" / "missions" / "00-first-words" / "test_00.py")


def test_where_to_edit_points_at_the_first_failing_todo(monkeypatch):
    from agent.testing import where_to_edit

    monkeypatch.delenv("MISSION_TARGET", raising=False)
    line = where_to_edit(MISSION_00_TEST, "  PASS  TODO 1: ok\n  FAIL  TODO 2: you picked a voice")
    assert line.startswith("Your file: python/missions/00-first-words/start.py:")
    assert line.endswith("(TODO 2)")
    n = int(line.split(":")[2].split(" ")[0])
    text = (PROJECT_ROOT / "python" / "missions" / "00-first-words" / "start.py").read_text().splitlines()
    assert "TODO 2" in text[n - 1]
    # No TODO in the report (a wrong `version`, say): the line of build_settings(), where the Settings are.
    fallback = where_to_edit(MISSION_00_TEST, "  FAIL  agent.speak.provider: aura-2-thalia-en is an Aura voice")
    assert fallback.startswith("Your file: python/missions/00-first-words/start.py:") and fallback.endswith(" (build_settings())")
    n = int(fallback.split(":")[2].split(" ")[0])
    assert text[n - 1].startswith("def build_settings")


def test_where_to_edit_falls_back_to_build_settings_when_the_todo_comment_is_gone(monkeypatch, tmp_path):
    from agent import testing

    mission = tmp_path / "python" / "missions" / "00-first-words"
    mission.mkdir(parents=True)
    test_file = mission / "test_00.py"
    test_file.write_text("", encoding="utf-8")
    (mission / "start.py").write_text('PROMPT = "x"\n\n\ndef build_settings():\n    return {}\n', encoding="utf-8")
    monkeypatch.setattr(testing, "PROJECT_ROOT", tmp_path)
    monkeypatch.delenv("MISSION_TARGET", raising=False)
    line = testing.where_to_edit(str(test_file), "  FAIL  TODO 2: you picked a voice")
    assert line == "Your file: python/missions/00-first-words/start.py:4 (TODO 2; its # TODO comment is gone, so start at build_settings())"
    assert testing.where_to_edit(str(test_file), "  FAIL  something else") == "Your file: python/missions/00-first-words/start.py:4 (build_settings())"
    assert testing.where_to_edit(str(test_file), "No Deepgram credentials. Copy...") == "Your file: python/missions/00-first-words/start.py"
    (mission / "start.py").write_text("x = 1\n", encoding="utf-8")
    assert testing.where_to_edit(str(test_file), "  FAIL  TODO 2: gone") == "Your file: python/missions/00-first-words/start.py"


@pytest.mark.parametrize("has_env", [True, False], ids=["env-with-empty-key", "no-env"])
def test_a_live_check_with_no_credentials_fails_at_once(monkeypatch, tmp_path, has_env):
    """Both forms of the first line, by whether .env exists, on a stand-in project folder: CI's
    matrix jobs run make setup-py (no .env), every other job make setup (one with an empty key)."""
    import time

    from agent import testing
    from agent.common import NO_CREDENTIALS, no_credentials_line

    monkeypatch.setattr("agent.common.PROJECT_ROOT", tmp_path)  # load_env and dotenv_exists read it at call time
    monkeypatch.delenv("PYTHON_DOTENV_DISABLED", raising=False)
    if has_env:
        (tmp_path / ".env").write_text("DEEPGRAM_API_KEY=\n", encoding="utf-8")  # what make setup leaves
    for name in ("DEEPGRAM_API_KEY", "WORKSHOP_TOKEN"):
        monkeypatch.setenv(name, "")  # set and empty, so .env can't fill it in
    started = time.monotonic()
    verdict = asyncio.run(testing.check_live(MISSION_00_TEST, None))
    assert time.monotonic() - started < 2
    assert not verdict.passed
    first, second = verdict.report.split("\n")
    assert first == no_credentials_line("00-first-words", has_env=has_env)
    if has_env:
        assert first.endswith("make check 00 runs offline with no key.")
    else:
        assert first == NO_CREDENTIALS
    assert second.startswith("make live talks to the real agent") and "make check 00" in second


# ---- MIC=1 on a machine with no audio device (Codespaces, a container) ---------

import types
from typing import Any


def _fake_sounddevice(monkeypatch, *, fail_on: str):
    """A stand-in `sounddevice` whose streams raise PortAudioError the way PortAudio
    does with no device: on opening ("open") or on starting ("start")."""
    sd: Any = types.ModuleType("sounddevice")

    class PortAudioError(Exception):
        pass

    class Stream:
        def __init__(self, *args, **kwargs):
            if fail_on == "open":
                raise PortAudioError("Error querying device -1")

        def start(self):
            if fail_on == "start":
                raise PortAudioError("Error starting stream")

        def stop(self):
            pass

        def close(self):
            pass

    sd.PortAudioError = PortAudioError
    sd.RawInputStream = Stream
    sd.RawOutputStream = Stream
    monkeypatch.setitem(sys.modules, "sounddevice", sd)


@pytest.mark.parametrize("fail_on", ["open", "start"])
async def test_no_audio_device_is_one_setup_line(monkeypatch, fail_on):
    from agent.common import NO_AUDIO_DEVICE, MicAndSpeaker

    _fake_sounddevice(monkeypatch, fail_on=fail_on)
    with pytest.raises(SetupError) as err:
        MicAndSpeaker(asyncio.get_running_loop()).start()
    assert str(err.value) == NO_AUDIO_DEVICE == "No microphone or speakers found here; type your turns instead (drop MIC=1)."


def _no_portaudio(monkeypatch):
    """`import sounddevice` raises OSError, as on Linux without the PortAudio library."""
    import importlib.abc
    import importlib.util

    class NoPortAudio(importlib.abc.MetaPathFinder, importlib.abc.Loader):
        def find_spec(self, name, path=None, target=None):
            return importlib.util.spec_from_loader(name, self) if name == "sounddevice" else None

        def create_module(self, spec):
            return None

        def exec_module(self, module):
            raise OSError("PortAudio library not found")

    monkeypatch.delitem(sys.modules, "sounddevice", raising=False)
    monkeypatch.setattr(sys, "meta_path", [NoPortAudio(), *sys.meta_path])


async def test_no_portaudio_library_names_the_package(monkeypatch):
    """On a Linux machine without the PortAudio library, the line names the package
    to install, not a missing device."""
    from agent import common
    from agent.common import NO_PORTAUDIO, MicAndSpeaker

    _no_portaudio(monkeypatch)
    monkeypatch.setattr(common, "_no_host_audio", lambda: False)  # CI may run in a container
    with pytest.raises(SetupError) as err:
        MicAndSpeaker(asyncio.get_running_loop())
    assert str(err.value) == NO_PORTAUDIO
    assert "sudo apt install libportaudio2" in NO_PORTAUDIO and "sudo dnf install portaudio" in NO_PORTAUDIO


def _only_markers(monkeypatch, *markers: str) -> None:
    """os.path.exists sees exactly these container markers (and no real ones), with
    CODESPACES and WSL_DISTRO_NAME unset."""
    from agent import common

    real_exists = os.path.exists
    known = {"/run/.toolboxenv", "/run/.containerenv", "/.dockerenv"}
    monkeypatch.setattr(common.os.path, "exists", lambda p: p in markers if p in known else real_exists(p))
    monkeypatch.delenv("CODESPACES", raising=False)
    monkeypatch.delenv("WSL_DISTRO_NAME", raising=False)


@pytest.mark.parametrize("env", ["CODESPACES", "WSL_DISTRO_NAME"])
async def test_no_portaudio_in_codespaces_or_wsl_is_the_no_device_line(monkeypatch, env):
    """In Codespaces or WSL, installing PortAudio brings no device: type your turns."""
    from agent.common import NO_AUDIO_DEVICE, MicAndSpeaker

    _no_portaudio(monkeypatch)
    _only_markers(monkeypatch)
    monkeypatch.setenv(env, "Ubuntu-24.04" if env == "WSL_DISTRO_NAME" else "true")
    with pytest.raises(SetupError) as err:
        MicAndSpeaker(asyncio.get_running_loop())
    assert str(err.value) == NO_AUDIO_DEVICE


@pytest.mark.parametrize("marker", ["/.dockerenv", "/run/.containerenv"])
async def test_no_portaudio_in_docker_or_podman_is_the_no_device_line(monkeypatch, marker):
    """Docker and Dev Containers (/.dockerenv) or Podman (/run/.containerenv): no device either."""
    from agent.common import NO_AUDIO_DEVICE, MicAndSpeaker

    _no_portaudio(monkeypatch)
    _only_markers(monkeypatch, marker)
    with pytest.raises(SetupError) as err:
        MicAndSpeaker(asyncio.get_running_loop())
    assert str(err.value) == NO_AUDIO_DEVICE


async def test_no_portaudio_in_a_toolbox_names_the_package(monkeypatch):
    """A Fedora toolbox or a distrobox is a Podman container (/run/.containerenv) that writes
    /run/.toolboxenv and shares the host's audio, so the line names the package to install."""
    from agent.common import NO_PORTAUDIO, MicAndSpeaker

    _no_portaudio(monkeypatch)
    _only_markers(monkeypatch, "/run/.toolboxenv", "/run/.containerenv")
    with pytest.raises(SetupError) as err:
        MicAndSpeaker(asyncio.get_running_loop())
    assert str(err.value) == NO_PORTAUDIO


async def test_no_audio_device_stops_before_the_call_connects(monkeypatch):
    from agent.common import run_async

    _fake_sounddevice(monkeypatch, fail_on="open")
    connections = []

    async def agent_server(ws):
        connections.append(1)
        await ws.close()

    async with serve(agent_server, "127.0.0.1", 0) as server:
        port = server.sockets[0].getsockname()[1]
        with pytest.raises(SetupError, match="No microphone or speakers found here"):
            await run_async(lambda: SETTINGS, url=f"ws://127.0.0.1:{port}", api_key=FAKE_KEY, interactive=False, quiet=True, mic=True)
    assert connections == []


# ---- closing lines: your program hung up, and a call with no audio --------------------


async def test_a_hang_up_from_your_code_and_a_call_without_audio_each_get_one_line():
    from agent.common import HUNG_UP_LINE, NO_AUDIO_LINE

    async def agent_server(ws):
        await ws.send(json.dumps({"type": "Welcome", "request_id": "r"}))
        async for message in ws:
            if isinstance(message, str) and json.loads(message)["type"] == "Settings":
                await ws.send(json.dumps({"type": "SettingsApplied"}))
                await ws.send(json.dumps({"type": "ConversationText", "role": "assistant", "content": "Bye now."}))

    script = (
        "import sys; sys.argv = ['start.py']\n"  # saving on: no audio comes, so nothing is written
        "from agent.common import run\n"
        "async def on_event(agent, event):\n"
        "    if event.get('type') == 'ConversationText':\n"
        "        await agent.close()\n"
        "run(lambda: " + repr(SETTINGS) + ", on_event)\n"
    )
    async with serve(agent_server, "127.0.0.1", 0) as srv:
        port = srv.sockets[0].getsockname()[1]
        env = {**os.environ, "DEEPGRAM_API_KEY": FAKE_KEY, "DEEPGRAM_AGENT_URL": f"ws://127.0.0.1:{port}", "WORKSHOP_TOKEN": "", "WORKSHOP_URL": ""}
        proc = await asyncio.create_subprocess_exec(
            sys.executable, "-c", script, cwd=str(PROJECT_ROOT / "python"), env=env,
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
        )
        out, _ = await asyncio.wait_for(proc.communicate(b"hello\n"), timeout=20)
    text = out.decode()
    assert proc.returncode == 0, text
    assert text.count(HUNG_UP_LINE) == 1 and "end of input" not in text, text
    assert text.index(HUNG_UP_LINE) < text.index(NO_AUDIO_LINE), text


async def test_the_end_of_input_says_bye_once():
    from agent.common import HUNG_UP_LINE

    async def agent_server(ws):
        await ws.send(json.dumps({"type": "Welcome", "request_id": "r"}))
        async for message in ws:
            if isinstance(message, str) and json.loads(message)["type"] == "Settings":
                await ws.send(json.dumps({"type": "SettingsApplied"}))

    status, out = await _run_program(agent_server, b"")
    assert status == 0, out
    assert "[bye] end of input, hanging up." in out and HUNG_UP_LINE not in out
    assert "[no audio]" not in out  # --no-save: nothing to save, nothing to say


async def test_an_unreachable_proxy_is_one_plain_line(monkeypatch):
    from agent.common import run_async, unreachable_line

    assert unreachable_line(OSError("Multiple exceptions: [Errno 61] Connect call failed ('::1', 9), [Errno 61] Connect call failed ('127.0.0.1', 9)"), True) == (
        "Could not reach the agent: connection refused. Check WORKSHOP_URL. Is the workshop site up?"
    )
    monkeypatch.delenv("DEEPGRAM_API_KEY", raising=False)
    monkeypatch.setenv("DEEPGRAM_AGENT_URL", "")  # set and empty, so .env can't fill it in
    monkeypatch.setenv("WORKSHOP_TOKEN", "wst_unreachable-test-token-0000")
    monkeypatch.setenv("WORKSHOP_URL", "ws://127.0.0.1:9/sdk")  # nothing listens on port 9
    with pytest.raises(SetupError) as err:
        await run_async(lambda: SETTINGS, interactive=False, quiet=True, mission="00-first-words")
    assert str(err.value) == "Could not reach the agent: connection refused. Check WORKSHOP_URL. Is the workshop site up?"


async def test_a_piped_turn_with_a_slow_tool_waits_for_the_reply_after_your_answer():
    # Mission 03's shape: a filler line, then a slow tool inside on_event, then the answer.
    # The filler's AgentAudioDone must not send the next piped line.
    log: list[str] = []

    async def agent_server(ws):
        async def say(content, ms=0.2):
            await ws.send(json.dumps({"type": "ConversationText", "role": "assistant", "content": content}))
            await asyncio.sleep(ms)
            log.append(f"done {content}")
            await ws.send(json.dumps({"type": "AgentAudioDone"}))

        await ws.send(json.dumps({"type": "Welcome", "request_id": "r"}))
        async for message in ws:
            if not isinstance(message, str):
                continue
            m = json.loads(message)
            if m["type"] == "Settings":
                await ws.send(json.dumps({"type": "SettingsApplied"}))
            elif m["type"] == "InjectUserMessage":
                log.append(f"user {m['content']}")
                if m["content"].startswith("delete"):
                    await ws.send(json.dumps({"type": "FunctionCallRequest", "functions": [{"id": "fc_1", "name": "deleteItem", "arguments": "{}", "client_side": True}]}))
                else:
                    asyncio.create_task(say(f"reply to {m['content']}"))
            elif m["type"] == "InjectAgentMessage":
                asyncio.create_task(say(m["message"]))
            elif m["type"] == "FunctionCallResponse":
                log.append("answered")
                asyncio.create_task(say("Deleted it.", 0.5))
            elif m["type"] == "AgentAudioDone":
                pass

    script = (
        "import asyncio, sys; sys.argv = ['start.py', '--no-save']\n"
        "from agent.common import run\n"
        "async def on_event(agent, event):\n"
        "    if event.get('type') == 'FunctionCallRequest':\n"
        "        await agent.inject_agent_message('One second.', behavior='queue')\n"
        "        await asyncio.sleep(1)\n"  # the slow tool, holding the loop as mission 03 does
        "        await agent.function_call_response('fc_1', 'deleteItem', 'done')\n"
        "run(lambda: " + repr(SETTINGS) + ", on_event)\n"
    )
    async with serve(agent_server, "127.0.0.1", 0) as srv:
        port = srv.sockets[0].getsockname()[1]
        env = {**os.environ, "DEEPGRAM_API_KEY": FAKE_KEY, "DEEPGRAM_AGENT_URL": f"ws://127.0.0.1:{port}", "WORKSHOP_TOKEN": "", "WORKSHOP_URL": ""}
        proc = await asyncio.create_subprocess_exec(
            sys.executable, "-c", script, cwd=str(PROJECT_ROOT / "python"), env=env,
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
        )
        out, _ = await asyncio.wait_for(proc.communicate(b"delete buy milk\nwhat is left\nbye now\n"), timeout=30)
    text = out.decode()
    assert proc.returncode == 0, text
    assert log == [
        "user delete buy milk", "done One second.", "answered", "done Deleted it.",
        "user what is left", "done reply to what is left", "user bye now", "done reply to bye now",
    ], text


# ---- a harness that can't run: its own line reaches the check ---------------------


def test_replay_scenarios_passes_on_the_harness_line(monkeypatch, tmp_path):
    """A harness on a Node.js outside its range exits 2 with one line; pytest collection
    shows that line, not a CalledProcessError."""
    from pathlib import Path

    from agent import testing

    real = Path(testing.HARNESS).parent / "lib" / "node-version.mjs"
    fake = tmp_path / "replay-server" / "harness.mjs"
    (fake.parent / "node_modules").mkdir(parents=True)
    fake.write_text(
        f"import {{ nodeTooOld }} from {json.dumps(real.as_uri())};\n"
        "console.error(nodeTooOld('v18.19.1'));\nprocess.exit(2);\n"
    )
    monkeypatch.setattr(testing, "HARNESS", fake)
    testing._node()  # no Node.js at all: fail here, on the checks' own sentence
    with pytest.raises(RuntimeError) as err:
        testing.replay_scenarios(str(testing.PROJECT_ROOT / "python" / "missions" / "00-first-words" / "test_00.py"))
    assert str(err.value).startswith("The checks need Node.js 20.19+ or 22.12+ (you have v18.19.1).")


@pytest.mark.parametrize(
    ("script", "how"),
    [("process.exit(3);", "exit 3"), ("process.kill(process.pid, 'SIGKILL');", "signal 9")],
)
def test_replay_scenarios_with_a_silent_harness_says_what_to_do(monkeypatch, tmp_path, script, how):
    """A harness that stops with no output (an exit code, or killed by a signal) still gives a line."""
    from agent import testing

    fake = tmp_path / "replay-server" / "harness.mjs"
    (fake.parent / "node_modules").mkdir(parents=True)
    fake.write_text(script + "\n")
    monkeypatch.setattr(testing, "HARNESS", fake)
    testing._node()  # no Node.js at all: fail here, on the checks' own sentence
    with pytest.raises(RuntimeError) as err:
        testing.replay_scenarios(str(testing.PROJECT_ROOT / "python" / "missions" / "00-first-words" / "test_00.py"))
    assert str(err.value) == f"The check harness stopped ({how}) without a message. Run make setup, then try again."


def test_no_node_line_matches_the_makefile(monkeypatch):
    """No Node.js at all: the same words as the Makefile's line, with "you have none"."""
    from agent import testing

    makefile = (testing.PROJECT_ROOT / "Makefile").read_text(encoding="utf-8")
    line = next(ln for ln in makefile.splitlines() if ln.startswith("MSG_NODE_OLD = "))
    expected = line[len("MSG_NODE_OLD = "):].replace("$$(node -v 2>/dev/null || echo none)", "none")
    assert "$" not in expected, expected
    monkeypatch.setattr(testing.shutil, "which", lambda name: None)
    with pytest.raises(RuntimeError) as err:
        testing._node()
    assert str(err.value) == expected


# ---- a key or token with a character a header can't carry ----------------------------
# Test characters are built from code points, so this file stays ASCII.

LQ, RQ = chr(0x201C), chr(0x201D)  # curly quotes, as a chat or a doc pastes them
MARKER = "leakprobe0123456789abcdef"
KEY_LINE = (
    "DEEPGRAM_API_KEY has a character a key can't have (a curly quote or a hidden space, "
    "often from copy and paste). Copy it again as plain text."
)
TOKEN_LINE = (
    "WORKSHOP_TOKEN has a character a token can't have (a curly quote or a hidden space, "
    "often from copy and paste). Copy it again as plain text."
)
GOOD_TOKEN = "wst_" + "AZaz09-_" * 6


def _bad_values(value: str, short: str) -> list:
    """Values a header can't carry, after Python's strip(): each stops with the line."""
    mid = len(value) // 2
    return [
        pytest.param(LQ + value + RQ, id="curly-quoted"),
        pytest.param(LQ + short + RQ, id="short-curly-quoted"),
        pytest.param(value[:mid] + chr(0x00A0) + value[mid:], id="inner-no-break-space"),
        pytest.param(value + chr(0x200B), id="trailing-zero-width-space"),
        pytest.param(value[:mid] + " " + value[mid:], id="inner-space"),
        pytest.param(value[:mid] + "\t" + value[mid:], id="inner-tab"),
        pytest.param(chr(0xFEFF) + value, id="leading-byte-order-mark"),  # strip() keeps U+FEFF
    ]


def _set_credentials(monkeypatch, **values: str) -> None:
    """Set all four credential variables, "" for the unused ones, so a developer's .env
    (load_env never overrides) can't fill any of them in."""
    for name in ("DEEPGRAM_API_KEY", "DEEPGRAM_AGENT_URL", "WORKSHOP_TOKEN", "WORKSHOP_URL"):
        monkeypatch.setenv(name, values.get(name, ""))


def _clean_env(**values: str) -> dict:
    """os.environ without any DEEPGRAM_*/WORKSHOP_* value, all four credentials set
    ("" when unused)."""
    env = {k: v for k, v in os.environ.items() if not k.startswith(("DEEPGRAM_", "WORKSHOP_"))}
    env.update(DEEPGRAM_API_KEY="", DEEPGRAM_AGENT_URL="", WORKSHOP_TOKEN="", WORKSHOP_URL="")
    env.update(values)
    return env


def _assert_never_printed(text: str) -> None:
    assert MARKER not in text and "abc" + RQ not in text, text
    assert LQ not in text and RQ not in text, text
    assert "Traceback" not in text, text


class _Counter:
    """A local TCP listener that counts connections and closes each one. A regression
    would connect here, never to Deepgram or the workshop proxy."""

    def __init__(self) -> None:
        self.sock = socket.socket()
        self.sock.bind(("127.0.0.1", 0))
        self.sock.listen(16)
        self.port = self.sock.getsockname()[1]
        self.count = 0
        threading.Thread(target=self._accept, daemon=True).start()

    def _accept(self) -> None:
        while True:
            try:
                conn, _ = self.sock.accept()
            except OSError:
                return
            self.count += 1
            conn.close()

    def connections(self) -> int:
        time.sleep(0.2)  # let a connection that is on its way be counted
        return self.count


@pytest.fixture
def counter():
    listener = _Counter()
    yield listener
    listener.sock.close()


@pytest.mark.parametrize("key", _bad_values(FAKE_KEY, "abc"))
def test_a_key_with_a_character_a_header_cant_carry_stops_before_connecting(monkeypatch, capsys, key):
    _set_credentials(monkeypatch, DEEPGRAM_API_KEY=key, DEEPGRAM_AGENT_URL="ws://127.0.0.1:9")
    with pytest.raises(SetupError) as err:
        make_client()
    assert str(err.value) == KEY_LINE
    assert err.value.retryable is False
    assert key.strip() not in str(err.value)
    assert capsys.readouterr() == ("", "")


@pytest.mark.parametrize("token", _bad_values(GOOD_TOKEN, "wst_abc"))
def test_a_token_with_a_character_a_header_cant_carry_stops_before_connecting(monkeypatch, capsys, token):
    _set_credentials(monkeypatch, WORKSHOP_TOKEN=token, WORKSHOP_URL="ws://127.0.0.1:9/sdk")
    with pytest.raises(SetupError) as err:
        make_client(mission="00-first-words")
    assert str(err.value) == TOKEN_LINE
    assert err.value.retryable is False
    assert token.strip() not in str(err.value)
    assert capsys.readouterr() == ("", "")


def test_valid_keys_and_tokens_pass_the_character_check(monkeypatch):
    from agent.testing import REPLAY_KEY

    # Edge whitespace from a paste is stripped first (Python's strip(): U+0085 and U+3000 too).
    for key in (FAKE_KEY, "  " + FAKE_KEY + chr(0x00A0) + "\n", chr(0x85) + FAKE_KEY + chr(0x3000)):
        _set_credentials(monkeypatch, DEEPGRAM_API_KEY=key, DEEPGRAM_AGENT_URL="ws://127.0.0.1:9")
        assert make_client()._client_wrapper.get_headers()["Authorization"] == f"Token {FAKE_KEY}"
    for token in (GOOD_TOKEN, "aaa.bbb.ccc"):
        _set_credentials(monkeypatch, WORKSHOP_TOKEN=token, WORKSHOP_URL="wss://speak.example.test/sdk")
        assert make_client(mission="00-first-words")._client_wrapper.get_headers()["Authorization"].lower() == f"bearer {token}".lower()
    # Only the credential actually sent is checked: an unused bad key never blocks the token...
    _set_credentials(monkeypatch, DEEPGRAM_API_KEY=LQ + FAKE_KEY + RQ, WORKSHOP_TOKEN=GOOD_TOKEN, WORKSHOP_URL="wss://speak.example.test/sdk")
    assert make_client(mission="00-first-words")._client_wrapper.get_headers()["Authorization"].lower() == f"bearer {GOOD_TOKEN}".lower()
    # ...nor an explicit key (make check sends REPLAY_KEY).
    _set_credentials(monkeypatch, DEEPGRAM_API_KEY=LQ + FAKE_KEY + RQ)
    assert make_client(url="ws://127.0.0.1:9", api_key=REPLAY_KEY)._client_wrapper.get_headers()["Authorization"] == f"Token {REPLAY_KEY}"


def test_redact_masks_an_invalid_authorization_header_line(monkeypatch):
    _set_credentials(monkeypatch)
    assert redact(f"invalid Authorization header: Token {LQ}abc{RQ}") == "invalid Authorization header: [redacted]"
    assert redact(f"invalid Authorization header: Bearer {LQ}wst_abc{RQ}") == "invalid Authorization header: [redacted]"
    # A message that ends in the header name: the next line is something else, and stays.
    assert redact("invalid Authorization header:\nToken shown") == "invalid Authorization header:[redacted]\nToken shown"
    assert redact("invalid Authorization header:\nBearer shown") == "invalid Authorization header:[redacted]\nBearer shown"


_RESILIENT_SCRIPT = (
    "import sys; sys.argv = ['start.py', '--no-save']\n"
    "from agent.resilient import run_resilient\n"
    "run_resilient(lambda: {})\n"
)


@pytest.mark.parametrize("mode", ["key", "token", "run_resilient"])
def test_make_run_with_a_bad_key_or_token_prints_the_line_and_never_connects(counter, mode):
    """`make run 00`: exit 2, exactly the line, no traceback, the value never printed,
    no connection."""
    url = f"ws://127.0.0.1:{counter.port}"
    if mode == "token":
        env, line = _clean_env(WORKSHOP_TOKEN=LQ + "wst_" + MARKER + RQ, WORKSHOP_URL=f"{url}/sdk"), TOKEN_LINE
    else:
        env, line = _clean_env(DEEPGRAM_API_KEY=LQ + MARKER + RQ, DEEPGRAM_AGENT_URL=url), KEY_LINE
    program = ["-c", _RESILIENT_SCRIPT] if mode == "run_resilient" else [str(PROJECT_ROOT / "python" / "missions" / "00-first-words" / "start.py"), "--no-save"]
    run = subprocess.run(
        [sys.executable, *program], cwd=str(PROJECT_ROOT / "python"), env=env,
        stdin=subprocess.DEVNULL, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=30,
    )
    assert run.returncode == 2, run.stdout + run.stderr
    assert run.stderr.strip() == line
    _assert_never_printed(run.stdout + run.stderr)
    assert counter.connections() == 0


async def test_a_crash_in_your_program_prints_its_traceback_with_the_key_masked():
    script = (
        "import os, sys; sys.argv = ['start.py', '--no-save']\n"
        "from agent.common import run\n"
        "def build_settings():\n"
        "    raise RuntimeError('Authorization: Token ' + os.environ['DEEPGRAM_API_KEY'])\n"
        "run(build_settings)\n"
    )

    async def welcome(ws):
        await ws.send(json.dumps({"type": "Welcome", "request_id": "r"}))
        async for _ in ws:
            pass

    async with serve(welcome, "127.0.0.1", 0) as srv:
        port = srv.sockets[0].getsockname()[1]
        proc = await asyncio.create_subprocess_exec(
            sys.executable, "-c", script, cwd=str(PROJECT_ROOT / "python"),
            env=_clean_env(DEEPGRAM_API_KEY=FAKE_KEY, DEEPGRAM_AGENT_URL=f"ws://127.0.0.1:{port}"),
            stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        )
        out, err = await asyncio.wait_for(proc.communicate(), timeout=20)
    stderr = err.decode()
    assert proc.returncode == 1, out.decode() + stderr
    assert "Traceback" in stderr  # your own bug keeps its traceback
    assert "RuntimeError: Authorization: [redacted]" in stderr
    assert FAKE_KEY not in out.decode() + stderr


async def test_a_crash_through_run_resilient_prints_its_traceback_with_the_key_masked():
    script = (
        "import os, sys; sys.argv = ['start.py', '--no-save']\n"
        "from agent.resilient import run_resilient\n"
        "def build_settings():\n"
        "    raise RuntimeError('Authorization: Token ' + os.environ['DEEPGRAM_API_KEY'])\n"
        "run_resilient(build_settings)\n"
    )

    async def welcome(ws):
        await ws.send(json.dumps({"type": "Welcome", "request_id": "r"}))
        async for _ in ws:
            pass

    async with serve(welcome, "127.0.0.1", 0) as srv:
        port = srv.sockets[0].getsockname()[1]
        proc = await asyncio.create_subprocess_exec(
            sys.executable, "-c", script, cwd=str(PROJECT_ROOT / "python"),
            env=_clean_env(DEEPGRAM_API_KEY=FAKE_KEY, DEEPGRAM_AGENT_URL=f"ws://127.0.0.1:{port}"),
            stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        )
        out, err = await asyncio.wait_for(proc.communicate(), timeout=20)
    stderr = err.decode()
    assert proc.returncode == 1, out.decode() + stderr
    assert "Traceback" in stderr  # your own bug keeps its traceback
    assert "RuntimeError: Authorization: [redacted]" in stderr
    assert FAKE_KEY not in out.decode() + stderr


async def test_make_live_with_a_bad_key_says_only_the_key_line_and_never_connects(monkeypatch, counter):
    from agent.testing import check_live, load_target

    # DEEPGRAM_AGENT_URL is where the harness's live upstream goes: the counting listener.
    _set_credentials(monkeypatch, DEEPGRAM_API_KEY=LQ + MARKER + RQ, DEEPGRAM_AGENT_URL=f"ws://127.0.0.1:{counter.port}")
    verdict = await check_live(MISSION_00_TEST, load_target(MISSION_00_TEST))
    assert not verdict.passed
    assert verdict.report == KEY_LINE  # the line ends on its own fix: no live hint after it
    assert counter.connections() == 0


async def test_make_check_sends_the_replay_key_so_a_bad_key_in_env_never_blocks_it(monkeypatch, counter):
    from agent.testing import check_replay, load_target, replay_scenarios

    monkeypatch.setenv("MISSION_TARGET", "solution")
    _set_credentials(monkeypatch, DEEPGRAM_API_KEY=LQ + MARKER + RQ, DEEPGRAM_AGENT_URL=f"ws://127.0.0.1:{counter.port}")
    module = load_target(MISSION_00_TEST)
    for scenario in replay_scenarios(MISSION_00_TEST):
        verdict = await check_replay(MISSION_00_TEST, module, scenario)
        assert verdict.passed, verdict.report
    assert counter.connections() == 0


# ---- An address that isn't one --------------------------------------------------

ADDRESSES = json.loads((PROJECT_ROOT / "tools" / "parity" / "addresses.json").read_text(encoding="utf-8"))


def test_the_address_check_reads_the_shared_table():
    """tools/parity/addresses.json: the same rows pass and fail in TypeScript, Java and the harness."""
    from agent.common import BAD_AGENT_URL, BAD_WORKSHOP_URL, agent_base_url, valid_address

    assert [u for u in ADDRESSES["valid"] if not valid_address(u)] == []
    assert [u for u in ADDRESSES["invalid"] if valid_address(u)] == []
    for raw, want in ADDRESSES["agent"]:
        if want is None:
            with pytest.raises(SetupError) as err:
                agent_base_url(raw)
            assert str(err.value) == BAD_AGENT_URL, raw
        else:
            assert agent_base_url(raw) == want, raw
    for raw, want in ADDRESSES["workshop"]:
        if want is None:
            with pytest.raises(SetupError) as err:
                workshop_base_url(raw)
            assert str(err.value) == BAD_WORKSHOP_URL, raw
        else:
            assert workshop_base_url(raw) == want, raw


@pytest.mark.parametrize("mode", ["key", "token", "run_resilient"])
@pytest.mark.parametrize("bad", [":abc", "/a b"], ids=["port-abc", "space-in-path"])
def test_make_run_with_an_address_that_isnt_one_says_so_and_never_connects(counter, mode, bad):
    """`make run 00`: exit 2, exactly the line, no traceback, the address never printed, no
    connection: `:abc` exits 2 with one line, never a traceback, and a space in the path never connects."""
    from agent.common import BAD_AGENT_URL, BAD_WORKSHOP_URL

    url = "ws://127.0.0.1" + (bad if bad == ":abc" else f":{counter.port}{bad}")
    if mode == "token":
        env, line = _clean_env(WORKSHOP_TOKEN="wst_" + MARKER, WORKSHOP_URL=f"{url}/sdk"), BAD_WORKSHOP_URL
    else:
        env, line = _clean_env(DEEPGRAM_API_KEY=MARKER, DEEPGRAM_AGENT_URL=url), BAD_AGENT_URL
    start = PROJECT_ROOT / "python" / "missions" / "00-first-words" / "start.py"
    program = ["-c", _RESILIENT_SCRIPT] if mode == "run_resilient" else [str(start), "--no-save"]
    run = subprocess.run(
        [sys.executable, *program], cwd=str(PROJECT_ROOT / "python"), env=env,
        stdin=subprocess.DEVNULL, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=30,
    )
    assert run.returncode == 2, run.stdout + run.stderr
    assert run.stderr.strip() == line
    _assert_never_printed(run.stdout + run.stderr)
    assert "127.0.0.1" not in run.stdout + run.stderr
    assert counter.connections() == 0


# ---- .env lines python-dotenv can't read ------------------------------------------

import logging

from agent import common as _common


def _bad_dotenv(tmp_path, data: bytes):
    path = tmp_path / ".env"
    path.write_bytes(data)
    return path


def test_load_env_names_each_line_it_cant_read_once_in_javas_words(monkeypatch, capsys, caplog, tmp_path):
    from agent.common import env_bad_line, env_unread_line, load_env

    monkeypatch.setattr(_common, "_env_said", set())
    monkeypatch.delenv("PYTHON_DOTENV_DISABLED", raising=False)
    monkeypatch.setenv("ENV_SHELL", "shell")
    path = _bad_dotenv(tmp_path, b'B="x\nKEY: v\nENV_PROBE=1\nENV_SHELL=file\n')
    caplog.set_level(logging.DEBUG)
    try:
        load_env(path)
        load_env(path)  # run() and run_async() each read .env: the lines print once
        assert capsys.readouterr().err == f"{env_unread_line(1)}\n{env_bad_line(2)}\n"
        assert os.environ["ENV_PROBE"] == "1" and os.environ["ENV_SHELL"] == "shell"
        # python-dotenv's own "could not parse statement" warning stays quiet.
        assert [r for r in caplog.records if r.name.startswith("dotenv")] == []
    finally:
        os.environ.pop("ENV_PROBE", None)


def test_a_dotenv_that_isnt_utf8_is_one_line_not_a_crash(monkeypatch, capsys, tmp_path):
    from agent.common import ENV_NOT_UTF8, load_env

    monkeypatch.setattr(_common, "_env_said", set())
    monkeypatch.delenv("PYTHON_DOTENV_DISABLED", raising=False)
    path = _bad_dotenv(tmp_path, b"# caf\xe9\nENV_PROBE=1\n")
    load_env(path)
    load_env(path)
    assert capsys.readouterr().err == ENV_NOT_UTF8 + "\n"
    assert "ENV_PROBE" not in os.environ  # none of it was read, as in Java


def test_python_dotenv_disabled_reads_and_names_nothing(monkeypatch, capsys, tmp_path):
    from agent.common import load_env

    monkeypatch.setattr(_common, "_env_said", set())
    monkeypatch.setenv("PYTHON_DOTENV_DISABLED", "1")
    load_env(_bad_dotenv(tmp_path, b"KEY: v\nENV_PROBE=1\n"))
    assert capsys.readouterr().err == ""
    assert "ENV_PROBE" not in os.environ


def test_make_run_names_the_dotenv_lines_once_after_a_quiet_import(tmp_path):
    """Through run(): the import's read says nothing, run() and run_async() say each line once
    (no python-dotenv text), then the missing-credentials line, exit 2."""
    from agent.common import env_bad_line, env_unread_line, no_credentials_line

    _bad_dotenv(tmp_path, b'DEEPGRAM_API_KEY="abc\nKEY: v\n')
    script = (
        "import sys; sys.argv = ['start.py', '--no-save']\n"
        "from pathlib import Path\n"
        "import agent.common as c\n"
        f"c.PROJECT_ROOT = Path({str(tmp_path)!r})\n"
        "c.load_env(quiet=True)  # as the import does\n"
        "print('IMPORTED', file=sys.stderr, flush=True)\n"
        "c.run(lambda: {})\n"
    )
    run = subprocess.run(
        [sys.executable, "-c", script], cwd=str(PROJECT_ROOT / "python"), env=_clean_env(),
        stdin=subprocess.DEVNULL, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=30,
    )
    assert run.returncode == 2, run.stdout + run.stderr
    # That .env exists (the bad one in tmp_path), so the line says the key is empty in it.
    assert run.stderr == f"IMPORTED\n{env_unread_line(1)}\n{env_bad_line(2)}\n{no_credentials_line(has_env=True)}\n"


# ---- a start file Python can't read: one line, not a traceback ----------------------


def test_the_syntax_module_prints_one_line_for_a_file_that_doesnt_parse(tmp_path, capsys):
    from agent import syntax

    bad = tmp_path / "start.py"
    bad.write_text('call = {"hang_up_pending": False\n', encoding="utf-8")
    assert syntax.main([str(bad), "make check 01"]) == 1
    err = capsys.readouterr().err.strip()
    assert err == f"Your Python file doesn't run: {bad}:1 SyntaxError: '{{' was never closed. Fix it and run make check 01 again."
    assert "\n" not in err

    good = tmp_path / "ok.py"
    good.write_text("X = 1\n", encoding="utf-8")
    assert syntax.main([str(good), "make run 01"]) == 0
    assert capsys.readouterr().err == ""

    # A path given from python/ (as the Makefile gives it) is shown from the project root.
    assert syntax.problem(bad, "python/missions/01-let-me-finish/start.py", "make check 01").startswith(
        "Your Python file doesn't run: python/missions/01-let-me-finish/start.py:1 SyntaxError:"
    )
    assert syntax.main(["missions/no-such/start.py"]) == 1
    assert "couldn't be read" in capsys.readouterr().err

    notutf8 = tmp_path / "latin.py"
    notutf8.write_bytes(b"# caf\xe9\nX = 1\n")
    assert syntax.main([str(notutf8), "make check 02"]) == 1
    assert capsys.readouterr().err.strip() == f"Your Python file doesn't run: {notutf8}:it isn't UTF-8 text (save it as UTF-8, plain text). Fix it and run make check 02 again."


def test_load_target_fails_the_check_with_one_line_when_the_file_cant_be_imported(monkeypatch, tmp_path):
    import pytest

    from agent import testing

    mission = tmp_path / "python" / "missions" / "05-mystery-guest"
    mission.mkdir(parents=True)
    test_file = mission / "test_05.py"
    test_file.write_text("", encoding="utf-8")
    monkeypatch.setattr(testing, "PROJECT_ROOT", tmp_path)
    monkeypatch.delenv("MISSION_TARGET", raising=False)
    monkeypatch.delenv("WORKSHOP_AGAIN", raising=False)

    # A NameError at import (the literal true, from another language) names the line.
    (mission / "start.py").write_text("SECRET = ''\nSURPRISE_ME = true\n", encoding="utf-8")
    with pytest.raises(pytest.fail.Exception) as info:
        testing.load_target(str(test_file))
    assert str(info.value) == (
        "Your Python file doesn't run: python/missions/05-mystery-guest/start.py:2 NameError: name 'true' is not defined. "
        "Fix it and run make check 05 again."
    )
    # A syntax error names its line too (the Makefile's syntax step runs first; this is the backstop).
    (mission / "start.py").write_text("SECRET = (\n", encoding="utf-8")
    with pytest.raises(pytest.fail.Exception) as info:
        testing.load_target(str(test_file))
    assert str(info.value).startswith("Your Python file doesn't run: python/missions/05-mystery-guest/start.py:1 SyntaxError:")
    assert str(info.value).endswith("Fix it and run make check 05 again.")


def test_load_target_names_the_command_make_hands_it_in_workshop_again(monkeypatch, tmp_path):
    """make check runs pytest with WORKSHOP_AGAIN set (Makefile CHECK_py and LIVE_py): SDK= when it mattered,
    and in Docker the docker compose prefix every other printed command carries."""
    import pytest

    from agent import testing

    mission = tmp_path / "python" / "missions" / "05-mystery-guest"
    mission.mkdir(parents=True)
    test_file = mission / "test_05.py"
    test_file.write_text("", encoding="utf-8")
    monkeypatch.setattr(testing, "PROJECT_ROOT", tmp_path)
    monkeypatch.delenv("MISSION_TARGET", raising=False)
    (mission / "start.py").write_text("SURPRISE_ME = true\n", encoding="utf-8")

    monkeypatch.setenv("WORKSHOP_AGAIN", "docker compose run --rm workshop make check 05 SDK=py")
    with pytest.raises(pytest.fail.Exception) as info:
        testing.load_target(str(test_file))
    assert str(info.value) == (
        "Your Python file doesn't run: python/missions/05-mystery-guest/start.py:1 NameError: name 'true' is not defined. "
        "Fix it and run docker compose run --rm workshop make check 05 SDK=py again."
    )
    # Exported empty (pytest run by hand), the host form.
    monkeypatch.setenv("WORKSHOP_AGAIN", "")
    with pytest.raises(pytest.fail.Exception) as info:
        testing.load_target(str(test_file))
    assert str(info.value).endswith("NameError: name 'true' is not defined. Fix it and run make check 05 again.")
