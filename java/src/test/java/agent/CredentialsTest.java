package agent;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.node.ObjectNode;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class CredentialsTest {
    static final String KEY = "my-own-key-0123456789";
    static final String TOKEN = "workshop-token-0123456789";

    static void env(String... kv) {
        java.util.Map<String, String> m = new java.util.HashMap<>();
        for (int i = 0; i < kv.length; i += 2) m.put(kv[i], kv[i + 1]);
        Env.useForTests(m, null);
    }

    @AfterEach
    void reset() {
        Env.resetForTests();
    }

    @Test
    void theAddressCheckReadsTheSharedTable() throws Exception {
        // tools/parity/addresses.json: the same rows pass and fail in Python, TypeScript and the
        // harness.
        com.fasterxml.jackson.databind.JsonNode table = Json.parse(java.nio.file.Files.readString(
                Common.PROJECT_ROOT.resolve("tools/parity/addresses.json"), java.nio.charset.StandardCharsets.UTF_8));
        for (com.fasterxml.jackson.databind.JsonNode u : table.get("valid")) {
            assertTrue(Credentials.validAddress(u.asText()), u.asText());
        }
        for (com.fasterxml.jackson.databind.JsonNode u : table.get("invalid")) {
            assertFalse(Credentials.validAddress(u.asText()), u.asText());
        }
        for (com.fasterxml.jackson.databind.JsonNode row : table.get("agent")) {
            String raw = row.get(0).asText();
            if (row.get(1).isNull()) {
                SetupError e = assertThrows(SetupError.class, () -> Credentials.agentBaseUrl(raw), raw);
                assertEquals(Credentials.BAD_AGENT_URL, e.getMessage(), raw);
            } else {
                assertEquals(row.get(1).asText(), Credentials.agentBaseUrl(raw), raw);
            }
        }
        for (com.fasterxml.jackson.databind.JsonNode row : table.get("workshop")) {
            String raw = row.get(0).asText();
            if (row.get(1).isNull()) {
                SetupError e = assertThrows(SetupError.class, () -> Credentials.workshopBaseUrl(raw, null), raw);
                assertEquals(Credentials.BAD_WORKSHOP_URL, e.getMessage(), raw);
            } else {
                assertEquals(row.get(1).asText(), Credentials.workshopBaseUrl(raw, null), raw);
            }
        }
    }

    @Test
    void aWorkshopTokenWithoutAKeyGoesThroughTheProxyForTheMission() throws Exception {
        env("WORKSHOP_TOKEN", TOKEN, "WORKSHOP_URL", "https://workshop.example/sdk/");
        Credentials.Target t = Credentials.plan(null, null, "00-first-words");
        assertEquals("wss://workshop.example/sdk/00-first-words", t.base());
        assertEquals(TOKEN, t.token());
        assertNull(t.apiKey());
        assertTrue(t.workshop());
        env("WORKSHOP_TOKEN", "tok-0123456789\u00A0", "WORKSHOP_URL", "wss://w.example/sdk");
        assertEquals("tok-0123456789", Credentials.plan(null, null, null).token());
    }

    @Test
    void theTokenBeatsAShellKeyWhenWorkshopUrlIsSet() throws Exception {
        env("DEEPGRAM_API_KEY", KEY, "WORKSHOP_TOKEN", TOKEN, "WORKSHOP_URL", "wss://workshop.example/sdk");
        Credentials.Target t = Credentials.plan(null, null, null);
        assertTrue(t.workshop());
        assertEquals(TOKEN, t.token());
        assertTrue(Credentials.credentialsNote().startsWith("[credentials] Using your workshop token (the proxy); your DEEPGRAM_API_KEY is set too"));
    }

    @Test
    void theKeyIsUsedWhenTheTokenHasNoWorkshopUrl() throws Exception {
        env("DEEPGRAM_API_KEY", KEY, "WORKSHOP_TOKEN", TOKEN);
        Credentials.Target t = Credentials.plan(null, null, null);
        assertFalse(t.workshop());
        assertEquals(KEY, t.apiKey());
        assertEquals(Credentials.PROD_AGENT_URL, t.base());
        assertEquals("[credentials] Using your DEEPGRAM_API_KEY; your workshop token is not used because WORKSHOP_URL is empty.",
                Credentials.credentialsNote());
        env("DEEPGRAM_API_KEY", KEY, "WORKSHOP_TOKEN", TOKEN, "DEEPGRAM_AGENT_URL", "wss://agent.example.test");
        assertEquals("[credentials] Using your DEEPGRAM_API_KEY; your workshop token is not used because DEEPGRAM_AGENT_URL is set.",
                Credentials.credentialsNote());
    }

    @Test
    void aTokenNeverGoesToDeepgramAgentUrl() {
        env("WORKSHOP_TOKEN", TOKEN, "DEEPGRAM_AGENT_URL", "wss://somewhere.example");
        SetupError e = assertThrows(SetupError.class, () -> Credentials.plan(null, null, null));
        assertTrue(e.getMessage().startsWith("DEEPGRAM_AGENT_URL needs your own DEEPGRAM_API_KEY"), e.getMessage());
    }

    @Test
    void anExplicitUrlAndKeyWinAndTheHarnessGetsTheKey() throws Exception {
        env("WORKSHOP_TOKEN", TOKEN, "WORKSHOP_URL", "wss://workshop.example/sdk");
        Credentials.Target t = Credentials.plan("ws://127.0.0.1:9/", "replay-key", null);
        assertEquals("ws://127.0.0.1:9", t.base());
        assertEquals("replay-key", t.apiKey());
        assertFalse(t.workshop());
    }

    @Test
    void aBadUrlIsNamedButNotEchoed() {
        env("DEEPGRAM_API_KEY", KEY, "DEEPGRAM_AGENT_URL", "http://private-endpoint.example");
        SetupError e = assertThrows(SetupError.class, () -> Credentials.plan(null, null, null));
        assertTrue(e.getMessage().startsWith("DEEPGRAM_AGENT_URL must start with wss://"));
        assertFalse(e.getMessage().contains("private-endpoint"));
    }

    @Test
    void agentAndWorkshopUrlShapes() throws Exception {
        env();
        assertEquals("wss://agent.example", Credentials.agentBaseUrl("wss://agent.example/v1/agent/converse/"));
        assertEquals(Credentials.PROD_AGENT_URL, Credentials.agentBaseUrl(""));
        assertEquals("ws://localhost:3000/sdk/01-let-me-finish", Credentials.workshopBaseUrl("http://localhost:3000/sdk", "01-let-me-finish"));
        assertEquals("wss://w.example/sdk", Credentials.workshopBaseUrl("wss://w.example/sdk/v1/agent/converse", null));
        SetupError noSdk = assertThrows(SetupError.class, () -> Credentials.workshopBaseUrl("https://w.example", null));
        assertTrue(noSdk.getMessage().contains("should end in /sdk"));
        assertThrows(SetupError.class, () -> Credentials.workshopBaseUrl("", null));
        assertEquals("wss://a.example", Credentials.agentBaseUrl("\u00A0wss://a.example/\u3000"));
        assertTrue(assertThrows(SetupError.class, () -> Credentials.agentBaseUrl(" ")).getMessage()
                .startsWith("DEEPGRAM_AGENT_URL must start with wss://"));
        assertEquals("wss://w.example/sdk", Credentials.workshopBaseUrl("\u2003wss://w.example/sdk\u00A0", null));
    }

    @Test
    void theNoCredentialsLineSaysEmptyWhenDotenvExistsAndCopyWhenItDoesNot(@TempDir Path dir) throws Exception {
        env("WORKSHOP_URL", "wss://speak.example.test/sdk");
        String missing = Credentials.noCredentialsLine("03-no-dead-air", false);
        assertEquals(Credentials.NO_CREDENTIALS, missing);
        assertTrue(missing.startsWith("No Deepgram credentials. Copy .env.example to .env"), missing);
        String empty = Credentials.noCredentialsLine("03-no-dead-air", true);
        assertEquals("DEEPGRAM_API_KEY is empty in .env (this folder). Set it, or paste WORKSHOP_URL and WORKSHOP_TOKEN "
                + "from the workshop's /code page. make check 03 runs offline with no key.", empty);
        assertFalse(empty.contains("Copy"));
        assertTrue(Credentials.noCredentialsLine(null, true).endsWith("make check NN runs offline with no key."));
        // The real check: a .env file on disk (empty key) picks the empty line; none picks the copy line.
        Path dotenv = dir.resolve(".env");
        Files.writeString(dotenv, "DEEPGRAM_API_KEY=\n");
        Env.useForTests(Map.of(), dotenv);
        assertTrue(Env.dotenvExists());
        assertEquals(Credentials.noCredentialsLine("00-first-words", true), Credentials.credentialsProblem(null, "00-first-words"));
        Env.useForTests(Map.of(), null);
        assertFalse(Env.dotenvExists());
        assertEquals(Credentials.noCredentialsLine("00-first-words", false), Credentials.credentialsProblem(null, "00-first-words"));
    }

    @Test
    void credentialsProblemAndCodePage() {
        env();
        // env() points .env at a file that isn't there: the copy line, with the mission number in.
        assertEquals(Credentials.NO_CREDENTIALS, Credentials.credentialsProblem(null));
        assertEquals(Credentials.NO_CREDENTIALS, Credentials.credentialsProblem(null, "03-no-dead-air"));
        assertNull(Credentials.credentialsProblem("explicit"));
        assertEquals("the workshop site's /code page", Credentials.codePage());
        SetupError none = assertThrows(SetupError.class, () -> Credentials.plan(null, null, null));
        assertEquals(Credentials.NO_CREDENTIALS, none.getMessage());
        env("WORKSHOP_URL", "ws://localhost:3000/sdk");
        assertEquals("http://localhost:3000/code", Credentials.codePage());
        assertNull(Credentials.credentialsNote());
        env("WORKSHOP_URL", "ws://localhost:3000\u00A0x/sdk");
        assertEquals("http://localhost:3000/code", Credentials.codePage());
        env("WORKSHOP_URL", "wss://speak.example.test/builders-lab/sdk/");
        assertEquals("https://speak.example.test/builders-lab/code", Credentials.codePage());
        env("WORKSHOP_URL", "https://speak.example.test/builders-lab/code");
        assertEquals("https://speak.example.test/builders-lab/code", Credentials.codePage());
        env("WORKSHOP_URL", "wss://speak.example.test/builders-lab/sdk/v1/agent/converse");
        assertEquals("https://speak.example.test/builders-lab", Credentials.workshopSite());
        env("WORKSHOP_URL", "wss://speak.example.test?x=1");
        assertEquals("https://speak.example.test", Credentials.workshopSite());
        // A pasted mission page (or its step) or /resume names the site, not that page.
        env("WORKSHOP_URL", "https://speak.example.test/builders-lab/m/first-words");
        assertEquals("https://speak.example.test/builders-lab/code", Credentials.codePage());
        env("WORKSHOP_URL", "https://speak.example.test/builders-lab/m/let-me-finish/the-knobs/");
        assertEquals("https://speak.example.test/builders-lab", Credentials.workshopSite());
        env("WORKSHOP_URL", "https://speak.example.test/resume");
        assertEquals("https://speak.example.test", Credentials.workshopSite());
    }

    @Test
    void missionOfReadsTheMissionPackage() {
        assertEquals("00-first-words", Credentials.missionOf(m00_first_words.Start.class));
        assertEquals("01-let-me-finish", Credentials.missionOf(m01_let_me_finish.Solution.class));
        assertNull(Credentials.missionOf(CredentialsTest.class));
    }

    @Test
    void listenProviderDefaultsOverridesAndTheProxyModel() {
        env("DEEPGRAM_API_KEY", KEY);
        assertEquals(Json.obj("type", "deepgram", "model", "nova-3", "version", "v1"), Common.listenProvider());
        env("DEEPGRAM_API_KEY", KEY, "LISTEN_MODEL", "flux-general-en", "LISTEN_VERSION", "v2");
        assertEquals(Json.obj("type", "deepgram", "model", "flux-general-en", "version", "v2"), Common.listenProvider());
        env("WORKSHOP_TOKEN", TOKEN, "WORKSHOP_URL", "wss://w.example/sdk");
        ObjectNode proxy = Common.listenProvider();
        assertEquals("flux-general-en", proxy.get("model").asText());
        assertEquals("v2", proxy.get("version").asText(), "the version is always there");
        env("LISTEN_MODEL", "nova-2");
        assertFalse(Common.listenProvider().has("version"), "a model of your own takes LISTEN_VERSION as given");
        env("LISTEN_MODEL", "flux-general-en\u00A0");
        assertEquals("flux-general-en", Common.listenProvider().get("model").asText());
        env("LISTEN_MODEL", "nova-2", "LISTEN_VERSION", "v1\u00A0");
        assertEquals("v1", Common.listenProvider().get("version").asText());
    }
}
