package io.github.cat.fabricobf.fabric;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import org.objectweb.asm.Type;
import org.objectweb.asm.tree.AnnotationNode;
import org.objectweb.asm.tree.ClassNode;
import org.objectweb.asm.tree.FieldNode;
import org.objectweb.asm.tree.MethodNode;

public final class MixinBytecodeAnalyzer {
    private static final String MIXIN_ANNOTATION_DESC = "Lorg/spongepowered/asm/mixin/Mixin;";

    public Set<String> extractTargetClasses(ClassNode mixinClass) {
        Set<String> result = new LinkedHashSet<>();
        List<AnnotationNode> annotations = mergeAnnotations(mixinClass.visibleAnnotations, mixinClass.invisibleAnnotations);
        for (AnnotationNode annotation : annotations) {
            if (!MIXIN_ANNOTATION_DESC.equals(annotation.desc)) {
                continue;
            }
            if (annotation.values == null) {
                continue;
            }
            for (int i = 0; i < annotation.values.size() - 1; i += 2) {
                String key = String.valueOf(annotation.values.get(i));
                Object value = annotation.values.get(i + 1);
                if ("targets".equals(key) && value instanceof List<?> list) {
                    for (Object raw : list) {
                        if (raw instanceof String str) {
                            result.add(str.replace('.', '/'));
                        }
                    }
                }
                if ("value".equals(key) && value instanceof List<?> list) {
                    for (Object raw : list) {
                        if (raw instanceof Type type) {
                            result.add(type.getInternalName());
                        }
                    }
                }
            }
        }
        return result;
    }

    public Set<MixinTargetReference> extractTargetMemberReferences(ClassNode mixinClass, Set<String> targetClasses) {
        Set<MixinTargetReference> refs = new LinkedHashSet<>();
        for (MethodNode method : mixinClass.methods) {
            List<AnnotationNode> annotations = mergeAnnotations(method.visibleAnnotations, method.invisibleAnnotations);
            for (AnnotationNode annotation : annotations) {
                List<String> methodNames = extractMethodNames(annotation);
                for (String methodName : methodNames) {
                    for (String owner : targetClasses) {
                        refs.add(new MixinTargetReference(owner, methodName, true));
                    }
                }
            }
        }

        for (FieldNode field : mixinClass.fields) {
            List<AnnotationNode> annotations = mergeAnnotations(field.visibleAnnotations, field.invisibleAnnotations);
            boolean shadowLike = annotations.stream().anyMatch(a ->
                    a.desc.contains("/Shadow;") || a.desc.contains("/Mutable;"));
            if (shadowLike) {
                for (String owner : targetClasses) {
                    refs.add(new MixinTargetReference(owner, field.name, false));
                }
            }
        }
        return refs;
    }

    private static List<String> extractMethodNames(AnnotationNode annotation) {
        List<String> names = new ArrayList<>();
        if (annotation.values == null) {
            return names;
        }
        for (int i = 0; i < annotation.values.size() - 1; i += 2) {
            Object keyRaw = annotation.values.get(i);
            Object value = annotation.values.get(i + 1);
            String key = String.valueOf(keyRaw);
            if (!"method".equals(key) && !"value".equals(key)) {
                continue;
            }
            if (value instanceof String str) {
                addExtractedName(str, names);
            } else if (value instanceof List<?> list) {
                for (Object obj : list) {
                    if (obj instanceof String str) {
                        addExtractedName(str, names);
                    }
                }
            }
        }
        if (names.isEmpty() && (annotation.desc.contains("/Invoker;") || annotation.desc.contains("/Accessor;"))) {
            names.add(inferNameFromAccessorStyle(annotation));
        }
        return names;
    }

    private static String inferNameFromAccessorStyle(AnnotationNode annotation) {
        if (annotation.values == null) {
            return "";
        }
        for (int i = 0; i < annotation.values.size() - 1; i += 2) {
            if ("value".equals(String.valueOf(annotation.values.get(i)))) {
                Object value = annotation.values.get(i + 1);
                if (value instanceof String str) {
                    return str;
                }
            }
        }
        return "";
    }

    private static void addExtractedName(String raw, List<String> names) {
        String trimmed = raw.trim();
        if (trimmed.isEmpty()) {
            return;
        }
        int paren = trimmed.indexOf('(');
        int colon = trimmed.indexOf(':');
        int end = trimmed.length();
        if (paren >= 0) {
            end = Math.min(end, paren);
        }
        if (colon >= 0) {
            end = Math.min(end, colon);
        }
        String name = trimmed.substring(0, end).trim();
        int lastSlash = name.lastIndexOf('/');
        if (lastSlash >= 0 && lastSlash + 1 < name.length()) {
            name = name.substring(lastSlash + 1);
        }
        if (!name.isEmpty()) {
            names.add(name);
        }
    }

    private static List<AnnotationNode> mergeAnnotations(List<AnnotationNode> visible, List<AnnotationNode> invisible) {
        List<AnnotationNode> all = new ArrayList<>();
        if (visible != null) {
            all.addAll(visible);
        }
        if (invisible != null) {
            all.addAll(invisible);
        }
        return all;
    }
}

