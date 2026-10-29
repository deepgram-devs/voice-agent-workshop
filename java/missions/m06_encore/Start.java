// Mission 06, Encore (bonus): push Speed and Expressivity until it does an impression.
//
// Run it:    make run 06   (or, from java/: sh mission.sh run 06-encore)
//            needs DEEPGRAM_API_KEY or your workshop token in .env; in Docker: docker compose run --rm workshop-java make run 06
//            Java runs on your machine, in GitHub Codespaces, in the dev container or in Docker's workshop-java service (a JDK 17+; README: Java)
// Check it:  make check 06     (offline, no key)
// Live:      make live 06      (real API: needs DEEPGRAM_API_KEY or your workshop token in .env)
//
// Three TODOs below. The brief is in ../../../missions/06-encore/README.md.
package m06_encore;

import static agent.Json.obj;

import agent.Common;
import agent.Mission;
import com.fasterxml.jackson.databind.node.ObjectNode;

public class Start implements Mission {
    // TODO 1: Ask for a performance: who is talking, and what they narrate.
    static final String PROMPT = "You are a helpful assistant.";

    // A Flux voice (version v2): Speed and Expressivity belong to Flux voices.
    static final String VOICE = "flux-hannah-en";

    // TODO 2: Change the speed: 0.85 to 1.15, in steps of 0.05. 1 is normal.
    static final double SPEED = 1.0;

    // TODO 3: Change the expressivity: a whole number from -2 (calm) to 2 (animated).
    // 0 is the voice's own delivery. It holds for the whole call.
    static final int EXPRESSIVITY = 0;

    static final String GREETING = "Ready when you are. Tell me what you see.";

    /** The Settings message: sent once, as soon as the server says Welcome. */
    @Override
    public ObjectNode buildSettings() {
        return obj(
                "audio", obj(
                        "input", obj("encoding", "linear16", "sample_rate", 16000),
                        "output", obj("encoding", "linear16", "sample_rate", 24000, "container", "none")),
                "agent", obj(
                        "listen", obj("provider", Common.listenProvider()),
                        "think", obj("provider", obj("type", "open_ai", "model", "gpt-4o-mini"), "prompt", PROMPT),
                        "speak", obj(
                                "provider", obj(
                                        "type", "deepgram",
                                        "model", VOICE,
                                        "version", "v2",
                                        "speed", SPEED,
                                        "expressivity", EXPRESSIVITY)),
                        "greeting", GREETING));
    }

    // Every event from the agent lands here (onEvent). Common already prints the
    // transcript; nothing else to do in this mission.

    public static void main(String[] args) {
        Common.run(new Start(), args);
    }
}
