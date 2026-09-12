package io.github.cat.fabricobf.fabric;

import io.github.cat.fabricobf.core.MemberRef;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashSet;
import java.util.Set;

public final class AccessWidenerParser {
    public AccessWidenerData parse(byte[] accessWidenerBytes, String path) {
        Set<String> classes = new LinkedHashSet<>();
        Set<MemberRef> methods = new LinkedHashSet<>();
        Set<MemberRef> fields = new LinkedHashSet<>();

        String content = new String(accessWidenerBytes, StandardCharsets.UTF_8);
        String[] lines = content.split("\\R");
        boolean headerSeen = false;
        for (String line : lines) {
            String trimmed = line.trim();
            if (trimmed.isEmpty() || trimmed.startsWith("#")) {
                continue;
            }
            if (!headerSeen) {
                if (!trimmed.startsWith("accessWidener")) {
                    throw new IllegalArgumentException("Malformed access widener " + path + ": missing header");
                }
                headerSeen = true;
                continue;
            }

            String[] parts = trimmed.split("\\s+");
            if (parts.length < 3) {
                continue;
            }
            String kind = parts[1];
            if ("class".equals(kind)) {
                classes.add(parts[2]);
            } else if ("method".equals(kind)) {
                if (parts.length < 5) {
                    throw new IllegalArgumentException("Malformed access widener method line: " + trimmed);
                }
                methods.add(new MemberRef(parts[2], parts[3], parts[4]));
            } else if ("field".equals(kind)) {
                if (parts.length < 5) {
                    throw new IllegalArgumentException("Malformed access widener field line: " + trimmed);
                }
                fields.add(new MemberRef(parts[2], parts[3], parts[4]));
            }
        }

        if (!headerSeen) {
            throw new IllegalArgumentException("Malformed access widener " + path + ": missing header");
        }
        return new AccessWidenerData(classes, methods, fields);
    }
}

