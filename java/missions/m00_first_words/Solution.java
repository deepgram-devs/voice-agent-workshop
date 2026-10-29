// Mission 00, First words: get an agent talking back in a voice you picked.
//
// Run it:    make run 00 MISSION_TARGET=solution
// Check it:  make check 00 MISSION_TARGET=solution     (offline, no key)
// Live:      make live 00 MISSION_TARGET=solution      (real API, uses your DEEPGRAM_API_KEY)
//
// Reference solution. Try Start.java first.
package m00_first_words;

import static agent.Json.obj;

import agent.Agent;
import agent.Common;
import agent.Event;
import agent.Mission;
import com.fasterxml.jackson.databind.node.ObjectNode;

public class Solution implements Mission {
    // Your own prompt: who it is, how it talks, one rule.
    static final String PROMPT = "You are Sam, the barista at a tiny cafe. Answer in one short sentence, "
            + "then ask one question back. Never recommend decaf.";

    // A different voice from the default.
    static final String VOICE = "flux-cliff-en";

    // The first thing it says when you connect.
    static final String GREETING = "Hi, welcome in. What can I get started for you?";

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
        Common.run(new Solution(), args);
    }
}
