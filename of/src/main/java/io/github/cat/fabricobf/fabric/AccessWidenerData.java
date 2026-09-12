package io.github.cat.fabricobf.fabric;

import io.github.cat.fabricobf.core.MemberRef;
import java.util.Collections;
import java.util.LinkedHashSet;
import java.util.Set;

public record AccessWidenerData(Set<String> classes, Set<MemberRef> methods, Set<MemberRef> fields) {
    public AccessWidenerData {
        classes = Collections.unmodifiableSet(new LinkedHashSet<>(classes));
        methods = Collections.unmodifiableSet(new LinkedHashSet<>(methods));
        fields = Collections.unmodifiableSet(new LinkedHashSet<>(fields));
    }
}

