package io.github.cat.fabricobf.asm;

import io.github.cat.fabricobf.core.ClassData;
import java.util.ArrayList;
import java.util.List;
import java.util.Random;
import org.objectweb.asm.Opcodes;
import org.objectweb.asm.tree.AbstractInsnNode;
import org.objectweb.asm.tree.InsnList;
import org.objectweb.asm.tree.InsnNode;
import org.objectweb.asm.tree.IntInsnNode;
import org.objectweb.asm.tree.LdcInsnNode;
import org.objectweb.asm.tree.MethodInsnNode;
import org.objectweb.asm.tree.MethodNode;

public final class NumberObfuscationTransformer {
    public List<String> transform(ClassData classData, long seed) {
        List<String> warnings = new ArrayList<>();
        Random random = new Random(seed ^ classData.internalName().hashCode());
        for (MethodNode methodNode : classData.classNode().methods) {
            if (!eligible(methodNode)) {
                continue;
            }
            for (AbstractInsnNode insn = methodNode.instructions.getFirst(); insn != null; ) {
                AbstractInsnNode next = insn.getNext();
                InsnList replacement = replacementFor(insn, random);
                if (replacement != null) {
                    methodNode.instructions.insertBefore(insn, replacement);
                    methodNode.instructions.remove(insn);
                }
                insn = next;
            }
        }
        return warnings;
    }

    private static InsnList replacementFor(AbstractInsnNode insn, Random random) {
        Integer intConstant = readIntConstant(insn);
        if (intConstant != null) {
            return intReplacement(intConstant, random);
        }

        Long longConstant = readLongConstant(insn);
        if (longConstant != null) {
            return longReplacement(longConstant, random);
        }

        Float floatConstant = readFloatConstant(insn);
        if (floatConstant != null) {
            int bits = Float.floatToRawIntBits(floatConstant);
            InsnList inner = intReplacement(bits, random);
            inner.add(new MethodInsnNode(
                    Opcodes.INVOKESTATIC,
                    "java/lang/Float",
                    "intBitsToFloat",
                    "(I)F",
                    false
            ));
            return inner;
        }

        Double doubleConstant = readDoubleConstant(insn);
        if (doubleConstant != null) {
            long bits = Double.doubleToRawLongBits(doubleConstant);
            InsnList inner = longReplacement(bits, random);
            inner.add(new MethodInsnNode(
                    Opcodes.INVOKESTATIC,
                    "java/lang/Double",
                    "longBitsToDouble",
                    "(J)D",
                    false
            ));
            return inner;
        }

        return null;
    }

    private static InsnList intReplacement(int value, Random random) {
        int choice = random.nextInt(8);
        InsnList r = new InsnList();
        switch (choice) {
            case 0 -> {
                int left = random.nextInt();
                int right = left ^ value;
                r.add(pushInt(left));
                r.add(pushInt(right));
                r.add(new InsnNode(Opcodes.IXOR));
            }
            case 1 -> {
                int left = random.nextInt();
                int mid = random.nextInt();
                int right = (value ^ mid) - left;
                r.add(pushInt(left));
                r.add(pushInt(right));
                r.add(new InsnNode(Opcodes.IADD));
                r.add(pushInt(mid));
                r.add(new InsnNode(Opcodes.IXOR));
            }
            case 2 -> {
                int left = random.nextInt();
                int mid = random.nextInt();
                int right = left ^ (value + mid);
                r.add(pushInt(left));
                r.add(pushInt(right));
                r.add(new InsnNode(Opcodes.IXOR));
                r.add(pushInt(mid));
                r.add(new InsnNode(Opcodes.ISUB));
            }
            case 3 -> {
                int left = random.nextInt();
                int mid = random.nextInt();
                int right = left ^ (value - mid);
                r.add(pushInt(left));
                r.add(pushInt(right));
                r.add(new InsnNode(Opcodes.IXOR));
                r.add(pushInt(mid));
                r.add(new InsnNode(Opcodes.IADD));
            }
            case 4 -> {
                int a = random.nextInt();
                int b = random.nextInt();
                int c = random.nextInt();
                int d = a ^ b ^ c ^ value;
                r.add(pushInt(a));
                r.add(pushInt(b));
                r.add(new InsnNode(Opcodes.IXOR));
                r.add(pushInt(c));
                r.add(new InsnNode(Opcodes.IXOR));
                r.add(pushInt(d));
                r.add(new InsnNode(Opcodes.IXOR));
            }
            case 5 -> {
                int a = random.nextInt();
                int b = random.nextInt();
                int c = (value ^ a) - b;
                r.add(pushInt(c));
                r.add(pushInt(b));
                r.add(new InsnNode(Opcodes.IADD));
                r.add(pushInt(a));
                r.add(new InsnNode(Opcodes.IXOR));
            }
            case 6 -> {
                int a = random.nextInt();
                int b = random.nextInt();
                int c = a ^ value;
                int d = b + c;
                r.add(pushInt(d));
                r.add(pushInt(b));
                r.add(new InsnNode(Opcodes.ISUB));
                r.add(pushInt(a));
                r.add(new InsnNode(Opcodes.IXOR));
            }
            default -> {
                int a = random.nextInt();
                int b = random.nextInt();
                int c = a ^ (value - b);
                r.add(pushInt(c));
                r.add(pushInt(a));
                r.add(new InsnNode(Opcodes.IXOR));
                r.add(pushInt(b));
                r.add(new InsnNode(Opcodes.IADD));
            }
        }
        return r;
    }

    private static InsnList longReplacement(long value, Random random) {
        int choice = random.nextInt(8);
        InsnList r = new InsnList();
        switch (choice) {
            case 0 -> {
                long left = random.nextLong();
                long right = left ^ value;
                r.add(new LdcInsnNode(left));
                r.add(new LdcInsnNode(right));
                r.add(new InsnNode(Opcodes.LXOR));
            }
            case 1 -> {
                long left = random.nextLong();
                long mid = random.nextLong();
                long right = (value ^ mid) - left;
                r.add(new LdcInsnNode(left));
                r.add(new LdcInsnNode(right));
                r.add(new InsnNode(Opcodes.LADD));
                r.add(new LdcInsnNode(mid));
                r.add(new InsnNode(Opcodes.LXOR));
            }
            case 2 -> {
                long left = random.nextLong();
                long mid = random.nextLong();
                long right = left ^ (value + mid);
                r.add(new LdcInsnNode(left));
                r.add(new LdcInsnNode(right));
                r.add(new InsnNode(Opcodes.LXOR));
                r.add(new LdcInsnNode(mid));
                r.add(new InsnNode(Opcodes.LSUB));
            }
            case 3 -> {
                long left = random.nextLong();
                long mid = random.nextLong();
                long right = left ^ (value - mid);
                r.add(new LdcInsnNode(left));
                r.add(new LdcInsnNode(right));
                r.add(new InsnNode(Opcodes.LXOR));
                r.add(new LdcInsnNode(mid));
                r.add(new InsnNode(Opcodes.LADD));
            }
            case 4 -> {
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
            case 5 -> {
                long a = random.nextLong();
                long b = random.nextLong();
                long c = (value ^ a) - b;
                r.add(new LdcInsnNode(c));
                r.add(new LdcInsnNode(b));
                r.add(new InsnNode(Opcodes.LADD));
                r.add(new LdcInsnNode(a));
                r.add(new InsnNode(Opcodes.LXOR));
            }
            case 6 -> {
                long a = random.nextLong();
                long b = random.nextLong();
                long c = a ^ value;
                long d = b + c;
                r.add(new LdcInsnNode(d));
                r.add(new LdcInsnNode(b));
                r.add(new InsnNode(Opcodes.LSUB));
                r.add(new LdcInsnNode(a));
                r.add(new InsnNode(Opcodes.LXOR));
            }
            default -> {
                long a = random.nextLong();
                long b = random.nextLong();
                long c = a ^ (value - b);
                r.add(new LdcInsnNode(c));
                r.add(new LdcInsnNode(a));
                r.add(new InsnNode(Opcodes.LXOR));
                r.add(new LdcInsnNode(b));
                r.add(new InsnNode(Opcodes.LADD));
            }
        }
        return r;
    }

    private static boolean eligible(MethodNode methodNode) {
        return (methodNode.access & (Opcodes.ACC_ABSTRACT | Opcodes.ACC_NATIVE)) == 0;
    }

    private static Integer readIntConstant(AbstractInsnNode insn) {
        return switch (insn.getOpcode()) {
            case Opcodes.ICONST_M1 -> -1;
            case Opcodes.ICONST_0 -> 0;
            case Opcodes.ICONST_1 -> 1;
            case Opcodes.ICONST_2 -> 2;
            case Opcodes.ICONST_3 -> 3;
            case Opcodes.ICONST_4 -> 4;
            case Opcodes.ICONST_5 -> 5;
            case Opcodes.BIPUSH, Opcodes.SIPUSH -> ((IntInsnNode) insn).operand;
            case Opcodes.LDC -> {
                Object cst = ((LdcInsnNode) insn).cst;
                if (cst instanceof Integer value) {
                    yield value;
                }
                yield null;
            }
            default -> null;
        };
    }

    private static Long readLongConstant(AbstractInsnNode insn) {
        return switch (insn.getOpcode()) {
            case Opcodes.LCONST_0 -> 0L;
            case Opcodes.LCONST_1 -> 1L;
            case Opcodes.LDC -> {
                Object cst = ((LdcInsnNode) insn).cst;
                if (cst instanceof Long value) {
                    yield value;
                }
                yield null;
            }
            default -> null;
        };
    }

    private static Float readFloatConstant(AbstractInsnNode insn) {
        return switch (insn.getOpcode()) {
            case Opcodes.FCONST_0 -> 0.0F;
            case Opcodes.FCONST_1 -> 1.0F;
            case Opcodes.FCONST_2 -> 2.0F;
            case Opcodes.LDC -> {
                Object cst = ((LdcInsnNode) insn).cst;
                if (cst instanceof Float value) {
                    yield value;
                }
                yield null;
            }
            default -> null;
        };
    }

    private static Double readDoubleConstant(AbstractInsnNode insn) {
        return switch (insn.getOpcode()) {
            case Opcodes.DCONST_0 -> 0.0D;
            case Opcodes.DCONST_1 -> 1.0D;
            case Opcodes.LDC -> {
                Object cst = ((LdcInsnNode) insn).cst;
                if (cst instanceof Double value) {
                    yield value;
                }
                yield null;
            }
            default -> null;
        };
    }

    private static AbstractInsnNode pushInt(int value) {
        return switch (value) {
            case -1 -> new InsnNode(Opcodes.ICONST_M1);
            case 0 -> new InsnNode(Opcodes.ICONST_0);
            case 1 -> new InsnNode(Opcodes.ICONST_1);
            case 2 -> new InsnNode(Opcodes.ICONST_2);
            case 3 -> new InsnNode(Opcodes.ICONST_3);
            case 4 -> new InsnNode(Opcodes.ICONST_4);
            case 5 -> new InsnNode(Opcodes.ICONST_5);
            default -> {
                if (value >= Byte.MIN_VALUE && value <= Byte.MAX_VALUE) {
                    yield new IntInsnNode(Opcodes.BIPUSH, value);
                }
                if (value >= Short.MIN_VALUE && value <= Short.MAX_VALUE) {
                    yield new IntInsnNode(Opcodes.SIPUSH, value);
                }
                yield new LdcInsnNode(value);
            }
        };
    }
}
