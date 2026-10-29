// Mission 06, Encore (bonus): push Speed and Expressivity until it does an impression.
//
// Run it:    make run 06 MISSION_TARGET=solution
// Check it:  make check 06 MISSION_TARGET=solution     (offline, no key)
// Live:      make live 06 MISSION_TARGET=solution      (real API, uses your DEEPGRAM_API_KEY)
//
// Reference solution. Try Start.java first.
package m06_encore;

import static agent.Json.obj;

import agent.Common;
import agent.Mission;
import com.fasterxml.jackson.databind.node.ObjectNode;

public class Solution implements Mission {
    // A performance, not a persona: who is talking, and what they narrate.
    static final String PROMPT = "You are a nature documentary narrator describing whatever the listener says as if it "
            + "were a rare animal in the wild. Hushed, awed, one or two sentences a turn. Never break character.";

    // A Flux voice (version v2): Speed and Expressivity belong to Flux voices.
    static final String VOICE = "flux-hannah-en";

    // Slower, for gravitas.
    static final double SPEED = 0.9;

    // Leaning into the words. It holds for the whole call.
    static final int EXPRESSIVITY = 1;

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
        Common.run(new Solution(), args);
    }
}
