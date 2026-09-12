package io.github.cat.fabricobf.core;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.Map;
import java.util.Set;

public final class AnalysisResult {
    private final Map<String, ClassData> classesByInternalName;
    private final Set<String> modOwnedClasses;
    private final KeepRegistry keepRegistry;
    private final Set<String> mixinClasses;
    private final Set<String> alwaysExcludedPrefixes;
    private final java.util.List<String> warnings;

    public AnalysisResult(
            Map<String, ClassData> classesByInternalName,
            Set<String> modOwnedClasses,
            KeepRegistry keepRegistry,
            Set<String> mixinClasses,
            Set<String> alwaysExcludedPrefixes,
            java.util.List<String> warnings
    ) {
        this.classesByInternalName = Collections.unmodifiableMap(new LinkedHashMap<>(classesByInternalName));
        this.modOwnedClasses = Collections.unmodifiableSet(new LinkedHashSet<>(modOwnedClasses));
        this.keepRegistry = keepRegistry;
        this.mixinClasses = Collections.unmodifiableSet(new LinkedHashSet<>(mixinClasses));
        this.alwaysExcludedPrefixes = Collections.unmodifiableSet(new LinkedHashSet<>(alwaysExcludedPrefixes));
        this.warnings = java.util.List.copyOf(warnings);
    }

    public Map<String, ClassData> classesByInternalName() {
        return classesByInternalName;
    }

    public Set<String> modOwnedClasses() {
        return modOwnedClasses;
    }

    public KeepRegistry keepRegistry() {
        return keepRegistry;
    }

    public Set<String> mixinClasses() {
        return mixinClasses;
    }

    public Set<String> alwaysExcludedPrefixes() {
        return alwaysExcludedPrefixes;
    }

    public java.util.List<String> warnings() {
        return warnings;
    }
}

