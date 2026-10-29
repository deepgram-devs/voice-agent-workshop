package agent;

import com.fasterxml.jackson.core.JsonParser;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.JsonToken;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.NumericNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.IOException;
import java.math.BigDecimal;
import java.math.BigInteger;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * JSON the way the missions write it: {@code obj("type", "deepgram", "model", VOICE)}
 * builds an object with its keys in the order given, and {@code arr(...)} a list.
 * Values may be strings, numbers, booleans, lists, maps or JSON nodes.
 */
public final class Json {
    /** A plain mapper: the wire JSON as written, nothing added or dropped. */
    public static final ObjectMapper MAPPER = new ObjectMapper();

    private static final JsonNodeFactory NODES = JsonNodeFactory.instance;

    private Json() {}

    /** An object from key, value pairs, in order. */
    public static ObjectNode obj(Object... keysAndValues) {
        if (keysAndValues.length % 2 != 0) {
            throw new IllegalArgumentException("obj(...) takes key, value pairs, but got " + keysAndValues.length
                    + " arguments. Give every key a value.");
        }
        ObjectNode node = NODES.objectNode();
        for (int i = 0; i < keysAndValues.length; i += 2) {
            if (!(keysAndValues[i] instanceof String key)) {
                throw new IllegalArgumentException("obj(...) keys are strings, but argument " + (i + 1)
                        + " isn't. Start each pair with a string key, like \"model\".");
            }
            node.set(key, node(keysAndValues[i + 1]));
        }
        return node;
    }

    /** A list of values, in order. */
    public static ArrayNode arr(Object... items) {
        ArrayNode node = NODES.arrayNode();
        for (Object item : items) {
            node.add(node(item));
        }
        return node;
    }

    /** One value as a JSON node. */
    public static JsonNode node(Object value) {
        if (value == null) return NODES.nullNode();
        if (value instanceof JsonNode n) return n;
        if (value instanceof String s) return NODES.textNode(s);
        if (value instanceof Boolean b) return NODES.booleanNode(b);
        if (value instanceof Integer n) return NODES.numberNode(n);
        if (value instanceof Long n) return NODES.numberNode(n);
        if (value instanceof Short n) return NODES.numberNode(n);
        if (value instanceof Double n) return NODES.numberNode(n);
        if (value instanceof Float n) return NODES.numberNode(n);
        if (value instanceof BigDecimal n) return NODES.numberNode(n);
        if (value instanceof BigInteger n) return NODES.numberNode(n);
        if (value instanceof Collection<?> items) return arr(items.toArray());
        if (value instanceof Object[] items) return arr(items);
        if (value instanceof Map<?, ?> map) {
            ObjectNode node = NODES.objectNode();
            map.forEach((k, v) -> node.set(String.valueOf(k), node(v)));
            return node;
        }
        return MAPPER.valueToTree(value);
    }

    /** Parses JSON text. */
    public static JsonNode parse(String text) {
        try {
            return MAPPER.readTree(text);
        } catch (JsonProcessingException e) {
            throw new IllegalArgumentException("not JSON: " + e.getOriginalMessage(), e);
        }
    }

    /** Compact JSON text. */
    public static String write(JsonNode node) {
        try {
            return MAPPER.writeValueAsString(node);
        } catch (JsonProcessingException e) {
            throw new IllegalStateException(e);
        }
    }

    /** A copy with every null field left out, at every depth (nulls in lists stay). */
    public static JsonNode withoutNulls(JsonNode node) {
        if (node instanceof ObjectNode object) {
            ObjectNode copy = NODES.objectNode();
            object.fields().forEachRemaining(e -> {
                if (!e.getValue().isNull()) copy.set(e.getKey(), withoutNulls(e.getValue()));
            });
            return copy;
        }
        if (node instanceof ArrayNode array) {
            ArrayNode copy = NODES.arrayNode();
            array.forEach(item -> copy.add(withoutNulls(item)));
            return copy;
        }
        return node;
    }

    /**
     * Every key that JSON text has twice in one object, at any depth, as its path: field
     * names, and indexes for lists. Parsing to a tree would keep one copy and hide the other.
     */
    static List<List<Object>> repeatedKeys(String text) throws IOException {
        List<List<Object>> found = new ArrayList<>();
        try (JsonParser parser = MAPPER.getFactory().createParser(text)) {
            parser.nextToken();
            repeatedKeys(parser, new ArrayList<>(), found);
        }
        return found;
    }

    private static void repeatedKeys(JsonParser parser, List<Object> path, List<List<Object>> found)
            throws IOException {
        if (parser.currentToken() == JsonToken.START_OBJECT) {
            Set<String> seen = new HashSet<>();
            while (parser.nextToken() == JsonToken.FIELD_NAME) {
                path.add(parser.currentName());
                if (!seen.add(parser.currentName())) found.add(List.copyOf(path));
                parser.nextToken();
                repeatedKeys(parser, path, found);
                path.remove(path.size() - 1);
            }
        } else if (parser.currentToken() == JsonToken.START_ARRAY) {
            for (int i = 0; parser.nextToken() != JsonToken.END_ARRAY; i++) {
                path.add(i);
                repeatedKeys(parser, path, found);
                path.remove(path.size() - 1);
            }
        }
    }

    /** Removes the key at {@code path}, a path {@link #repeatedKeys} gave; false if it is gone. */
    static boolean removeAt(JsonNode root, List<Object> path) {
        JsonNode node = root;
        for (Object step : path.subList(0, path.size() - 1)) {
            node = step instanceof Integer i ? node.path(i) : node.path((String) step);
        }
        return node instanceof ObjectNode parent && parent.remove((String) path.get(path.size() - 1)) != null;
    }

    /** Same JSON, numbers compared by value (1 and 1.0 are equal). */
    public static boolean sameJson(JsonNode a, JsonNode b) {
        if (a == null || b == null) return a == b;
        return a.equals(NUMBERS_BY_VALUE, b);
    }

    private static final Comparator<JsonNode> NUMBERS_BY_VALUE = (x, y) -> {
        if (x instanceof NumericNode && y instanceof NumericNode) {
            return x.decimalValue().compareTo(y.decimalValue());
        }
        return x.equals(y) ? 0 : 1;
    };
}
