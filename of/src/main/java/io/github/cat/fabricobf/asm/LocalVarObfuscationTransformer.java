package io.github.cat.fabricobf.asm;

import io.github.cat.fabricobf.core.ClassData;
import java.util.ArrayList;
import java.util.List;
import org.objectweb.asm.Opcodes;
import org.objectweb.asm.tree.LocalVariableNode;
import org.objectweb.asm.tree.MethodNode;

public final class LocalVarObfuscationTransformer {
    public List<String> transform(ClassData classData, long seed) {
        List<String> warnings = new ArrayList<>();

        for (MethodNode methodNode : classData.classNode().methods) {
            if (methodNode.localVariables == null || methodNode.localVariables.isEmpty()) {
                continue;
            }

            boolean isStatic = (methodNode.access & Opcodes.ACC_STATIC) != 0;
            boolean isConstructor = "<init>".equals(methodNode.name);

            for (LocalVariableNode lv : methodNode.localVariables) {
                // In non-static methods (including constructors) slot 0 holds 'this'.
                // Renaming it would corrupt stack-map frames and confuse decompilers in a
                // counter-productive way, so we leave it alone.
                if (!isStatic && lv.index == 0) {
                    continue;
                }

                // Constructor parameters start at slot 1 (slot 0 is 'this').  We honour
                // the caller's intent by not renaming them so that the constructor
                // signature remains readable in debug builds.
                if (isConstructor && lv.index > 0 && isParameter(methodNode, lv.index)) {
                    continue;
                }

                lv.name = "v" + lv.index;
            }
        }

        return warnings;
    }

    /**
     * Returns {@code true} when {@code slotIndex} belongs to a parameter of
     * {@code methodNode}.  Parameter slots are those occupied by the method's
     * argument types immediately after the implicit {@code this} slot (if any).
     *
     * <p>This is a best-effort check: if the descriptor cannot be parsed, or the
     * slot falls outside the range of known parameters, we conservatively return
     * {@code false} so that the local is renamed normally.</p>
     */
    private static boolean isParameter(MethodNode methodNode, int slotIndex) {
        boolean isStatic = (methodNode.access & Opcodes.ACC_STATIC) != 0;
        // First parameter slot: 1 for instance methods, 0 for static (unused here since
        // we only call this helper when isConstructor == true, which is never static).
        int slot = isStatic ? 0 : 1;

        String desc = methodNode.desc;
        // Walk the descriptor to find the last parameter slot
        int i = 1; // skip leading '('
        while (i < desc.length() && desc.charAt(i) != ')') {
            if (slotIndex == slot) {
                return true;
            }
            int typeSize = descriptorSlotSize(desc, i);
            if (typeSize == 0) {
                break; // malformed descriptor, bail out
            }
            slot += typeSize;
            i += descriptorLength(desc, i);
        }
        return false;
    }

    /** Returns the JVM slot width (1 or 2) of the type starting at {@code offset} in {@code desc}. */
    private static int descriptorSlotSize(String desc, int offset) {
        char c = desc.charAt(offset);
        return (c == 'J' || c == 'D') ? 2 : 1;
    }

    /**
     * Returns the number of characters in the descriptor starting at {@code offset}
     * that represent a single type.
     */
    private static int descriptorLength(String desc, int offset) {
        char c = desc.charAt(offset);
        return switch (c) {
            case 'B', 'C', 'D', 'F', 'I', 'J', 'S', 'Z' -> 1;
            case 'L' -> {
                int semi = desc.indexOf(';', offset);
                yield (semi < 0) ? 1 : semi - offset + 1;
            }
            case '[' -> {
                // Count leading '[' then recurse for the element type
                int depth = 0;
                while (offset + depth < desc.length() && desc.charAt(offset + depth) == '[') {
                    depth++;
                }
                yield depth + descriptorLength(desc, offset + depth);
            }
            default -> 1; // unknown — advance by one to avoid infinite loop
        };
    }
}
