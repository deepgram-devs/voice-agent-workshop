package agent;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;
import org.junit.jupiter.api.io.TempDir;

/** The example runs offline against the mission 00 replay. `make ci` runs this (`make unit`). */
// SEPARATE_THREAD: a test stuck in a blocking pipe read (which ignores interrupts) still fails
// at 60 s.
@Timeout(value = 60, threadMode = Timeout.ThreadMode.SEPARATE_THREAD)
class ExamplesTest {
    @Test
    void firstSettingsSendsSettingsFirstAndSavesTheVoice(@TempDir Path dir) throws Exception {
        Path dump = dir.resolve("session.json");
        Process harness = new ProcessBuilder(Testing.node(), Testing.HARNESS.toString(), "replay", "00", "greeting", "--dump", dump.toString())
                .redirectErrorStream(true)
                .start();
        BufferedReader harnessOut = new BufferedReader(new InputStreamReader(harness.getInputStream(), StandardCharsets.UTF_8));
        try {
            String ready = harnessOut.readLine();
            // On failure, the harness's own output (a Node.js line, say) is the message.
            assertTrue(ready != null && ready.startsWith("READY "), ready);

            Path wav = dir.resolve("voice.wav");
            String java = Paths.get(System.getProperty("java.home"), "bin", "java").toString();
            ProcessBuilder example = new ProcessBuilder(java, "-cp", System.getProperty("java.class.path"), "FirstSettings", wav.toString())
                    .directory(Common.PROJECT_ROOT.resolve("java").toFile())
                    .redirectErrorStream(true)
                    .redirectInput(ProcessBuilder.Redirect.from(new java.io.File("/dev/null"))); // Java on Windows is WSL
            Map<String, String> env = example.environment();
            env.remove("WORKSHOP_TOKEN");
            env.remove("WORKSHOP_URL");
            env.put("DEEPGRAM_API_KEY", Testing.REPLAY_KEY);
            env.put("DEEPGRAM_AGENT_URL", ready.substring("READY ".length()));
            Process run = example.start();
            String out = output(run, 30);
            harness.waitFor(10, TimeUnit.SECONDS);

            assertEquals(0, run.exitValue(), out);
            assertTrue(out.contains("[ready]") && out.contains("assistant: Hi there."), out);
            assertEquals("RIFF", new String(Files.readAllBytes(wav), 0, 4, StandardCharsets.US_ASCII));
            List<String> client = new ArrayList<>();
            for (JsonNode e : Json.parse(Files.readString(dump)).path("events")) {
                if (e.path("dir").asText().equals("client") && e.has("frame")) client.add(e.path("frame").path("type").asText());
            }
            assertEquals("Settings", client.get(0), client.toString());
        } finally {
            harness.destroyForcibly();
        }
    }

    /**
     * Runs FirstSettings from {@code dir}/java (so {@code dir}/.env is its .env), with the
     * given variables.
     */
    static String[] runExample(Path dir, Map<String, String> vars) throws Exception {
        return runExample(dir, vars, dir.resolve("voice.wav"));
    }

    static String[] runExample(Path dir, Map<String, String> vars, Path wav) throws Exception {
        Files.createDirectories(dir.resolve("java"));
        String java = Paths.get(System.getProperty("java.home"), "bin", "java").toString();
        ProcessBuilder example = new ProcessBuilder(java, "-cp", System.getProperty("java.class.path"), "FirstSettings",
                wav.toString())
                .directory(dir.resolve("java").toFile())
                .redirectErrorStream(true)
                .redirectInput(ProcessBuilder.Redirect.from(new java.io.File("/dev/null")));
        for (String name : List.copyOf(example.environment().keySet())) {
            if (name.startsWith("DEEPGRAM_") || name.startsWith("WORKSHOP_")) example.environment().remove(name);
        }
        example.environment().putAll(vars);
        Process run = example.start();
        String out = output(run, 30);
        return new String[] {String.valueOf(run.exitValue()), out};
    }

    /**
     * A process's output, read on its own thread, once it ends within {@code seconds}; a
     * process still running then is killed and the test fails, rather than hanging on the pipe.
     */
    static String output(Process run, int seconds) throws Exception {
        java.util.concurrent.CompletableFuture<String> out = java.util.concurrent.CompletableFuture.supplyAsync(() -> {
            try {
                return new String(run.getInputStream().readAllBytes(), StandardCharsets.UTF_8);
            } catch (java.io.IOException e) {
                return "";
            }
        });
        if (!run.waitFor(seconds, TimeUnit.SECONDS)) {
            run.destroyForcibly(); // closes its pipe, so what it printed so far can be read
            String said = out.get(5, TimeUnit.SECONDS);
            throw new AssertionError("still running after " + seconds + " s: " + (said.isEmpty() ? "(no output)" : said));
        }
        return out.get(5, TimeUnit.SECONDS);
    }

    /** FirstSettings.parse on {@code text}: what it read, and the lines it printed. */
    static Map<?, ?> exampleParse(String text, List<String> problems) throws Exception {
        java.lang.reflect.Method parse = Class.forName("FirstSettings").getDeclaredMethod("parse", String.class, java.util.function.Consumer.class);
        parse.setAccessible(true);
        java.util.function.Consumer<String> add = problems::add;
        return (Map<?, ?>) parse.invoke(null, text, add);
    }

    @Test
    void theExampleReadsDotenvAsTheHelpersDo() throws Exception {
        for (String[] c : EnvTest.PYTHON_DOTENV) {
            Map<String, String> expected = c.length == 1 ? Map.of() : Map.of(c[1], c[2]);
            assertEquals(expected, exampleParse(c[0] + "\n", new java.util.ArrayList<>()), c[0]);
        }
        for (String[] c : EnvTest.PYTHON_DOTENV_FILES) {
            assertEquals(EnvTest.pairs(c), exampleParse(c[0], new java.util.ArrayList<>()), c[0]);
        }
        String bad = "A=1\nB=\"x\nC='y' z\nKEY: v\n# a\u0085b\n# c\u2028d\n";
        List<String> exampleSaid = new java.util.ArrayList<>();
        List<String> helpersSaid = new java.util.ArrayList<>();
        exampleParse(bad, exampleSaid);
        Env.parse(bad, helpersSaid::add);
        assertEquals(helpersSaid, exampleSaid, "the same line for a line it can't read");
        assertEquals(List.of(Env.unreadLine(2), Env.unreadLine(3), Env.badLine(4)), exampleSaid);
    }

    @Test
    void aQuotedKeyInDotenvReachesTheServerWithoutItsQuotes(@TempDir Path dir) throws Exception {
        Files.writeString(dir.resolve(".env"), "\uFEFFDEEPGRAM_API_KEY=\"" + Testing.REPLAY_KEY + "\" # mine\n");
        try (FakeAgent server = new FakeAgent()) {
            server.afterApplied = ws -> ws.close(1000, "done");
            String[] r = runExample(dir, Map.of("DEEPGRAM_AGENT_URL", server.url()));
            assertEquals("0", r[0], r[1]);
            assertEquals("Token " + Testing.REPLAY_KEY, server.server.takeRequest().getHeader("Authorization"));
            // Its Settings, as the SDK wrote them, have each key once.
            assertEquals("Settings", FakeAgent.strict(server.frames.get(0)).path("type").asText());
            assertEquals("deepgram", FakeAgent.strict(server.frames.get(0)).at("/agent/listen/provider/type").asText());
        }
    }

    @Test
    void aQuotedKeyWithATrailingNoBreakSpaceReachesTheServerWithoutIt(@TempDir Path dir) throws Exception {
        Files.writeString(dir.resolve(".env"), "DEEPGRAM_API_KEY=\"" + Testing.REPLAY_KEY + "\u00A0\"\n", StandardCharsets.UTF_8);
        try (FakeAgent server = new FakeAgent()) {
            server.afterApplied = ws -> ws.close(1000, "done");
            String[] r = runExample(dir, Map.of("DEEPGRAM_AGENT_URL", server.url()));
            assertEquals("0", r[0], r[1]);
            assertEquals("Token " + Testing.REPLAY_KEY, server.server.takeRequest().getHeader("Authorization"));
        }
    }

    @Test
    void aDeepgramAgentUrlWithATrailingNoBreakSpaceStillConnects(@TempDir Path dir) throws Exception {
        try (FakeAgent server = new FakeAgent()) {
            Files.writeString(dir.resolve(".env"), "DEEPGRAM_AGENT_URL=\"" + server.url() + "\u00A0\"\n", StandardCharsets.UTF_8);
            server.afterApplied = ws -> ws.close(1000, "done");
            String[] r = runExample(dir, Map.of("DEEPGRAM_API_KEY", "x-test-key"));
            assertEquals("0", r[0], r[1]);
        }
    }

    @Test
    void aConverseUrlWithATrailingSlashIsntAddedTwice(@TempDir Path dir) throws Exception {
        try (FakeAgent server = new FakeAgent()) {
            server.afterApplied = ws -> ws.close(1000, "done");
            String[] r = runExample(dir, Map.of("DEEPGRAM_API_KEY", "x-test-key", "DEEPGRAM_AGENT_URL", server.url() + "/v1/agent/converse/"));
            assertEquals("0", r[0], r[1]);
            assertEquals("/v1/agent/converse", server.server.takeRequest().getPath());
        }
    }

    @Test
    void aVoiceItCantSaveSaysWhyAndWhatToDo(@TempDir Path dir) throws Exception {
        Files.writeString(dir.resolve("out"), "a file where the folder should be");
        Path wav = dir.resolve("out").resolve("voice.wav");
        try (FakeAgent server = new FakeAgent()) {
            server.afterApplied = ws -> {
                ws.send(okio.ByteString.of((byte) 1, (byte) 2));
                ws.close(1000, "done");
            };
            String[] r = runExample(dir, Map.of("DEEPGRAM_API_KEY", "x-test-key", "DEEPGRAM_AGENT_URL", server.url()), wav);
            assertTrue(r[1].contains("Couldn't save the agent's voice to " + wav + ": " + dir.resolve("out") + " is a file, not a folder. "
                    + "Move or rename that file, then run this again."), r[1]);
        }
    }

    @Test
    void stoppingTheExampleSaysByeAndAnEndOfItsOwnDoesnt(@TempDir Path dir) throws Exception {
        try (FakeAgent server = new FakeAgent()) {
            Files.createDirectories(dir.resolve("java"));
            String java = Paths.get(System.getProperty("java.home"), "bin", "java").toString();
            ProcessBuilder pb = new ProcessBuilder(java, "-cp", System.getProperty("java.class.path"), "FirstSettings",
                    dir.resolve("voice.wav").toString()).directory(dir.resolve("java").toFile()).redirectErrorStream(true);
            pb.environment().keySet().removeIf(n -> n.startsWith("DEEPGRAM_") || n.startsWith("WORKSHOP_"));
            pb.environment().putAll(Map.of("DEEPGRAM_API_KEY", "x-test-key", "DEEPGRAM_AGENT_URL", server.url()));
            Process p = pb.start();
            BufferedReader in = new BufferedReader(new InputStreamReader(p.getInputStream(), StandardCharsets.UTF_8));
            String line;
            while ((line = in.readLine()) != null && !line.startsWith("[ready]")) { }
            // SIGINT, as Ctrl-C sends (Process.destroy() would close this end of the pipe too).
            new ProcessBuilder("kill", "-INT", String.valueOf(p.pid())).start().waitFor();
            StringBuilder rest = new StringBuilder();
            while ((line = in.readLine()) != null) rest.append(line).append('\n');
            assertTrue(p.waitFor(10, TimeUnit.SECONDS));
            assertTrue(rest.toString().contains("[bye]"), rest.toString());
        }
        try (FakeAgent server = new FakeAgent()) {
            server.afterApplied = ws -> ws.close(1000, "done");
            String[] r = runExample(dir, Map.of("DEEPGRAM_API_KEY", "x-test-key", "DEEPGRAM_AGENT_URL", server.url()));
            assertEquals("0", r[0], r[1]);
            assertTrue(!r[1].contains("[bye]"), r[1]);
        }
    }

    @Test
    void aKeyWithACurlyQuoteSaysSoBeforeConnecting(@TempDir Path dir) throws Exception {
        // From .env, as a notes app pastes it (in a shell with no locale, it would arrive as '?').
        Files.writeString(dir.resolve(".env"), "DEEPGRAM_API_KEY=\u201cabc\u201d\n", StandardCharsets.UTF_8);
        String[] r = runExample(dir, Map.of("DEEPGRAM_AGENT_URL", "ws://127.0.0.1:9"));
        assertEquals("2", r[0], r[1]);
        assertEquals(Credentials.badCharacter("DEEPGRAM_API_KEY", "a key"), r[1].strip());
    }

    @Test
    void nothingListeningIsCouldNotReachTheAgent(@TempDir Path dir) throws Exception {
        int port;
        try (java.net.ServerSocket s = new java.net.ServerSocket(0, 1, java.net.InetAddress.getLoopbackAddress())) {
            port = s.getLocalPort();
        }
        String[] r = runExample(dir, Map.of("DEEPGRAM_API_KEY", "x-test-key", "DEEPGRAM_AGENT_URL", "ws://127.0.0.1:" + port));
        assertEquals("2", r[0], r[1]);
        assertEquals("Could not reach the agent: connection refused. Check DEEPGRAM_AGENT_URL.", r[1].strip());
    }

    @Test
    void noKeyAsksForAKeyAndNeverTheTokenLines(@TempDir Path dir) throws Exception {
        // The two token lines set and no key: the example reads the key only and says so in its
        // own words, never asking for lines it ignores. With .env present, the "is empty" form;
        // without one, the "No Deepgram credentials" form.
        Map<String, String> vars = Map.of(
                "DEEPGRAM_API_KEY", "", "DEEPGRAM_AGENT_URL", "ws://127.0.0.1:9",
                "WORKSHOP_TOKEN", "wst_unit-test-token", "WORKSHOP_URL", "ws://127.0.0.1:9/sdk");
        Files.writeString(dir.resolve(".env"), "DEEPGRAM_API_KEY=\n");
        String[] r = runExample(dir, vars);
        assertEquals("2", r[0], r[1]);
        assertEquals("DEEPGRAM_API_KEY is empty in .env (this folder). Set it: this example "
                + "runs on your own key only (make run takes a workshop token too). "
                + "make check NN runs offline with no key.", r[1].strip());
        Files.delete(dir.resolve(".env"));
        r = runExample(dir, vars);
        assertEquals("2", r[0], r[1]);
        assertEquals("No Deepgram credentials. Copy .env.example to .env and set "
                + "DEEPGRAM_API_KEY (free key: https://console.deepgram.com/signup): "
                + "this example runs on your own key only (make run takes a workshop token too).",
                r[1].strip());
    }

    @Test
    void aDropEndsTheExampleWithOneConnection(@TempDir Path dir) throws Exception {
        try (java.net.ServerSocket raw = new java.net.ServerSocket(0, 5, java.net.InetAddress.getLoopbackAddress())) {
            java.util.concurrent.atomic.AtomicInteger accepted = new java.util.concurrent.atomic.AtomicInteger();
            Thread dropper = new Thread(() -> {
                try {
                    while (true) {
                        try (java.net.Socket s = raw.accept()) {
                            accepted.incrementAndGet();
                            RunTest.dropAfterWelcome(s);
                        }
                    }
                } catch (java.io.IOException e) {
                    // The test closed the server socket.
                }
            });
            dropper.setDaemon(true);
            dropper.start();
            String[] r = runExample(dir, Map.of("DEEPGRAM_API_KEY", "x-test-key", "DEEPGRAM_AGENT_URL", "ws://127.0.0.1:" + raw.getLocalPort()));
            assertEquals("0", r[0], r[1]);
            assertTrue(r[1].contains("[closed] 1006 no close frame"), r[1]);
            Thread.sleep(500);
            assertEquals(1, accepted.get(), "no reconnect");
        }
    }
}
