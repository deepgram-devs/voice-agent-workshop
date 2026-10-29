// Mission 04, Polyglot: one listener for every language, and a voice that follows.
//
// Run it:    make run 04 MISSION_TARGET=solution
// Check it:  make check 04 MISSION_TARGET=solution     (offline, no key)
// Live:      make live 04 MISSION_TARGET=solution      (real API, uses your DEEPGRAM_API_KEY)
//
// Reference solution. Try Start.java first.
package m04_polyglot;

import static agent.Json.arr;
import static agent.Json.obj;

import agent.Agent;
import agent.Common;
import agent.Event;
import agent.Mission;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.List;
import java.util.Locale;
import java.util.Map;

public class Solution implements Mission {
    // The multilingual listener, and the languages you expect to hear.
    static final String LISTEN_MODEL = "flux-general-multi";
    static final List<String> LANGUAGE_HINTS = List.of("en", "es", "fr");

    static final String PROMPT = "You are a friendly help desk at a conference. Answer in one or two short "
            + "sentences, always in the language the person just used.";

    // One Aura-2 voice per language. To try other voices, including multi_tts
    // voices, swap the ids here and nothing else changes.
    static final Map<String, String> VOICES = Map.of(
            "en", "aura-2-thalia-en",
            "es", "aura-2-celeste-es",
            "de", "aura-2-julius-de",
            "fr", "aura-2-agathe-fr",
            "it", "aura-2-livia-it",
            "nl", "aura-2-rhea-nl",
            "ja", "aura-2-izanami-ja");
    static final String START_LANGUAGE = "en";

    /** The `speak` block for one language's voice, for Settings and UpdateSpeak. */
    static ObjectNode speakFor(String language) {
        return obj("provider", obj("type", "deepgram", "model", VOICES.get(language)));
    }

    /**
     * The language a user turn was mostly in ("es" from "es-419"), or null.
     * `languages` lists what the listener heard, most words first.
     */
    static String firstLanguage(Event event) {
        JsonNode heard = event.get("languages");
        if (heard == null || !heard.isArray() || heard.isEmpty()) return null;
        return heard.get(0).asText().split("-")[0].toLowerCase(Locale.ROOT);
    }

    /** Which voice the agent speaks with, and the one it had before a switch. */
    static final class Voice {
        String language = START_LANGUAGE;
        String previous = null; // set while an UpdateSpeak waits for its answer
    }

    final Voice voice = new Voice();

    /** The Settings message: sent once, as soon as the server says Welcome. */
    @Override
    public ObjectNode buildSettings() {
        ObjectNode listen = obj("type", "deepgram", "model", LISTEN_MODEL, "version", "v2");
        if (!LANGUAGE_HINTS.isEmpty()) {
            listen.set("language_hints", arr(LANGUAGE_HINTS.toArray()));
        }
        return obj(
                "audio", obj(
                        "input", obj("encoding", "linear16", "sample_rate", 16000),
                        "output", obj("encoding", "linear16", "sample_rate", 24000, "container", "none")),
                "agent", obj(
                        "listen", obj("provider", listen),
                        "think", obj("provider", obj("type", "open_ai", "model", "gpt-4o-mini"), "prompt", PROMPT),
                        "speak", speakFor(START_LANGUAGE)));
    }

    /** Every event from the agent lands here. */
    @Override
    public void onEvent(Agent agent, Event event) {
        String kind = event.type();
        if ("Welcome".equals(kind)) {
            // A new call starts with the starting voice.
            voice.language = START_LANGUAGE;
            voice.previous = null;

        } else if ("ConversationText".equals(kind) && "user".equals(event.str("role"))) {
            String heard = firstLanguage(event);
            if (heard != null && !heard.equals(voice.language) && VOICES.containsKey(heard)) {
                // Switch once: remember the old voice in case the switch fails.
                voice.previous = voice.language;
                voice.language = heard;
                agent.updateSpeak(speakFor(heard));
                System.out.println("[voice] switching to " + VOICES.get(heard) + " from the next reply");
            }

        } else if ("SpeakUpdated".equals(kind)) {
            voice.previous = null;

        } else if ("Error".equals(kind) && voice.previous != null) {
            // The switch failed, and the server ends the call after this error.
            // Say what happened in one line and hang up, so the program ends cleanly.
            String reason = firstNonEmpty(event.str("description"), event.str("code"), "no reason given");
            // The line below adds its own period.
            if (reason.endsWith(".")) reason = reason.substring(0, reason.length() - 1);
            System.out.println("[voice] couldn't switch to " + VOICES.get(voice.language) + ": " + reason
                    + ". Ending the call.");
            agent.close();
        }
    }

    /** The first value that is neither null nor empty (Python's `a or b or c`). */
    static String firstNonEmpty(String... values) {
        for (String value : values) {
            if (value != null && !value.isEmpty()) return value;
        }
        return "";
    }

    public static void main(String[] args) {
        Common.run(new Solution(), args);
    }
}
