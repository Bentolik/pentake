package io.github.cat.fabricobf.fabric;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashSet;
import java.util.Set;

public final class MixinConfigParser {
    /**
     * Non-mixin top-level keys in a mixin config JSON that are NOT arrays of class names.
     * All other top-level array entries are treated as platform-specific mixin lists
     * (e.g. "fabric", "forge", "neoforge", etc.).
     */
    private static final Set<String> NON_MIXIN_KEYS = Set.of(
            "required", "minVersion", "package", "compatibilityLevel",
            "plugin", "injectors", "overwrites", "verbose", "setSourceFile",
            "refmap", "target", "priority", "mixinPriority"
    );

    public MixinConfigData parse(byte[] mixinConfigBytes, String path) {
        try {
            JsonObject root = JsonParser.parseString(new String(mixinConfigBytes, StandardCharsets.UTF_8)).getAsJsonObject();
            String basePackage = root.has("package") ? root.get("package").getAsString() : "";

            Set<String> mixinClasses = new LinkedHashSet<>();
            Set<String> pluginClasses = new LinkedHashSet<>();

            // Collect from all top-level array entries that are not metadata keys.
            // This covers the standard "mixins", "client", "server" sections AND
            // platform-specific sections like "fabric", "forge", "neoforge", etc.
            for (String key : root.keySet()) {
                if (NON_MIXIN_KEYS.contains(key)) {
                    continue;
                }
                JsonElement element = root.get(key);
                if (!element.isJsonArray()) {
                    continue;
                }
                collectMixinClassNames(root, basePackage, key, mixinClasses);
            }

            if (root.has("plugin")) {
                String plugin = root.get("plugin").getAsString().replace('.', '/');
                pluginClasses.add(plugin);
            }

            return new MixinConfigData(basePackage.replace('.', '/'), mixinClasses, pluginClasses);
        } catch (Exception ex) {
            throw new IllegalArgumentException("Malformed mixin config " + path + ": " + ex.getMessage(), ex);
        }
    }

    private static void collectMixinClassNames(
            JsonObject root,
            String basePackage,
            String key,
            Set<String> destination
    ) {
        if (!root.has(key)) {
            return;
        }
        JsonArray entries = root.getAsJsonArray(key);
        for (JsonElement element : entries) {
            if (!element.isJsonPrimitive()) {
                continue;
            }
            String raw = element.getAsString();
            // In the Mixin spec ALL entries (even sub-packaged ones like "fabric.FooMixin")
            // are RELATIVE to the config's "package" field. Only skip prepending the
            // base package when the entry is already a fully-qualified name that
            // starts with that very package prefix.
            String dotted;
            if (basePackage.isBlank()) {
                dotted = raw;
            } else {
                String basePrefix = basePackage + ".";
                dotted = raw.startsWith(basePrefix) ? raw : basePrefix + raw;
            }
            destination.add(dotted.replace('.', '/'));
        }
    }
}


