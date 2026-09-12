package io.github.cat.fabricobf.core;

import io.github.cat.fabricobf.asm.ClassSplitterTransformer;
import io.github.cat.fabricobf.asm.ControlFlowTransformer;
import io.github.cat.fabricobf.asm.JunkFieldTransformer;
import io.github.cat.fabricobf.asm.LocalVarObfuscationTransformer;
import io.github.cat.fabricobf.asm.MappingRemapper;
import io.github.cat.fabricobf.asm.NumberObfuscationTransformer;
import io.github.cat.fabricobf.asm.StringEncryptionTransformer;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.objectweb.asm.ClassReader;
import org.objectweb.asm.ClassWriter;
import org.objectweb.asm.Opcodes;
import org.objectweb.asm.commons.ClassRemapper;
import org.objectweb.asm.util.CheckClassAdapter;
import org.objectweb.asm.tree.AbstractInsnNode;
import org.objectweb.asm.tree.ClassNode;
import org.objectweb.asm.tree.LineNumberNode;
import org.objectweb.asm.tree.MethodNode;

/**
 * Orchestrates all ASM transformation passes in the correct order, then applies
 * the symbol-rename remapping.  Each class is processed independently so that a
 * failure in one transform pass degrades gracefully to the original bytes rather
 * than corrupting the entire output jar.
 *
 * <p>Transform order:
 * <ol>
 *   <li>String encryption (adds a decode helper method)
 *   <li>Control-flow noise (opaque predicates at method entries)
 *   <li>Number constant obfuscation (arithmetic XOR chains)
 *   <li>Debug metadata stripping -- or local variable name obfuscation in aggressive mode
 *   <li>Junk field injection (insane mode only)
 *   <li>Class splitting across synthetic helper classes (insane mode only)
 *   <li>Symbol remapping via ClassRemapper
 *   <li>Per-class bytecode verification
 * </ol>
 */
public final class ObfuscationApplier {
    private final StringEncryptionTransformer stringEncryptionTransformer = new StringEncryptionTransformer();
    private final ControlFlowTransformer controlFlowTransformer = new ControlFlowTransformer();
    private final NumberObfuscationTransformer numberObfuscationTransformer = new NumberObfuscationTransformer();
    private final ClassSplitterTransformer classSplitterTransformer = new ClassSplitterTransformer();
    private final JunkFieldTransformer junkFieldTransformer = new JunkFieldTransformer();
    private final LocalVarObfuscationTransformer localVarObfuscationTransformer = new LocalVarObfuscationTransformer();

    public ApplyResult apply(
            JarArchive archive,
            AnalysisResult analysisResult,
            SymbolMapping mapping,
            ObfuscationConfig config
    ) {
        Map<String, byte[]> classEntries = new LinkedHashMap<>();
        List<String> warnings = new ArrayList<>();
        MappingRemapper remapper = new MappingRemapper(mapping, analysisResult.classesByInternalName());

        boolean needsComputeFrames = config.effectiveStringEncryption()
                || config.effectiveMaxMode()
                || config.effectiveUltraMode()
                || config.effectiveInsaneMode();
        int readFlags = needsComputeFrames ? ClassReader.SKIP_FRAMES : ClassReader.EXPAND_FRAMES;

        // --- Pass 1: in-place bytecode transformations per class ---
        Map<String, ClassNode> processedNodes = new LinkedHashMap<>();

        for (ClassData classData : archive.classesByEntry().values()) {
            ClassNode node = new ClassNode();
            new ClassReader(classData.originalBytes()).accept(node, readFlags);
            ClassData mutableClass = new ClassData(classData.entryName(), classData.originalBytes(), node);

            try {
                if (config.effectiveStringEncryption()) {
                    warnings.addAll(stringEncryptionTransformer.transform(
                            mutableClass,
                            config.seed(),
                            config.effectiveAggressive(),
                            config.effectiveMaxMode()
                    ));
                }
                if (config.effectiveMaxMode()) {
                    warnings.addAll(controlFlowTransformer.transform(
                            mutableClass,
                            config.seed(),
                            config.effectiveInsaneMode()
                    ));
                }
                if (config.effectiveUltraMode()) {
                    warnings.addAll(numberObfuscationTransformer.transform(mutableClass, config.seed()));
                }
                if (config.effectiveStripDebug()) {
                    stripDebugMetadata(node);
                } else if (config.effectiveAggressive()) {
                    warnings.addAll(localVarObfuscationTransformer.transform(mutableClass, config.seed()));
                }
                if (config.effectiveInsaneMode()) {
                    warnings.addAll(junkFieldTransformer.transform(mutableClass, config.seed()));
                }
            } catch (Exception ex) {
                String msg = ex.getMessage() != null ? ex.getMessage() : ex.getClass().getSimpleName();
                warnings.add("[TRANSFORM_ERROR] " + classData.internalName()
                        + " -- " + msg + "; reverting to untransformed bytecode for this class");
                node = new ClassNode();
                new ClassReader(classData.originalBytes()).accept(node, readFlags);
            }

            processedNodes.put(classData.internalName(), node);
        }

        // --- Pass 2: cross-class method splitting (insane mode) ---
        Map<String, ClassNode> extraClassNodes = new LinkedHashMap<>();
        if (config.effectiveInsaneMode()) {
            try {
                extraClassNodes.putAll(classSplitterTransformer.transform(processedNodes, config.seed()));
            } catch (Exception ex) {
                String msg = ex.getMessage() != null ? ex.getMessage() : ex.getClass().getSimpleName();
                warnings.add("[SPLIT_ERROR] class splitter failed: " + msg);
            }
        }

        // --- Pass 3: symbol remapping and bytecode serialisation ---
        for (ClassData classData : archive.classesByEntry().values()) {
            ClassNode node = processedNodes.get(classData.internalName());
            byte[] bytes = writeClass(node, needsComputeFrames, analysisResult, mapping, remapper, warnings);
            String mappedOwner = mapping.classMap().getOrDefault(classData.internalName(), classData.internalName());
            classEntries.put(mappedOwner + ".class", bytes);
        }

        for (Map.Entry<String, ClassNode> entry : extraClassNodes.entrySet()) {
            byte[] bytes = writeClass(entry.getValue(), true, analysisResult, mapping, remapper, warnings);
            classEntries.put(entry.getKey() + ".class", bytes);
        }

        return new ApplyResult(classEntries, archive.resourcesByEntry(), warnings);
    }

    private static byte[] writeClass(
            ClassNode node,
            boolean computeFrames,
            AnalysisResult analysisResult,
            SymbolMapping mapping,
            MappingRemapper remapper,
            List<String> warnings
    ) {
        try {
            ClassWriter writer = computeFrames
                    ? new FrameClassWriter(ClassWriter.COMPUTE_FRAMES, analysisResult.classesByInternalName(), mapping)
                    : new ClassWriter(0);
            ClassRemapper classRemapper = new ClassRemapper(writer, remapper);
            node.accept(classRemapper);
            byte[] bytes = writer.toByteArray();
            verifyBytecode(node.name, bytes, warnings);
            return bytes;
        } catch (Exception ex) {
            String msg = ex.getMessage() != null ? ex.getMessage() : ex.getClass().getSimpleName();
            warnings.add("[WRITE_ERROR] " + node.name + " -- " + msg + "; emitting placeholder class");
            return emptyClassBytes(
                    mapping.classMap().getOrDefault(node.name, node.name),
                    node.superName != null ? node.superName : "java/lang/Object"
            );
        }
    }

    private static void verifyBytecode(String className, byte[] bytes, List<String> warnings) {
        try {
            ClassNode verifyNode = new ClassNode();
            new ClassReader(bytes).accept(verifyNode, ClassReader.SKIP_DEBUG | ClassReader.SKIP_FRAMES);
        } catch (Exception ex) {
            String msg = ex.getMessage() != null ? ex.getMessage() : ex.getClass().getSimpleName();
            warnings.add("[VERIFY_PARSE_ERROR] " + className + " -- " + msg);
            return;
        }
        try {
            new ClassReader(bytes).accept(
                    new CheckClassAdapter(new ClassWriter(0), false),
                    ClassReader.SKIP_DEBUG | ClassReader.SKIP_FRAMES
            );
        } catch (Exception ex) {
            String msg = ex.getMessage() != null ? ex.getMessage() : ex.getClass().getSimpleName();
            warnings.add("[VERIFY_STRUCTURAL_WARN] " + className + " -- " + msg);
        }
    }

    private static byte[] emptyClassBytes(String internalName, String superName) {
        ClassWriter cw = new ClassWriter(0);
        cw.visit(Opcodes.V21, Opcodes.ACC_PUBLIC | Opcodes.ACC_SYNTHETIC,
                internalName, null, superName, null);
        cw.visitEnd();
        return cw.toByteArray();
    }

    private static void stripDebugMetadata(ClassNode node) {
        node.sourceFile = null;
        node.sourceDebug = null;
        for (MethodNode method : node.methods) {
            method.localVariables = null;
            method.visibleLocalVariableAnnotations = null;
            method.invisibleLocalVariableAnnotations = null;
            for (AbstractInsnNode insn = method.instructions.getFirst(); insn != null; ) {
                AbstractInsnNode next = insn.getNext();
                if (insn instanceof LineNumberNode) {
                    method.instructions.remove(insn);
                }
                insn = next;
            }
        }
    }

    public record ApplyResult(
            Map<String, byte[]> classEntries,
            Map<String, byte[]> resources,
            List<String> warnings
    ) {
    }
}
