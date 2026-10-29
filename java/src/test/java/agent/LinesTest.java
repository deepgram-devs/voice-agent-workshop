package agent;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.net.ConnectException;
import java.net.UnknownHostException;
import java.util.Map;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

class LinesTest {
    static Event ev(Object... kv) {
        return new Event(Json.obj(kv));
    }

    @BeforeEach
    void env() {
        Env.useForTests(Map.of("WORKSHOP_URL", "wss://workshop.example/sdk"), null);
    }

    @AfterEach
    void reset() {
        Env.resetForTests();
    }

    @Test
    void warningsCarryTheirCodeAndVoicePromptAddedIsANote() {
        assertEquals("Agent warning: audio dropped (AUDIO_DROPPED)",
                Lines.explainWarning(ev("type", "Warning", "description", "audio dropped", "code", "AUDIO_DROPPED")));
        assertEquals("Agent warning: no code here", Lines.explainWarning(ev("type", "Warning", "message", "no code here")));
        assertEquals(Lines.VOICE_PROMPT_NOTE, Lines.explainWarning(ev("type", "Warning", "code", "VOICE_PROMPT_ADDED")));
    }

    @Test
    void errorsGetTheirHints() {
        assertEquals("Agent error: bad (UNPARSABLE_CLIENT_MESSAGE)\n  " + Lines.SETTINGS_REFUSED_HINT,
                Lines.explainError(ev("type", "Error", "description", "bad", "code", "UNPARSABLE_CLIENT_MESSAGE")));
        assertTrue(Lines.explainError(ev("type", "Error", "code", "CONCURRENCY_LIMIT_REACHED")).endsWith(Lines.THINKING_BUSY_HINT));
        assertEquals("Agent error:  (no code)", Lines.explainError(ev("type", "Error")));
    }

    @Test
    void stopCodesPrintTheWorkshopLineInTheProxysWordsOrOurs() {
        for (String code : Lines.REFUSAL_CODES) {
            assertEquals("[workshop] " + Lines.TALK_MESSAGES.get(code) + " (" + code + ")", Lines.explainError(ev("type", "Error", "code", code)));
        }
        assertEquals("[workshop] Your token was replaced. (TOKEN_REPLACED)",
                Lines.explainWarning(ev("type", "Warning", "code", "TOKEN_REPLACED", "description", "Your token was replaced.")));
        assertTrue(Lines.STOP_CODES.containsAll(Lines.REFUSAL_CODES));
    }

    @Test
    void refusedLinesBy401And404ThroughTheProxyOrNot() {
        assertEquals("Deepgram refused the connection (HTTP 401). Check DEEPGRAM_API_KEY.", Lines.refusedLine(401, false));
        assertEquals("The workshop proxy refused the connection (HTTP 401). " + Lines.tokenRefusedHint(), Lines.refusedLine(401, true));
        assertTrue(Lines.tokenRefusedHint().endsWith("https://workshop.example/code."));
        assertEquals("The workshop proxy refused the connection (HTTP 404). " + Lines.PROXY_CLOSED_HINT, Lines.refusedLine(404, true));
        assertEquals("Deepgram refused the connection (HTTP 404).", Lines.refusedLine(404, false));
        assertTrue(Lines.retryableStatus(429) && Lines.retryableStatus(503));
        assertFalse(Lines.retryableStatus(401) || Lines.retryableStatus(null));
    }

    @Test
    void unreachableLinesNeverPrintTheExceptionText() {
        assertEquals("Could not reach the agent: connection refused. Check DEEPGRAM_AGENT_URL.",
                Lines.unreachableLine(new RuntimeException("wrapped", new ConnectException("Failed to connect to /10.0.0.1:443")), false));
        assertEquals("Could not reach the agent: connection refused. Check WORKSHOP_URL. Is the workshop site up?",
                Lines.unreachableLine(new ConnectException("refused"), true));
        assertEquals("Could not reach the agent: no such host. Check DEEPGRAM_AGENT_URL.",
                Lines.unreachableLine(new UnknownHostException("secret.example"), false));
        assertEquals("Could not reach the agent: it timed out. Check DEEPGRAM_AGENT_URL.",
                Lines.unreachableLine(new java.util.concurrent.TimeoutException(), false));
        assertEquals("Could not reach the agent: IllegalStateException. Check DEEPGRAM_AGENT_URL.",
                Lines.unreachableLine(new IllegalStateException("secret.example"), false));
    }

    @Test
    void eventLinesAndTheReplayTags() {
        assertEquals("assistant: Hi.", Lines.eventLine(ev("type", "ConversationText", "role", "assistant", "content", "Hi."), false, null));
        assertNull(Lines.eventLine(ev("type", "ConversationText", "role", "assistant", "content", " "), false, null));
        assertEquals("None: Hi.", Lines.eventLine(ev("type", "ConversationText", "content", "Hi."), false, null), "as common.py prints a missing role");
        assertNull(Lines.eventLine(ev("type", "AgentAudioDone"), false, "tty"));
        assertEquals("[ready] the agent has your settings." + Lines.readyHint("tty"), Lines.eventLine(ev("type", "SettingsApplied"), false, "tty"));
        assertEquals("[replay] [ready] the agent has your settings.", Lines.eventLine(ev("type", "SettingsApplied"), true, "tty"));
        assertEquals("[replay] Agent error: x (E)\n" + Lines.REPLAY_ERROR_NOTE,
                Lines.eventLine(ev("type", "Error", "description", "x", "code", "E"), true, null));
        assertEquals("", Lines.readyHint(null));
        assertTrue(Lines.readyHint("piped").contains("hangs up after the reply to the last one"));
    }
}
