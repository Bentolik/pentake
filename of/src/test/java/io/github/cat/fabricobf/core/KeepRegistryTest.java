package io.github.cat.fabricobf.core;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;
import java.util.regex.Pattern;
import org.junit.jupiter.api.Test;
import org.objectweb.asm.Opcodes;
import org.objectweb.asm.tree.FieldNode;
import org.objectweb.asm.tree.MethodNode;

class KeepRegistryTest {
    @Test
    void appliesExplicitAndRegexKeepRules() {
        KeepRegistry keepRegistry = new KeepRegistry(List.of(Pattern.compile("^M:com/example/mod/Helper#hidden\\(\\)Ljava/lang/String;$")));
        keepRegistry.keepClass("com/example/mod/EntryPoint");
        keepRegistry.keepField(new MemberRef("com/example/mod/Helper", "serialVersionUID", "J"));
        keepRegistry.keepMethodName("com/example/mod/TargetClass", "targetMethod");

        MethodNode hidden = new MethodNode(Opcodes.ACC_PRIVATE, "hidden", "()Ljava/lang/String;", null, null);
        MethodNode targetMethod = new MethodNode(Opcodes.ACC_PROTECTED, "targetMethod", "()V", null, null);
        FieldNode serialUid = new FieldNode(Opcodes.ACC_PRIVATE, "serialVersionUID", "J", null, null);
        FieldNode renamed = new FieldNode(Opcodes.ACC_PRIVATE, "renamed", "I", null, null);

        assertTrue(keepRegistry.isClassKept("com/example/mod/EntryPoint"));
        assertTrue(keepRegistry.isMethodKept("com/example/mod/Helper", hidden));
        assertTrue(keepRegistry.isMethodKept("com/example/mod/TargetClass", targetMethod));
        assertTrue(keepRegistry.isFieldKept("com/example/mod/Helper", serialUid));
        assertFalse(keepRegistry.isFieldKept("com/example/mod/Helper", renamed));
    }
}

