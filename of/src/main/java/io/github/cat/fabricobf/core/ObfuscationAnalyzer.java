package io.github.cat.fabricobf.core;

import io.github.cat.fabricobf.fabric.AccessWidenerData;
import io.github.cat.fabricobf.fabric.AccessWidenerParser;
import io.github.cat.fabricobf.fabric.FabricModJsonParser;
import io.github.cat.fabricobf.fabric.MixinBytecodeAnalyzer;
import io.github.cat.fabricobf.fabric.MixinConfigData;
import io.github.cat.fabricobf.fabric.MixinConfigParser;
import io.github.cat.fabricobf.fabric.MixinTargetReference;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;
import org.objectweb.asm.Opcodes;
import org.objectweb.asm.Type;
import org.objectweb.asm.signature.SignatureReader;
import org.objectweb.asm.signature.SignatureVisitor;
import org.objectweb.asm.tree.AbstractInsnNode;
import org.objectweb.asm.tree.ClassNode;
import org.objectweb.asm.tree.FieldNode;
import org.objectweb.asm.tree.LdcInsnNode;
import org.objectweb.asm.tree.MethodInsnNode;

public final class ObfuscationAnalyzer {
    private static final String FABRIC_MOD_JSON = "fabric.mod.json";
    private static final Set<String> REFLECTION_SENSITIVE_FIELD_NAMES = Set.of(
            "name",
            "id",
            "key",
            "bind",
            "enabled",
            "value"
    );
    private static final Set<String> JSON_POJO_HINTS = Set.of(
            "Info",
            "Config",
            "Profile",
            "Announcement",
            "CacheData",
            "Result"
    );

    private final FabricModJsonParser fabricModJsonParser = new FabricModJsonParser();
    private final MixinConfigParser mixinConfigParser = new MixinConfigParser();
    private final AccessWidenerParser accessWidenerParser = new AccessWidenerParser();
    private final MixinBytecodeAnalyzer mixinBytecodeAnalyzer = new MixinBytecodeAnalyzer();

    public AnalysisResult analyze(JarArchive archive, ObfuscationConfig config) {
        List<Pattern> keepPatterns = compilePatterns(config.keepRegexRules());
        KeepRegistry keepRegistry = new KeepRegistry(keepPatterns);
        List<String> warnings = new ArrayList<>();

        Map<String, ClassData> byInternalName = new LinkedHashMap<>();
        for (ClassData classData : archive.classesByEntry().values()) {
            byInternalName.put(classData.internalName(), classData);
        }

        Set<String> modOwnedClasses = new LinkedHashSet<>();
        for (String owner : byInternalName.keySet()) {
            if (!SafetyRules.isExcludedOwnerPrefix(owner)) {
                modOwnedClasses.add(owner);
            }
        }

        byte[] fabricModBytes = archive.resourcesByEntry().get(FABRIC_MOD_JSON);
        FabricMetadata metadata;
        if (fabricModBytes == null) {
            // Not a Fabric mod — proceed with generic obfuscation without any Fabric-specific keeps.
            warnings.add("[NO_FABRIC_MOD_JSON] fabric.mod.json not found; applying generic obfuscation");
            metadata = new FabricMetadata(Set.of(), Set.of(), Set.of(), null);
        } else {
            metadata = fabricModJsonParser.parse(fabricModBytes);
        }

        for (String entrypointClass : metadata.entrypointClasses()) {
            keepRegistry.keepClass(entrypointClass);
        }
        for (MemberRef methodRef : metadata.entrypointMethods()) {
            keepRegistry.keepMethodName(methodRef.owner(), methodRef.name());
        }

        Set<String> mixinClasses = new LinkedHashSet<>();
        Set<String> mixinPackages = new LinkedHashSet<>();
        for (String mixinPath : metadata.mixinConfigs()) {
            byte[] mixinConfigBytes = archive.resourcesByEntry().get(mixinPath);
            if (mixinConfigBytes == null) {
                throw new IllegalArgumentException("Declared mixin config not found: " + mixinPath);
            }
            MixinConfigData mixinConfigData = mixinConfigParser.parse(mixinConfigBytes, mixinPath);
            mixinClasses.addAll(mixinConfigData.mixinClasses());
            if (!mixinConfigData.mixinPackage().isEmpty()) {
                mixinPackages.add(mixinConfigData.mixinPackage());
            }
            for (String pluginClass : mixinConfigData.pluginClasses()) {
                keepRegistry.keepClass(pluginClass);
            }
        }

        for (String mixinClass : mixinClasses) {
            keepRegistry.keepClass(mixinClass);
            ClassData mixinClassData = byInternalName.get(mixinClass);
            if (mixinClassData == null) {
                warnings.add("[MIXIN_CLASS_MISSING] Declared mixin class not found in jar: " + mixinClass);
                continue;
            }
            Set<String> targetClasses = mixinBytecodeAnalyzer.extractTargetClasses(mixinClassData.classNode());
            for (String targetClass : targetClasses) {
                keepRegistry.keepClass(targetClass);
            }
            Set<MixinTargetReference> targetRefs = mixinBytecodeAnalyzer.extractTargetMemberReferences(
                    mixinClassData.classNode(),
                    targetClasses
            );
            for (MixinTargetReference targetRef : targetRefs) {
                if (targetRef.memberName() == null || targetRef.memberName().isBlank()) {
                    continue;
                }
                if (targetRef.method()) {
                    keepRegistry.keepMethodName(targetRef.owner(), targetRef.memberName());
                } else {
                    keepRegistry.keepFieldName(targetRef.owner(), targetRef.memberName());
                }
            }
        }

        if (metadata.accessWidenerPath() != null) {
            byte[] awBytes = archive.resourcesByEntry().get(metadata.accessWidenerPath());
            if (awBytes == null) {
                throw new IllegalArgumentException("Declared access widener not found: " + metadata.accessWidenerPath());
            }
            AccessWidenerData awData = accessWidenerParser.parse(awBytes, metadata.accessWidenerPath());
            for (String className : awData.classes()) {
                keepRegistry.keepClass(className);
            }
            awData.methods().forEach(keepRegistry::keepMethod);
            awData.fields().forEach(keepRegistry::keepField);
        }

        byte[] manifestBytes = archive.resourcesByEntry().get("META-INF/MANIFEST.MF");
        if (manifestBytes != null) {
            try {
                java.util.jar.Manifest manifest = new java.util.jar.Manifest(new java.io.ByteArrayInputStream(manifestBytes));
                String mainClass = manifest.getMainAttributes().getValue(java.util.jar.Attributes.Name.MAIN_CLASS);
                if (mainClass != null && !mainClass.isBlank()) {
                    keepRegistry.keepClass(mainClass.replace('.', '/'));
                    keepRegistry.keepMethodName(mainClass.replace('.', '/'), "main");
                }
            } catch (Exception ex) {
                warnings.add("[MANIFEST_WARN] Failed to parse META-INF/MANIFEST.MF: " + ex.getMessage());
            }
        }

        for (String className : byInternalName.keySet()) {
            if (SafetyRules.isExcludedOwnerPrefix(className)) {
                keepRegistry.keepClass(className);
            }
            for (String mixinPackage : mixinPackages) {
                if (className.startsWith(mixinPackage + "/")) {
                    keepRegistry.keepClass(className);
                    break;
                }
            }
        }

        // Serialization safety defaults.
        Set<String> gsonTargetClasses = detectGsonTargetClasses(byInternalName.values());
        Set<String> serializedStateClasses = detectSerializedStateClasses(byInternalName, gsonTargetClasses);
        Set<String> classNameStringLiterals = detectClassNameStringLiterals(byInternalName);
        classNameStringLiterals.forEach(keepRegistry::keepClass);
        for (ClassData classData : byInternalName.values()) {
            String owner = classData.internalName();
            boolean gsonTarget = gsonTargetClasses.contains(owner);
            boolean likelyJsonPojo = isLikelyJsonPojo(owner);
            boolean serializedState = serializedStateClasses.contains(owner);
            if (gsonTarget || likelyJsonPojo) {
                keepAllMembers(owner, classData, keepRegistry);
            } else if (serializedState) {
                keepAllFields(owner, classData, keepRegistry);
            }
            classData.classNode().methods.forEach(methodNode -> {
                if (SafetyRules.isMethodSerializationSensitive(methodNode)) {
                    keepRegistry.keepMethod(new MemberRef(owner, methodNode.name, methodNode.desc));
                }
            });
            classData.classNode().fields.forEach(fieldNode -> {
                if (SafetyRules.isFieldSerializationSensitive(fieldNode) || SafetyRules.hasJsonLikeAnnotation(fieldNode)) {
                    keepRegistry.keepField(new MemberRef(owner, fieldNode.name, fieldNode.desc));
                }
                if (isReflectionSensitiveField(owner, fieldNode.name)) {
                    keepRegistry.keepField(new MemberRef(owner, fieldNode.name, fieldNode.desc));
                }
                if (gsonTarget || likelyJsonPojo || serializedState) {
                    keepRegistry.keepField(new MemberRef(owner, fieldNode.name, fieldNode.desc));
                }
            });
        }

        return new AnalysisResult(
                byInternalName,
                modOwnedClasses,
                keepRegistry,
                mixinClasses,
                SafetyRules.ALWAYS_EXCLUDED_PREFIXES,
                warnings
        );
    }

    private static List<Pattern> compilePatterns(List<String> keepRegexRules) {
        List<Pattern> patterns = new ArrayList<>();
        for (String regex : keepRegexRules) {
            patterns.add(Pattern.compile(regex));
        }
        return patterns;
    }

    private static boolean isReflectionSensitiveField(String owner, String fieldName) {
        if (owner.contains("/settings/") && REFLECTION_SENSITIVE_FIELD_NAMES.contains(fieldName)) {
            return true;
        }
        if ((owner.endsWith("/Builder") || owner.endsWith("$Builder")) && !fieldName.startsWith("this$")) {
            return true;
        }
        return false;
    }

    private static boolean isLikelyJsonPojo(String owner) {
        if (owner.contains("/client/system/")) {
            return true;
        }
        String simple = owner.substring(owner.lastIndexOf('/') + 1);
        for (String hint : JSON_POJO_HINTS) {
            if (simple.contains(hint)) {
                return true;
            }
        }
        return false;
    }

    private static Set<String> detectGsonTargetClasses(Iterable<ClassData> classes) {
        Set<String> targets = new LinkedHashSet<>();
        for (ClassData classData : classes) {
            classData.classNode().methods.forEach(methodNode -> {
                for (AbstractInsnNode insn = methodNode.instructions.getFirst(); insn != null; insn = insn.getNext()) {
                    if (!(insn instanceof MethodInsnNode methodInsnNode)) {
                        continue;
                    }
                    if (!"com/google/gson/Gson".equals(methodInsnNode.owner)) {
                        continue;
                    }
                    if (!methodInsnNode.name.startsWith("fromJson") && !methodInsnNode.name.startsWith("toJson")) {
                        continue;
                    }
                    if (!methodInsnNode.desc.contains("Ljava/lang/Class;")) {
                        continue;
                    }
                    String target = findClosestClassLiteral(insn.getPrevious());
                    if (target != null && !target.startsWith("java/")) {
                        targets.add(target);
                    }
                }
            });
        }
        return targets;
    }

    private static Set<String> detectSerializedStateClasses(
            Map<String, ClassData> classesByInternalName,
            Set<String> gsonTargetClasses
    ) {
        Set<String> result = new LinkedHashSet<>(gsonTargetClasses);
        Set<String> jsonSerializableInterfaces = detectJsonSerializableInterfaces(classesByInternalName);

        for (ClassData classData : classesByInternalName.values()) {
            String owner = classData.internalName();
            if (isLikelyJsonPojo(owner) || implementsAny(classData.classNode(), jsonSerializableInterfaces)) {
                result.add(owner);
            }
        }
        result.addAll(detectJsonSerializableLoadTargets(classesByInternalName.values()));

        ArrayDeque<String> queue = new ArrayDeque<>(result);
        Set<String> visited = new HashSet<>();
        while (!queue.isEmpty()) {
            String owner = queue.removeFirst();
            if (!visited.add(owner)) {
                continue;
            }
            ClassData classData = classesByInternalName.get(owner);
            if (classData == null) {
                continue;
            }
            for (FieldNode field : classData.classNode().fields) {
                for (String referenced : fieldReferencedClasses(field)) {
                    if (classesByInternalName.containsKey(referenced) && result.add(referenced)) {
                        queue.add(referenced);
                    }
                }
            }
        }
        return result;
    }

    private static Set<String> detectJsonSerializableInterfaces(Map<String, ClassData> classesByInternalName) {
        Set<String> interfaces = new LinkedHashSet<>();
        for (ClassData classData : classesByInternalName.values()) {
            ClassNode node = classData.classNode();
            if ((node.access & Opcodes.ACC_INTERFACE) != 0 && node.name.endsWith("/JsonSerializable")) {
                interfaces.add(node.name);
            }
        }
        return interfaces;
    }

    private static boolean implementsAny(ClassNode node, Set<String> interfaces) {
        if (node.interfaces == null || interfaces.isEmpty()) {
            return false;
        }
        for (String interfaceName : node.interfaces) {
            if (interfaces.contains(interfaceName)) {
                return true;
            }
        }
        return false;
    }

    private static Set<String> detectJsonSerializableLoadTargets(Iterable<ClassData> classes) {
        Set<String> targets = new LinkedHashSet<>();
        for (ClassData classData : classes) {
            classData.classNode().methods.forEach(methodNode -> {
                for (AbstractInsnNode insn = methodNode.instructions.getFirst(); insn != null; insn = insn.getNext()) {
                    if (!(insn instanceof MethodInsnNode methodInsnNode)) {
                        continue;
                    }
                    if (!methodInsnNode.owner.endsWith("/JsonSerializable") || !"load".equals(methodInsnNode.name)) {
                        continue;
                    }
                    if (!methodInsnNode.desc.contains("Ljava/lang/Class;")) {
                        continue;
                    }
                    String target = findClosestClassLiteral(insn.getPrevious());
                    if (target != null && !target.startsWith("java/")) {
                        targets.add(target);
                    }
                }
            });
        }
        return targets;
    }

    private static Set<String> detectClassNameStringLiterals(Map<String, ClassData> classesByInternalName) {
        Map<String, String> knownNames = new LinkedHashMap<>();
        for (String owner : classesByInternalName.keySet()) {
            knownNames.put(owner, owner);
            knownNames.put(owner.replace('/', '.'), owner);
        }

        Set<String> result = new LinkedHashSet<>();
        for (ClassData classData : classesByInternalName.values()) {
            classData.classNode().methods.forEach(methodNode -> {
                for (AbstractInsnNode insn = methodNode.instructions.getFirst(); insn != null; insn = insn.getNext()) {
                    if (!(insn instanceof LdcInsnNode ldc) || !(ldc.cst instanceof String value)) {
                        continue;
                    }
                    String owner = knownNames.get(value);
                    if (owner != null) {
                        result.add(owner);
                    }
                }
            });
        }
        return result;
    }

    private static Set<String> fieldReferencedClasses(FieldNode field) {
        Set<String> result = new LinkedHashSet<>();
        addType(result, Type.getType(field.desc));
        if (field.signature != null) {
            try {
                new SignatureReader(field.signature).accept(new SignatureVisitor(Opcodes.ASM9) {
                    @Override
                    public void visitClassType(String name) {
                        result.add(name);
                    }
                });
            } catch (IllegalArgumentException ignored) {
                // Bad generic signatures should not stop obfuscation; descriptor analysis still applies.
            }
        }
        return result;
    }

    private static void addType(Set<String> result, Type type) {
        if (type.getSort() == Type.OBJECT) {
            result.add(type.getInternalName());
        } else if (type.getSort() == Type.ARRAY) {
            addType(result, type.getElementType());
        }
    }

    private static void keepAllMembers(String owner, ClassData classData, KeepRegistry keepRegistry) {
        classData.classNode().methods.forEach(methodNode ->
                keepRegistry.keepMethod(new MemberRef(owner, methodNode.name, methodNode.desc))
        );
        keepAllFields(owner, classData, keepRegistry);
    }

    private static void keepAllFields(String owner, ClassData classData, KeepRegistry keepRegistry) {
        classData.classNode().fields.forEach(fieldNode ->
                keepRegistry.keepField(new MemberRef(owner, fieldNode.name, fieldNode.desc))
        );
    }

    private static String findClosestClassLiteral(AbstractInsnNode start) {
        int steps = 0;
        for (AbstractInsnNode cur = start; cur != null && steps < 12; cur = cur.getPrevious(), steps++) {
            if (cur instanceof LdcInsnNode ldc && ldc.cst instanceof Type type && type.getSort() == Type.OBJECT) {
                return type.getInternalName();
            }
        }
        return null;
    }
}
