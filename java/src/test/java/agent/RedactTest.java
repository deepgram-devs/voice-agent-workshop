package agent;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.IOException;
import java.util.Map;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

class RedactTest {
    static final String KEY = "abcdef0123456789secretkey";
    static final String TOKEN = "eyJhbGciOiJIUzI1NiJ9.workshop.token";

    @BeforeEach
    void env() {
        Env.useForTests(Map.of("DEEPGRAM_API_KEY", KEY, "WORKSHOP_TOKEN", TOKEN), null);
    }

    @AfterEach
    void reset() {
        Env.resetForTests();
    }

    @Test
    void masksTheConfiguredKeyAndToken() {
        String out = Redact.redact("key " + KEY + " and token " + TOKEN);
        assertFalse(out.contains(KEY));
        assertFalse(out.contains(TOKEN));
        assertEquals("key [redacted] and token [redacted]", out);
    }

    @Test
    void aKeyWithATrailingNoBreakSpaceIsMaskedAsItIsSent() {
        Env.useForTests(Map.of("DEEPGRAM_API_KEY", "abcdefgh12\u00A0"), null);
        assertEquals("x [redacted] y", Redact.redact("x abcdefgh12 y"));
    }

    @Test
    void aKeyWithRegexCharactersIsMaskedLiterally() {
        String key = "a.b*c+d(e)[f]$g^h|i\\j";
        Env.useForTests(Map.of("DEEPGRAM_API_KEY", key), null);
        assertEquals("sent [redacted] once", Redact.redact("sent " + key + " once"));
        assertEquals("aXbXXcXXd stays", Redact.redact("aXbXXcXXd stays"));
    }

    @Test
    void masksAuthorizationInEveryShape() {
        for (String text : new String[] {
            "Authorization: Token zzzzzzzzzzzzzzzz",
            "{'authorization': 'Bearer zzzzzzzzzzzzzzzz'}",
            "\"Authorization\"=\"Token zzzzzzzzzzzzzzzz\"",
            "headers={Authorization=Token zzzzzzzzzzzzzzzz, X=1}",
        }) {
            String out = Redact.redact(text);
            assertFalse(out.contains("zzzzzzzzzzzzzzzz"), out);
            assertTrue(out.contains("[redacted]"), out);
        }
        assertEquals("sent Bearer [redacted] here", Redact.redact("sent Bearer zzzzzzzzzzzzzzzz here"));
        assertEquals("a short Token abc stays", Redact.redact("a short Token abc stays"));
    }

    @Test
    void masksTheRestOfAnInvalidAuthorizationHeaderLineAndOnlyThatLine() {
        Env.useForTests(Map.of("DEEPGRAM_API_KEY", ""), null);
        String lq = "\u201C";
        String rq = "\u201D";
        assertEquals("invalid Authorization header: [redacted]",
                Redact.redact("invalid Authorization header: Token " + lq + "abc" + rq));
        assertEquals("invalid Authorization header: [redacted]",
                Redact.redact("invalid Authorization header: Bearer " + lq + "wst_abc" + rq));
        // A message that ends in the header name: the next line is something else, and stays.
        assertEquals("invalid Authorization header:[redacted]\nToken shown",
                Redact.redact("invalid Authorization header:\nToken shown"));
        assertEquals("invalid Authorization header:[redacted]\nBearer shown",
                Redact.redact("invalid Authorization header:\nBearer shown"));
    }

    @Test
    void describeErrorNamesTheTypeAndNeverAUrlOrAKey() {
        String line = Redact.describeError(new IOException("Failed to connect to wss://secret.host.example/v1/agent/converse?x=" + KEY));
        assertTrue(line.startsWith("IOException: Failed to connect to "), line);
        assertFalse(line.contains("secret.host.example"), line);
        assertFalse(line.contains(KEY), line);
        assertEquals("IllegalStateException", Redact.describeError(new IllegalStateException()));
        assertEquals("RuntimeException: first line", Redact.describeError(new RuntimeException("first line\nsecond")));
    }
}
