package io.github.cat.fabricobf.asm;

import static org.junit.jupiter.api.Assertions.assertTrue;

import io.github.cat.fabricobf.core.ClassData;
import org.junit.jupiter.api.Test;
import org.objectweb.asm.Opcodes;
import org.objectweb.asm.tree.AbstractInsnNode;
import org.objectweb.asm.tree.ClassNode;
import org.objectweb.asm.tree.FieldNode;
import org.objectweb.asm.tree.MethodInsnNode;

class StringEncryptionTransformerInterfaceTest {
    @Test
    void maxModeUsesInterfaceMethodRefForInterfaceOwner() {
        ClassNode node = new ClassNode();
        node.version = Opcodes.V21;
        node.access = Opcodes.ACC_PUBLIC | Opcodes.ACC_INTERFACE | Opcodes.ACC_ABSTRACT;
        node.name = "com/example/mod/Constants";
        node.superName = "java/lang/Object";
        node.fields.add(new FieldNode(
                Opcodes.ACC_PUBLIC | Opcodes.ACC_STATIC | Opcodes.ACC_FINAL,
                "TOKEN",
                "Ljava/lang/String;",
                null,
                "hello"
        ));

        ClassData data = new ClassData(node.name + ".class", new byte[0], node);
        new StringEncryptionTransformer().transform(data, 20260522L, true, true);

        boolean foundInterfaceInvokeStatic = false;
        for (var method : node.methods) {
            for (AbstractInsnNode insn = method.instructions.getFirst(); insn != null; insn = insn.getNext()) {
                if (insn instanceof MethodInsnNode call
                        && call.getOpcode() == Opcodes.INVOKESTATIC
                        && call.owner.equals(node.name)
                        && call.name.startsWith("$fabricobf$dec$")
                        && "Ljava/lang/String;".equals(call.desc.substring(call.desc.indexOf(')') + 1))
                        && call.itf) {
                    foundInterfaceInvokeStatic = true;
                    break;
                }
            }
        }
        assertTrue(foundInterfaceInvokeStatic);
    }
}
