package io.github.cat.fabricobf.core;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;

public final class SymbolMapping {
    private final Map<String, String> classMap;
    private final Map<MemberRef, String> methodMap;
    private final Map<MemberRef, String> fieldMap;

    public SymbolMapping(
            Map<String, String> classMap,
            Map<MemberRef, String> methodMap,
            Map<MemberRef, String> fieldMap
    ) {
        this.classMap = Collections.unmodifiableMap(new LinkedHashMap<>(classMap));
        this.methodMap = Collections.unmodifiableMap(new LinkedHashMap<>(methodMap));
        this.fieldMap = Collections.unmodifiableMap(new LinkedHashMap<>(fieldMap));
    }

    public Map<String, String> classMap() {
        return classMap;
    }

    public Map<MemberRef, String> methodMap() {
        return methodMap;
    }

    public Map<MemberRef, String> fieldMap() {
        return fieldMap;
    }
}

