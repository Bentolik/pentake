package io.github.cat.fabricobf.core;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.objectweb.asm.Opcodes;
import org.objectweb.asm.tree.AbstractInsnNode;
import org.objectweb.asm.tree.ClassNode;
import org.objectweb.asm.tree.FieldNode;
import org.objectweb.asm.tree.MethodNode;

public final class MappingGenerator {
    public MappingGenerationResult generate(AnalysisResult analysis, ObfuscationConfig config) {
        List<String> warnings = new ArrayList<>();
        KeepRegistry keep = analysis.keepRegistry();

        Map<String, String> classMap = new LinkedHashMap<>();
        Map<MemberRef, String> methodMap = new LinkedHashMap<>();
        Map<MemberRef, String> fieldMap = new LinkedHashMap<>();

        DeterministicNameGenerator generator = new DeterministicNameGenerator(config.seed());
        Map<String, ClassData> classes = analysis.classesByInternalName();
        List<String> sortedOwners = classes.keySet().stream().sorted().toList();

        Set<String> occupiedClassNames = new HashSet<>(classes.keySet());
        if (config.effectiveRenameClasses()) {
            for (String owner : sortedOwners) {
                if (!analysis.modOwnedClasses().contains(owner)) {
                    continue;
                }
                if (keep.isClassKept(owner)) {
                    continue;
                }
                ClassData classData = classes.get(owner);
                if (classData != null && isRecordClass(classData.classNode())) {
                    warnings.add("[CLASS_SKIP_RECORD] " + owner);
                    continue;
                }
                if (owner.endsWith("module-info") || owner.endsWith("package-info")) {
                    continue;
                }
                String packagePrefix = "";
                int slash = owner.lastIndexOf('/');
                if (slash >= 0) {
                    packagePrefix = owner.substring(0, slash + 1);
                }
                String candidate;
                do {
                    candidate = packagePrefix + generator.nextIdentifier(occupiedClassNames);
                } while (occupiedClassNames.contains(candidate));
                occupiedClassNames.add(candidate);
                classMap.put(owner, candidate);
            }
        }

        Hierarchy hierarchy = new Hierarchy(classes);
        for (String owner : sortedOwners) {
            ClassData classData = classes.get(owner);
            ClassNode classNode = classData.classNode();
            if (isRecordClass(classNode)) {
                warnings.add("[MEMBER_SKIP_RECORD] " + owner);
                continue;
            }

            boolean classKept = keep.isClassKept(owner);
            if (!analysis.modOwnedClasses().contains(owner)) {
                continue;
            }
            if (classKept) {
                continue;
            }

            Map<String, Set<String>> methodNamesByDesc = indexMethodNamesByDesc(classNode.methods);
            Set<String> usedFieldNames = indexFieldNames(classNode.fields);

            List<MethodNode> sortedMethods = new ArrayList<>(classNode.methods);
            sortedMethods.sort(Comparator.comparing((MethodNode m) -> m.name).thenComparing(m -> m.desc));
            for (MethodNode method : sortedMethods) {
                if (!isMethodCandidate(owner, classNode, method, analysis, hierarchy, keep, config, warnings)) {
                    continue;
                }
                Set<String> usedForDesc = methodNamesByDesc.computeIfAbsent(method.desc, ignored -> new HashSet<>());
                String newName = generator.nextIdentifier(usedForDesc);
                usedForDesc.add(newName);
                methodMap.put(new MemberRef(owner, method.name, method.desc), newName);
            }

            List<FieldNode> sortedFields = new ArrayList<>(classNode.fields);
            sortedFields.sort(Comparator.comparing((FieldNode f) -> f.name).thenComparing(f -> f.desc));
            for (FieldNode field : sortedFields) {
                if (!isFieldCandidate(owner, classNode, field, analysis, hierarchy, keep, config, warnings)) {
                    continue;
                }
                String newName = generator.nextIdentifier(usedFieldNames);
                usedFieldNames.add(newName);
                fieldMap.put(new MemberRef(owner, field.name, field.desc), newName);
            }
        }

        return new MappingGenerationResult(new SymbolMapping(classMap, methodMap, fieldMap), warnings);
    }

    private static boolean isMethodCandidate(
            String owner,
            ClassNode classNode,
            MethodNode methodNode,
            AnalysisResult analysis,
            Hierarchy hierarchy,
            KeepRegistry keep,
            ObfuscationConfig config,
            List<String> warnings
    ) {
        if (methodNode.name.startsWith("<")) {
            return false;
        }
        if ((methodNode.access & Opcodes.ACC_PUBLIC) != 0) {
            return false;
        }
        if ((methodNode.access & (Opcodes.ACC_NATIVE | Opcodes.ACC_ABSTRACT | Opcodes.ACC_SYNTHETIC | Opcodes.ACC_BRIDGE)) != 0) {
            return false;
        }
        if (SafetyRules.isMethodSerializationSensitive(methodNode)) {
            return false;
        }
        if (containsInvokeDynamic(methodNode) && !config.effectiveAggressive()) {
            warnings.add("[METHOD_SKIP_INDY] " + owner + "#" + methodNode.name + methodNode.desc);
            return false;
        }
        if (keep.isMethodKept(owner, methodNode)) {
            return false;
        }

        boolean isPrivate = (methodNode.access & Opcodes.ACC_PRIVATE) != 0;
        if (isPrivate) {
            return true;
        }

        boolean isProtected = (methodNode.access & Opcodes.ACC_PROTECTED) != 0;
        boolean isPackagePrivate = SafetyRules.isPackagePrivate(methodNode.access);
        if (!isProtected && !isPackagePrivate) {
            return false;
        }

        boolean classFinal = (classNode.access & Opcodes.ACC_FINAL) != 0;
        boolean methodFinal = (methodNode.access & Opcodes.ACC_FINAL) != 0;
        boolean methodStatic = (methodNode.access & Opcodes.ACC_STATIC) != 0;
        if (!classFinal && !methodFinal && !methodStatic) {
            warnings.add("[METHOD_SKIP_UNSAFE_DISPATCH] " + owner + "#" + methodNode.name + methodNode.desc);
            return false;
        }

        if (hierarchy.hasExternalSuper(owner)) {
            warnings.add("[METHOD_SKIP_EXTERNAL_SUPER] " + owner + "#" + methodNode.name + methodNode.desc);
            return false;
        }

        if (hierarchy.hasOwnedAncestorDeclaration(owner, methodNode.name, methodNode.desc)) {
            warnings.add("[METHOD_SKIP_OVERRIDE] " + owner + "#" + methodNode.name + methodNode.desc);
            return false;
        }
        if (hierarchy.hasOwnedDescendantDeclaration(owner, methodNode.name, methodNode.desc)) {
            warnings.add("[METHOD_SKIP_OVERRIDDEN] " + owner + "#" + methodNode.name + methodNode.desc);
            return false;
        }
        return true;
    }

    private static boolean isFieldCandidate(
            String owner,
            ClassNode classNode,
            FieldNode fieldNode,
            AnalysisResult analysis,
            Hierarchy hierarchy,
            KeepRegistry keep,
            ObfuscationConfig config,
            List<String> warnings
    ) {
        if ((fieldNode.access & Opcodes.ACC_PUBLIC) != 0) {
            return false;
        }
        if ((fieldNode.access & Opcodes.ACC_SYNTHETIC) != 0) {
            return false;
        }
        if (SafetyRules.isFieldSerializationSensitive(fieldNode) || SafetyRules.hasJsonLikeAnnotation(fieldNode)) {
            return false;
        }
        if (keep.isFieldKept(owner, fieldNode)) {
            return false;
        }

        boolean isPrivate = (fieldNode.access & Opcodes.ACC_PRIVATE) != 0;
        if (isPrivate) {
            return true;
        }

        // For protected and package-private fields: allow renaming in aggressive mode
        // only when the class hierarchy is fully contained within the jar (no external
        // subclasses that could reference the field by its original name).
        if (!config.effectiveAggressive()) {
            warnings.add("[FIELD_SKIP_NON_PRIVATE] " + owner + "#" + fieldNode.name + ":" + fieldNode.desc);
            return false;
        }

        boolean classFinal = (classNode.access & Opcodes.ACC_FINAL) != 0;
        if (!classFinal && hierarchy.hasExternalSubclass(owner)) {
            warnings.add("[FIELD_SKIP_EXTERNAL_SUBCLASS] " + owner + "#" + fieldNode.name + ":" + fieldNode.desc);
            return false;
        }

        return true;
    }

    private static boolean containsInvokeDynamic(MethodNode methodNode) {
        for (AbstractInsnNode insn = methodNode.instructions.getFirst(); insn != null; insn = insn.getNext()) {
            if (insn.getOpcode() == Opcodes.INVOKEDYNAMIC) {
                return true;
            }
        }
        return false;
    }

    private static Set<String> indexFieldNames(List<FieldNode> fields) {
        Set<String> names = new HashSet<>();
        for (FieldNode fieldNode : fields) {
            names.add(fieldNode.name);
        }
        return names;
    }

    private static Map<String, Set<String>> indexMethodNamesByDesc(List<MethodNode> methods) {
        Map<String, Set<String>> namesByDesc = new HashMap<>();
        for (MethodNode methodNode : methods) {
            namesByDesc.computeIfAbsent(methodNode.desc, ignored -> new HashSet<>()).add(methodNode.name);
        }
        return namesByDesc;
    }

    private static boolean isRecordClass(ClassNode classNode) {
        return (classNode.access & Opcodes.ACC_RECORD) != 0;
    }

    private static final class Hierarchy {
        private final Map<String, ClassNode> classNodes = new HashMap<>();
        private final Map<String, Set<String>> subclasses = new HashMap<>();

        private Hierarchy(Map<String, ClassData> classes) {
            for (Map.Entry<String, ClassData> entry : classes.entrySet()) {
                classNodes.put(entry.getKey(), entry.getValue().classNode());
            }
            for (Map.Entry<String, ClassNode> entry : classNodes.entrySet()) {
                String owner = entry.getKey();
                ClassNode node = entry.getValue();
                if (node.superName != null) {
                    subclasses.computeIfAbsent(node.superName, ignored -> new HashSet<>()).add(owner);
                }
            }
        }

        private boolean hasExternalSuper(String owner) {
            ClassNode node = classNodes.get(owner);
            String current = node == null ? null : node.superName;
            while (current != null && !"java/lang/Object".equals(current)) {
                if (!classNodes.containsKey(current)) {
                    return true;
                }
                ClassNode parent = classNodes.get(current);
                current = parent == null ? null : parent.superName;
            }
            return false;
        }

        /** True if any direct or transitive subclass of {@code owner} is outside the jar. */
        private boolean hasExternalSubclass(String owner) {
            ArrayDeque<String> queue = new ArrayDeque<>(subclasses.getOrDefault(owner, Set.of()));
            while (!queue.isEmpty()) {
                String sub = queue.removeFirst();
                if (!classNodes.containsKey(sub)) {
                    return true;
                }
                queue.addAll(subclasses.getOrDefault(sub, Set.of()));
            }
            return false;
        }

        private boolean hasOwnedAncestorDeclaration(String owner, String name, String desc) {
            ClassNode node = classNodes.get(owner);
            String current = node == null ? null : node.superName;
            while (current != null && !"java/lang/Object".equals(current)) {
                ClassNode parent = classNodes.get(current);
                if (parent == null) {
                    return false;
                }
                if (declares(parent, name, desc)) {
                    return true;
                }
                current = parent.superName;
            }
            return false;
        }

        private boolean hasOwnedDescendantDeclaration(String owner, String name, String desc) {
            ArrayDeque<String> queue = new ArrayDeque<>(subclasses.getOrDefault(owner, Set.of()));
            while (!queue.isEmpty()) {
                String candidate = queue.removeFirst();
                ClassNode node = classNodes.get(candidate);
                if (node == null) {
                    continue;
                }
                if (declares(node, name, desc)) {
                    return true;
                }
                queue.addAll(subclasses.getOrDefault(candidate, Set.of()));
            }
            return false;
        }

        private static boolean declares(ClassNode node, String name, String desc) {
            for (MethodNode methodNode : node.methods) {
                if (methodNode.name.equals(name) && methodNode.desc.equals(desc)) {
                    return true;
                }
            }
            return false;
        }
    }
}
