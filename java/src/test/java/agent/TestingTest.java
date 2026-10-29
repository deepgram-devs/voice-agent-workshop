package agent;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.ByteArrayOutputStream;
import java.io.PrintStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;
import org.junit.jupiter.api.io.TempDir;

/** The check driver: what a person reads when a check fails, and that the harness runs it. */
// SEPARATE_THREAD: a test stuck in a blocking pipe read (which ignores interrupts) still fails
// at 60 s.
@Timeout(value = 60, threadMode = Timeout.ThreadMode.SEPARATE_THREAD)
class TestingTest {
    @BeforeEach
    void env() {
        Env.useForTests(Map.of("PATH", String.valueOf(System.getenv("PATH"))), null);
    }

    @AfterEach
    void reset() {
        Env.resetForTests();
    }

    @Test
    void whereToEditPointsAtTheFirstFailingTodo(@TempDir Path dir) throws Exception {
        Path file = dir.resolve("Start.java");
        Files.writeString(file, "class Start {\n    // TODO 1: one\n    int a;\n    // TODO 12: twelve\n    //TODO 2: two\n}\n");
        String report = "x\n  PASS  TODO 1: ok\n  FAIL  TODO 2: the thing\n  FAIL  TODO 1: other";
        assertEquals("Your file: " + file + ":5 (TODO 2)", Testing.whereToEdit(file, report));
        assertEquals("Your file: " + file, Testing.whereToEdit(file, "no failing todo here"));
        // The TODO comment gone, or no TODO in the report: the line of buildSettings(), where the Settings are.
        Path built = dir.resolve("Built.java");
        Files.writeString(built, "class Built {\n    static final String VOICE = \"x\";\n\n    public ObjectNode buildSettings() {\n        return null;\n    }\n}\n");
        assertEquals("Your file: " + built + ":4 (TODO 2; its // TODO comment is gone, so start at buildSettings())",
                Testing.whereToEdit(built, "FAIL  TODO 2: you picked a voice"));
        assertEquals("Your file: " + built + ":4 (buildSettings())", Testing.whereToEdit(built, "FAIL  agent.speak.provider: aura-2-thalia-en is an Aura voice"));
        assertEquals("Your file: " + built, Testing.whereToEdit(built, "No Deepgram credentials. Copy..."));
        Path shown = Common.PROJECT_ROOT.resolve("java/missions/m00_first_words/Start.java");
        assertTrue(Testing.whereToEdit(shown, "  FAIL  TODO 3: x").startsWith("Your file: java/missions/m00_first_words/Start.java:"));
    }

    @Test
    void theReportLeavesOutReadyAndVerdictLines() {
        assertEquals("one\n  two", Testing.report(List.of("", "READY ws://127.0.0.1:1", "one", "  two", "VERDICT {\"pass\":false}", "")));
    }

    @Test
    void missionNamesAndTargets() {
        assertEquals("00-first-words", Testing.missionName("m00_first_words"));
        assertEquals("06-encore", Testing.missionName("m06_encore"));
        assertThrows(IllegalArgumentException.class, () -> Testing.missionName("agent"));
        assertEquals("Start", Testing.target());
        Env.useForTests(Map.of("MISSION_TARGET", "solution"), null);
        assertEquals("Solution", Testing.target());
        assertTrue(Testing.targetPath("m01_let_me_finish").endsWith(Path.of("java/missions/m01_let_me_finish/Solution.java")));
    }

    @Test
    void theTargetComesFromMissionShOrTheShellNeverFromDotenv(@TempDir Path dir) throws Exception {
        Path dotenv = dir.resolve(".env");
        Files.writeString(dotenv, "MISSION_TARGET=solution\n");
        Env.useForTests(Map.of(), dotenv);
        assertEquals("Start", Testing.target(), "mission.sh compiled Start.java: .env doesn't change that");
        String before = System.getProperty("workshop.target");
        try {
            System.setProperty("workshop.target", "Solution");
            assertEquals("Solution", Testing.target());
        } finally {
            if (before == null) System.clearProperty("workshop.target");
            else System.setProperty("workshop.target", before);
        }
    }

    @Test
    void aLiveCheckWithNoCredentialsFailsAtOnceWithTheLiveHint(@TempDir Path dir) throws Exception {
        // env() (BeforeEach) points .env at a file that isn't there: the copy line, then the live hint.
        long t0 = System.nanoTime();
        Testing.Verdict v = Testing.checkLive("m00_first_words", new m00_first_words.Solution());
        assertFalse(v.passed());
        assertEquals(Credentials.NO_CREDENTIALS + "\n" + Testing.liveHint("00-first-words"), v.report());
        assertTrue((System.nanoTime() - t0) / 1_000_000 < 5000);
        // With .env there and the key empty (what make setup leaves): the "is empty" line, same hint.
        Files.writeString(dir.resolve(".env"), "DEEPGRAM_API_KEY=\n");
        Env.useForTests(Map.of("PATH", String.valueOf(System.getenv("PATH"))), dir.resolve(".env"));
        v = Testing.checkLive("m00_first_words", new m00_first_words.Solution());
        assertFalse(v.passed());
        String[] lines = v.report().split("\n");
        assertEquals(Credentials.noCredentialsLine("00-first-words", true), lines[0]);
        assertTrue(lines[0].endsWith("make check 00 runs offline with no key."), lines[0]);
        assertEquals(Testing.liveHint("00-first-words"), lines[1]);
    }

    @Test
    void aLiveCheckWithABadKeySaysOnlyTheKeyLineAndNeverConnects() throws Exception {
        // DEEPGRAM_AGENT_URL is where the harness's live upstream goes: a listener that counts.
        java.net.InetAddress loopback = java.net.InetAddress.getLoopbackAddress();
        try (java.net.ServerSocket listener = new java.net.ServerSocket(0, 50, loopback)) {
            java.util.concurrent.atomic.AtomicInteger connections = new java.util.concurrent.atomic.AtomicInteger();
            Thread accept = new Thread(() -> {
                try {
                    while (true) {
                        listener.accept().close();
                        connections.incrementAndGet();
                    }
                } catch (java.io.IOException e) {
                    // closed at the end of the test
                }
            });
            accept.setDaemon(true);
            accept.start();
            Env.useForTests(Map.of("PATH", String.valueOf(System.getenv("PATH")),
                    "DEEPGRAM_API_KEY", "\u201Cabc\u201D",
                    "DEEPGRAM_AGENT_URL", "ws://127.0.0.1:" + listener.getLocalPort()), null);
            Testing.Verdict v = Testing.checkLive("m00_first_words", new m00_first_words.Solution());
            assertFalse(v.passed());
            // The line ends on its own fix: no live hint after it.
            assertEquals(Credentials.badCharacter("DEEPGRAM_API_KEY", "a key"), v.report());
            assertEquals(0, connections.get());
        }
    }

    @Test
    void aHarnessThatIsntInstalledSaysToRunMakeSetup(@TempDir Path dir) {
        IllegalStateException e = assertThrows(IllegalStateException.class,
                () -> Testing.node(dir.resolve("harness.mjs"), System.getenv("PATH")));
        assertEquals("The check harness isn't installed. Run make setup in the voice-agent-workshop folder.", e.getMessage());
    }

    @Test
    void noNodeAtAllIsTheMakefilesLineWithYouHaveNone(@TempDir Path dir) throws Exception {
        String line = Files.readAllLines(Common.PROJECT_ROOT.resolve("Makefile")).stream()
                .filter(l -> l.startsWith("MSG_NODE_OLD = ")).findFirst().orElseThrow();
        String expected = line.substring("MSG_NODE_OLD = ".length()).replace("$$(node -v 2>/dev/null || echo none)", "none");
        assertFalse(expected.contains("$"), expected);
        IllegalStateException e = assertThrows(IllegalStateException.class, () -> Testing.node(dir.resolve("harness.mjs"), dir.toString()));
        assertEquals(expected, e.getMessage());
    }

    @Test
    void aHarnessThatStopsSilentlyStillSaysWhatToDo(@TempDir Path dir) throws Exception {
        Path fake = dir.resolve("replay-server").resolve("harness.mjs");
        Files.createDirectories(fake.getParent().resolve("node_modules"));
        for (String[] c : new String[][] {{"process.exit(3);", "exit 3"}, {"process.kill(process.pid, 'SIGKILL');", "exit 137, or signal 9"}, {"process.exit(255);", "exit 255, or signal 127"}}) {
            Files.writeString(fake, c[0] + "\n");
            IllegalStateException e = assertThrows(IllegalStateException.class, () -> Testing.replayScenarios(fake, "00-first-words"));
            assertEquals("The check harness stopped (" + c[1] + ") without a message. Run make setup, then try again.", e.getMessage());
        }
        Files.writeString(fake, "console.error('the harness says why'); process.exit(2);\n");
        IllegalStateException said = assertThrows(IllegalStateException.class, () -> Testing.replayScenarios(fake, "00-first-words"));
        assertEquals("the harness says why", said.getMessage());
    }

    @Test
    void aLongStderrFromTheHarnessDoesntStallIt(@TempDir Path dir) throws Exception {
        Path fake = dir.resolve("replay-server").resolve("harness.mjs");
        Files.createDirectories(fake.getParent().resolve("node_modules"));
        // 1 MB of stderr first: read after stdout on one thread, the harness would block on a
        // full pipe.
        Files.writeString(fake, "process.stderr.write('x'.repeat(1 << 20), () => process.stdout.write(JSON.stringify({ replay: ['a', 'b'] })));\n");
        assertEquals(List.of("a", "b"), Testing.replayScenarios(fake, "00-first-words"));
    }

    @Test
    void theHarnessIsStoppedWhenTheCheckEndsEarly() throws Exception {
        // Interrupted while the harness waits for the program: the harness must not
        // outlive the check. buildSettings blocks on a latch the test releases at the
        // end, so its thread never prints later.
        java.util.concurrent.CountDownLatch release = new java.util.concurrent.CountDownLatch(1);
        Thread check = new Thread(() -> {
            try {
                Testing.checkReplay("m00_first_words", new Mission() {
                    @Override
                    public ObjectNode buildSettings() {
                        try {
                            release.await();
                        } catch (InterruptedException e) {
                            Thread.currentThread().interrupt();
                        }
                        throw new IllegalStateException("released");
                    }
                }, "greeting");
            } catch (Exception e) {
                // InterruptedException, expected
            }
        });
        check.start();
        try {
            long until = System.currentTimeMillis() + 10_000;
            while (harnesses().isEmpty() && System.currentTimeMillis() < until) Thread.sleep(50);
            assertFalse(harnesses().isEmpty(), "the harness started");
            check.interrupt();
            check.join(10_000);
            until = System.currentTimeMillis() + 5_000;
            while (!harnesses().isEmpty() && System.currentTimeMillis() < until) Thread.sleep(50);
            assertTrue(harnesses().isEmpty(), "the harness was stopped");
        } finally {
            release.countDown();
        }
    }

    static List<ProcessHandle> harnesses() {
        return ProcessHandle.current().children()
                .filter(p -> p.isAlive() && p.info().commandLine().orElse("").contains("harness.mjs"))
                .toList();
    }

    /** Runs Check on a mission package, capturing what it prints. */
    static String[] check(String... args) {
        ByteArrayOutputStream buf = new ByteArrayOutputStream();
        PrintStream old = System.out;
        System.setOut(new PrintStream(buf, true, StandardCharsets.UTF_8));
        int status;
        try {
            status = Check.run(args);
        } finally {
            System.setOut(old);
        }
        return new String[] {String.valueOf(status), buf.toString(StandardCharsets.UTF_8)};
    }

    @Test
    void checkPrintsTheReportWithNoStackTraceAndExits1() {
        String[] r = check("m00_first_words");
        assertEquals("1", r[0], r[1]);
        assertTrue(r[1].contains("  FAIL  TODO 1: the prompt is your own"), r[1]);
        assertTrue(r[1].contains("Your file: java/missions/m00_first_words/Start.java:"), r[1]);
        assertTrue(r[1].strip().endsWith("1 failed, 0 passed"), r[1]);
        assertFalse(r[1].contains("READY ") || r[1].contains("VERDICT "), r[1]);
        // ci-starts reads these two as a crash: Check never prints them for a plain failure.
        assertFalse(r[1].contains("your program stopped with") || r[1].contains("harness: "), r[1]);
        assertFalse(r[1].contains("\tat "), r[1]);
    }

    @Test
    void checkPassesTheSolution() {
        Env.useForTests(Map.of("MISSION_TARGET", "solution", "PATH", String.valueOf(System.getenv("PATH"))), null);
        String[] r = check("m01_let_me_finish");
        assertEquals("0", r[0], r[1]);
        assertTrue(r[1].strip().endsWith("1 passed"), r[1]);
    }

    @Test
    void aProgramThatThrowsIsReportedAsStoppedWithTheExceptionsLine() throws Exception {
        Mission broken = new Mission() {
            @Override
            public ObjectNode buildSettings() {
                return new m00_first_words.Solution().buildSettings();
            }

            @Override
            public void onEvent(Agent agent, Event event) {
                if (event.type().equals("SettingsApplied")) throw new IllegalStateException("boom");
            }
        };
        PrintStream old = System.out;
        System.setOut(new PrintStream(new ByteArrayOutputStream(), true, StandardCharsets.UTF_8)); // what the program prints
        Testing.Verdict v;
        try {
            v = Testing.checkReplay("m00_first_words", broken, "greeting");
        } finally {
            System.setOut(old);
        }
        assertFalse(v.passed());
        assertTrue(v.report().contains("your program stopped with IllegalStateException: boom"), v.report());
        assertTrue(v.report().contains("Your file: java/missions/m00_first_words/Start.java"), v.report());
    }
}
