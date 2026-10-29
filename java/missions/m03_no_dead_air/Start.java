// Mission 03, No dead air: answer a tool call, and cover the wait while a slow one runs.
//
// Run it:    make run 03   (or, from java/: sh mission.sh run 03-no-dead-air)
//            needs DEEPGRAM_API_KEY or your workshop token in .env; in Docker: docker compose run --rm workshop-java make run 03
//            Java runs on your machine, in GitHub Codespaces, in the dev container or in Docker's workshop-java service (a JDK 17+; README: Java)
// Check it:  make check 03     (offline, no key)
// Live:      make live 03      (real API: needs DEEPGRAM_API_KEY or your workshop token in .env)
//
// Three TODOs below. In the event handler TODO 3 sits above TODO 2: the filler goes out before
// the tool runs. The brief is in ../../../missions/03-no-dead-air/README.md.
package m03_no_dead_air;

import static agent.Json.obj;

import agent.Agent;
import agent.Common;
import agent.Env;
import agent.Event;
import agent.Json;
import agent.Mission;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Set;

public class Start implements Mission {
    static final String PROMPT = "You are a to-do list assistant at a developer conference. "
            + "Keep replies to one short sentence. "
            + "Use the tools to add, list, complete and delete items, and confirm what you did. "
            + "Never use markdown or emoji.";

    // The list every call starts with, so there is something to delete straight away.
    static final List<String> SEED_ITEMS = List.of("Buy milk", "Call the dentist", "Book the flight home");

    // deleteItem is slow on purpose, like a lookup against a slow database.
    static final int SLOW_SECONDS = 3;
    static final Set<String> SLOW_TOOLS = Set.of("deleteItem");

    // What the agent says while a slow tool runs.
    static final String FILLER = "One second, let me find that.";

    static ObjectNode itemParam(String what) {
        return obj(
                "type", "object",
                "properties", obj("item", obj(
                        "type", "string",
                        "description", what + ", in the caller's words. A partial match is fine.")),
                "required", List.of("item"));
    }

    // The four functions the agent can call. They travel in Settings as agent.think.functions.
    static final List<ObjectNode> FUNCTIONS = List.of(
            obj("name", "deleteItem",
                    "description", "Delete an item from the to-do list for good. "
                            + "This lookup is slow and takes about three seconds.",
                    "parameters", itemParam("The item to delete")),
            obj("name", "completeItem",
                    "description", "Mark an item on the to-do list as done. It stays on the list.",
                    "parameters", itemParam("The item to mark as done")),
            obj("name", "addItem",
                    "description", "Add a new item to the to-do list.",
                    "parameters", itemParam("The item to add")),
            obj("name", "listItems",
                    "description", "Read back every item on the to-do list with whether it is done.",
                    "parameters", obj("type", "object", "properties", obj())));

    /** One line of the to-do list. */
    static final class Item {
        final String text;
        boolean done;

        Item(String text) {
            this.text = text;
        }
    }

    // The to-do list for this call. onEvent resets it when a call starts.
    final List<Item> items = new ArrayList<>();

    /** The item whose text best matches what the caller said, or null. */
    Item findItem(String query) {
        String q = (query == null ? "" : query).strip().toLowerCase(Locale.ROOT);
        if (q.isEmpty()) return null;
        for (Item item : items) {
            String text = item.text.toLowerCase(Locale.ROOT);
            if (text.contains(q) || q.contains(text)) return item;
        }
        List<String> words = new ArrayList<>();
        for (String w : q.split("\\s+")) {
            if (w.length() > 2) words.add(w);
        }
        Item best = null;
        int bestScore = 0;
        for (Item item : items) {
            String text = item.text.toLowerCase(Locale.ROOT);
            int score = 0;
            for (String w : words) {
                if (text.contains(w)) score++;
            }
            if (score > bestScore) { // on a tie, the first one wins
                best = item;
                bestScore = score;
            }
        }
        return best;
    }

    String count() {
        return items.size() + " item" + (items.size() == 1 ? "" : "s") + " on the list.";
    }

    /** The "item" argument as text ("" when it's missing). */
    static String item(JsonNode args) {
        JsonNode value = args.get("item");
        if (value == null) return "";
        return value.isValueNode() ? value.asText() : value.toString();
    }

    String addItem(JsonNode args) {
        String text = item(args).strip();
        if (text.isEmpty()) return "Nothing to add: the item was empty.";
        items.add(new Item(text));
        return "Added \"" + text + "\". " + count();
    }

    String listItems(JsonNode args) {
        if (items.isEmpty()) return "The list is empty.";
        List<String> lines = new ArrayList<>();
        for (int n = 0; n < items.size(); n++) {
            Item i = items.get(n);
            lines.add((n + 1) + ". " + i.text + (i.done ? " (done)" : ""));
        }
        return String.join(" ", lines);
    }

    String completeItem(JsonNode args) {
        Item hit = findItem(item(args));
        if (hit == null) return "No item matching \"" + item(args) + "\". " + count();
        hit.done = true;
        return "Marked \"" + hit.text + "\" as done.";
    }

    String deleteItem(JsonNode args) throws InterruptedException {
        Thread.sleep(SLOW_SECONDS * 1000L); // the slow lookup this mission is built around
        // TODO 1: Delete the item and say what you did. The agent reads whatever you return out loud,
        // so return a short sentence, and say so when nothing matches (completeItem shows the pattern):
        // Item hit = findItem(item(args));
        // if (hit == null) return ...;
        // items.remove(hit);
        // return ...;
        return "TODO";
    }

    String runTool(String name, JsonNode args) throws InterruptedException {
        return switch (name == null ? "" : name) {
            case "addItem" -> addItem(args);
            case "listItems" -> listItems(args);
            case "completeItem" -> completeItem(args);
            case "deleteItem" -> deleteItem(args);
            default -> "Unknown function: " + name;
        };
    }

    /** The Settings message: sent once, as soon as the server says Welcome. */
    @Override
    public ObjectNode buildSettings() {
        String model = thinkingModel();
        return obj(
                "audio", obj(
                        "input", obj("encoding", "linear16", "sample_rate", 16000),
                        "output", obj("encoding", "linear16", "sample_rate", 24000, "container", "none")),
                "agent", obj(
                        "listen", obj("provider", Common.listenProvider()),
                        "think", !model.isEmpty()
                                ? thinkingThink(model)
                                : obj("provider", obj("type", "open_ai", "model", "gpt-4o-mini"),
                                        "prompt", PROMPT, "functions", FUNCTIONS),
                        "speak", obj("provider", obj("type", "deepgram", "model", "flux-hannah-en", "version", "v2"))));
    }

    /** Every event from the agent lands here, as the wire JSON. */
    @Override
    public void onEvent(Agent agent, Event event) throws InterruptedException {
        String kind = event.type();
        if ("Welcome".equals(kind)) {
            items.clear(); // a fresh list per call
            for (String text : SEED_ITEMS) items.add(new Item(text));
        } else if ("FunctionCallRequest".equals(kind)) {
            for (Event call : event.items("functions")) {
                if (!call.bool("client_side", true)) {
                    continue; // the agent runs this one itself; answer only the calls meant for your code
                }
                String name = call.str("name");
                // TODO 3: A slow tool leaves the caller in silence. Before a tool in SLOW_TOOLS runs, have
                // the agent say FILLER (test name first: a Set.of refuses null):
                // if (name != null && SLOW_TOOLS.contains(name)) agent.injectAgentMessage(FILLER, "queue");
                String arguments = call.str("arguments");
                JsonNode args = Json.parse(arguments == null || arguments.isEmpty() ? "{}" : arguments);
                String result = runTool(name, args);
                // TODO 2: The agent matches each answer to its request by id. Send this call's id, call.str("id"), in place of "".
                agent.functionCallResponse("", name, result);
            }
        }
    }

    // Stretch (optional, not checked): the `thinking` feature, a think provider built
    // for voice that covers the wait on its own. Put its model id in .env as
    // THINKING_MODEL and your Settings ask for it (missions/03-no-dead-air/README.md).
    static String thinkingModel() {
        return Env.stripped("THINKING_MODEL");
    }

    /**
     * The think block for the `thinking` provider, sent in your Settings.
     * If it runs on its own agent endpoint, put that endpoint in DEEPGRAM_AGENT_URL.
     */
    static ObjectNode thinkingThink(String model) {
        return obj(
                "provider", obj("type", "deepgram", "model", model, "reasoning_mode", "none"),
                "prompt", PROMPT,
                "functions", FUNCTIONS);
    }

    public static void main(String[] args) {
        Common.run(new Start(), args);
    }
}
