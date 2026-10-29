package agent;

import static org.junit.jupiter.api.Assertions.assertEquals;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/** Env.stripped: a variable trimmed as Python's str.strip() trims it (mission 03's model id). */
class EnvStrippedTest {
    @AfterEach
    void reset() {
        Env.resetForTests();
    }

    @Test
    void trimsUnicodeSpacesAsPythonDoes() {
        Env.useForTests(Map.of("THINKING_MODEL", "\u00A0\u3000 model-id\t\u2003\n"), null);
        assertEquals("model-id", Env.stripped("THINKING_MODEL"));
    }

    @Test
    void keepsSpacesInsideTheValue() {
        Env.useForTests(Map.of("THINKING_MODEL", " a b "), null);
        assertEquals("a b", Env.stripped("THINKING_MODEL"));
    }

    @Test
    void anUnsetVariableIsEmpty() {
        Env.useForTests(Map.of(), null);
        assertEquals("", Env.stripped("THINKING_MODEL"));
    }

    @Test
    void readsDotenvToo(@TempDir Path dir) throws Exception {
        Path file = dir.resolve(".env");
        Files.writeString(file, "THINKING_MODEL=\"\u00A0from-file\u00A0\"\n");
        Env.useForTests(Map.of(), file);
        assertEquals("from-file", Env.stripped("THINKING_MODEL"));
    }
}
