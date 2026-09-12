package io.github.cat.fabricobf.core;

import java.util.Set;
import org.objectweb.asm.Opcodes;
import org.objectweb.asm.Type;
import org.objectweb.asm.tree.AnnotationNode;
import org.objectweb.asm.tree.FieldNode;
import org.objectweb.asm.tree.MethodNode;

public final class SafetyRules {
    public static final Set<String> ALWAYS_EXCLUDED_PREFIXES = Set.of(
            "net/minecraft/",
            "net/fabricmc/",
            "org/spongepowered/",
            "com/mojang/"
    );

    private SafetyRules() {
    }

    public static boolean isExcludedOwnerPrefix(String internalName) {
        for (String prefix : ALWAYS_EXCLUDED_PREFIXES) {
            if (internalName.startsWith(prefix)) {
                return true;
            }
        }
        return false;
    }

    public static boolean isMethodSerializationSensitive(MethodNode methodNode) {
        return (methodNode.name.equals("writeObject") && methodNode.desc.equals("(Ljava/io/ObjectOutputStream;)V"))
                || (methodNode.name.equals("readObject") && methodNode.desc.equals("(Ljava/io/ObjectInputStream;)V"))
                || (methodNode.name.equals("readResolve") && methodNode.desc.equals("()Ljava/lang/Object;"))
                || (methodNode.name.equals("writeReplace") && methodNode.desc.equals("()Ljava/lang/Object;"));
    }

    public static boolean isFieldSerializationSensitive(FieldNode fieldNode) {
        return "serialVersionUID".equals(fieldNode.name);
    }

    public static boolean hasJsonLikeAnnotation(FieldNode fieldNode) {
        return hasJsonLikeAnnotation(fieldNode.visibleAnnotations) || hasJsonLikeAnnotation(fieldNode.invisibleAnnotations);
    }

    private static boolean hasJsonLikeAnnotation(java.util.List<AnnotationNode> annotations) {
        if (annotations == null) {
            return false;
        }
        for (AnnotationNode annotation : annotations) {
            Type type = Type.getType(annotation.desc);
            String className = type.getClassName();
            if (className.startsWith("com.google.gson.annotations.")
                    || className.startsWith("com.fasterxml.jackson.annotation.")
                    || className.endsWith(".SerializedName")
                    || className.endsWith(".JsonProperty")) {
                return true;
            }
        }
        return false;
    }

    public static boolean isPackagePrivate(int access) {
        return (access & (Opcodes.ACC_PUBLIC | Opcodes.ACC_PRIVATE | Opcodes.ACC_PROTECTED)) == 0;
    }
}

