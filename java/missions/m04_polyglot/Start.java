// Mission 04, Polyglot: one listener for every language, and a voice that follows.
//
// Run it:    make run 04   (or, from java/: sh mission.sh run 04-polyglot)
//            needs DEEPGRAM_API_KEY or your workshop token in .env; in Docker: docker compose run --rm workshop-java make run 04
//            Java runs on your machine, in GitHub Codespaces, in the dev container or in Docker's workshop-java service (a JDK 17+; README: Java)
// Check it:  make check 04     (offline, no key)
// Live:      make live 04      (real API: needs DEEPGRAM_API_KEY or your workshop token in .env)
//
// Three TODOs below. The brief is in ../../../missions/04-polyglot/README.md.
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

public class Start implements Mission {
    // TODO 1: Switch to the multilingual listener, flux-general-multi, and list the
    // languages you expect to hear as hints (two-letter language codes such as "en", "es", "fr"), including one beyond "en"
    // and "es", such as List.of("en", "es", "fr").
    static final String LISTEN_MODEL = "flux-general-en";
    static final List<String> LANGUAGE_HINTS = List.of();

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
            // TODO 2: `heard` is null on a typed turn (no `languages`): test that first. When it is set,
            // differs from voice.language and VOICES has a voice for it, switch once: keep the old
            // language in voice.previous, set voice.language to `heard`, send the new speak block, and
            // print the switch so you see it:
            // if (heard != null && !heard.equals(voice.language) && VOICES.containsKey(heard)) {
            //     voice.previous = ...;
            //     voice.language = ...;
            //     agent.updateSpeak(speakFor(heard));
            //     System.out.println("[voice] switching to " + VOICES.get(heard) + " from the next reply");
            // }

        } else if ("SpeakUpdated".equals(kind)) {
            voice.previous = null;

        } else if ("Error".equals(kind)) {
            // TODO 3: A failed switch ends the call: the server closes the connection right after this
            // Error. If a switch was waiting (voice.previous is set), print one clear line, which voice
            // failed and why (str returns null for a missing field), then hang up with agent.close() so
            // the program ends cleanly:
            // if (voice.previous != null) {
            //     String why = event.str("description");
            //     if (why == null) why = event.str("code");
            //     System.out.println("[voice] couldn't switch to " + VOICES.get(voice.language) + ": " + why);
            //     agent.close();
            // }
        }
    }

    public static void main(String[] args) {
        Common.run(new Start(), args);
    }
}
