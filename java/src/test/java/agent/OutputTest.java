package agent;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.nio.charset.StandardCharsets;
import java.nio.file.Paths;
import org.junit.jupiter.api.Test;

/** Output is UTF-8 whatever the locale says (JDK 17 has no -Dstdout.encoding to fix it). */
class OutputTest {
    static final String LINE = "\u00bfQu\u00e9 tal? \u2014 s\u00ed";

    /** Runs Utf8Probe in a JVM told its console is ASCII, with no locale; its stdout bytes. */
    static byte[] probe(String mode) throws Exception {
        String java = Paths.get(System.getProperty("java.home"), "bin", "java").toString();
        ProcessBuilder pb = new ProcessBuilder(java, "-Dstdout.encoding=US-ASCII", "-Dsun.stdout.encoding=US-ASCII",
                "-Dfile.encoding=US-ASCII", "-cp", System.getProperty("java.class.path"), "agent.Utf8Probe", mode);
        pb.environment().remove("LANG");
        pb.environment().remove("LC_ALL");
        pb.environment().remove("LC_CTYPE");
        Process p = pb.start();
        byte[] out = p.getInputStream().readAllBytes();
        assertEquals(0, p.waitFor());
        return out;
    }

    @Test
    void utf8OutputPrintsUtf8OnAnAsciiConsole() throws Exception {
        assertArrayEquals((LINE + System.lineSeparator()).getBytes(StandardCharsets.UTF_8), probe("wrapped"));
    }

    @Test
    void withoutItTheSameLineComesOutAsQuestionMarks() throws Exception {
        // The control: this is what Common.run and Check.main would print without the wrap.
        String plain = new String(probe("plain"), StandardCharsets.US_ASCII);
        assertTrue(plain.contains("?Qu? tal"), plain);
    }
}
