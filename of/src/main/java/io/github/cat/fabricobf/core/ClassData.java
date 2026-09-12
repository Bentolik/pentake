package io.github.cat.fabricobf.core;

import org.objectweb.asm.tree.ClassNode;

public record ClassData(String entryName, byte[] originalBytes, ClassNode classNode) {
    public String internalName() {
        return classNode.name;
    }
}

