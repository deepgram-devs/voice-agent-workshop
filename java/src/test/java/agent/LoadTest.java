package agent;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.lang.reflect.InvocationTargetException;
import java.nio.file.Paths;
import java.util.Arrays;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;

/** What a person sees when their mission can't be made, or throws: one line, or a short trace. */
@Timeout(value = 60, threadMode = Timeout.ThreadMode.SEPARATE_THREAD)
class LoadTest {
    /** A mission whose static initializer throws. */
    public static class StaticThrows implements Mission {
        static final int X = Integer.parseInt("nope");

        @Override
        public com.fasterxml.jackson.databind.node.ObjectNode buildSettings() {
            return Json.obj("x", X);
        }
    }

    /** A mission whose field initializer throws. */
    public static class FieldThrows implements Mission {
        final int x = Integer.parseInt("seven");

        @Override
        public com.fasterxml.jackson.databind.node.ObjectNode buildSettings() {
            return Json.obj("x", x);
        }
    }

    @Test
    void cantLoadNamesWhatTheInitializerThrewNotJavasWrapper() {
        NumberFormatException cause = new NumberFormatException("For input string: \"nope\"");
        assertEquals("Can't load m00_first_words.Start: NumberFormatException: For input string: \"nope\"",
                Testing.cantLoad("m00_first_words.Start", new ExceptionInInitializerError(cause)));
        assertEquals("Can't load m00_first_words.Start: NumberFormatException: For input string: \"nope\"",
                Testing.cantLoad("m00_first_words.Start", new InvocationTargetException(cause)));
        assertEquals("Can't load x.Y: ClassNotFoundException: x.Y", Testing.cantLoad("x.Y", new ClassNotFoundException("x.Y")));
    }

    /** Runs agent.Run on a class, with its own pipes read off this thread; {exit code, output}. */
    static String[] run(String... args) throws Exception {
        String java = Paths.get(System.getProperty("java.home"), "bin", "java").toString();
        String[] cmd = new String[args.length + 4];
        cmd[0] = java;
        cmd[1] = "-cp";
        cmd[2] = System.getProperty("java.class.path");
        cmd[3] = "agent.Run";
        System.arraycopy(args, 0, cmd, 4, args.length);
        ProcessBuilder pb = new ProcessBuilder(cmd).redirectErrorStream(true);
        pb.environment().keySet().removeIf(n -> n.startsWith("DEEPGRAM_") || n.startsWith("WORKSHOP_"));
        Process p = pb.start();
        String out = ExamplesTest.output(p, 30);
        return new String[] {String.valueOf(p.exitValue()), out};
    }

    @Test
    void makeRunGetsTheSameLineForAStaticOrFieldInitializerThatThrows() throws Exception {
        String[] st = run("agent", "LoadTest$StaticThrows");
        assertEquals("1", st[0], st[1]);
        assertEquals("Can't load agent.LoadTest$StaticThrows: NumberFormatException: For input string: \"nope\"", st[1].strip());
        String[] field = run("agent", "LoadTest$FieldThrows");
        assertEquals("1", field[0], field[1]);
        assertEquals("Can't load agent.LoadTest$FieldThrows: NumberFormatException: For input string: \"seven\"", field[1].strip());
        assertFalse(field[1].contains("\tat "), field[1]);
    }

    static Throwable deep(String message, int frames) {
        RuntimeException e = new RuntimeException(message);
        StackTraceElement[] stack = new StackTraceElement[frames];
        Arrays.setAll(stack, i -> new StackTraceElement("m00_first_words.Start", "deep", "Start.java", i + 1));
        e.setStackTrace(stack);
        return e;
    }

    @Test
    void theTraceStopsAt20FramesAndSaysHowToSeeTheRest() {
        String t = Common.trace(deep("boom", 1000), Common.TRACE_FRAMES, Common.moreHint("00"));
        assertEquals(20, t.split("\tat ", -1).length - 1, t);
        assertTrue(t.startsWith("java.lang.RuntimeException: boom\n"), t);
        assertTrue(t.endsWith("\t... 980 more (to print them all: JAVA_TOOL_OPTIONS=-Dworkshop.fulltrace=true make run 00 SDK=java)\n"), t);
        assertEquals(1000, Common.trace(deep("boom", 1000), Integer.MAX_VALUE, "").split("\tat ", -1).length - 1);
    }

    @Test
    void causesAndSuppressedFollowEachOnceEvenInALoop() {
        Throwable a = deep("a", 3);
        Throwable b = deep("b", 3);
        a.initCause(b);
        b.initCause(a); // a loop: a -> b -> a
        a.addSuppressed(deep("s", 2));
        String t = Common.trace(a, 20, "");
        assertTrue(t.contains("\tSuppressed: java.lang.RuntimeException: s\n"), t);
        assertTrue(t.contains("Caused by: java.lang.RuntimeException: b\n"), t);
        assertTrue(t.contains("[CIRCULAR REFERENCE: java.lang.RuntimeException: a]"), t);
        assertEquals(1, t.split("RuntimeException: b\n", -1).length - 1, t);
    }

    @Test
    void outputHelperKillsAProcessThatDoesntEnd() throws Exception {
        String java = Paths.get(System.getProperty("java.home"), "bin", "java").toString();
        Process p = new ProcessBuilder(java, "-cp", System.getProperty("java.class.path"), "agent.LoadTest$Sleeper").start();
        long t0 = System.nanoTime();
        AssertionError e = org.junit.jupiter.api.Assertions.assertThrows(AssertionError.class, () -> ExamplesTest.output(p, 2));
        assertEquals("still running after 2 s: started, never ends", e.getMessage().strip(), "what it printed so far is kept");
        assertTrue(p.waitFor(5, TimeUnit.SECONDS), "killed");
        assertTrue((System.nanoTime() - t0) / 1_000_000 < 10_000);
    }

    /** Never ends on its own. */
    public static class Sleeper {
        public static void main(String[] args) throws InterruptedException {
            System.out.println("started, never ends");
            Thread.sleep(600_000);
        }
    }
}
