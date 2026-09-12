package io.github.cat.fabricobf.fabric;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import io.github.cat.fabricobf.core.FabricMetadata;
import io.github.cat.fabricobf.core.MemberRef;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashSet;
import java.util.Set;

public final class FabricModJsonParser {
    public FabricMetadata parse(byte[] fabricModJsonBytes) {
        try {
            JsonObject root = JsonParser.parseString(new String(fabricModJsonBytes, StandardCharsets.UTF_8)).getAsJsonObject();
            Set<String> mixinConfigs = parseMixins(root);
            Set<String> entrypointClasses = new LinkedHashSet<>();
            Set<MemberRef> entrypointMethods = new LinkedHashSet<>();
            parseEntrypoints(root, entrypointClasses, entrypointMethods);
            String accessWidener = root.has("accessWidener") ? root.get("accessWidener").getAsString() : null;
            return new FabricMetadata(mixinConfigs, entrypointClasses, entrypointMethods, accessWidener);
        } catch (Exception ex) {
            throw new IllegalArgumentException("Malformed fabric.mod.json: " + ex.getMessage(), ex);
        }
    }

    private static Set<String> parseMixins(JsonObject root) {
        Set<String> mixins = new LinkedHashSet<>();
        if (!root.has("mixins")) {
            return mixins;
        }
        JsonArray array = root.getAsJsonArray("mixins");
        for (JsonElement element : array) {
            if (element.isJsonPrimitive()) {
                mixins.add(element.getAsString());
            } else if (element.isJsonObject()) {
                JsonObject obj = element.getAsJsonObject();
                if (obj.has("config")) {
                    mixins.add(obj.get("config").getAsString());
                }
            }
        }
        return mixins;
    }

    private static void parseEntrypoints(
            JsonObject root,
            Set<String> entrypointClasses,
            Set<MemberRef> entrypointMethods
    ) {
        if (!root.has("entrypoints")) {
            return;
        }
        JsonObject entrypoints = root.getAsJsonObject("entrypoints");
        for (String key : entrypoints.keySet()) {
            JsonArray values = entrypoints.getAsJsonArray(key);
            for (JsonElement value : values) {
                String raw;
                if (value.isJsonPrimitive()) {
                    raw = value.getAsString();
                } else if (value.isJsonObject() && value.getAsJsonObject().has("value")) {
                    raw = value.getAsJsonObject().get("value").getAsString();
                } else {
                    continue;
                }
                String[] split = raw.split("::", 2);
                String owner = split[0].replace('.', '/');
                entrypointClasses.add(owner);
                if (split.length == 2) {
                    entrypointMethods.add(new MemberRef(owner, split[1], ""));
                }
            }
        }
    }
}

