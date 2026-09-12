package io.github.cat.fabricobf.core;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;

public final class JarArchive {
    private final Map<String, ClassData> classesByEntry;
    private final Map<String, byte[]> resourcesByEntry;

    public JarArchive(Map<String, ClassData> classesByEntry, Map<String, byte[]> resourcesByEntry) {
        this.classesByEntry = Collections.unmodifiableMap(new LinkedHashMap<>(classesByEntry));
        this.resourcesByEntry = Collections.unmodifiableMap(new LinkedHashMap<>(resourcesByEntry));
    }

    public Map<String, ClassData> classesByEntry() {
        return classesByEntry;
    }

    public Map<String, byte[]> resourcesByEntry() {
        return resourcesByEntry;
    }
}

