package io.github.cat.fabricobf.asm;

import static org.junit.jupiter.api.Assertions.*;

import java.util.LinkedHashMap;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.objectweb.asm.ClassReader;
import org.objectweb.asm.ClassWriter;
import org.objectweb.asm.Opcodes;
import org.objectweb.asm.tree.*;

class ClassSplitterTransformerTest {

    @Test
    void splitsPrivateStaticMethodIntoNewClass() {
        Map<String, ClassNode> classNodes = makeSingleClass();
        ClassSplitterTransformer splitter = new ClassSplitterTransformer();
        Map<String, ClassNode> extra = splitter.transform(classNodes, 42L);

        assertFalse(extra.isEmpty());

        MethodNode modified = classNodes.get("Test").methods.get(0);
        assertEquals(2, modified.instructions.size());
        AbstractInsnNode first = modified.instructions.getFirst();
        assertInstanceOf(MethodInsnNode.class, first);
        MethodInsnNode call = (MethodInsnNode) first;
        assertEquals(Opcodes.INVOKESTATIC, call.getOpcode());
        assertTrue(call.owner.startsWith("$fabricobf$"));
        assertEquals("$m$0", call.name);
        assertEquals("()I", call.desc);

        ClassNode extraClass = extra.values().iterator().next();
        assertEquals(1, extraClass.methods.size());
        MethodNode moved = extraClass.methods.get(0);
        assertTrue((moved.access & Opcodes.ACC_PUBLIC) != 0);
        assertTrue((moved.access & Opcodes.ACC_STATIC) != 0);
        assertEquals("$m$0", moved.name);

        assertSerializable(classNodes.get("Test"));
        assertSerializable(extraClass);
    }

    @Test
    void leavesNonPrivateMethodsUntouched() {
        ClassNode cn = new ClassNode();
        cn.version = Opcodes.V21;
        cn.access = Opcodes.ACC_PUBLIC;
        cn.name = "Test";
        cn.superName = "java/lang/Object";

        MethodNode pubStatic = new MethodNode(Opcodes.ACC_PUBLIC | Opcodes.ACC_STATIC, "pub", "()I", null, null);
        pubStatic.instructions = new InsnList();
        pubStatic.instructions.add(new InsnNode(Opcodes.ICONST_1));
        pubStatic.instructions.add(new InsnNode(Opcodes.IRETURN));
        cn.methods.add(pubStatic);

        Map<String, ClassNode> classNodes = new LinkedHashMap<>();
        classNodes.put("Test", cn);

        Map<String, ClassNode> extra = new ClassSplitterTransformer().transform(classNodes, 42L);
        assertTrue(extra.isEmpty());
    }

    @Test
    void leavesMethodsReferencingPrivateFieldsUntouched() {
        ClassNode cn = new ClassNode();
        cn.version = Opcodes.V21;
        cn.access = Opcodes.ACC_PUBLIC;
        cn.name = "Test";
        cn.superName = "java/lang/Object";
        cn.fields.add(new FieldNode(Opcodes.ACC_PRIVATE, "x", "I", null, null));

        MethodNode method = new MethodNode(Opcodes.ACC_PRIVATE | Opcodes.ACC_STATIC, "bad", "()I", null, null);
        method.instructions = new InsnList();
        method.instructions.add(new FieldInsnNode(Opcodes.GETSTATIC, "Test", "x", "I"));
        method.instructions.add(new InsnNode(Opcodes.IRETURN));
        cn.methods.add(method);

        Map<String, ClassNode> classNodes = new LinkedHashMap<>();
        classNodes.put("Test", cn);

        Map<String, ClassNode> extra = new ClassSplitterTransformer().transform(classNodes, 42L);
        assertTrue(extra.isEmpty(), "Should not split methods referencing private fields");
    }

    @Test
    void handlesMethodsWithParameters() {
        ClassNode cn = new ClassNode();
        cn.version = Opcodes.V21;
        cn.access = Opcodes.ACC_PUBLIC;
        cn.name = "Test";
        cn.superName = "java/lang/Object";

        MethodNode method = new MethodNode(Opcodes.ACC_PRIVATE | Opcodes.ACC_STATIC, "add", "(II)I", null, null);
        method.instructions = new InsnList();
        method.instructions.add(new VarInsnNode(Opcodes.ILOAD, 0));
        method.instructions.add(new VarInsnNode(Opcodes.ILOAD, 1));
        method.instructions.add(new InsnNode(Opcodes.IADD));
        method.instructions.add(new InsnNode(Opcodes.IRETURN));
        method.maxLocals = 2;
        cn.methods.add(method);

        Map<String, ClassNode> classNodes = new LinkedHashMap<>();
        classNodes.put("Test", cn);

        Map<String, ClassNode> extra = new ClassSplitterTransformer().transform(classNodes, 42L);
        assertFalse(extra.isEmpty());

        MethodNode modified = cn.methods.get(0);
        assertEquals(4, modified.instructions.size());
        assertInstanceOf(VarInsnNode.class, modified.instructions.get(0));
        assertInstanceOf(VarInsnNode.class, modified.instructions.get(1));
        assertInstanceOf(MethodInsnNode.class, modified.instructions.get(2));
        assertInstanceOf(InsnNode.class, modified.instructions.get(3));

        assertSerializable(cn);
        assertSerializable(extra.values().iterator().next());
    }

    @Test
    void deterministicWithSameSeed() {
        Map<String, ClassNode> base = makeSingleClass();
        Map<String, ClassNode> a = new ClassSplitterTransformer().transform(cloneNodes(base), 42L);
        Map<String, ClassNode> b = new ClassSplitterTransformer().transform(cloneNodes(base), 42L);

        assertEquals(a.size(), b.size());
        assertEquals(a.keySet(), b.keySet());
    }

    private static Map<String, ClassNode> makeSingleClass() {
        ClassNode cn = new ClassNode();
        cn.version = Opcodes.V21;
        cn.access = Opcodes.ACC_PUBLIC;
        cn.name = "Test";
        cn.superName = "java/lang/Object";

        MethodNode method = new MethodNode(Opcodes.ACC_PRIVATE | Opcodes.ACC_STATIC, "compute", "()I", null, null);
        method.instructions = new InsnList();
        method.instructions.add(new InsnNode(Opcodes.ICONST_3));
        method.instructions.add(new InsnNode(Opcodes.IRETURN));
        method.maxStack = 1;
        method.maxLocals = 0;
        cn.methods.add(method);

        Map<String, ClassNode> map = new LinkedHashMap<>();
        map.put("Test", cn);
        return map;
    }

    private static Map<String, ClassNode> cloneNodes(Map<String, ClassNode> original) {
        Map<String, ClassNode> result = new LinkedHashMap<>();
        for (var entry : original.entrySet()) {
            ClassWriter cw = new ClassWriter(0);
            entry.getValue().accept(cw);
            ClassNode copy = new ClassNode();
            new ClassReader(cw.toByteArray()).accept(copy, 0);
            result.put(entry.getKey(), copy);
        }
        return result;
    }

    private static void assertSerializable(ClassNode cn) {
        ClassWriter cw = new ClassWriter(ClassWriter.COMPUTE_MAXS);
        assertDoesNotThrow(() -> cn.accept(cw));
        byte[] bytes = cw.toByteArray();
        ClassNode reloaded = new ClassNode();
        assertDoesNotThrow(() -> new ClassReader(bytes).accept(reloaded, 0));
    }
}
