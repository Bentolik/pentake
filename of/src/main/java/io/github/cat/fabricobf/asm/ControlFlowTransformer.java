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
import org.objectweb.asm.tree.JumpInsnNode;
import org.objectweb.asm.tree.LabelNode;
import org.objectweb.asm.tree.LdcInsnNode;
import org.objectweb.asm.tree.MethodInsnNode;
import org.objectweb.asm.tree.MethodNode;
import org.objectweb.asm.tree.TypeInsnNode;
import org.objectweb.asm.tree.VarInsnNode;

public final class ControlFlowTransformer {
    public List<String> transform(ClassData classData, long seed) {
        return transform(classData, seed, false);
    }

    public List<String> transform(ClassData classData, long seed, boolean insane) {
        List<String> warnings = new ArrayList<>();
        long classSeed = seed ^ classData.internalName().hashCode();
        Random classRand = new Random(classSeed);
        for (MethodNode methodNode : classData.classNode().methods) {
            if (!eligible(methodNode)) {
                continue;
            }

            AbstractInsnNode firstInsn = methodNode.instructions.getFirst();
            if (firstInsn == null) {
                continue;
            }

            LabelNode deadBlock = new LabelNode();
            LabelNode resume = new LabelNode();
            String marker = "$cf$" + Long.toUnsignedString(seed, 16);
            long methodSeed = classSeed ^ methodNode.name.hashCode() ^ methodNode.desc.hashCode();
            Random methodRand = new Random(methodSeed);

            InsnList prefix = new InsnList();
            appendOpaquePredicate(prefix, deadBlock, methodRand);
            prefix.add(new JumpInsnNode(Opcodes.GOTO, resume));
            prefix.add(deadBlock);
            appendThrowBlock(prefix, marker, methodRand);
            prefix.add(resume);

            methodNode.instructions.insertBefore(firstInsn, prefix);
            if (insane) {
                addExtraOpaqueBlocks(methodNode, seed, classRand);
            }
        }
        return warnings;
    }

    private static void addExtraOpaqueBlocks(MethodNode methodNode, long seed, Random classRand) {
        long methodSeed = seed ^ methodNode.name.hashCode() ^ methodNode.desc.hashCode();
        Random methodRand = new Random(methodSeed);

        for (AbstractInsnNode insn = methodNode.instructions.getFirst(); insn != null; ) {
            AbstractInsnNode next = insn.getNext();
            int opcode = insn.getOpcode();
            if (opcode == Opcodes.RETURN) {
                methodNode.instructions.insertBefore(insn, runtimeOpaqueBlock(methodRand, seed));
            } else if (opcode == Opcodes.IRETURN || opcode == Opcodes.FRETURN || opcode == Opcodes.ARETURN) {
                int tempVar = methodNode.maxLocals;
                methodNode.maxLocals += 1;
                InsnList block = new InsnList();
                int storeOp = (opcode == Opcodes.IRETURN) ? Opcodes.ISTORE : (opcode == Opcodes.FRETURN ? Opcodes.FSTORE : Opcodes.ASTORE);
                int loadOp = (opcode == Opcodes.IRETURN) ? Opcodes.ILOAD : (opcode == Opcodes.FRETURN ? Opcodes.FLOAD : Opcodes.ALOAD);
                block.add(new VarInsnNode(storeOp, tempVar));
                block.add(runtimeOpaqueBlock(methodRand, seed));
                block.add(new VarInsnNode(loadOp, tempVar));
                methodNode.instructions.insertBefore(insn, block);
            } else if (opcode == Opcodes.LRETURN || opcode == Opcodes.DRETURN) {
                int tempVar = methodNode.maxLocals;
                methodNode.maxLocals += 2;
                InsnList block = new InsnList();
                int storeOp = (opcode == Opcodes.LRETURN) ? Opcodes.LSTORE : Opcodes.DSTORE;
                int loadOp = (opcode == Opcodes.LRETURN) ? Opcodes.LLOAD : Opcodes.DLOAD;
                block.add(new VarInsnNode(storeOp, tempVar));
                block.add(runtimeOpaqueBlock(methodRand, seed));
                block.add(new VarInsnNode(loadOp, tempVar));
                methodNode.instructions.insertBefore(insn, block);
            }
            insn = next;
        }
    }

    private static InsnList runtimeOpaqueBlock(Random random, long seed) {
        LabelNode deadBlock = new LabelNode();
        LabelNode resume = new LabelNode();
        InsnList block = new InsnList();
        appendOpaquePredicate(block, deadBlock, random);
        block.add(new JumpInsnNode(Opcodes.GOTO, resume));
        block.add(deadBlock);
        appendThrowBlock(block, "$cf$ret$" + Long.toUnsignedString(seed, 16), random);
        block.add(resume);
        return block;
    }

    private static void appendOpaquePredicate(InsnList insns, LabelNode deadBlock, Random random) {
        int choice = random.nextInt(9);
        switch (choice) {
            case 0 -> {
                insns.add(new LdcInsnNode("0"));
                insns.add(new MethodInsnNode(Opcodes.INVOKESTATIC, "java/lang/Integer", "parseInt", "(Ljava/lang/String;)I", false));
                insns.add(new JumpInsnNode(Opcodes.IFNE, deadBlock));
            }
            case 1 -> {
                insns.add(new LdcInsnNode("0.0"));
                insns.add(new MethodInsnNode(Opcodes.INVOKESTATIC, "java/lang/Double", "parseDouble", "(Ljava/lang/String;)D", false));
                insns.add(new InsnNode(Opcodes.DCONST_0));
                insns.add(new InsnNode(Opcodes.DCMPG));
                insns.add(new JumpInsnNode(Opcodes.IFNE, deadBlock));
            }
            case 2 -> {
                insns.add(new InsnNode(Opcodes.ICONST_0));
                insns.add(new MethodInsnNode(Opcodes.INVOKESTATIC, "java/lang/Math", "abs", "(I)I", false));
                insns.add(new JumpInsnNode(Opcodes.IFNE, deadBlock));
            }
            case 3 -> {
                insns.add(new InsnNode(Opcodes.ICONST_5));
                insns.add(new IntInsnNode(Opcodes.BIPUSH, 10));
                insns.add(new MethodInsnNode(Opcodes.INVOKESTATIC, "java/lang/Math", "min", "(II)I", false));
                insns.add(new IntInsnNode(Opcodes.BIPUSH, 10));
                insns.add(new JumpInsnNode(Opcodes.IF_ICMPEQ, deadBlock));
            }
            case 4 -> {
                insns.add(new LdcInsnNode("abc"));
                insns.add(new LdcInsnNode("z"));
                insns.add(new MethodInsnNode(Opcodes.INVOKEVIRTUAL, "java/lang/String", "indexOf", "(Ljava/lang/String;)I", false));
                insns.add(new InsnNode(Opcodes.ICONST_M1));
                insns.add(new JumpInsnNode(Opcodes.IF_ICMPNE, deadBlock));
            }
            case 5 -> {
                insns.add(new LdcInsnNode("abc"));
                insns.add(new LdcInsnNode("z"));
                insns.add(new MethodInsnNode(Opcodes.INVOKEVIRTUAL, "java/lang/String", "contains", "(Ljava/lang/CharSequence;)Z", false));
                insns.add(new JumpInsnNode(Opcodes.IFNE, deadBlock));
            }
            case 6 -> {
                insns.add(new LdcInsnNode("os.name.invalid.xyz"));
                insns.add(new MethodInsnNode(Opcodes.INVOKESTATIC, "java/lang/System", "getProperty", "(Ljava/lang/String;)Ljava/lang/String;", false));
                insns.add(new JumpInsnNode(Opcodes.IFNONNULL, deadBlock));
            }
            case 7 -> {
                insns.add(new InsnNode(Opcodes.DCONST_0));
                insns.add(new MethodInsnNode(Opcodes.INVOKESTATIC, "java/lang/Double", "isNaN", "(D)Z", false));
                insns.add(new JumpInsnNode(Opcodes.IFNE, deadBlock));
            }
            default -> {
                insns.add(new LdcInsnNode(""));
                insns.add(new MethodInsnNode(Opcodes.INVOKEVIRTUAL, "java/lang/String", "length", "()I", false));
                insns.add(new JumpInsnNode(Opcodes.IFNE, deadBlock));
            }
        }
    }

    private static void appendThrowBlock(InsnList insns, String marker, Random random) {
        int choice = random.nextInt(6);
        String exceptionType = switch (choice) {
            case 0 -> "java/lang/NullPointerException";
            case 1 -> "java/lang/IllegalArgumentException";
            case 2 -> "java/lang/IndexOutOfBoundsException";
            case 3 -> "java/lang/ArithmeticException";
            case 4 -> "java/lang/ClassCastException";
            default -> "java/lang/IllegalStateException";
        };
        insns.add(new TypeInsnNode(Opcodes.NEW, exceptionType));
        insns.add(new InsnNode(Opcodes.DUP));

        boolean withMessage = random.nextBoolean();
        if (withMessage) {
            insns.add(new LdcInsnNode(marker));
            insns.add(new MethodInsnNode(
                    Opcodes.INVOKESPECIAL,
                    exceptionType,
                    "<init>",
                    "(Ljava/lang/String;)V",
                    false
            ));
        } else {
            insns.add(new MethodInsnNode(
                    Opcodes.INVOKESPECIAL,
                    exceptionType,
                    "<init>",
                    "()V",
                    false
            ));
        }
        insns.add(new InsnNode(Opcodes.ATHROW));
    }

    private static boolean eligible(MethodNode methodNode) {
        if ((methodNode.access & (Opcodes.ACC_ABSTRACT | Opcodes.ACC_NATIVE)) != 0) {
            return false;
        }
        return !"<init>".equals(methodNode.name) && !"<clinit>".equals(methodNode.name);
    }
}
