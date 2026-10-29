// Mission 00, First words: get an agent talking back in a voice you picked.
//
// Run it:    make run 00   (or, from java/: sh mission.sh run 00-first-words)
//            talk to it; needs DEEPGRAM_API_KEY or your workshop token in .env; in Docker: docker compose run --rm workshop-java make run 00
//            Java runs on your machine, in GitHub Codespaces, in the dev container or in Docker's workshop-java service (a JDK 17+; README: Java)
// Check it:  make check 00      (offline, no key)
// Live:      make live 00       (real API, with your DEEPGRAM_API_KEY or your workshop token)
//
// Three TODOs below. The brief is in ../../../missions/00-first-words/README.md.
package m00_first_words;

import static agent.Json.obj;

import agent.Agent;
import agent.Common;
import agent.Event;
import agent.Mission;
import com.fasterxml.jackson.databind.node.ObjectNode;

public class Start implements Mission {
    // TODO 1: Write your own prompt. Who is the agent, how does it talk, and one rule
    // it always follows. A sentence or three is plenty.
    static final String PROMPT = "You are a helpful assistant.";

    // TODO 2: Pick a different voice by id: flux-cliff-en, flux-alexis-en or flux-rufus-en, or one from the brief.
    static final String VOICE = "flux-hannah-en";

    // TODO 3: Give it a greeting: the first thing it says when you connect.
    static final String GREETING = "";

    /** The Settings message: sent once, as soon as the server says Welcome. */
    @Override
    public ObjectNode buildSettings() {
        ObjectNode agent = obj(
                "listen", obj("provider", Common.listenProvider()),
                "think", obj("provider", obj("type", "open_ai", "model", "gpt-4o-mini"), "prompt", PROMPT),
                "speak", obj("provider", obj("type", "deepgram", "model", VOICE, "version", "v2")));
        if (!GREETING.isEmpty()) {
            agent.put("greeting", GREETING);
        }
        return obj(
                "audio", obj(
                        "input", obj("encoding", "linear16", "sample_rate", 16000),
                        "output", obj("encoding", "linear16", "sample_rate", 24000, "container", "none")),
                "agent", agent);
    }

    /** Every event from the agent lands here. */
    @Override
    public void onEvent(Agent agent, Event event) {
        // Common already prints the transcript; nothing else to do in this mission.
    }

    public static void main(String[] args) {
        Common.run(new Start(), args);
    }
}
