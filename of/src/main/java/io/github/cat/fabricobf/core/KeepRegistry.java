package io.github.cat.fabricobf.core;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;
import org.objectweb.asm.tree.FieldNode;
import org.objectweb.asm.tree.MethodNode;

public final class KeepRegistry {
    private final Set<String> keptClasses = new HashSet<>();
    private final Set<MemberRef> keptMethods = new HashSet<>();
    private final Set<MemberRef> keptFields = new HashSet<>();
    private final Map<String, Set<String>> keptMethodNamesByOwner = new HashMap<>();
    private final Map<String, Set<String>> keptFieldNamesByOwner = new HashMap<>();
    private final List<Pattern> userPatterns;

    public KeepRegistry(List<Pattern> userPatterns) {
        this.userPatterns = new ArrayList<>(userPatterns);
    }

    public void keepClass(String owner) {
        if (owner != null) {
            keptClasses.add(owner);
        }
    }

    public void keepMethod(MemberRef ref) {
        if (ref != null) {
            keptMethods.add(ref);
        }
    }

    public void keepField(MemberRef ref) {
        if (ref != null) {
            keptFields.add(ref);
        }
    }

    public void keepMethodName(String owner, String name) {
        if (owner == null || name == null) {
            return;
        }
        keptMethodNamesByOwner.computeIfAbsent(owner, ignored -> new HashSet<>()).add(name);
    }

    public void keepFieldName(String owner, String name) {
        if (owner == null || name == null) {
            return;
        }
        keptFieldNamesByOwner.computeIfAbsent(owner, ignored -> new HashSet<>()).add(name);
    }

    public boolean isClassKept(String owner) {
        return keptClasses.contains(owner) || matchesUserRules("C:" + owner);
    }

    public boolean isMethodKept(String owner, MethodNode node) {
        MemberRef ref = new MemberRef(owner, node.name, node.desc);
        if (keptMethods.contains(ref)) {
            return true;
        }
        if (keptMethodNamesByOwner.getOrDefault(owner, Set.of()).contains(node.name)) {
            return true;
        }
        return matchesUserRules("M:" + owner + "#" + node.name + node.desc);
    }

    public boolean isFieldKept(String owner, FieldNode node) {
        MemberRef ref = new MemberRef(owner, node.name, node.desc);
        if (keptFields.contains(ref)) {
            return true;
        }
        if (keptFieldNamesByOwner.getOrDefault(owner, Set.of()).contains(node.name)) {
            return true;
        }
        return matchesUserRules("F:" + owner + "#" + node.name + ":" + node.desc);
    }

    private boolean matchesUserRules(String token) {
        for (Pattern pattern : userPatterns) {
            if (pattern.matcher(token).find()) {
                return true;
            }
        }
        return false;
    }
}

