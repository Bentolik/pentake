package io.github.cat.fabricobf.asm;

import static org.junit.jupiter.api.Assertions.assertEquals;

import io.github.cat.fabricobf.core.ClassData;
import io.github.cat.fabricobf.core.MemberRef;
import io.github.cat.fabricobf.core.SymbolMapping;
import java.util.LinkedHashMap;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.objectweb.asm.tree.ClassNode;

class MappingRemapperHierarchyTest {
    @Test
    void resolvesInheritedFieldAndMethodMappingsFromAncestorOwner() {
        ClassNode base = new ClassNode();
        base.name = "com/example/Base";
        base.superName = "java/lang/Object";

        ClassNode child = new ClassNode();
        child.name = "com/example/Child";
        child.superName = "com/example/Base";

        Map<String, ClassData> classes = new LinkedHashMap<>();
        classes.put(base.name, new ClassData(base.name + ".class", new byte[0], base));
        classes.put(child.name, new ClassData(child.name + ".class", new byte[0], child));

        SymbolMapping mapping = new SymbolMapping(
                Map.of(),
                Map.of(new MemberRef("com/example/Base", "compute", "()I"), "m0"),
                Map.of(new MemberRef("com/example/Base", "value", "I"), "f0")
        );
        MappingRemapper remapper = new MappingRemapper(mapping, classes);

        assertEquals("f0", remapper.mapFieldName("com/example/Child", "value", "I"));
        assertEquals("m0", remapper.mapMethodName("com/example/Child", "compute", "()I"));
    }
}

