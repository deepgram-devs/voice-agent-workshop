package agent;

import static agent.Json.obj;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.function.BiConsumer;
import java.util.regex.Matcher;
import okio.ByteString;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;
import org.junit.jupiter.api.io.TempDir;

/** The conversation loop against a fake agent endpoint: what goes out, when, and how a run ends. */
@Timeout(30)
class RunTest {
    static final ObjectNode SETTINGS = obj(
            "audio", obj("input", obj("encoding", "linear16", "sample_rate", 16000),
                    "output", obj("encoding", "linear16", "sample_rate", 24000, "container", "none")),
            "agent", obj(
                    "listen", obj("provider", obj("type", "deepgram", "model", "nova-3", "version", "v1")),
                    "think", obj("provider", obj("type", "open_ai", "model", "gpt-4o-mini"), "prompt", "Be brief."),
                    "speak", obj("provider", obj("type", "deepgram", "model", "flux-hannah-en", "version", "v2"))));

    /** A mission from two lambdas. */
    static Mission mission(ObjectNode settings, BiConsumer<Agent, Event> onEvent) {
        return new Mission() {
            @Override
            public ObjectNode buildSettings() {
                return settings.deepCopy();
            }

            @Override
            public void onEvent(Agent agent, Event event) {
                onEvent.accept(agent, event);
            }
        };
    }

    final ByteArrayOutputStream out = new ByteArrayOutputStream();

    String printed() {
        return out.toString(StandardCharsets.UTF_8);
    }

    @BeforeEach
    void env() {
        Env.useForTests(Map.of(), null);
    }

    @AfterEach
    void reset() {
        Env.resetForTests();
    }

    @Test
    void settingsGoFirstAtWelcomeAndKeepAliveOnlyAfterSettingsApplied() throws Exception {
        try (FakeAgent server = new FakeAgent()) {
            server.appliedDelayMs = 400;
            List<String> seenAtApplied = new CopyOnWriteArrayList<>();
            Common.RunOptions o = server.options(out);
            o.keepAliveMs = 100;
            Agent agent = Common.runAsync(mission(SETTINGS, (a, e) -> {
                if (e.type().equals("SettingsApplied")) {
                    seenAtApplied.addAll(server.types());
                    new Thread(() -> {
                        FakeAgent.pause(350);
                        a.close();
                    }).start();
                }
            }), o);
            assertEquals(List.of("Settings"), seenAtApplied, "nothing but Settings before SettingsApplied");
            assertEquals("Settings", server.types().get(0));
            assertTrue(server.types().contains("KeepAlive"), "KeepAlive after ready: " + server.types());
            assertTrue(agent.ready && agent.closed && agent.hungUp);
            assertTrue(Json.sameJson(Json.parse(server.frames.get(0)), withType("Settings", SETTINGS)));
            assertEquals(1000, server.clientCloseCode);
            assertFalse(printed().contains(Lines.HUNG_UP_LINE), "closed from another thread: no hung-up line");
        }
    }

    static ObjectNode withType(String type, ObjectNode body) {
        ObjectNode m = obj("type", type);
        m.setAll(body.deepCopy());
        return m;
    }

    @Test
    void closeFromOnEventPrintsTheHungUpLineOnceAndClosesWith1000() throws Exception {
        try (FakeAgent server = new FakeAgent()) {
            long t0 = System.nanoTime();
            Agent agent = Common.runAsync(mission(SETTINGS, (a, e) -> {
                if (e.type().equals("SettingsApplied")) a.close();
            }), server.options(out));
            long ms = (System.nanoTime() - t0) / 1_000_000;
            assertEquals(1, printed().split(java.util.regex.Pattern.quote(Lines.HUNG_UP_LINE), -1).length - 1, printed());
            assertTrue(agent.hungUp);
            assertEquals(1000, server.clientCloseCode);
            assertTrue(ms < 3000, "the run ends right after hanging up: " + ms + " ms");
        }
    }

    @Test
    void sendersSendTheWireShapesInOrderRawAmongTyped() throws Exception {
        ObjectNode speak = obj("provider", obj("type", "deepgram", "model", "flux-cliff-en", "version", "v2"));
        ObjectNode think = obj("provider", obj("type", "open_ai", "model", "gpt-4o-mini"), "prompt", "New.");
        List<JsonNode> expected = List.of(
                Json.obj("type", "UpdatePrompt", "prompt", "Also: be kind."),
                Json.obj("type", "Custom", "anything", 1),
                Json.obj("type", "UpdateSpeak", "speak", speak),
                Json.obj("type", "UpdateThink", "think", think),
                Json.obj("type", "InjectAgentMessage", "message", "One moment."),
                Json.obj("type", "InjectAgentMessage", "message", "Still here.", "behavior", "interrupt"),
                Json.obj("type", "InjectUserMessage", "content", "Hello"),
                Json.obj("type", "FunctionCallResponse", "id", "f1", "name", "end_call", "content", "ok"),
                Json.obj("type", "KeepAlive"));
        try (FakeAgent server = new FakeAgent()) {
            Common.runAsync(mission(SETTINGS, (a, e) -> {
                if (!e.type().equals("SettingsApplied")) return;
                a.updatePrompt("Also: be kind.");
                a.sendRaw(Json.obj("type", "Custom", "anything", 1));
                a.updateSpeak(speak);
                a.updateThink(think);
                a.injectAgentMessage("One moment.");
                a.injectAgentMessage("Still here.", "interrupt");
                a.injectUserMessage("Hello");
                a.functionCallResponse("f1", "end_call", "ok");
                a.keepAlive();
                a.close();
            }), server.options(out));
            List<String> frames = server.frames.subList(1, server.frames.size());
            assertEquals(expected.size(), frames.size(), server.types().toString());
            for (int i = 0; i < expected.size(); i++) {
                assertTrue(Json.sameJson(expected.get(i), Json.parse(frames.get(i))), "frame " + i + ": " + frames.get(i));
            }
            assertFalse(printed().contains("[note]"), "every typed sender went typed: " + printed());
        }
    }

    /** Settings shapes the missions send: listen v2 with hints, functions, speak options. */
    static List<ObjectNode> settingsShapes() {
        ObjectNode item = obj("type", "object",
                "properties", obj("item", obj("type", "string", "description", "The item.")),
                "required", Json.arr("item"));
        ObjectNode multi = SETTINGS.deepCopy();
        ObjectNode agent = (ObjectNode) multi.get("agent");
        agent.set("listen", obj("provider", obj("version", "v2", "type", "deepgram", "model", "flux-general-multi",
                "language_hints", Json.arr("en", "es", "fr"))));
        agent.set("speak", obj("provider", obj("type", "deepgram", "model", "aura-2-thalia-en")));
        ObjectNode tools = SETTINGS.deepCopy();
        ((ObjectNode) tools.at("/agent/think")).set("functions", Json.arr(
                obj("name", "deleteItem", "description", "Delete an item.", "parameters", item),
                obj("name", "listItems", "description", "Read the list.",
                        "parameters", obj("type", "object", "properties", obj()))));
        ObjectNode voice = SETTINGS.deepCopy();
        ((ObjectNode) voice.get("agent")).set("speak", obj("provider", obj("type", "deepgram", "version", "v2",
                "model", "flux-hannah-en", "speed", 0.9, "expressivity", 1)));
        ((ObjectNode) voice.get("agent")).put("greeting", "Ready when you are.");
        ObjectNode timing = SETTINGS.deepCopy();
        ((ObjectNode) timing.get("agent")).set("think_live",
                obj("provider", obj("type", "deepgram", "version", "v1", "frustration_max_count", 2)));
        return List.of(SETTINGS, multi, tools, voice, timing, new m00_first_words.Solution().buildSettings(),
                new m01_let_me_finish.Solution().buildSettings());
    }

    @Test
    void everyFrameOnTheWireHasEachKeyOnce() throws Exception {
        ObjectNode speak = obj("provider", obj("type", "deepgram", "model", "aura-2-celeste-es"));
        ObjectNode think = obj("provider", obj("type", "open_ai", "model", "gpt-4o-mini"), "prompt", "New.",
                "functions", Json.arr(obj("name", "listItems",
                        "parameters", obj("type", "object", "properties", obj()))));
        List<JsonNode> turns = List.of(
                Json.obj("type", "UpdatePrompt", "prompt", "Also: be kind."),
                Json.obj("type", "UpdateSpeak", "speak", speak),
                Json.obj("type", "UpdateThink", "think", think),
                Json.obj("type", "InjectAgentMessage", "message", "One second.", "behavior", "queue"),
                Json.obj("type", "InjectUserMessage", "content", "Hello"),
                Json.obj("type", "FunctionCallResponse", "id", "f1", "name", "listItems", "content", "1. Milk"),
                Json.obj("type", "KeepAlive"));
        for (ObjectNode settings : settingsShapes()) {
            try (FakeAgent server = new FakeAgent()) {
                Common.runAsync(mission(settings, (a, e) -> {
                    if (!e.type().equals("SettingsApplied")) return;
                    a.updatePrompt("Also: be kind.");
                    a.updateSpeak(speak);
                    a.updateThink(think);
                    a.injectAgentMessage("One second.", "queue");
                    a.injectUserMessage("Hello");
                    a.functionCallResponse("f1", "listItems", "1. Milk");
                    a.keepAlive();
                    a.close();
                }), server.options(out));
                assertEquals(1 + turns.size(), server.frames.size(), server.types().toString());
                assertTrue(Json.sameJson(withType("Settings", settings), FakeAgent.strict(server.frames.get(0))),
                        server.frames.get(0));
                for (int i = 0; i < turns.size(); i++) {
                    String frame = server.frames.get(i + 1);
                    assertTrue(Json.sameJson(turns.get(i), FakeAgent.strict(frame)), frame);
                }
            }
        }
        assertFalse(printed().contains("[note]"), "every shape went typed: " + printed());
    }

    @Test
    void repeatedKeysFindsEachRepeatAtAnyDepth() throws Exception {
        String text = "{\"type\":\"S\",\"a\":{\"p\":{\"type\":\"d\",\"type\":\"d\"}},"
                + "\"f\":[{\"n\":1},{\"n\":1,\"n\":2}],\"type\":\"S\"}";
        assertEquals(List.of(List.of("a", "p", "type"), List.of("f", 1, "n"), List.of("type")),
                Json.repeatedKeys(text));
        assertEquals(List.of(), Json.repeatedKeys("{\"a\":{\"type\":1},\"b\":{\"type\":1}}"));
    }

    @Test
    void aThinkBlockTheSdkCantCarryGoesRawWithOneNote() throws Exception {
        ObjectNode thinking = obj("provider", obj("type", "deepgram", "model", "some-thinking-model", "reasoning_mode", "none"));
        ObjectNode settings = SETTINGS.deepCopy();
        ((ObjectNode) settings.get("agent")).set("think", thinking);
        try (FakeAgent server = new FakeAgent()) {
            Common.runAsync(mission(settings, (a, e) -> {
                if (!e.type().equals("SettingsApplied")) return;
                a.updateThink(thinking);
                a.updateThink(thinking);
                a.close();
            }), server.options(out));
            JsonNode sent = Json.parse(server.frames.get(0));
            assertEquals("none", sent.at("/agent/think/provider/reasoning_mode").asText(), "the JSON arrives intact");
            assertTrue(Json.sameJson(Json.obj("type", "UpdateThink", "think", thinking), Json.parse(server.frames.get(1))));
            assertEquals(1, count(printed(), "[note] Settings sent as raw JSON: this SDK release has no field for part of it (the check reads it the same)"), printed());
            assertEquals(1, count(printed(), "[note] UpdateThink sent as raw JSON: this SDK release has no field for part of it (the check reads it the same)"), printed());
        }
    }

    static int count(String text, String needle) {
        return text.split(java.util.regex.Pattern.quote(needle), -1).length - 1;
    }

    @Test
    void anEventTypeNewerThanTheSdkReachesOnEventAndIsntAnError() throws Exception {
        List<String> seen = new CopyOnWriteArrayList<>();
        try (FakeAgent server = new FakeAgent()) {
            server.afterApplied = ws -> ws.send("{\"type\":\"FrustrationDetected\",\"level\":0.9}");
            Common.runAsync(mission(SETTINGS, (a, e) -> {
                seen.add(e.type());
                if (e.type().equals("FrustrationDetected")) {
                    assertEquals(0.9, e.num("level"));
                    a.close();
                }
            }), server.options(out));
            assertEquals(List.of("Welcome", "SettingsApplied", "FrustrationDetected"), seen);
        }
    }

    @Test
    void theMissionsTakeAFrameWithNoType() throws Exception {
        for (Mission m : new Mission[] {new m00_first_words.Solution(), new m01_let_me_finish.Start(), new m01_let_me_finish.Solution()}) {
            try (FakeAgent server = new FakeAgent()) {
                server.afterApplied = ws -> {
                    ws.send("{\"no\":\"type\"}");
                    ws.close(1000, "done");
                };
                Agent agent = Common.runAsync(m, server.options(out));
                assertEquals(1000, agent.closeCode, m.getClass().getName());
            }
        }
    }

    @Test
    void anOnEventExceptionEndsTheRunAsAMissionError() throws Exception {
        try (FakeAgent server = new FakeAgent()) {
            MissionError err = assertThrows(MissionError.class, () -> Common.runAsync(mission(SETTINGS, (a, e) -> {
                if (e.type().equals("SettingsApplied")) throw new IllegalStateException("boom");
            }), server.options(out)));
            assertInstanceOf(IllegalStateException.class, err.getCause());
            assertEquals("boom", err.getCause().getMessage());
        }
    }

    @Test
    void anErrorThrownInOnEventOrBuildSettingsEndsTheRunAndNeverHangs() throws Exception {
        try (FakeAgent server = new FakeAgent()) {
            long t0 = System.nanoTime();
            MissionError err = assertThrows(MissionError.class, () -> Common.runAsync(mission(SETTINGS, (a, e) -> {
                if (e.type().equals("SettingsApplied")) throw new AssertionError("expected 1 but was 2");
            }), server.options(out)));
            assertInstanceOf(AssertionError.class, err.getCause());
            assertTrue((System.nanoTime() - t0) / 1_000_000 < 5000);
        }
        try (FakeAgent server = new FakeAgent()) {
            Mission overflowing = new Mission() {
                @Override
                public ObjectNode buildSettings() {
                    throw new StackOverflowError();
                }
            };
            MissionError err = assertThrows(MissionError.class, () -> Common.runAsync(overflowing, server.options(out)));
            assertInstanceOf(StackOverflowError.class, err.getCause());
        }
    }

    @Test
    void yourProgramsExceptionPrintsRedacted() throws Exception {
        String key = "fake0123456789abcdef0123456789abcdef0123";
        Env.useForTests(Map.of("DEEPGRAM_API_KEY", key), null);
        Mission leaking = new Mission() {
            @Override
            public ObjectNode buildSettings() {
                throw new IllegalStateException("Token " + key);
            }
        };
        try (FakeAgent server = new FakeAgent()) {
            MissionError err = assertThrows(MissionError.class, () -> Common.runAsync(leaking, server.options(out)));
            String printed = Common.missionErrorTrace(err, "00");
            assertTrue(printed.startsWith("java.lang.IllegalStateException: Token [redacted]"), printed);
            assertFalse(printed.contains(key), printed);
        }
    }

    @Test
    void aNullFieldGoesOutOnTheWireAsPythonSendsItWithNoNote() throws Exception {
        ObjectNode think = obj("provider", obj("type", "open_ai", "model", "gpt-4o-mini"), "prompt", null);
        try (FakeAgent server = new FakeAgent()) {
            Common.runAsync(mission(SETTINGS, (a, e) -> {
                if (!e.type().equals("SettingsApplied")) return;
                a.updateThink(think);
                a.close();
            }), server.options(out));
            JsonNode sent = Json.parse(server.frames.get(1));
            assertEquals("UpdateThink", sent.path("type").asText());
            assertTrue(sent.path("think").has("prompt") && sent.path("think").get("prompt").isNull(), server.frames.get(1));
            assertFalse(printed().contains("[note]"), printed());
        }
    }

    @Test
    void onceTheServersCloseArrivesTheTransportIsntOpen() throws Exception {
        List<Boolean> openAtClosing = new CopyOnWriteArrayList<>();
        RawTransport.Transport.afterClosing = t -> openAtClosing.add(t.isOpen());
        try (FakeAgent server = new FakeAgent()) {
            server.afterApplied = ws -> ws.close(1000, "done");
            Agent agent = Common.runAsync(mission(SETTINGS, (a, e) -> {}), server.options(out));
            assertEquals(List.of(false), openAtClosing);
            assertEquals(1000, agent.closeCode);
        } finally {
            RawTransport.Transport.afterClosing = null;
        }
    }

    @Test
    void aRefusalIsExitStatus1WithTheWorkshopLineAndNoClosedLine() throws Exception {
        try (FakeAgent server = new FakeAgent()) {
            server.welcome = false;
            server.server.setDispatcher(refusing(server, "Error", "TALK_UNCONFIGURED", 1013));
            Agent agent = Common.runAsync(mission(SETTINGS, (a, e) -> {}), server.options(out));
            assertEquals(1, Common.exitStatus(agent));
            assertEquals("TALK_UNCONFIGURED", agent.stopCode);
            assertEquals(1013, agent.closeCode);
            assertTrue(printed().contains("[workshop] " + Lines.TALK_MESSAGES.get("TALK_UNCONFIGURED") + " (TALK_UNCONFIGURED)"), printed());
            assertFalse(printed().contains("[closed]"), printed());
        }
    }

    @Test
    void aStaffPauseMidRunEndsCleanly() throws Exception {
        try (FakeAgent server = new FakeAgent()) {
            server.server.setDispatcher(refusing(server, "Warning", "TALK_PAUSED", 1000));
            Agent agent = Common.runAsync(mission(SETTINGS, (a, e) -> {}), server.options(out));
            assertEquals(0, Common.exitStatus(agent));
            assertEquals("Warning", agent.stopType);
        }
    }

    /** A server that sends one Error or Warning with a code, then closes. */
    static okhttp3.mockwebserver.Dispatcher refusing(FakeAgent server, String type, String code, int closeCode) {
        return new okhttp3.mockwebserver.Dispatcher() {
            @Override
            public okhttp3.mockwebserver.MockResponse dispatch(okhttp3.mockwebserver.RecordedRequest request) {
                return new okhttp3.mockwebserver.MockResponse().withWebSocketUpgrade(new okhttp3.WebSocketListener() {
                    @Override
                    public void onOpen(okhttp3.WebSocket ws, okhttp3.Response response) {
                        ws.send("{\"type\":\"" + type + "\",\"code\":\"" + code + "\",\"description\":\"\"}");
                        ws.close(closeCode, "bye");
                    }

                    @Override
                    public void onClosing(okhttp3.WebSocket ws, int c, String reason) {
                        ws.close(1000, null);
                    }
                });
            }
        };
    }

    @Test
    void aDropEndsTheRunAs1006AndAServerCloseIsOneConnection() throws Exception {
        // MockWebServer can't drop a WebSocket, so a few lines of socket do:
        // Welcome, then the TCP connection goes.
        try (java.net.ServerSocket raw = new java.net.ServerSocket(0, 5, java.net.InetAddress.getLoopbackAddress())) {
            java.util.concurrent.atomic.AtomicInteger accepted = new java.util.concurrent.atomic.AtomicInteger();
            Thread dropper = new Thread(() -> {
                try {
                    while (true) {
                        try (java.net.Socket s = raw.accept()) {
                            accepted.incrementAndGet();
                            dropAfterWelcome(s);
                        }
                    }
                } catch (java.io.IOException e) {
                    // The test closed the server socket.
                }
            });
            dropper.setDaemon(true);
            dropper.start();
            Common.RunOptions o = new Common.RunOptions();
            o.url = "ws://127.0.0.1:" + raw.getLocalPort();
            o.apiKey = "test-key-0123456789";
            o.interactive = false;
            o.out = new java.io.PrintStream(out, true, StandardCharsets.UTF_8);
            long t0 = System.nanoTime();
            Agent agent = Common.runAsync(mission(SETTINGS, (a, e) -> {}), o);
            assertEquals(1006, agent.closeCode);
            assertTrue(printed().contains("[closed] 1006 no close frame"), printed());
            assertTrue((System.nanoTime() - t0) / 1_000_000 < 5000);
            FakeAgent.pause(300);
            assertEquals(1, accepted.get(), "no reconnect");
        }
        try (FakeAgent server = new FakeAgent()) {
            server.afterApplied = ws -> ws.close(1011, "server error");
            Agent agent = Common.runAsync(mission(SETTINGS, (a, e) -> {}), server.options(out));
            assertEquals(1011, agent.closeCode);
            assertTrue(printed().contains("[closed] 1011 server error"), printed());
            FakeAgent.pause(300);
            assertEquals(1, server.server.getRequestCount(), "no reconnect");
        }
    }

    /**
     * Answers the WebSocket upgrade, sends Welcome, reads the client's first frame, then drops
     * the connection.
     */
    static void dropAfterWelcome(java.net.Socket s) throws java.io.IOException {
        java.io.InputStream in = s.getInputStream();
        StringBuilder head = new StringBuilder();
        while (!head.toString().endsWith("\r\n\r\n")) {
            int c = in.read();
            if (c < 0) return;
            head.append((char) c);
        }
        Matcher m = java.util.regex.Pattern.compile("(?i)Sec-WebSocket-Key:\\s*(\\S+)").matcher(head);
        if (!m.find()) return;
        String accept;
        try {
            accept = java.util.Base64.getEncoder().encodeToString(java.security.MessageDigest.getInstance("SHA-1")
                    .digest((m.group(1) + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").getBytes(StandardCharsets.US_ASCII)));
        } catch (java.security.NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
        java.io.OutputStream os = s.getOutputStream();
        os.write(("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: "
                + accept + "\r\n\r\n").getBytes(StandardCharsets.US_ASCII));
        byte[] welcome = "{\"type\":\"Welcome\",\"request_id\":\"r1\"}".getBytes(StandardCharsets.UTF_8);
        os.write(new byte[] {(byte) 0x81, (byte) welcome.length});
        os.write(welcome);
        os.flush();
        in.read(new byte[2]); // the start of the client's Settings frame
        FakeAgent.pause(100);
        s.setSoLinger(true, 0); // a reset, not a close frame
    }

    @Test
    void anAddressTheSdkCantReadIsOneLineThatNamesTheVariableNotTheValue() throws Exception {
        Common.RunOptions o = new Common.RunOptions();
        o.url = "ws://127.0.0.1:abc";
        o.apiKey = "test-key-0123456789";
        o.interactive = false;
        o.out = new java.io.PrintStream(out, true, StandardCharsets.UTF_8);
        SetupError e = assertThrows(SetupError.class, () -> Common.runAsync(mission(SETTINGS, (a, ev) -> {}), o));
        assertEquals("DEEPGRAM_AGENT_URL isn't a valid address. Copy it again, or leave it empty for Deepgram "
                + "production.", e.getMessage());
        assertFalse(e.getMessage().contains("abc"));
    }

    @Test
    void aSpaceInTheAddressIsTheLineBeforeAnyConnection() throws Exception {
        // OkHttp would encode the space and connect: the check in Credentials.plan stops it first.
        try (FakeAgent server = new FakeAgent()) {
            String spaced = server.url() + "/a b";
            Env.useForTests(Map.of("DEEPGRAM_API_KEY", "test-key-0123456789", "DEEPGRAM_AGENT_URL", spaced), null);
            Common.RunOptions o = server.options(out);
            o.url = null;
            o.apiKey = null;
            SetupError e = assertThrows(SetupError.class, () -> Common.runAsync(mission(SETTINGS, (a, ev) -> {}), o));
            assertEquals(Credentials.BAD_AGENT_URL, e.getMessage());
            assertEquals(0, server.server.getRequestCount(), "stopped before connecting");
        }
    }

    @Test
    void aKeyOrTokenWithACharacterAHeaderCantCarryIsNamedNotCalledABadAddress() throws Exception {
        try (FakeAgent server = new FakeAgent()) {
            Env.useForTests(Map.of("DEEPGRAM_API_KEY", "\u201cabc\u201d"), null);
            Common.RunOptions o = server.options(out);
            o.apiKey = null;
            SetupError key = assertThrows(SetupError.class, () -> Common.runAsync(mission(SETTINGS, (a, ev) -> {}), o));
            assertEquals("DEEPGRAM_API_KEY has a character a key can't have (a curly quote or a hidden space, often from "
                    + "copy and paste). Copy it again as plain text.", key.getMessage());
            assertFalse(key.getMessage().contains("abc"));
            assertEquals(0, server.server.getRequestCount(), "stopped before connecting");
        }
        Env.useForTests(Map.of("WORKSHOP_TOKEN", "tok en", "WORKSHOP_URL", "ws://127.0.0.1:9/sdk"), null);
        SetupError token = assertThrows(SetupError.class, () -> Credentials.plan(null, null, null));
        assertEquals(Credentials.badCharacter("WORKSHOP_TOKEN", "a token"), token.getMessage());
    }

    @Test
    void aKeyWithATrailingNoBreakSpaceConnectsAsInPython() throws Exception {
        try (FakeAgent server = new FakeAgent()) {
            Env.useForTests(Map.of("DEEPGRAM_API_KEY", "test-key-0123456789\u00A0"), null);
            server.afterApplied = ws -> ws.close(1000, "done");
            Common.RunOptions o = server.options(out);
            o.apiKey = null;
            Common.runAsync(mission(SETTINGS, (a, ev) -> {}), o);
            assertEquals("Token test-key-0123456789", server.server.takeRequest().getHeader("Authorization"));
        }
    }

    @Test
    void aBadWorkshopUrlSendsYouToTheCodePageAndNeverEchoesIt() throws Exception {
        for (String url : List.of("ws://127.0.0.1:abc/sdk", "wss://bad host/sdk", "wss://[bad/sdk")) {
            Env.useForTests(Map.of("WORKSHOP_TOKEN", "tok-0123456789", "WORKSHOP_URL", url), null);
            Common.RunOptions o = new Common.RunOptions();
            o.interactive = false;
            o.out = new java.io.PrintStream(out, true, StandardCharsets.UTF_8);
            SetupError e = assertThrows(SetupError.class, () -> Common.runAsync(mission(SETTINGS, (a, ev) -> {}), o), url);
            assertEquals("WORKSHOP_URL isn't a valid address. Copy it again from the workshop's /code page.", e.getMessage(), url);
            for (String part : List.of("abc", "127.0.0.1", "bad")) assertFalse(e.getMessage().contains(part), url);
        }
    }

    @Test
    void aServerThatGoesSilentEndsTheRunWhenAPingGoesUnanswered() throws Exception {
        // Answers the upgrade and Welcome, then reads and drops everything: no pong comes back.
        try (java.net.ServerSocket raw = new java.net.ServerSocket(0, 5, java.net.InetAddress.getLoopbackAddress())) {
            Thread silent = new Thread(() -> {
                try (java.net.Socket s = raw.accept()) {
                    answerUpgradeWithWelcome(s);
                    s.getInputStream().transferTo(java.io.OutputStream.nullOutputStream());
                } catch (java.io.IOException e) {
                    // The client gave up: that's the point.
                }
            });
            silent.setDaemon(true);
            silent.start();
            Common.RunOptions o = new Common.RunOptions();
            o.url = "ws://127.0.0.1:" + raw.getLocalPort();
            o.apiKey = "test-key-0123456789";
            o.interactive = false;
            o.pingMs = 300;
            o.out = new java.io.PrintStream(out, true, StandardCharsets.UTF_8);
            long t0 = System.nanoTime();
            Agent agent = Common.runAsync(mission(SETTINGS, (a, e) -> {}), o);
            assertEquals(1006, agent.closeCode);
            assertTrue(printed().contains("[closed] 1006 no close frame"), printed());
            assertTrue((System.nanoTime() - t0) / 1_000_000 < 10_000);
        }
    }

    /** Answers a WebSocket upgrade and sends Welcome. */
    static void answerUpgradeWithWelcome(java.net.Socket s) throws java.io.IOException {
        java.io.InputStream in = s.getInputStream();
        StringBuilder head = new StringBuilder();
        while (!head.toString().endsWith("\r\n\r\n")) {
            int c = in.read();
            if (c < 0) return;
            head.append((char) c);
        }
        Matcher m = java.util.regex.Pattern.compile("(?i)Sec-WebSocket-Key:\\s*(\\S+)").matcher(head);
        if (!m.find()) return;
        String accept;
        try {
            accept = java.util.Base64.getEncoder().encodeToString(java.security.MessageDigest.getInstance("SHA-1")
                    .digest((m.group(1) + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").getBytes(StandardCharsets.US_ASCII)));
        } catch (java.security.NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
        java.io.OutputStream os = s.getOutputStream();
        os.write(("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: "
                + accept + "\r\n\r\n").getBytes(StandardCharsets.US_ASCII));
        byte[] welcome = "{\"type\":\"Welcome\",\"request_id\":\"r1\"}".getBytes(StandardCharsets.UTF_8);
        os.write(new byte[] {(byte) 0x81, (byte) welcome.length});
        os.write(welcome);
        os.flush();
    }

    @Test
    void a401IsOneLineWithNoKeyAndOneAttempt() throws Exception {
        try (FakeAgent server = new FakeAgent()) {
            server.refuseWith = 401;
            Common.RunOptions o = server.options(out);
            long t0 = System.nanoTime();
            SetupError e = assertThrows(SetupError.class, () -> Common.runAsync(mission(SETTINGS, (a, ev) -> {}), o));
            assertEquals("Deepgram refused the connection (HTTP 401). Check DEEPGRAM_API_KEY.", e.getMessage());
            assertFalse(e.retryable);
            assertFalse(printed().contains(o.apiKey));
            assertTrue((System.nanoTime() - t0) / 1_000_000 < 3000);
            FakeAgent.pause(200);
            assertEquals(1, server.server.getRequestCount());
            assertEquals("Token " + o.apiKey, server.server.takeRequest().getHeader("Authorization"));
        }
        try (FakeAgent server = new FakeAgent()) {
            server.refuseWith = 503;
            SetupError e = assertThrows(SetupError.class, () -> Common.runAsync(mission(SETTINGS, (a, ev) -> {}), server.options(out)));
            assertTrue(e.retryable, e.getMessage());
        }
    }

    @Test
    void nothingListeningIsOneLine() throws Exception {
        FakeAgent server = new FakeAgent();
        Common.RunOptions o = server.options(out);
        server.close();
        SetupError e = assertThrows(SetupError.class, () -> Common.runAsync(mission(SETTINGS, (a, ev) -> {}), o));
        assertEquals("Could not reach the agent: connection refused. Check DEEPGRAM_AGENT_URL.", e.getMessage());
        assertTrue(e.retryable);
    }

    @Test
    void theAgentsAudioLandsInTheWavInOrder(@TempDir Path dir) throws Exception {
        try (FakeAgent server = new FakeAgent()) {
            server.afterApplied = ws -> {
                ws.send(ByteString.of((byte) 1, (byte) 2));
                ws.send(ByteString.of((byte) 3, (byte) 4));
                ws.send(ByteString.of((byte) 5, (byte) 6));
                ws.send("{\"type\":\"AgentAudioDone\"}");
            };
            Common.RunOptions o = server.options(out);
            o.saveAudio = dir.resolve("out").resolve("call.wav");
            Common.runAsync(mission(SETTINGS, (a, e) -> {
                if (e.type().equals("AgentAudioDone")) a.close();
            }), o);
            byte[] wav = Files.readAllBytes(o.saveAudio);
            assertEquals("RIFF", new String(wav, 0, 4, StandardCharsets.US_ASCII));
            assertEquals(24000, java.nio.ByteBuffer.wrap(wav, 24, 4).order(java.nio.ByteOrder.LITTLE_ENDIAN).getInt());
            assertTrue(Arrays.equals(new byte[] {1, 2, 3, 4, 5, 6}, Arrays.copyOfRange(wav, 44, wav.length)));
            assertTrue(printed().contains("[saved] the agent's voice is in "), printed());
        }
    }

    @Test
    void aVoiceItCantSaveSaysWhyNotThePathAgain(@TempDir Path dir) throws Exception {
        Files.writeString(dir.resolve("out"), "a file where the folder should be");
        try (FakeAgent server = new FakeAgent()) {
            server.afterApplied = ws -> {
                ws.send(ByteString.of((byte) 1, (byte) 2));
                ws.send("{\"type\":\"AgentAudioDone\"}");
            };
            Common.RunOptions o = server.options(out);
            o.saveAudio = dir.resolve("out").resolve("call.wav");
            Common.runAsync(mission(SETTINGS, (a, e) -> {
                if (e.type().equals("AgentAudioDone")) a.close();
            }), o);
            assertTrue(printed().contains("Couldn't save the agent's voice to " + o.saveAudio + ": " + dir.resolve("out")
                    + " is a file, not a folder. Move or rename that file, then run this again."), printed());
        }
        java.nio.file.Path p = Path.of("/x/out/call.wav");
        assertEquals("permission denied", Common.saveReason(new java.nio.file.AccessDeniedException(p.toString())));
        assertEquals("Not a directory", Common.saveReason(new java.nio.file.FileSystemException(p.toString(), null, "Not a directory")));
        assertEquals("that folder doesn't exist", Common.saveReason(new java.nio.file.NoSuchFileException(p.toString())));
        assertEquals("the system gave no reason", Common.saveReason(new java.nio.file.FileSystemException(p.toString())));
        assertEquals("the system gave no reason", Common.saveReason(new java.io.IOException()));
        assertEquals("No space left on device", Common.saveReason(new java.io.IOException("No space left on device")));
    }

    @Test
    void noAudioSaysSoOnceTheAgentHadYourSettings(@TempDir Path dir) throws Exception {
        try (FakeAgent server = new FakeAgent()) {
            Common.RunOptions o = server.options(out);
            o.saveAudio = dir.resolve("call.wav");
            Common.runAsync(mission(SETTINGS, (a, e) -> {
                if (e.type().equals("SettingsApplied")) a.close();
            }), o);
            assertFalse(Files.exists(o.saveAudio));
            assertTrue(printed().contains(Lines.NO_AUDIO_LINE), printed());
        }
    }

    @Test
    void pipedLinesGoOneAtATimeAfterTheGreetingAndTheEndOfInputHangsUpOnce() throws Exception {
        ObjectNode settings = SETTINGS.deepCopy();
        ((ObjectNode) settings.get("agent")).put("greeting", "Hello there.");
        List<String> order = new CopyOnWriteArrayList<>();
        try (FakeAgent server = new FakeAgent()) {
            server.afterApplied = ws -> new Thread(() -> {
                FakeAgent.pause(300);
                order.add("greeting done");
                ws.send("{\"type\":\"AgentAudioDone\"}");
            }).start();
            server.onFrame = (ws, frame) -> {
                if (!frame.path("type").asText().equals("InjectUserMessage")) return;
                String said = frame.path("content").asText();
                order.add("user: " + said);
                new Thread(() -> {
                    FakeAgent.pause(200);
                    ws.send("{\"type\":\"ConversationText\",\"role\":\"assistant\",\"content\":\"About " + said + ".\"}");
                    FakeAgent.pause(200);
                    order.add("reply done: " + said);
                    ws.send("{\"type\":\"AgentAudioDone\"}");
                }).start();
            };
            Common.RunOptions o = server.options(out);
            o.interactive = null;
            o.typing = "piped";
            o.input = new TypedLines(new ByteArrayInputStream("first\n\nsecond\n".getBytes(StandardCharsets.UTF_8)));
            Agent agent = Common.runAsync(mission(settings, (a, e) -> {}), o);
            assertEquals(List.of("greeting done", "user: first", "reply done: first", "user: second", "reply done: second"), order);
            assertEquals(1, count(printed(), Lines.END_OF_INPUT_LINE), printed());
            assertFalse(printed().contains(Lines.HUNG_UP_LINE), printed());
            assertTrue(agent.hungUp);
            assertTrue(printed().contains("[ready] the agent has your settings." + Lines.readyHint("piped")), printed());
        }
    }

    @Test
    void aPipedTurnWithAFunctionCallWaitsForTheReplyAfterYourAnswer() throws Exception {
        List<String> order = new CopyOnWriteArrayList<>();
        try (FakeAgent server = new FakeAgent()) {
            server.onFrame = (ws, frame) -> {
                String type = frame.path("type").asText();
                if (type.equals("InjectUserMessage")) {
                    order.add("user: " + frame.path("content").asText());
                    ws.send("{\"type\":\"FunctionCallRequest\",\"functions\":[{\"id\":\"c1\",\"name\":\"slow\",\"arguments\":\"{}\",\"client_side\":true}]}");
                } else if (type.equals("InjectAgentMessage")) {
                    // The filler plays and ends: that must not end the turn.
                    ws.send("{\"type\":\"ConversationText\",\"role\":\"assistant\",\"content\":\"One moment.\"}");
                    ws.send("{\"type\":\"AgentAudioDone\"}");
                } else if (type.equals("FunctionCallResponse")) {
                    new Thread(() -> {
                        FakeAgent.pause(200);
                        ws.send("{\"type\":\"ConversationText\",\"role\":\"assistant\",\"content\":\"Done.\"}");
                        order.add("reply done");
                        ws.send("{\"type\":\"AgentAudioDone\"}");
                    }).start();
                }
            };
            Common.RunOptions o = server.options(out);
            o.interactive = null;
            o.typing = "piped";
            o.input = new TypedLines(new ByteArrayInputStream("one\ntwo\n".getBytes(StandardCharsets.UTF_8)));
            Common.runAsync(mission(SETTINGS, (a, e) -> {
                if (e.type().equals("FunctionCallRequest")) {
                    a.injectAgentMessage("One moment.");
                    new Thread(() -> {
                        FakeAgent.pause(300);
                        a.functionCallResponse("c1", "slow", "done");
                    }).start();
                }
            }), o);
            assertEquals(List.of("user: one", "reply done", "user: two", "reply done"), order);
        }
    }

    @Test
    void theShellsWordOnStdinWinsOverSystemConsole() {
        String before = System.getProperty("workshop.stdin");
        try {
            System.setProperty("workshop.stdin", "tty");
            assertEquals("tty", TypedLines.inputMode(), "stdin is a terminal even when stdout is a pipe");
            System.setProperty("workshop.stdin", "piped");
            assertEquals("piped", TypedLines.inputMode());
        } finally {
            if (before == null) System.clearProperty("workshop.stdin");
            else System.setProperty("workshop.stdin", before);
        }
    }

    @Test
    void withoutATerminalTypedTurnsArePiped() {
        org.junit.jupiter.api.Assumptions.assumeTrue(System.console() == null, "a console is attached");
        assertEquals("piped", TypedLines.inputMode());
    }
}
