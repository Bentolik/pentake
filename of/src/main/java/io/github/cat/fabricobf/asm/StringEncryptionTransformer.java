package io.github.cat.fabricobf.asm;

import io.github.cat.fabricobf.core.ClassData;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;
import java.util.Random;
import org.objectweb.asm.Handle;
import org.objectweb.asm.Opcodes;
import org.objectweb.asm.Type;
import org.objectweb.asm.tree.AbstractInsnNode;
import org.objectweb.asm.tree.ClassNode;
import org.objectweb.asm.tree.FieldInsnNode;
import org.objectweb.asm.tree.FieldNode;
import org.objectweb.asm.tree.InsnList;
import org.objectweb.asm.tree.InsnNode;
import org.objectweb.asm.tree.IincInsnNode;
import org.objectweb.asm.tree.IntInsnNode;
import org.objectweb.asm.tree.InvokeDynamicInsnNode;
import org.objectweb.asm.tree.JumpInsnNode;
import org.objectweb.asm.tree.LabelNode;
import org.objectweb.asm.tree.LdcInsnNode;
import org.objectweb.asm.tree.MethodInsnNode;
import org.objectweb.asm.tree.MethodNode;
import org.objectweb.asm.tree.TypeInsnNode;
import org.objectweb.asm.tree.VarInsnNode;

public final class StringEncryptionTransformer {
    public List<String> transform(ClassData classData, long seed) {
        return transform(classData, seed, false, false);
    }

    public List<String> transform(ClassData classData, long seed, boolean aggressive) {
        return transform(classData, seed, aggressive, false);
    }

    public List<String> transform(ClassData classData, long seed, boolean aggressive, boolean maxMode) {
        List<String> warnings = new ArrayList<>();
        ClassNode classNode = classData.classNode();
        boolean ownerIsInterface = (classNode.access & Opcodes.ACC_INTERFACE) != 0;
        String decodeMethodName = "$fabricobf$dec$" + Long.toUnsignedString(seed & 0xFFFF, 16);
        boolean touched = false;

        long classSeed = seed ^ classData.internalName().hashCode() ^ 0xA7B3C9D1L;
        Random classRand = new Random(classSeed);
        boolean loopForward = maxMode ? classRand.nextBoolean() : true;
        int predicateChoice = maxMode ? classRand.nextInt(9) : 0;

        for (MethodNode methodNode : classNode.methods) {
            if (!eligible(methodNode, aggressive)) {
                continue;
            }
            if (containsInvokeDynamic(methodNode) && !aggressive) {
                warnings.add("[STRING_SKIP_INDY] " + classData.internalName() + "#" + methodNode.name + methodNode.desc);
                continue;
            }
            boolean methodTouched = false;
            int literalIndex = 0;
            for (AbstractInsnNode insn = methodNode.instructions.getFirst(); insn != null; ) {
                AbstractInsnNode next = insn.getNext();
                if (maxMode && insn instanceof InvokeDynamicInsnNode indy && isStringConcat(indy)) {
                    InsnList replacement = rewriteStringConcat(
                            classData.internalName(),
                            methodNode,
                            decodeMethodName,
                            indy,
                            seed,
                            ownerIsInterface
                    );
                    if (replacement != null) {
                        methodNode.instructions.insertBefore(indy, replacement);
                        methodNode.instructions.remove(indy);
                        methodTouched = true;
                    }
                } else if (insn instanceof LdcInsnNode ldcInsnNode && ldcInsnNode.cst instanceof String str && (maxMode || !str.isEmpty())) {
                    int key = keyFor(classData.internalName(), methodNode.name, methodNode.desc, literalIndex++, seed);
                    String encoded = maxMode ? encodeMax(str, key) : encodeBasic(str);
                    InsnList replacement = new InsnList();
                    replacement.add(new LdcInsnNode(encoded));
                    replacement.add(new MethodInsnNode(
                            Opcodes.INVOKESTATIC,
                            classData.internalName(),
                            decodeMethodName,
                            "(Ljava/lang/String;)Ljava/lang/String;",
                            ownerIsInterface
                    ));
                    methodNode.instructions.insert(insn, replacement);
                    methodNode.instructions.remove(insn);
                    methodTouched = true;
                }
                insn = next;
            }
            touched = touched || methodTouched;
        }

        if (maxMode) {
            touched = liftStaticFinalStringConstants(
                    classData.internalName(),
                    classNode,
                    decodeMethodName,
                    seed,
                    ownerIsInterface
            ) || touched;
        }

        if (touched) {
            if (maxMode) {
                injectDecodeMethodMax(classNode, decodeMethodName, loopForward, predicateChoice);
            } else {
                injectDecodeMethodBasic(classNode, decodeMethodName);
            }
        }
        return warnings;
    }

    private static boolean isStringConcat(InvokeDynamicInsnNode indy) {
        if (!indy.desc.endsWith(")Ljava/lang/String;") || !(indy.bsm instanceof Handle handle)) {
            return false;
        }
        return "java/lang/invoke/StringConcatFactory".equals(handle.getOwner())
                && "makeConcatWithConstants".equals(handle.getName())
                && indy.bsmArgs.length > 0
                && indy.bsmArgs[0] instanceof String;
    }

    private static InsnList rewriteStringConcat(
            String owner,
            MethodNode methodNode,
            String decodeMethodName,
            InvokeDynamicInsnNode indy,
            long seed,
            boolean ownerIsInterface
    ) {
        Type[] argTypes = Type.getArgumentTypes(indy.desc);
        if (argTypes.length == 0) {
            return null;
        }

        int[] locals = new int[argTypes.length];
        int nextLocal = methodNode.maxLocals;
        InsnList replacement = new InsnList();
        for (int i = argTypes.length - 1; i >= 0; i--) {
            Type type = argTypes[i];
            nextLocal += type.getSize();
            locals[i] = nextLocal - type.getSize();
            replacement.add(new VarInsnNode(type.getOpcode(Opcodes.ISTORE), locals[i]));
        }
        methodNode.maxLocals = Math.max(methodNode.maxLocals, nextLocal);

        replacement.add(new TypeInsnNode(Opcodes.NEW, "java/lang/StringBuilder"));
        replacement.add(new InsnNode(Opcodes.DUP));
        replacement.add(new MethodInsnNode(Opcodes.INVOKESPECIAL, "java/lang/StringBuilder", "<init>", "()V", false));

        String recipe = (String) indy.bsmArgs[0];
        int argIndex = 0;
        int constIndex = 1;
        StringBuilder literal = new StringBuilder();
        for (int i = 0; i < recipe.length(); i++) {
            char ch = recipe.charAt(i);
            if (ch == '\u0001') {
                appendLiteral(replacement, owner, decodeMethodName, literal.toString(), seed, i, ownerIsInterface);
                literal.setLength(0);
                if (argIndex >= argTypes.length) {
                    return null;
                }
                Type type = argTypes[argIndex];
                replacement.add(new VarInsnNode(type.getOpcode(Opcodes.ILOAD), locals[argIndex]));
                appendValue(replacement, type);
                argIndex++;
            } else if (ch == '\u0002') {
                appendLiteral(replacement, owner, decodeMethodName, literal.toString(), seed, i, ownerIsInterface);
                literal.setLength(0);
                if (constIndex >= indy.bsmArgs.length) {
                    return null;
                }
                appendLiteral(replacement, owner, decodeMethodName, String.valueOf(indy.bsmArgs[constIndex++]), seed, i, ownerIsInterface);
            } else {
                literal.append(ch);
            }
        }
        appendLiteral(replacement, owner, decodeMethodName, literal.toString(), seed, recipe.length(), ownerIsInterface);
        replacement.add(new MethodInsnNode(Opcodes.INVOKEVIRTUAL, "java/lang/StringBuilder", "toString", "()Ljava/lang/String;", false));
        return replacement;
    }

    private static void appendLiteral(
            InsnList insns,
            String owner,
            String decodeMethodName,
            String value,
            long seed,
            int ordinal,
            boolean ownerIsInterface
    ) {
        if (value.isEmpty()) {
            return;
        }
        int key = keyFor(owner, "$concat$", value, ordinal, seed);
        insns.add(new LdcInsnNode(encodeMax(value, key)));
        insns.add(new MethodInsnNode(
                Opcodes.INVOKESTATIC,
                owner,
                decodeMethodName,
                "(Ljava/lang/String;)Ljava/lang/String;",
                ownerIsInterface
        ));
        appendValue(insns, Type.getType(String.class));
    }

    private static void appendValue(InsnList insns, Type type) {
        String descriptor = switch (type.getSort()) {
            case Type.BOOLEAN -> "(Z)Ljava/lang/StringBuilder;";
            case Type.CHAR -> "(C)Ljava/lang/StringBuilder;";
            case Type.BYTE, Type.SHORT, Type.INT -> "(I)Ljava/lang/StringBuilder;";
            case Type.FLOAT -> "(F)Ljava/lang/StringBuilder;";
            case Type.LONG -> "(J)Ljava/lang/StringBuilder;";
            case Type.DOUBLE -> "(D)Ljava/lang/StringBuilder;";
            default -> "(Ljava/lang/Object;)Ljava/lang/StringBuilder;";
        };
        insns.add(new MethodInsnNode(
                Opcodes.INVOKEVIRTUAL,
                "java/lang/StringBuilder",
                "append",
                descriptor,
                false
        ));
    }

    private static boolean liftStaticFinalStringConstants(
            String owner,
            ClassNode classNode,
            String decodeMethodName,
            long seed,
            boolean ownerIsInterface
    ) {
        List<FieldPayload> payloads = new ArrayList<>();
        int fieldIndex = 0;
        for (FieldNode fieldNode : classNode.fields) {
            if ((fieldNode.access & Opcodes.ACC_STATIC) == 0 || (fieldNode.access & Opcodes.ACC_FINAL) == 0) {
                continue;
            }
            if (!"Ljava/lang/String;".equals(fieldNode.desc)) {
                continue;
            }
            if (!(fieldNode.value instanceof String value)) {
                continue;
            }
            int key = keyFor(owner, fieldNode.name, fieldNode.desc, fieldIndex++, seed);
            payloads.add(new FieldPayload(fieldNode.name, encodeMax(value, key)));
            fieldNode.value = null;
        }

        if (payloads.isEmpty()) {
            return false;
        }

        MethodNode clinit = ensureClassInitializer(classNode);
        List<AbstractInsnNode> returns = new ArrayList<>();
        for (AbstractInsnNode insn = clinit.instructions.getFirst(); insn != null; insn = insn.getNext()) {
            if (insn.getOpcode() == Opcodes.RETURN) {
                returns.add(insn);
            }
        }

        if (returns.isEmpty()) {
            clinit.instructions.add(new InsnNode(Opcodes.RETURN));
            returns.add(clinit.instructions.getLast());
        }

        for (AbstractInsnNode ret : returns) {
            InsnList assign = new InsnList();
            for (FieldPayload payload : payloads) {
                assign.add(new LdcInsnNode(payload.encoded()));
                assign.add(new MethodInsnNode(
                        Opcodes.INVOKESTATIC,
                        owner,
                        decodeMethodName,
                        "(Ljava/lang/String;)Ljava/lang/String;",
                        ownerIsInterface
                ));
                assign.add(new FieldInsnNode(
                        Opcodes.PUTSTATIC,
                        owner,
                        payload.name(),
                        "Ljava/lang/String;"
                ));
            }
            clinit.instructions.insertBefore(ret, assign);
        }

        return true;
    }

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

    private static int keyFor(String owner, String name, String desc, int ordinal, long seed) {
        long mix = seed;
        mix = mix * 31 + owner.hashCode();
        mix = mix * 31 + name.hashCode();
        mix = mix * 31 + desc.hashCode();
        mix = mix * 31 + ordinal;
        int h = (int) mix;
        h = (h ^ (h >>> 16)) * 0x85ebca6b;
        h = (h ^ (h >>> 13)) * 0xc2b2ae35;
        h = h ^ (h >>> 16);
        return h;
    }

    private static String encodeBasic(String str) {
        return Base64.getEncoder().encodeToString(str.getBytes(StandardCharsets.UTF_8));
    }

    private static String encodeMax(String str, int key) {
        byte[] strBytes = str.getBytes(StandardCharsets.UTF_8);
        byte[] combined = new byte[strBytes.length + 4];
        combined[0] = (byte) (key >> 24);
        combined[1] = (byte) (key >> 16);
        combined[2] = (byte) (key >> 8);
        combined[3] = (byte) key;
        for (int i = 0; i < strBytes.length; i++) {
            byte b = strBytes[i];
            b ^= (key + i);
            b ^= (key >>> 8) - i;
            combined[4 + i] = b;
        }
        return new StringBuilder(Base64.getEncoder().encodeToString(combined)).reverse().toString();
    }

    private static boolean eligible(MethodNode methodNode, boolean aggressive) {
        if (!aggressive && (methodNode.access & Opcodes.ACC_PRIVATE) == 0) {
            return false;
        }
        int excluded = Opcodes.ACC_ABSTRACT | Opcodes.ACC_NATIVE | Opcodes.ACC_BRIDGE;
        if (!aggressive) {
            excluded |= Opcodes.ACC_SYNTHETIC;
        }
        return (methodNode.access & excluded) == 0;
    }

    private static boolean containsInvokeDynamic(MethodNode methodNode) {
        for (AbstractInsnNode insn = methodNode.instructions.getFirst(); insn != null; insn = insn.getNext()) {
            if (insn instanceof InvokeDynamicInsnNode) {
                return true;
            }
        }
        return false;
    }

    private static void injectDecodeMethodBasic(ClassNode classNode, String methodName) {
        for (MethodNode existing : classNode.methods) {
            if (existing.name.equals(methodName) && existing.desc.equals("(Ljava/lang/String;)Ljava/lang/String;")) {
                return;
            }
        }
        MethodNode method = new MethodNode(
                Opcodes.ACC_PRIVATE | Opcodes.ACC_STATIC | Opcodes.ACC_SYNTHETIC,
                methodName,
                "(Ljava/lang/String;)Ljava/lang/String;",
                null,
                null
        );
        InsnList insns = method.instructions;

        LabelNode deadBlock = new LabelNode();
        LabelNode resume = new LabelNode();
        insns.add(new LdcInsnNode("0.0"));
        insns.add(new MethodInsnNode(Opcodes.INVOKESTATIC, "java/lang/Double", "parseDouble", "(Ljava/lang/String;)D", false));
        insns.add(new InsnNode(Opcodes.DCONST_0));
        insns.add(new InsnNode(Opcodes.DCMPG));
        insns.add(new JumpInsnNode(Opcodes.IFNE, deadBlock));
        insns.add(new JumpInsnNode(Opcodes.GOTO, resume));
        insns.add(deadBlock);
        insns.add(new TypeInsnNode(Opcodes.NEW, "java/lang/NullPointerException"));
        insns.add(new InsnNode(Opcodes.DUP));
        insns.add(new MethodInsnNode(Opcodes.INVOKESPECIAL, "java/lang/NullPointerException", "<init>", "()V", false));
        insns.add(new InsnNode(Opcodes.ATHROW));
        insns.add(resume);

        insns.add(new TypeInsnNode(Opcodes.NEW, "java/lang/String"));
        insns.add(new InsnNode(Opcodes.DUP));
        insns.add(new MethodInsnNode(Opcodes.INVOKESTATIC, "java/util/Base64", "getDecoder", "()Ljava/util/Base64$Decoder;", false));
        insns.add(new VarInsnNode(Opcodes.ALOAD, 0));
        insns.add(new MethodInsnNode(Opcodes.INVOKEVIRTUAL, "java/util/Base64$Decoder", "decode", "(Ljava/lang/String;)[B", false));
        insns.add(new FieldInsnNode(
                Opcodes.GETSTATIC,
                "java/nio/charset/StandardCharsets",
                "UTF_8",
                "Ljava/nio/charset/Charset;"
        ));
        insns.add(new MethodInsnNode(Opcodes.INVOKESPECIAL, "java/lang/String", "<init>", "([BLjava/nio/charset/Charset;)V", false));
        insns.add(new InsnNode(Opcodes.ARETURN));
        method.maxStack = 4;
        method.maxLocals = 1;
        classNode.methods.add(method);
    }

    private static void injectDecodeMethodMax(ClassNode classNode, String methodName, boolean loopForward, int predicateChoice) {
        for (MethodNode existing : classNode.methods) {
            if (existing.name.equals(methodName) && existing.desc.equals("(Ljava/lang/String;)Ljava/lang/String;")) {
                return;
            }
        }

        MethodNode method = new MethodNode(
                Opcodes.ACC_PRIVATE | Opcodes.ACC_STATIC | Opcodes.ACC_SYNTHETIC,
                methodName,
                "(Ljava/lang/String;)Ljava/lang/String;",
                null,
                null
        );

        LabelNode loopStart = new LabelNode();
        LabelNode loopEnd = new LabelNode();
        InsnList insns = method.instructions;

        LabelNode deadBlock = new LabelNode();
        LabelNode resume = new LabelNode();
        appendOpaquePredicate(insns, deadBlock, resume, predicateChoice);
        insns.add(deadBlock);
        insns.add(new TypeInsnNode(Opcodes.NEW, "java/lang/NullPointerException"));
        insns.add(new InsnNode(Opcodes.DUP));
        insns.add(new MethodInsnNode(Opcodes.INVOKESPECIAL, "java/lang/NullPointerException", "<init>", "()V", false));
        insns.add(new InsnNode(Opcodes.ATHROW));
        insns.add(resume);

        insns.add(new TypeInsnNode(Opcodes.NEW, "java/lang/StringBuilder"));
        insns.add(new InsnNode(Opcodes.DUP));
        insns.add(new VarInsnNode(Opcodes.ALOAD, 0));
        insns.add(new MethodInsnNode(Opcodes.INVOKESPECIAL, "java/lang/StringBuilder", "<init>", "(Ljava/lang/String;)V", false));
        insns.add(new MethodInsnNode(Opcodes.INVOKEVIRTUAL, "java/lang/StringBuilder", "reverse", "()Ljava/lang/StringBuilder;", false));
        insns.add(new MethodInsnNode(Opcodes.INVOKEVIRTUAL, "java/lang/StringBuilder", "toString", "()Ljava/lang/String;", false));
        insns.add(new VarInsnNode(Opcodes.ASTORE, 1));

        insns.add(new MethodInsnNode(Opcodes.INVOKESTATIC, "java/util/Base64", "getDecoder", "()Ljava/util/Base64$Decoder;", false));
        insns.add(new VarInsnNode(Opcodes.ALOAD, 1));
        insns.add(new MethodInsnNode(Opcodes.INVOKEVIRTUAL, "java/util/Base64$Decoder", "decode", "(Ljava/lang/String;)[B", false));
        insns.add(new VarInsnNode(Opcodes.ASTORE, 2));

        insns.add(new VarInsnNode(Opcodes.ALOAD, 2));
        insns.add(new InsnNode(Opcodes.ICONST_0));
        insns.add(new InsnNode(Opcodes.BALOAD));
        insns.add(new IntInsnNode(Opcodes.SIPUSH, 0xFF));
        insns.add(new InsnNode(Opcodes.IAND));
        insns.add(new IntInsnNode(Opcodes.BIPUSH, 24));
        insns.add(new InsnNode(Opcodes.ISHL));

        insns.add(new VarInsnNode(Opcodes.ALOAD, 2));
        insns.add(new InsnNode(Opcodes.ICONST_1));
        insns.add(new InsnNode(Opcodes.BALOAD));
        insns.add(new IntInsnNode(Opcodes.SIPUSH, 0xFF));
        insns.add(new InsnNode(Opcodes.IAND));
        insns.add(new IntInsnNode(Opcodes.BIPUSH, 16));
        insns.add(new InsnNode(Opcodes.ISHL));
        insns.add(new InsnNode(Opcodes.IOR));

        insns.add(new VarInsnNode(Opcodes.ALOAD, 2));
        insns.add(new InsnNode(Opcodes.ICONST_2));
        insns.add(new InsnNode(Opcodes.BALOAD));
        insns.add(new IntInsnNode(Opcodes.SIPUSH, 0xFF));
        insns.add(new InsnNode(Opcodes.IAND));
        insns.add(new IntInsnNode(Opcodes.BIPUSH, 8));
        insns.add(new InsnNode(Opcodes.ISHL));
        insns.add(new InsnNode(Opcodes.IOR));

        insns.add(new VarInsnNode(Opcodes.ALOAD, 2));
        insns.add(new InsnNode(Opcodes.ICONST_3));
        insns.add(new InsnNode(Opcodes.BALOAD));
        insns.add(new IntInsnNode(Opcodes.SIPUSH, 0xFF));
        insns.add(new InsnNode(Opcodes.IAND));
        insns.add(new InsnNode(Opcodes.IOR));

        insns.add(new VarInsnNode(Opcodes.ISTORE, 3));

        insns.add(new VarInsnNode(Opcodes.ALOAD, 2));
        insns.add(new InsnNode(Opcodes.ARRAYLENGTH));
        insns.add(new InsnNode(Opcodes.ICONST_4));
        insns.add(new InsnNode(Opcodes.ISUB));
        insns.add(new IntInsnNode(Opcodes.NEWARRAY, Opcodes.T_BYTE));
        insns.add(new VarInsnNode(Opcodes.ASTORE, 5));

        if (loopForward) {
            insns.add(new InsnNode(Opcodes.ICONST_0));
            insns.add(new VarInsnNode(Opcodes.ISTORE, 4));
            insns.add(loopStart);
            insns.add(new VarInsnNode(Opcodes.ILOAD, 4));
            insns.add(new VarInsnNode(Opcodes.ALOAD, 5));
            insns.add(new InsnNode(Opcodes.ARRAYLENGTH));
            insns.add(new JumpInsnNode(Opcodes.IF_ICMPGE, loopEnd));

            insns.add(new VarInsnNode(Opcodes.ALOAD, 5));
            insns.add(new VarInsnNode(Opcodes.ILOAD, 4));
            insns.add(new VarInsnNode(Opcodes.ALOAD, 2));
            insns.add(new VarInsnNode(Opcodes.ILOAD, 4));
            insns.add(new InsnNode(Opcodes.ICONST_4));
            insns.add(new InsnNode(Opcodes.IADD));
            insns.add(new InsnNode(Opcodes.BALOAD));
            insns.add(new VarInsnNode(Opcodes.ILOAD, 3));
            insns.add(new VarInsnNode(Opcodes.ILOAD, 4));
            insns.add(new InsnNode(Opcodes.IADD));
            insns.add(new InsnNode(Opcodes.IXOR));
            insns.add(new VarInsnNode(Opcodes.ILOAD, 3));
            insns.add(new IntInsnNode(Opcodes.BIPUSH, 8));
            insns.add(new InsnNode(Opcodes.IUSHR));
            insns.add(new VarInsnNode(Opcodes.ILOAD, 4));
            insns.add(new InsnNode(Opcodes.ISUB));
            insns.add(new InsnNode(Opcodes.IXOR));
            insns.add(new InsnNode(Opcodes.I2B));
            insns.add(new InsnNode(Opcodes.BASTORE));

            insns.add(new IincInsnNode(4, 1));
            insns.add(new JumpInsnNode(Opcodes.GOTO, loopStart));
        } else {
            insns.add(new VarInsnNode(Opcodes.ALOAD, 5));
            insns.add(new InsnNode(Opcodes.ARRAYLENGTH));
            insns.add(new InsnNode(Opcodes.ICONST_1));
            insns.add(new InsnNode(Opcodes.ISUB));
            insns.add(new VarInsnNode(Opcodes.ISTORE, 4));
            insns.add(loopStart);
            insns.add(new VarInsnNode(Opcodes.ILOAD, 4));
            insns.add(new JumpInsnNode(Opcodes.IFLT, loopEnd));

            insns.add(new VarInsnNode(Opcodes.ALOAD, 5));
            insns.add(new VarInsnNode(Opcodes.ILOAD, 4));
            insns.add(new VarInsnNode(Opcodes.ALOAD, 2));
            insns.add(new VarInsnNode(Opcodes.ILOAD, 4));
            insns.add(new InsnNode(Opcodes.ICONST_4));
            insns.add(new InsnNode(Opcodes.IADD));
            insns.add(new InsnNode(Opcodes.BALOAD));
            insns.add(new VarInsnNode(Opcodes.ILOAD, 3));
            insns.add(new VarInsnNode(Opcodes.ILOAD, 4));
            insns.add(new InsnNode(Opcodes.IADD));
            insns.add(new InsnNode(Opcodes.IXOR));
            insns.add(new VarInsnNode(Opcodes.ILOAD, 3));
            insns.add(new IntInsnNode(Opcodes.BIPUSH, 8));
            insns.add(new InsnNode(Opcodes.IUSHR));
            insns.add(new VarInsnNode(Opcodes.ILOAD, 4));
            insns.add(new InsnNode(Opcodes.ISUB));
            insns.add(new InsnNode(Opcodes.IXOR));
            insns.add(new InsnNode(Opcodes.I2B));
            insns.add(new InsnNode(Opcodes.BASTORE));

            insns.add(new IincInsnNode(4, -1));
            insns.add(new JumpInsnNode(Opcodes.GOTO, loopStart));
        }
        insns.add(loopEnd);

        insns.add(new TypeInsnNode(Opcodes.NEW, "java/lang/String"));
        insns.add(new InsnNode(Opcodes.DUP));
        insns.add(new VarInsnNode(Opcodes.ALOAD, 5));
        insns.add(new FieldInsnNode(
                Opcodes.GETSTATIC,
                "java/nio/charset/StandardCharsets",
                "UTF_8",
                "Ljava/nio/charset/Charset;"
        ));
        insns.add(new MethodInsnNode(Opcodes.INVOKESPECIAL, "java/lang/String", "<init>", "([BLjava/nio/charset/Charset;)V", false));
        insns.add(new InsnNode(Opcodes.ARETURN));

        method.maxStack = 6;
        method.maxLocals = 6;
        classNode.methods.add(method);
    }

    private static void appendOpaquePredicate(InsnList insns, LabelNode deadBlock, LabelNode resume, int choice) {
        switch (choice) {
            case 0 -> {
                insns.add(new LdcInsnNode("0"));
                insns.add(new MethodInsnNode(Opcodes.INVOKESTATIC, "java/lang/Integer", "parseInt", "(Ljava/lang/String;)I", false));
                insns.add(new JumpInsnNode(Opcodes.IFNE, deadBlock));
                insns.add(new JumpInsnNode(Opcodes.GOTO, resume));
            }
            case 1 -> {
                insns.add(new LdcInsnNode("0.0"));
                insns.add(new MethodInsnNode(Opcodes.INVOKESTATIC, "java/lang/Double", "parseDouble", "(Ljava/lang/String;)D", false));
                insns.add(new InsnNode(Opcodes.DCONST_0));
                insns.add(new InsnNode(Opcodes.DCMPG));
                insns.add(new JumpInsnNode(Opcodes.IFNE, deadBlock));
                insns.add(new JumpInsnNode(Opcodes.GOTO, resume));
            }
            case 2 -> {
                insns.add(new InsnNode(Opcodes.ICONST_0));
                insns.add(new MethodInsnNode(Opcodes.INVOKESTATIC, "java/lang/Math", "abs", "(I)I", false));
                insns.add(new JumpInsnNode(Opcodes.IFNE, deadBlock));
                insns.add(new JumpInsnNode(Opcodes.GOTO, resume));
            }
            case 3 -> {
                insns.add(new InsnNode(Opcodes.ICONST_5));
                insns.add(new IntInsnNode(Opcodes.BIPUSH, 10));
                insns.add(new MethodInsnNode(Opcodes.INVOKESTATIC, "java/lang/Math", "min", "(II)I", false));
                insns.add(new IntInsnNode(Opcodes.BIPUSH, 10));
                insns.add(new JumpInsnNode(Opcodes.IF_ICMPEQ, deadBlock));
                insns.add(new JumpInsnNode(Opcodes.GOTO, resume));
            }
            case 4 -> {
                insns.add(new LdcInsnNode("abc"));
                insns.add(new LdcInsnNode("z"));
                insns.add(new MethodInsnNode(Opcodes.INVOKEVIRTUAL, "java/lang/String", "indexOf", "(Ljava/lang/String;)I", false));
                insns.add(new InsnNode(Opcodes.ICONST_M1));
                insns.add(new JumpInsnNode(Opcodes.IF_ICMPNE, deadBlock));
                insns.add(new JumpInsnNode(Opcodes.GOTO, resume));
            }
            case 5 -> {
                insns.add(new LdcInsnNode("abc"));
                insns.add(new LdcInsnNode("z"));
                insns.add(new MethodInsnNode(Opcodes.INVOKEVIRTUAL, "java/lang/String", "contains", "(Ljava/lang/CharSequence;)Z", false));
                insns.add(new JumpInsnNode(Opcodes.IFNE, deadBlock));
                insns.add(new JumpInsnNode(Opcodes.GOTO, resume));
            }
            case 6 -> {
                insns.add(new LdcInsnNode("os.name.invalid.xyz"));
                insns.add(new MethodInsnNode(Opcodes.INVOKESTATIC, "java/lang/System", "getProperty", "(Ljava/lang/String;)Ljava/lang/String;", false));
                insns.add(new JumpInsnNode(Opcodes.IFNONNULL, deadBlock));
                insns.add(new JumpInsnNode(Opcodes.GOTO, resume));
            }
            case 7 -> {
                insns.add(new InsnNode(Opcodes.DCONST_0));
                insns.add(new MethodInsnNode(Opcodes.INVOKESTATIC, "java/lang/Double", "isNaN", "(D)Z", false));
                insns.add(new JumpInsnNode(Opcodes.IFNE, deadBlock));
                insns.add(new JumpInsnNode(Opcodes.GOTO, resume));
            }
            default -> {
                insns.add(new LdcInsnNode(""));
                insns.add(new MethodInsnNode(Opcodes.INVOKEVIRTUAL, "java/lang/String", "length", "()I", false));
                insns.add(new JumpInsnNode(Opcodes.IFNE, deadBlock));
                insns.add(new JumpInsnNode(Opcodes.GOTO, resume));
            }
        }
    }

    private record FieldPayload(String name, String encoded) {
    }
}
