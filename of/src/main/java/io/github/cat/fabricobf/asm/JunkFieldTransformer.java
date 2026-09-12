package io.github.cat.fabricobf.asm;

import io.github.cat.fabricobf.core.ClassData;
import java.util.ArrayList;
import java.util.List;
import java.util.Random;
import org.objectweb.asm.Opcodes;
import org.objectweb.asm.tree.AbstractInsnNode;
import org.objectweb.asm.tree.ClassNode;
import org.objectweb.asm.tree.FieldInsnNode;
import org.objectweb.asm.tree.FieldNode;
import org.objectweb.asm.tree.InsnList;
import org.objectweb.asm.tree.InsnNode;
import org.objectweb.asm.tree.LdcInsnNode;
import org.objectweb.asm.tree.MethodNode;

public final class JunkFieldTransformer {
    public List<String> transform(ClassData classData, long seed) {
        List<String> warnings = new ArrayList<>();
        ClassNode classNode = classData.classNode();

        // Skip interfaces, enums, annotations, and records — they are ineligible
        int access = classNode.access;
        if ((access & Opcodes.ACC_INTERFACE) != 0) return warnings;
        if ((access & Opcodes.ACC_ENUM) != 0) return warnings;
        if ((access & Opcodes.ACC_ANNOTATION) != 0) return warnings;
        if ((access & Opcodes.ACC_RECORD) != 0) return warnings;

        Random random = new Random(seed ^ classData.internalName().hashCode());

        // Add between 2 and 4 junk fields (inclusive), deterministically
        int fieldCount = 2 + random.nextInt(3);
        List<String> fieldNames = new ArrayList<>(fieldCount);

        for (int i = 0; i < fieldCount; i++) {
            // Build a hex-suffix name that is unique per class+seed combination
            String fieldName = "$jf$" + Long.toUnsignedString(random.nextLong() & 0xFFFFFFFFL, 16);
            FieldNode fieldNode = new FieldNode(
                    Opcodes.ACC_PRIVATE | Opcodes.ACC_STATIC | Opcodes.ACC_SYNTHETIC,
                    fieldName,
                    "J",
                    null,
                    null
            );
            classNode.fields.add(fieldNode);
            fieldNames.add(fieldName);
        }

        // Obtain (or create) the class initializer and inject assignments before its first RETURN
        MethodNode clinit = ensureClassInitializer(classNode);
        AbstractInsnNode insertionPoint = firstReturn(clinit);

        for (String fieldName : fieldNames) {
            long targetValue = random.nextLong();
            InsnList xorChain = buildXorChain(targetValue, random);
            xorChain.add(new FieldInsnNode(
                    Opcodes.PUTSTATIC,
                    classData.internalName(),
                    fieldName,
                    "J"
            ));
            clinit.instructions.insertBefore(insertionPoint, xorChain);
        }

        return warnings;
    }

    // ---------------------------------------------------------------------------
    // XOR-chain construction — the target value is computed at runtime, never
    // stored directly in the constant pool.
    // ---------------------------------------------------------------------------

    private static InsnList buildXorChain(long value, Random random) {
        int choice = random.nextInt(4);
        InsnList r = new InsnList();
        switch (choice) {
            case 0 -> {
                // value = a ^ b,  b = a ^ value
                long a = random.nextLong();
                long b = a ^ value;
                r.add(new LdcInsnNode(a));
                r.add(new LdcInsnNode(b));
                r.add(new InsnNode(Opcodes.LXOR));
            }
            case 1 -> {
                // value = (a ^ b) ^ c,  c = (a ^ b) ^ value
                long a = random.nextLong();
                long b = random.nextLong();
                long c = (a ^ b) ^ value;
                r.add(new LdcInsnNode(a));
                r.add(new LdcInsnNode(b));
                r.add(new InsnNode(Opcodes.LXOR));
                r.add(new LdcInsnNode(c));
                r.add(new InsnNode(Opcodes.LXOR));
            }
            case 2 -> {
                // value = a ^ b ^ c ^ d,  d = a ^ b ^ c ^ value
                long a = random.nextLong();
                long b = random.nextLong();
                long c = random.nextLong();
                long d = a ^ b ^ c ^ value;
                r.add(new LdcInsnNode(a));
                r.add(new LdcInsnNode(b));
                r.add(new InsnNode(Opcodes.LXOR));
                r.add(new LdcInsnNode(c));
                r.add(new InsnNode(Opcodes.LXOR));
                r.add(new LdcInsnNode(d));
                r.add(new InsnNode(Opcodes.LXOR));
            }
            default -> {
                // value = (a ^ b) ^ (c ^ d),  d = c ^ (a ^ b) ^ value
                long a = random.nextLong();
                long b = random.nextLong();
                long c = random.nextLong();
                long d = c ^ (a ^ b) ^ value;
                r.add(new LdcInsnNode(a));
                r.add(new LdcInsnNode(b));
                r.add(new InsnNode(Opcodes.LXOR));
                r.add(new LdcInsnNode(c));
                r.add(new LdcInsnNode(d));
                r.add(new InsnNode(Opcodes.LXOR));
                r.add(new InsnNode(Opcodes.LXOR));
            }
        }
        return r;
    }

    // ---------------------------------------------------------------------------
    // Helpers
    // ---------------------------------------------------------------------------

    /** Returns the existing {@code <clinit>}, or creates a minimal one and adds it to the class. */
    private static MethodNode ensureClassInitializer(ClassNode classNode) {
        for (MethodNode methodNode : classNode.methods) {
            if ("<clinit>".equals(methodNode.name) && "()V".equals(methodNode.desc)) {
                return methodNode;
            }
        }
        MethodNode clinit = new MethodNode(Opcodes.ACC_STATIC, "<clinit>", "()V", null, null);
        clinit.instructions.add(new InsnNode(Opcodes.RETURN));
        classNode.methods.add(clinit);
        return clinit;
    }

    /** Returns the first {@code RETURN} instruction in {@code clinit}, creating one if absent. */
    private static AbstractInsnNode firstReturn(MethodNode clinit) {
        for (AbstractInsnNode insn = clinit.instructions.getFirst(); insn != null; insn = insn.getNext()) {
            if (insn.getOpcode() == Opcodes.RETURN) {
                return insn;
            }
        }
        // Defensive fallback: should not normally be reached after ensureClassInitializer
        clinit.instructions.add(new InsnNode(Opcodes.RETURN));
        return clinit.instructions.getLast();
    }
}
