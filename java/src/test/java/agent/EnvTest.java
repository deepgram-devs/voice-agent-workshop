package agent;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class EnvTest {
    @AfterEach
    void reset() {
        Env.resetForTests();
    }

    /**
     * Each line read alone, and what python-dotenv 1.2.4 (python/uv.lock) reads from it:
     * the key and value, or nothing when it drops the line. Recorded with dotenv_values()
     * in a python:3.12-slim container. Multi-line quoted values aren't supported here
     * (see Env.parse).
     */
    static final String[][] PYTHON_DOTENV = {
            {"KEY: v"},
            {"KEY v"},
            {"'k=1"},
            {"export =x"},
            {"''=x"},
            {"export=1", "export", "1"},
            {"A'B=1", "A'B", "1"},
            {"\"A=1", "\"A", "1"},
            {"A=plain", "A", "plain"},
            {"A=plain # comment", "A", "plain"},
            {"A=#nothing", "A", "#nothing"},
            {"A=a#b", "A", "a#b"},
            {"A=", "A", ""},
            {"export A=1", "A", "1"},
            {"A = spaced ", "A", "spaced"},
            {"A=\"abc\" # mine", "A", "abc"},
            {"A='x y'   # single", "A", "x y"},
            {"A=\"unclosed"},
            {"A='unclosed"},
            {"A=\"a\" trailing words"},
            {"A='a' trailing words"},
            {"A=\"#not a comment\"", "A", "#not a comment"},
            {"A=\"say \\\"hi\\\" \\\\ ok\\n\"", "A", "say \"hi\" \\ ok\n"},
            {"A=\"tab\\there\"", "A", "tab\there"},
            {"A='single \\n \\t \\\\ \\' literal'", "A", "single \\n \\t \\ ' literal"},
            {"A='it''s'"},
            {"A=unquoted \\t \\n", "A", "unquoted \\t \\n"},
            {"A.B=1", "A.B", "1"},
            {"A-B=1", "A-B", "1"},
            {"1A=1", "1A", "1"},
            {"A B=1"},
            {"A=1\r", "A", "1"},
            {"\ufeffA=1", "A", "1"},
            {"A= #c", "A", ""},
            {"A=  value # c", "A", "value"},
            {"A=x\t#c", "A", "x"},
            {"A=\"q\"#c", "A", "q"},
            {"A=\"a\\x41\\u00e9\"", "A", "a\\x41\\u00e9"},
            {"A=\"\"", "A", ""},
            {"A=''", "A", ""},
            {"A=\"a\" ", "A", "a"},
    };

    /**
     * Whole files and what python-dotenv 1.2.4 reads from them (interpolate=False: ${VAR} isn't
     * expanded here), as {text, key, value, key, value...}; recorded the same way.
     */
    static final String[][] PYTHON_DOTENV_FILES = {
            {"A=1\nA\n"},
            {"A\nA=1\n", "A", "1"},
            {"A=1\nexport A\n"},
            {"A=1\nA # c\n"},
            {"A=1\n'A'\n"},
            {"A=1\nB\n", "A", "1"},
            {"A=1\rB=2\r", "A", "1", "B", "2"},
            {"A=1\r\nB=2\rC=3\n", "A", "1", "B", "2", "C", "3"},
            {"'A'=1\n", "A", "1"},
            {"'A B'=1\n", "A B", "1"},
            {"'A=1\n"},
            {"A=x\u00a0#c\n", "A", "x"},
            {"A=x\u001c#c\n", "A", "x"},
            {"A=x\u2003#c\n", "A", "x"},
            {"A=x\u3000#c\n", "A", "x"},
            {"A=a\u0085b\n", "A", "a\u0085b"},
            {"A=a\u2028b\n", "A", "a\u2028b"},
            {"A=a\u00a0b\n", "A", "a\u00a0b"},
            {"A=\u00a0x\n", "A", "x"},
            {"A=x\u00a0\n", "A", "x"},
            {"A=\"q\"\u00a0#c\n", "A", "q"},
            {"A=\"q\"\u001c\n", "A", "q"},
            {"A=x\u001c\n", "A", "x"},
            {"A=${B}\n", "A", "${B}"},
            {"A=\"unclosed\nB=2\n", "B", "2"},
    };

    static Map<String, String> pairs(String[] c) {
        Map<String, String> m = new java.util.LinkedHashMap<>();
        for (int i = 1; i + 1 < c.length; i += 2) m.put(c[i], c[i + 1]);
        return m;
    }

    @Test
    void readsEveryFileAsPythonDotenvDoes() {
        for (String[] c : PYTHON_DOTENV_FILES) assertEquals(pairs(c), Env.parse(c[0]), c[0]);
    }

    @Test
    void aLineDroppedForItsQuoteIsNamedByNumber(@TempDir Path dir) throws Exception {
        java.util.List<String> problems = new java.util.ArrayList<>();
        assertEquals(Map.of("A", "1", "C", "3"), Env.parse("A=1\r\nB=\"x\nC=3\nD='y' z\n", problems::add));
        assertEquals(java.util.List.of(Env.unreadLine(2), Env.unreadLine(4)), problems);
        java.util.List<String> bad = new java.util.ArrayList<>();
        assertEquals(Map.of("A", "1"), Env.parse("# a comment\n\nA=1\nDEEPGRAM_API_KEY: abc\n", bad::add));
        assertEquals(java.util.List.of(Env.badLine(4)), bad);
        assertEquals(".env line 4 couldn't be read: it isn't KEY=value. Fix that line, then run this again.", Env.badLine(4));
        assertEquals(".env line 2 couldn't be read: its quote never closes, or text follows the closing quote. "
                + "Fix that line, then run this again.", Env.unreadLine(2));
        Path dotenv = dir.resolve(".env");
        Files.writeString(dotenv, "DEEPGRAM_API_KEY=\"abc\n");
        java.io.ByteArrayOutputStream err = new java.io.ByteArrayOutputStream();
        java.io.PrintStream old = System.err;
        System.setErr(new java.io.PrintStream(err, true, java.nio.charset.StandardCharsets.UTF_8));
        try {
            Env.useForTests(Map.of(), dotenv);
            Env.load();
        } finally {
            System.setErr(old);
        }
        String said = err.toString(java.nio.charset.StandardCharsets.UTF_8);
        assertEquals(Env.unreadLine(1) + System.lineSeparator(), said, "once, however often .env is read");
    }

    @Test
    void readsEveryLineAsPythonDotenvDoes() {
        for (String[] c : PYTHON_DOTENV) {
            Map<String, String> expected = c.length == 1 ? Map.of() : Map.of(c[1], c[2]);
            assertEquals(expected, Env.parse(c[0] + "\n"), c[0]);
        }
    }

    @Test
    void aQuotedKeyWithACommentAfterItIsTheKeyAlone() {
        assertEquals("abc", Env.parse("# keys\nexport DEEPGRAM_API_KEY=\"abc\" # mine\r\n").get("DEEPGRAM_API_KEY"));
    }

    @Test
    void aMultiLineQuotedValueIsDroppedNotCut() {
        assertEquals(Map.of("B", "2"), Env.parse("A=\"one\ntwo\"\nB=2\n"));
    }

    @Test
    void aDotenvThatIsntUtf8IsReadAsEmptyWithOneLine(@TempDir Path dir) throws Exception {
        Path dotenv = dir.resolve(".env");
        Files.write(dotenv, new byte[] {'A', '=', (byte) 0xE9, '\n'});
        java.io.ByteArrayOutputStream err = new java.io.ByteArrayOutputStream();
        java.io.PrintStream old = System.err;
        System.setErr(new java.io.PrintStream(err, true, java.nio.charset.StandardCharsets.UTF_8));
        try {
            Env.useForTests(Map.of(), dotenv);
        } finally {
            System.setErr(old);
        }
        assertEquals("", Env.get("A"));
        assertTrue(err.toString(java.nio.charset.StandardCharsets.UTF_8).contains(".env isn't UTF-8 text"), err.toString());
    }

    @Test
    void theShellWinsEvenWhenEmptyAndDotenvFillsIn(@TempDir Path dir) throws Exception {
        Path dotenv = dir.resolve(".env");
        Files.writeString(dotenv, "DEEPGRAM_API_KEY=from-file\nLISTEN_MODEL=flux-general-en\r\nWORKSHOP_URL=wss://x/sdk\n");
        Env.useForTests(Map.of("DEEPGRAM_API_KEY", "from-shell", "WORKSHOP_URL", ""), dotenv);
        assertEquals("from-shell", Env.get("DEEPGRAM_API_KEY"));
        assertEquals("flux-general-en", Env.get("LISTEN_MODEL"));
        assertEquals("", Env.get("WORKSHOP_URL"), "set in the shell, even empty: the shell wins");
        assertEquals("", Env.get("NOT_SET_ANYWHERE"));
    }

    @Test
    void theChildEnvironmentCarriesDotenvForTheHarness(@TempDir Path dir) throws Exception {
        Path dotenv = dir.resolve(".env");
        Files.writeString(dotenv, "DEEPGRAM_AGENT_URL=wss://example.invalid\nPATH=/nope\n");
        Env.useForTests(Map.of("PATH", "/usr/bin"), dotenv);
        Map<String, String> child = Env.childEnvironment();
        assertEquals("wss://example.invalid", child.get("DEEPGRAM_AGENT_URL"));
        assertEquals("/usr/bin", child.get("PATH"));
    }
}
