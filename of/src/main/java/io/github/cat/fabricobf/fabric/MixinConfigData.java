package io.github.cat.fabricobf.fabric;

import java.util.Collections;
import java.util.LinkedHashSet;
import java.util.Set;

public record MixinConfigData(String mixinPackage, Set<String> mixinClasses, Set<String> pluginClasses) {
    public MixinConfigData {
        mixinClasses = Collections.unmodifiableSet(new LinkedHashSet<>(mixinClasses));
        pluginClasses = Collections.unmodifiableSet(new LinkedHashSet<>(pluginClasses));
    }
}

