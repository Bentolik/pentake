package io.github.cat.fabricobf.asm;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Random;
import org.objectweb.asm.ClassReader;
import org.objectweb.asm.ClassWriter;
import org.objectweb.asm.Opcodes;
import org.objectweb.asm.Type;
import org.objectweb.asm.tree.AbstractInsnNode;
import org.objectweb.asm.tree.ClassNode;
import org.objectweb.asm.tree.FieldInsnNode;
import org.objectweb.asm.tree.FieldNode;
import org.objectweb.asm.tree.InsnList;
import org.objectweb.asm.tree.InsnNode;
import org.objectweb.asm.tree.MethodInsnNode;
import org.objectweb.asm.tree.MethodNode;
import org.objectweb.asm.tree.VarInsnNode;

/**
 * Splits private-static methods out of their owner class into synthetic helper
 * classes, then replaces each original method body with a static forwarding call.
 *
 * <p>Safety constraints enforced by {@link #eligible}:
 * <ul>
 *   <li>Only {@code private static} non-abstract non-native methods are candidates.
 *   <li>Methods that reference private or package-private members of the owner class
 *       are rejected — the generated helper lives in the default package and cannot
 *       access those members from there.
 *   <li>Methods with {@code INVOKEDYNAMIC} instructions are rejected because lambda
 *       bootstrap handles may reference synthetic methods in the original class that
 *       are not accessible from the helper class.
 *   <li>Methods with {@code INVOKESPECIAL} on the owner's super class are rejected
 *       because only a subclass can issue those calls.
 * </ul>
 */
public final class ClassSplitterTransformer {

    public Map<String, ClassNode> transform(Map<String, ClassNode> classNodes, long seed) {
        Map<String, ClassNode> generated = new LinkedHashMap<>();
        List<SplitCandidate> candidates = findCandidates(classNodes);

        if (candidates.isEmpty()) {
            return generated;
        }

        Random random = new Random(seed ^ 0x5F1E4DA5F1C4A9B6L);
        int numClasses = Math.min(2 + random.nextInt(4), candidates.size());
        String[] classNames = new String[numClasses];
        for (int i = 0; i < numClasses; i++) {
            classNames[i] = "$fabricobf$" + Long.toUnsignedString(seed ^ (i * 0x9E3779B97F4A7C1FL), 36);
        }

        for (int i = 0; i < numClasses; i++) {
            ClassNode cn = new ClassNode();
            cn.version = Opcodes.V21;
            cn.access = Opcodes.ACC_PUBLIC | Opcodes.ACC_FINAL | Opcodes.ACC_SYNTHETIC;
            cn.name = classNames[i];
            cn.superName = "java/lang/Object";
            generated.put(classNames[i], cn);
        }

        for (int i = 0; i < candidates.size(); i++) {
            SplitCandidate c = candidates.get(i);
            int idx = i % numClasses;
            ClassNode target = generated.get(classNames[idx]);

            try {
                MethodNode copy = deepCopyMethod(c.method());
                copy.access = Opcodes.ACC_PUBLIC | Opcodes.ACC_STATIC | Opcodes.ACC_SYNTHETIC;
                copy.name = c.methodName();
                copy.signature = c.method().signature;
                target.methods.add(copy);

                replaceWithForward(c.method(), target.name, c.methodName());
            } catch (Exception ex) {
                // If we can't split this method, leave it in place — correctness over completeness.
            }
        }

        return generated;
    }

    /**
     * Deep-copies a method by serialising it through ASM's ClassWriter/ClassReader
     * round-trip, giving a fully independent copy of the instruction list.
     */
    private static MethodNode deepCopyMethod(MethodNode original) {
        ClassNode tempClass = new ClassNode();
        tempClass.version = Opcodes.V21;
        tempClass.access = Opcodes.ACC_PUBLIC | Opcodes.ACC_SYNTHETIC;
        tempClass.name = "$fabricobf$tmp";
        tempClass.superName = "java/lang/Object";

        // Shallow wrapper — instructions are NOT modified here; the round-trip below
        // produces a genuinely independent copy.
        MethodNode wrapper = new MethodNode(
                original.access,
                original.name,
                original.desc,
                original.signature,
                original.exceptions == null ? null
                        : original.exceptions.toArray(String[]::new)
        );
        wrapper.instructions = original.instructions;
        wrapper.tryCatchBlocks = original.tryCatchBlocks;
        wrapper.localVariables = original.localVariables;
        wrapper.visibleAnnotations = original.visibleAnnotations;
        wrapper.invisibleAnnotations = original.invisibleAnnotations;
        wrapper.maxStack = original.maxStack;
        wrapper.maxLocals = original.maxLocals;

        tempClass.methods.add(wrapper);

        // COMPUTE_MAXS avoids needing full type hierarchy resolution.
        ClassWriter cw = new ClassWriter(ClassWriter.COMPUTE_MAXS);
        tempClass.accept(cw);

        ClassNode resultNode = new ClassNode();
        new ClassReader(cw.toByteArray()).accept(resultNode, ClassReader.EXPAND_FRAMES);
        return resultNode.methods.get(0);
    }

    private static List<SplitCandidate> findCandidates(Map<String, ClassNode> classNodes) {
        List<SplitCandidate> result = new ArrayList<>();
        long counter = 0;
        for (Map.Entry<String, ClassNode> entry : classNodes.entrySet()) {
            String owner = entry.getKey();
            ClassNode cn = entry.getValue();
            for (MethodNode method : cn.methods) {
                if (eligible(method, cn, owner)) {
                    String methodName = "$m$" + Long.toUnsignedString(counter++, 36);
                    result.add(new SplitCandidate(owner, method, methodName));
                }
            }
        }
        return result;
    }

    private static boolean eligible(MethodNode method, ClassNode ownerClass, String ownerName) {
        // Only split private-static methods.
        if (method.name.startsWith("<")) {
            return false;
        }
        if ((method.access & (Opcodes.ACC_PRIVATE | Opcodes.ACC_STATIC))
                != (Opcodes.ACC_PRIVATE | Opcodes.ACC_STATIC)) {
            return false;
        }
        if ((method.access & (Opcodes.ACC_ABSTRACT | Opcodes.ACC_NATIVE | Opcodes.ACC_SYNTHETIC)) != 0) {
            return false;
        }
        if (method.instructions == null || method.instructions.size() == 0) {
            return false;
        }

        // Determine whether the owner is in a named package.
        // The generated helper class lives in the default package ("$fabricobf$xxx"),
        // so it cannot access package-private members of a class in a named package.
        boolean ownerInNamedPackage = ownerName.contains("/");

        for (AbstractInsnNode insn : method.instructions) {
            // Reject INVOKEDYNAMIC — lambda bootstrap handles may reference package-
            // or class-private synthetics that the helper class cannot reach.
            if (insn.getOpcode() == Opcodes.INVOKEDYNAMIC) {
                return false;
            }

            if (insn instanceof FieldInsnNode f && f.owner.equals(ownerName)) {
                if (isPrivateOrPackagePrivateField(ownerClass, f.name, f.desc, ownerInNamedPackage)) {
                    return false;
                }
            }

            if (insn instanceof MethodInsnNode m) {
                // Super-call via INVOKESPECIAL requires subclass context.
                if (m.getOpcode() == Opcodes.INVOKESPECIAL
                        && m.owner.equals(ownerClass.superName)) {
                    return false;
                }
                if (m.owner.equals(ownerName)
                        && isPrivateOrPackagePrivateMethod(ownerClass, m.name, m.desc, ownerInNamedPackage)) {
                    return false;
                }
            }
        }
        return true;
    }

    /**
     * Returns true if the field is private, or if it is package-private and the
     * generated class would be in a different package ({@code ownerInNamedPackage}).
     */
    private static boolean isPrivateOrPackagePrivateField(
            ClassNode cn, String name, String desc, boolean ownerInNamedPackage) {
        for (FieldNode f : cn.fields) {
            if (f.name.equals(name) && f.desc.equals(desc)) {
                if ((f.access & Opcodes.ACC_PRIVATE) != 0) return true;
                if (ownerInNamedPackage && isPackagePrivate(f.access)) return true;
                return false;
            }
        }
        return false;
    }

    private static boolean isPrivateOrPackagePrivateMethod(
            ClassNode cn, String name, String desc, boolean ownerInNamedPackage) {
        for (MethodNode m : cn.methods) {
            if (m.name.equals(name) && m.desc.equals(desc)) {
                if ((m.access & Opcodes.ACC_PRIVATE) != 0) return true;
                if (ownerInNamedPackage && isPackagePrivate(m.access)) return true;
                return false;
            }
        }
        return false;
    }

    private static boolean isPackagePrivate(int access) {
        return (access & (Opcodes.ACC_PUBLIC | Opcodes.ACC_PROTECTED | Opcodes.ACC_PRIVATE)) == 0;
    }

    private static void replaceWithForward(MethodNode method, String targetClass, String targetMethod) {
        InsnList forward = new InsnList();
        int loadIndex = 0;
        Type[] paramTypes = Type.getArgumentTypes(method.desc);
        for (Type t : paramTypes) {
            forward.add(new VarInsnNode(t.getOpcode(Opcodes.ILOAD), loadIndex));
            loadIndex += t.getSize();
        }

        forward.add(new MethodInsnNode(
                Opcodes.INVOKESTATIC,
                targetClass,
                targetMethod,
                method.desc,
                false
        ));

        String retDesc = method.desc.substring(method.desc.indexOf(')') + 1);
        forward.add(retInsn(retDesc));

        method.instructions.clear();
        method.tryCatchBlocks.clear();
        if (method.localVariables != null) {
            method.localVariables.clear();
        }
        method.instructions.add(forward);
        // Frame recomputation via COMPUTE_FRAMES will fix maxStack/maxLocals.
        method.maxStack = Math.max(loadIndex, 1);
    }

    private static AbstractInsnNode retInsn(String desc) {
        return switch (desc) {
            case "V" -> new InsnNode(Opcodes.RETURN);
            case "I", "Z", "B", "S", "C" -> new InsnNode(Opcodes.IRETURN);
            case "J" -> new InsnNode(Opcodes.LRETURN);
            case "F" -> new InsnNode(Opcodes.FRETURN);
            case "D" -> new InsnNode(Opcodes.DRETURN);
            default -> new InsnNode(Opcodes.ARETURN);
        };
    }

    private record SplitCandidate(String owner, MethodNode method, String methodName) {
    }
}
