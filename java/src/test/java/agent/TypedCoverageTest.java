package agent;

import static agent.Json.obj;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.ByteArrayOutputStream;
import java.lang.reflect.Field;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import java.util.TreeSet;
import okhttp3.WebSocket;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;

/**
 * Every Solution, driven against a local fake agent: what it sends goes out typed (no
 * [note]) and with each key once. Mission 03's `thinking` block is the one raw part.
 */
@Timeout(60)
class TypedCoverageTest {
    static final String[] MISSIONS = {
        "m00_first_words", "m01_let_me_finish", "m02_read_the_room", "m03_no_dead_air",
        "m04_polyglot", "m05_mystery_guest", "m06_encore",
    };
    static final String SETTINGS_NOTE = "[note] Settings sent as raw JSON: this SDK release has no field for part of it (the check reads it the same)";

    @BeforeEach
    void env() {
        Env.useForTests(Map.of(), null);
    }

    @AfterEach
    void reset() {
        Env.resetForTests();
    }

    static Mission solution(String pkg) throws Exception {
        return (Mission) Class.forName(pkg + ".Solution").getDeclaredConstructor().newInstance();
    }

    /** A static field of a mission class, read the way the test sees the mission's own value. */
    static Object field(String pkg, String name) throws Exception {
        Field f = Class.forName(pkg + ".Solution").getDeclaredField(name);
        f.setAccessible(true);
        return f.get(null);
    }

    /** What the server sends after SettingsApplied, awaiting the answers; then it hangs up. */
    interface Script {
        void play(WebSocket ws, FakeAgent server) throws Exception;
    }

    /** Runs one mission against a fake agent with a script; returns what the run printed. */
    static String drive(Mission mission, FakeAgent server, Script script) throws Exception {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        server.afterApplied = ws -> new Thread(() -> {
            try {
                script.play(ws, server);
            } catch (Exception | AssertionError e) {
                // The frame checks after the run say what was missing.
            } finally {
                ws.close(1000, "done");
            }
        }).start();
        Common.runAsync(mission, server.options(out));
        for (String frame : server.frames) FakeAgent.strict(frame);
        return out.toString(StandardCharsets.UTF_8);
    }

    static String userTurn(String content, String language) {
        return Json.obj("type", "ConversationText", "role", "user", "content", content,
                "languages", Json.arr(language)).toString();
    }

    static String functionCall(String id, String name, String arguments) {
        return Json.obj("type", "FunctionCallRequest", "functions", Json.arr(
                obj("id", id, "name", name, "arguments", arguments, "client_side", true))).toString();
    }

    /** The client frames of one type, parsed strictly. */
    static List<JsonNode> sent(FakeAgent server, String type) {
        List<JsonNode> out = new ArrayList<>();
        for (String f : server.frames) {
            JsonNode n = FakeAgent.strict(f);
            if (type.equals(n.path("type").asText())) out.add(n);
        }
        return out;
    }

    /** Each mission's script: the events that make it use every sender it has. */
    static Script scriptFor(String pkg) throws Exception {
        switch (pkg) {
            case "m01_let_me_finish":
                return (ws, s) -> {
                    ws.send(functionCall("f1", "end_call", "{}"));
                    s.await("FunctionCallResponse");
                    ws.send("{\"type\":\"AgentAudioDone\"}");
                    FakeAgent.pause(300);
                };
            case "m02_read_the_room":
                return (ws, s) -> {
                    ws.send("{\"type\":\"FrustrationDetected\",\"count\":2,\"escalated\":true}");
                    s.await("UpdatePrompt");
                };
            case "m03_no_dead_air":
                return (ws, s) -> {
                    ws.send(functionCall("f1", "deleteItem", "{\"item\":\"milk\"}"));
                    s.await("FunctionCallResponse");
                };
            case "m04_polyglot":
                return (ws, s) -> {
                    @SuppressWarnings("unchecked")
                    Map<String, String> voices = new TreeMap<>((Map<String, String>) field(pkg, "VOICES"));
                    voices.remove("en");
                    for (String lang : voices.keySet()) {
                        ws.send(userTurn("Hola", lang));
                        s.await("UpdateSpeak");
                        ws.send("{\"type\":\"SpeakUpdated\"}");
                    }
                    ws.send(userTurn("Hello", "en"));
                    s.await("UpdateSpeak");
                };
            case "m05_mystery_guest":
                return (ws, s) -> {
                    int turns = (Integer) field(pkg, "CLUE_AFTER_TURNS");
                    for (int i = 0; i < turns; i++) ws.send(userTurn("Are you a painter?", "en"));
                    s.await("UpdatePrompt");
                };
            default:
                return (ws, s) -> FakeAgent.pause(200);
        }
    }

    /** The senders each mission uses, beyond Settings. */
    static final Map<String, List<String>> SENDERS = Map.of(
            "m01_let_me_finish", List.of("FunctionCallResponse"),
            "m02_read_the_room", List.of("UpdatePrompt"),
            "m03_no_dead_air", List.of("InjectAgentMessage", "FunctionCallResponse"),
            "m04_polyglot", List.of("UpdateSpeak"),
            "m05_mystery_guest", List.of("UpdatePrompt"));

    @Test
    void everySolutionGoesTypedWithEachKeyOnce() throws Exception {
        for (String pkg : MISSIONS) {
            try (FakeAgent server = new FakeAgent()) {
                String printed = drive(solution(pkg), server, scriptFor(pkg));
                assertEquals("Settings", server.types().get(0), pkg);
                for (String type : SENDERS.getOrDefault(pkg, List.of())) {
                    assertFalse(sent(server, type).isEmpty(), pkg + " sent no " + type + ": " + server.types());
                }
                assertFalse(printed.contains("[note]"), pkg + " went raw: " + printed);
            }
        }
    }

    @Test
    void missionFoursVoicesGoOutAsTypedUpdateSpeak() throws Exception {
        @SuppressWarnings("unchecked")
        Map<String, String> voices = (Map<String, String>) field("m04_polyglot", "VOICES");
        try (FakeAgent server = new FakeAgent()) {
            String printed = drive(solution("m04_polyglot"), server, scriptFor("m04_polyglot"));
            List<String> models = new ArrayList<>();
            for (JsonNode n : sent(server, "UpdateSpeak")) {
                String model = n.at("/speak/provider/model").asText();
                assertTrue(Json.sameJson(Json.obj("type", "UpdateSpeak", "speak",
                        obj("provider", obj("type", "deepgram", "model", model))), n), n.toString());
                models.add(model);
            }
            assertEquals(new TreeSet<>(voices.values()), new TreeSet<>(models));
            assertEquals(voices.size(), models.size(), models.toString());
            assertFalse(printed.contains("[note]"), printed);
        }
    }

    @Test
    void missionThreesFillerGoesOutAsATypedQueuedInjectAgentMessage() throws Exception {
        String filler = (String) field("m03_no_dead_air", "FILLER");
        try (FakeAgent server = new FakeAgent()) {
            String printed = drive(solution("m03_no_dead_air"), server, scriptFor("m03_no_dead_air"));
            List<JsonNode> injected = sent(server, "InjectAgentMessage");
            assertEquals(1, injected.size(), server.types().toString());
            assertTrue(Json.sameJson(Json.obj("type", "InjectAgentMessage", "message", filler, "behavior", "queue"),
                    injected.get(0)), injected.get(0).toString());
            int filled = server.types().indexOf("InjectAgentMessage");
            assertTrue(filled < server.types().indexOf("FunctionCallResponse"), "filler first: " + server.types());
            assertFalse(printed.contains("[note]"), printed);
        }
    }

    @Test
    void withThinkingModelSetMissionThreePrintsOneSettingsNote() throws Exception {
        Env.useForTests(Map.of("THINKING_MODEL", " some-thinking-model "), null);
        try (FakeAgent server = new FakeAgent()) {
            String printed = drive(solution("m03_no_dead_air"), server, scriptFor("m03_no_dead_air"));
            JsonNode settings = FakeAgent.strict(server.frames.get(0));
            assertEquals("some-thinking-model", settings.at("/agent/think/provider/model").asText());
            assertEquals("none", settings.at("/agent/think/provider/reasoning_mode").asText());
            assertEquals(1, RunTest.count(printed, SETTINGS_NOTE), printed);
            assertEquals(1, RunTest.count(printed, "[note]"), "only Settings went raw: " + printed);
            assertFalse(sent(server, "InjectAgentMessage").isEmpty(), server.types().toString());
        }
    }
}
