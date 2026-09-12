package io.github.cat.fabricobf.core;

import java.util.Collections;
import java.util.LinkedHashSet;
import java.util.Set;

public final class FabricMetadata {
    private final Set<String> mixinConfigs;
    private final Set<String> entrypointClasses;
    private final Set<MemberRef> entrypointMethods;
    private final String accessWidenerPath;

    public FabricMetadata(
            Set<String> mixinConfigs,
            Set<String> entrypointClasses,
            Set<MemberRef> entrypointMethods,
            String accessWidenerPath
    ) {
        this.mixinConfigs = Collections.unmodifiableSet(new LinkedHashSet<>(mixinConfigs));
        this.entrypointClasses = Collections.unmodifiableSet(new LinkedHashSet<>(entrypointClasses));
        this.entrypointMethods = Collections.unmodifiableSet(new LinkedHashSet<>(entrypointMethods));
        this.accessWidenerPath = accessWidenerPath;
    }

    public Set<String> mixinConfigs() {
        return mixinConfigs;
    }

    public Set<String> entrypointClasses() {
        return entrypointClasses;
    }

    public Set<MemberRef> entrypointMethods() {
        return entrypointMethods;
    }

    public String accessWidenerPath() {
        return accessWidenerPath;
    }
}

