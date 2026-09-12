package io.github.cat.fabricobf.asm;

import io.github.cat.fabricobf.core.ClassData;
import io.github.cat.fabricobf.core.MemberRef;
import io.github.cat.fabricobf.core.SymbolMapping;
import java.util.ArrayDeque;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;
import org.objectweb.asm.commons.Remapper;
import org.objectweb.asm.tree.ClassNode;

public final class MappingRemapper extends Remapper {
    private final SymbolMapping mapping;
    private final Map<String, ClassNode> classNodes;

    public MappingRemapper(SymbolMapping mapping, Map<String, ClassData> classesByInternalName) {
        this.mapping = mapping;
        this.classNodes = new HashMap<>();
        for (Map.Entry<String, ClassData> entry : classesByInternalName.entrySet()) {
            this.classNodes.put(entry.getKey(), entry.getValue().classNode());
        }
    }

    @Override
    public String map(String internalName) {
        return mapping.classMap().getOrDefault(internalName, internalName);
    }

    @Override
    public String mapFieldName(String owner, String name, String descriptor) {
        String renamed = mapping.fieldMap().get(new MemberRef(owner, name, descriptor));
        if (renamed != null) {
            return renamed;
        }
        for (String candidateOwner : resolveOwners(owner)) {
            renamed = mapping.fieldMap().get(new MemberRef(candidateOwner, name, descriptor));
            if (renamed != null) {
                return renamed;
            }
        }
        return name;
    }

    @Override
    public String mapMethodName(String owner, String name, String descriptor) {
        String renamed = mapping.methodMap().get(new MemberRef(owner, name, descriptor));
        if (renamed != null) {
            return renamed;
        }
        for (String candidateOwner : resolveOwners(owner)) {
            renamed = mapping.methodMap().get(new MemberRef(candidateOwner, name, descriptor));
            if (renamed != null) {
                return renamed;
            }
        }
        return name;
    }

    private Set<String> resolveOwners(String owner) {
        Set<String> visited = new HashSet<>();
        ArrayDeque<String> queue = new ArrayDeque<>();
        ClassNode root = classNodes.get(owner);
        if (root == null) {
            return Set.of();
        }

        if (root.superName != null) {
            queue.add(root.superName);
        }
        if (root.interfaces != null) {
            queue.addAll(root.interfaces);
        }

        while (!queue.isEmpty()) {
            String current = queue.removeFirst();
            if (!visited.add(current)) {
                continue;
            }
            ClassNode node = classNodes.get(current);
            if (node == null) {
                continue;
            }
            if (node.superName != null) {
                queue.add(node.superName);
            }
            if (node.interfaces != null) {
                queue.addAll(node.interfaces);
            }
        }
        return visited;
    }
}
