package agent;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.ArrayList;
import java.util.List;

/**
 * One event from the agent, as the wire JSON: {@code event.type()}, {@code event.str("role")},
 * {@code event.items("functions")}. Every field the server sent is here, including event
 * types and fields newer than the SDK.
 */
public final class Event {
    private final ObjectNode json;

    public Event(ObjectNode json) {
        this.json = json;
    }

    /** The event in a text frame, or null when the frame isn't a JSON object. */
    public static Event parse(String text) {
        try {
            JsonNode node = Json.parse(text);
            return node instanceof ObjectNode object ? new Event(object) : null;
        } catch (IllegalArgumentException e) {
            return null;
        }
    }

    /** "Welcome", "ConversationText", "FunctionCallRequest" ... */
    public String type() {
        return str("type");
    }

    /** A field as text (a number or boolean as written), or null when it's missing or null. */
    public String str(String key) {
        JsonNode value = json.get(key);
        if (value == null || value.isNull()) return null;
        return value.isValueNode() ? value.asText() : value.toString();
    }

    /** A field as JSON, or null when it's missing. */
    public JsonNode get(String key) {
        return json.get(key);
    }

    public boolean has(String key) {
        JsonNode value = json.get(key);
        return value != null && !value.isNull();
    }

    /** A boolean field, or {@code fallback} when it's missing. */
    public boolean bool(String key, boolean fallback) {
        JsonNode value = json.get(key);
        return value != null && value.isBoolean() ? value.booleanValue() : fallback;
    }

    /** A number field, or null when it's missing or not a number. */
    public Double num(String key) {
        JsonNode value = json.get(key);
        return value != null && value.isNumber() ? value.doubleValue() : null;
    }

    /**
     * A list of objects (FunctionCallRequest's "functions", say), each as an Event; empty
     * when missing.
     */
    public List<Event> items(String key) {
        List<Event> out = new ArrayList<>();
        JsonNode value = json.get(key);
        if (value != null && value.isArray()) {
            for (JsonNode item : value) {
                if (item instanceof ObjectNode object) out.add(new Event(object));
            }
        }
        return out;
    }

    /** The whole event as JSON. */
    public ObjectNode json() {
        return json;
    }

    @Override
    public String toString() {
        return Json.write(json);
    }
}
