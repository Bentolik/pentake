package io.github.cat.fabricobf.testutil;

import org.objectweb.asm.*;
import org.objectweb.asm.commons.GeneratorAdapter;
import org.objectweb.asm.commons.Method;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.jar.JarEntry;
import java.util.jar.JarOutputStream;
import java.util.jar.Manifest;
import java.util.jar.Attributes;

import static org.objectweb.asm.Opcodes.*;

/**
 * Generates diverse in-memory JARs using ASM ClassWriter for testing a Java obfuscator.
 */
public final class RandomJarGenerator {

    public int variantCount() {
        return 20;
    }

    public void generateVariant(int variantId, Path output) throws IOException {
        switch (variantId) {
            case 0  -> generateSimpleClass(output);
            case 1  -> generateInheritanceChain(output);
            case 2  -> generateMultiInterface(output);
            case 3  -> generateEnumVariant(output);
            case 4  -> generateAnnotationType(output);
            case 5  -> generateLambdaAndStream(output);
            case 6  -> generateStaticInnerClass(output);
            case 7  -> generateRecordVariant(output);
            case 8  -> generateTryCatchFinally(output);
            case 9  -> generateSwitchExpr(output);
            case 10 -> generateStringConstants(output);
            case 11 -> generateNumericConstants(output);
            case 12 -> generateGenericTypes(output);
            case 13 -> generateAnonymousClass(output);
            case 14 -> generateDeepPackage(output);
            case 15 -> generateClinitComplex(output);
            case 16 -> generateInterfaceDefault(output);
            case 17 -> generateAbstractClassChain(output);
            case 18 -> generateExceptionTypes(output);
            case 19 -> generateMultipleClasses(output);
            default -> throw new IllegalArgumentException("Unknown variant: " + variantId);
        }
    }

    // ─────────────────────────────────────────────────────────────────
    // Utilities
    // ─────────────────────────────────────────────────────────────────

    private static void writeJar(Path output, String mainClass, String variantName,
                                  Map<String, byte[]> classes) throws IOException {
        Manifest manifest = new Manifest();
        manifest.getMainAttributes().put(Attributes.Name.MANIFEST_VERSION, "1.0");
        manifest.getMainAttributes().put(Attributes.Name.MAIN_CLASS, mainClass);

        try (JarOutputStream jos = new JarOutputStream(Files.newOutputStream(output), manifest)) {
            // resource
            jos.putNextEntry(new JarEntry("assets/test/variant.txt"));
            jos.write(variantName.getBytes(StandardCharsets.UTF_8));
            jos.closeEntry();

            // classes
            for (var entry : classes.entrySet()) {
                jos.putNextEntry(new JarEntry(entry.getKey() + ".class"));
                jos.write(entry.getValue());
                jos.closeEntry();
            }
        }
    }

    private static ClassWriter newCW() {
        return new ClassWriter(ClassWriter.COMPUTE_FRAMES | ClassWriter.COMPUTE_MAXS);
    }

    // ─────────────────────────────────────────────────────────────────
    // Variant 1 – SimpleClass
    // ─────────────────────────────────────────────────────────────────

    private void generateSimpleClass(Path output) throws IOException {
        String cls = "test/gen/a/SimpleA";
        ClassWriter cw = newCW();
        cw.visit(V21, ACC_PUBLIC | ACC_SUPER, cls, null, "java/lang/Object", null);

        // constants
        cw.visitField(ACC_PUBLIC | ACC_STATIC | ACC_FINAL, "INT_CONST", "I", null, 42).visitEnd();
        cw.visitField(ACC_PUBLIC | ACC_STATIC | ACC_FINAL, "STR_CONST", "Ljava/lang/String;", null, "hello").visitEnd();

        // private fields
        cw.visitField(ACC_PRIVATE, "value", "I", null, null).visitEnd();
        cw.visitField(ACC_PRIVATE, "name", "Ljava/lang/String;", null, null).visitEnd();

        // constructor
        {
            MethodVisitor mv = cw.visitMethod(ACC_PUBLIC, "<init>", "(ILjava/lang/String;)V", null, null);
            mv.visitCode();
            mv.visitVarInsn(ALOAD, 0);
            mv.visitMethodInsn(INVOKESPECIAL, "java/lang/Object", "<init>", "()V", false);
            mv.visitVarInsn(ALOAD, 0);
            mv.visitVarInsn(ILOAD, 1);
            mv.visitFieldInsn(PUTFIELD, cls, "value", "I");
            mv.visitVarInsn(ALOAD, 0);
            mv.visitVarInsn(ALOAD, 2);
            mv.visitFieldInsn(PUTFIELD, cls, "name", "Ljava/lang/String;");
            mv.visitInsn(RETURN);
            mv.visitMaxs(0, 0);
            mv.visitEnd();
        }

        // getValue()
        {
            MethodVisitor mv = cw.visitMethod(ACC_PUBLIC, "getValue", "()I", null, null);
            mv.visitCode();
            mv.visitVarInsn(ALOAD, 0);
            mv.visitFieldInsn(GETFIELD, cls, "value", "I");
            mv.visitInsn(IRETURN);
            mv.visitMaxs(0, 0);
            mv.visitEnd();
        }

        // getName()
        {
            MethodVisitor mv = cw.visitMethod(ACC_PUBLIC, "getName", "()Ljava/lang/String;", null, null);
            mv.visitCode();
            mv.visitVarInsn(ALOAD, 0);
            mv.visitFieldInsn(GETFIELD, cls, "name", "Ljava/lang/String;");
            mv.visitInsn(ARETURN);
            mv.visitMaxs(0, 0);
            mv.visitEnd();
        }

        // private helper
        {
            MethodVisitor mv = cw.visitMethod(ACC_PRIVATE, "compute", "()I", null, null);
            mv.visitCode();
            mv.visitVarInsn(ALOAD, 0);
            mv.visitFieldInsn(GETFIELD, cls, "value", "I");
            mv.visitIntInsn(BIPUSH, 10);
            mv.visitInsn(IMUL);
            mv.visitInsn(IRETURN);
            mv.visitMaxs(0, 0);
            mv.visitEnd();
        }

        // check()
        {
            MethodVisitor mv = cw.visitMethod(ACC_PUBLIC | ACC_STATIC, "check", "()Ljava/lang/String;", null, null);
            mv.visitCode();
            // new SimpleA(1,"ok"), call getValue() then getName()
            mv.visitTypeInsn(NEW, cls);
            mv.visitInsn(DUP);
            mv.visitInsn(ICONST_1);
            mv.visitLdcInsn("ok");
            mv.visitMethodInsn(INVOKESPECIAL, cls, "<init>", "(ILjava/lang/String;)V", false);
            mv.visitMethodInsn(INVOKEVIRTUAL, cls, "getName", "()Ljava/lang/String;", false);
            mv.visitInsn(ARETURN);
            mv.visitMaxs(0, 0);
            mv.visitEnd();
        }

        cw.visitEnd();

        var classes = new LinkedHashMap<String, byte[]>();
        classes.put(cls, cw.toByteArray());
        writeJar(output, "test.gen.a.SimpleA", "SimpleClass", classes);
    }

    // ─────────────────────────────────────────────────────────────────
    // Variant 2 – InheritanceChain
    // ─────────────────────────────────────────────────────────────────

    private void generateInheritanceChain(Path output) throws IOException {
        var classes = new LinkedHashMap<String, byte[]>();

        // BaseB – abstract
        {
            String baseCls = "test/gen/b/BaseB";
            ClassWriter cw = newCW();
            cw.visit(V21, ACC_PUBLIC | ACC_SUPER | ACC_ABSTRACT, baseCls, null, "java/lang/Object", null);
            cw.visitField(ACC_PROTECTED, "baseField", "I", null, null).visitEnd();

            MethodVisitor mv = cw.visitMethod(ACC_PUBLIC, "<init>", "()V", null, null);
            mv.visitCode();
            mv.visitVarInsn(ALOAD, 0);
            mv.visitMethodInsn(INVOKESPECIAL, "java/lang/Object", "<init>", "()V", false);
            mv.visitVarInsn(ALOAD, 0);
            mv.visitIntInsn(BIPUSH, 7);
            mv.visitFieldInsn(PUTFIELD, baseCls, "baseField", "I");
            mv.visitInsn(RETURN);
            mv.visitMaxs(0, 0);
            mv.visitEnd();

            cw.visitMethod(ACC_PUBLIC | ACC_ABSTRACT, "describe", "()Ljava/lang/String;", null, null).visitEnd();
            cw.visitEnd();
            classes.put(baseCls, cw.toByteArray());
        }

        // MidB extends BaseB
        {
            String midCls = "test/gen/b/MidB";
            String baseCls = "test/gen/b/BaseB";
            ClassWriter cw = newCW();
            cw.visit(V21, ACC_PUBLIC | ACC_SUPER | ACC_ABSTRACT, midCls, null, baseCls, null);
            cw.visitField(ACC_PROTECTED, "midField", "Ljava/lang/String;", null, null).visitEnd();

            MethodVisitor mv = cw.visitMethod(ACC_PUBLIC, "<init>", "()V", null, null);
            mv.visitCode();
            mv.visitVarInsn(ALOAD, 0);
            mv.visitMethodInsn(INVOKESPECIAL, baseCls, "<init>", "()V", false);
            mv.visitVarInsn(ALOAD, 0);
            mv.visitLdcInsn("mid");
            mv.visitFieldInsn(PUTFIELD, midCls, "midField", "Ljava/lang/String;");
            mv.visitInsn(RETURN);
            mv.visitMaxs(0, 0);
            mv.visitEnd();

            cw.visitEnd();
            classes.put(midCls, cw.toByteArray());
        }

        // LeafB extends MidB
        {
            String leafCls = "test/gen/b/LeafB";
            String midCls  = "test/gen/b/MidB";
            ClassWriter cw = newCW();
            cw.visit(V21, ACC_PUBLIC | ACC_SUPER, leafCls, null, midCls, null);

            MethodVisitor init = cw.visitMethod(ACC_PUBLIC, "<init>", "()V", null, null);
            init.visitCode();
            init.visitVarInsn(ALOAD, 0);
            init.visitMethodInsn(INVOKESPECIAL, midCls, "<init>", "()V", false);
            init.visitInsn(RETURN);
            init.visitMaxs(0, 0);
            init.visitEnd();

            // implement describe()
            MethodVisitor desc = cw.visitMethod(ACC_PUBLIC, "describe", "()Ljava/lang/String;", null, null);
            desc.visitCode();
            desc.visitVarInsn(ALOAD, 0);
            desc.visitFieldInsn(GETFIELD, "test/gen/b/MidB", "midField", "Ljava/lang/String;");
            desc.visitInsn(ARETURN);
            desc.visitMaxs(0, 0);
            desc.visitEnd();

            // check()
            MethodVisitor chk = cw.visitMethod(ACC_PUBLIC | ACC_STATIC, "check", "()Ljava/lang/String;", null, null);
            chk.visitCode();
            chk.visitTypeInsn(NEW, leafCls);
            chk.visitInsn(DUP);
            chk.visitMethodInsn(INVOKESPECIAL, leafCls, "<init>", "()V", false);
            chk.visitMethodInsn(INVOKEVIRTUAL, leafCls, "describe", "()Ljava/lang/String;", false);
            // we want "ok" – but let's exercise it: compare with "mid"
            // Actually let's return "ok" via StringBuilder to exercise code
            chk.visitVarInsn(ASTORE, 0);
            chk.visitLdcInsn("ok");
            chk.visitInsn(ARETURN);
            chk.visitMaxs(0, 0);
            chk.visitEnd();

            cw.visitEnd();
            classes.put(leafCls, cw.toByteArray());
        }

        writeJar(output, "test.gen.b.LeafB", "InheritanceChain", classes);
    }

    // ─────────────────────────────────────────────────────────────────
    // Variant 3 – MultiInterface
    // ─────────────────────────────────────────────────────────────────

    private void generateMultiInterface(Path output) throws IOException {
        var classes = new LinkedHashMap<String, byte[]>();
        String pkg = "test/gen/c/";

        // Interface IA
        {
            ClassWriter cw = newCW();
            cw.visit(V21, ACC_PUBLIC | ACC_ABSTRACT | ACC_INTERFACE, pkg + "IA", null, "java/lang/Object", null);
            cw.visitMethod(ACC_PUBLIC | ACC_ABSTRACT, "doA", "()Ljava/lang/String;", null, null).visitEnd();
            cw.visitEnd();
            classes.put(pkg + "IA", cw.toByteArray());
        }

        // Interface IB
        {
            ClassWriter cw = newCW();
            cw.visit(V21, ACC_PUBLIC | ACC_ABSTRACT | ACC_INTERFACE, pkg + "IB", null, "java/lang/Object", null);
            cw.visitMethod(ACC_PUBLIC | ACC_ABSTRACT, "doB", "()I", null, null).visitEnd();
            cw.visitEnd();
            classes.put(pkg + "IB", cw.toByteArray());
        }

        // ImplC implements IA, IB
        {
            String implCls = pkg + "ImplC";
            ClassWriter cw = newCW();
            cw.visit(V21, ACC_PUBLIC | ACC_SUPER, implCls, null, "java/lang/Object",
                    new String[]{pkg + "IA", pkg + "IB"});

            MethodVisitor init = cw.visitMethod(ACC_PUBLIC, "<init>", "()V", null, null);
            init.visitCode();
            init.visitVarInsn(ALOAD, 0);
            init.visitMethodInsn(INVOKESPECIAL, "java/lang/Object", "<init>", "()V", false);
            init.visitInsn(RETURN);
            init.visitMaxs(0, 0);
            init.visitEnd();

            MethodVisitor doA = cw.visitMethod(ACC_PUBLIC, "doA", "()Ljava/lang/String;", null, null);
            doA.visitCode();
            doA.visitLdcInsn("A");
            doA.visitInsn(ARETURN);
            doA.visitMaxs(0, 0);
            doA.visitEnd();

            MethodVisitor doB = cw.visitMethod(ACC_PUBLIC, "doB", "()I", null, null);
            doB.visitCode();
            doB.visitIntInsn(BIPUSH, 42);
            doB.visitInsn(IRETURN);
            doB.visitMaxs(0, 0);
            doB.visitEnd();

            MethodVisitor chk = cw.visitMethod(ACC_PUBLIC | ACC_STATIC, "check", "()Ljava/lang/String;", null, null);
            chk.visitCode();
            chk.visitTypeInsn(NEW, implCls);
            chk.visitInsn(DUP);
            chk.visitMethodInsn(INVOKESPECIAL, implCls, "<init>", "()V", false);
            chk.visitVarInsn(ASTORE, 0);
            chk.visitVarInsn(ALOAD, 0);
            chk.visitMethodInsn(INVOKEVIRTUAL, implCls, "doA", "()Ljava/lang/String;", false);
            chk.visitVarInsn(ASTORE, 1);
            chk.visitVarInsn(ALOAD, 0);
            chk.visitMethodInsn(INVOKEVIRTUAL, implCls, "doB", "()I", false);
            chk.visitVarInsn(ISTORE, 2);
            chk.visitLdcInsn("ok");
            chk.visitInsn(ARETURN);
            chk.visitMaxs(0, 0);
            chk.visitEnd();

            cw.visitEnd();
            classes.put(implCls, cw.toByteArray());
        }

        writeJar(output, "test.gen.c.ImplC", "MultiInterface", classes);
    }

    // ─────────────────────────────────────────────────────────────────
    // Variant 4 – EnumVariant
    // ─────────────────────────────────────────────────────────────────

    private void generateEnumVariant(Path output) throws IOException {
        var classes = new LinkedHashMap<String, byte[]>();
        String enumCls = "test/gen/d/ColorEnum";
        String[] values = {"RED", "GREEN", "BLUE"};

        ClassWriter cw = newCW();
        cw.visit(V21, ACC_PUBLIC | ACC_FINAL | ACC_SUPER | ACC_ENUM, enumCls,
                "Ljava/lang/Enum<L" + enumCls + ";>;", "java/lang/Enum", null);

        // ordinal fields for each constant
        for (String v : values) {
            cw.visitField(ACC_PUBLIC | ACC_STATIC | ACC_FINAL | ACC_ENUM, v,
                    "L" + enumCls + ";", null, null).visitEnd();
        }
        // $VALUES
        cw.visitField(ACC_PRIVATE | ACC_STATIC | ACC_FINAL | ACC_SYNTHETIC, "$VALUES",
                "[L" + enumCls + ";", null, null).visitEnd();

        // <clinit>
        {
            MethodVisitor mv = cw.visitMethod(ACC_STATIC, "<clinit>", "()V", null, null);
            mv.visitCode();
            for (int i = 0; i < values.length; i++) {
                mv.visitTypeInsn(NEW, enumCls);
                mv.visitInsn(DUP);
                mv.visitLdcInsn(values[i]);
                mv.visitIntInsn(BIPUSH, i);
                mv.visitMethodInsn(INVOKESPECIAL, enumCls, "<init>", "(Ljava/lang/String;I)V", false);
                mv.visitFieldInsn(PUTSTATIC, enumCls, values[i], "L" + enumCls + ";");
            }
            // build $VALUES
            mv.visitIntInsn(BIPUSH, values.length);
            mv.visitTypeInsn(ANEWARRAY, enumCls);
            for (int i = 0; i < values.length; i++) {
                mv.visitInsn(DUP);
                mv.visitIntInsn(BIPUSH, i);
                mv.visitFieldInsn(GETSTATIC, enumCls, values[i], "L" + enumCls + ";");
                mv.visitInsn(AASTORE);
            }
            mv.visitFieldInsn(PUTSTATIC, enumCls, "$VALUES", "[L" + enumCls + ";");
            mv.visitInsn(RETURN);
            mv.visitMaxs(0, 0);
            mv.visitEnd();
        }

        // private <init>
        {
            MethodVisitor mv = cw.visitMethod(ACC_PRIVATE, "<init>", "(Ljava/lang/String;I)V", null, null);
            mv.visitCode();
            mv.visitVarInsn(ALOAD, 0);
            mv.visitVarInsn(ALOAD, 1);
            mv.visitVarInsn(ILOAD, 2);
            mv.visitMethodInsn(INVOKESPECIAL, "java/lang/Enum", "<init>", "(Ljava/lang/String;I)V", false);
            mv.visitInsn(RETURN);
            mv.visitMaxs(0, 0);
            mv.visitEnd();
        }

        // values()
        {
            MethodVisitor mv = cw.visitMethod(ACC_PUBLIC | ACC_STATIC, "values",
                    "()[L" + enumCls + ";", null, null);
            mv.visitCode();
            mv.visitFieldInsn(GETSTATIC, enumCls, "$VALUES", "[L" + enumCls + ";");
            mv.visitMethodInsn(INVOKEVIRTUAL, "[L" + enumCls + ";", "clone", "()Ljava/lang/Object;", false);
            mv.visitTypeInsn(CHECKCAST, "[L" + enumCls + ";");
            mv.visitInsn(ARETURN);
            mv.visitMaxs(0, 0);
            mv.visitEnd();
        }

        // valueOf(String)
        {
            MethodVisitor mv = cw.visitMethod(ACC_PUBLIC | ACC_STATIC, "valueOf",
                    "(Ljava/lang/String;)L" + enumCls + ";", null, null);
            mv.visitCode();
            mv.visitLdcInsn(Type.getType("L" + enumCls + ";"));
            mv.visitVarInsn(ALOAD, 0);
            mv.visitMethodInsn(INVOKESTATIC, "java/lang/Enum", "valueOf",
                    "(Ljava/lang/Class;Ljava/lang/String;)Ljava/lang/Enum;", false);
            mv.visitTypeInsn(CHECKCAST, enumCls);
            mv.visitInsn(ARETURN);
            mv.visitMaxs(0, 0);
            mv.visitEnd();
        }

        // getName()
        {
            MethodVisitor mv = cw.visitMethod(ACC_PUBLIC, "getName", "()Ljava/lang/String;", null, null);
            mv.visitCode();
            mv.visitVarInsn(ALOAD, 0);
            mv.visitMethodInsn(INVOKEVIRTUAL, enumCls, "name", "()Ljava/lang/String;", false);
            mv.visitInsn(ARETURN);
            mv.visitMaxs(0, 0);
            mv.visitEnd();
        }

        // check()
        {
            MethodVisitor mv = cw.visitMethod(ACC_PUBLIC | ACC_STATIC, "check", "()Ljava/lang/String;", null, null);
            mv.visitCode();
            mv.visitFieldInsn(GETSTATIC, enumCls, "GREEN", "L" + enumCls + ";");
            mv.visitMethodInsn(INVOKEVIRTUAL, enumCls, "getName", "()Ljava/lang/String;", false);
            mv.visitVarInsn(ASTORE, 0);
            mv.visitLdcInsn("ok");
            mv.visitInsn(ARETURN);
            mv.visitMaxs(0, 0);
            mv.visitEnd();
        }

        cw.visitEnd();
        classes.put(enumCls, cw.toByteArray());
        writeJar(output, "test.gen.d.ColorEnum", "EnumVariant", classes);
    }

    // ─────────────────────────────────────────────────────────────────
    // Variant 5 – AnnotationType
    // ─────────────────────────────────────────────────────────────────

    private void generateAnnotationType(Path output) throws IOException {
        var classes = new LinkedHashMap<String, byte[]>();
        String annCls = "test/gen/e/MyAnnotation";
        String useCls = "test/gen/e/AnnotatedClass";

        // @interface MyAnnotation
        {
            ClassWriter cw = newCW();
            cw.visit(V21, ACC_PUBLIC | ACC_ABSTRACT | ACC_INTERFACE | ACC_ANNOTATION, annCls,
                    null, "java/lang/Object", new String[]{"java/lang/annotation/Annotation"});

            // @Retention(RUNTIME)
            AnnotationVisitor av = cw.visitAnnotation("Ljava/lang/annotation/Retention;", true);
            av.visitEnum("value", "Ljava/lang/annotation/RetentionPolicy;", "RUNTIME");
            av.visitEnd();

            // String value() default "default"
            MethodVisitor mv = cw.visitMethod(ACC_PUBLIC | ACC_ABSTRACT, "value", "()Ljava/lang/String;", null, null);
            mv.visitAnnotationDefault().visit(null, "default");
            mv.visitEnd();

            cw.visitEnd();
            classes.put(annCls, cw.toByteArray());
        }

        // AnnotatedClass
        {
            ClassWriter cw = newCW();
            cw.visit(V21, ACC_PUBLIC | ACC_SUPER, useCls, null, "java/lang/Object", null);

            // @MyAnnotation("ok") on the class
            AnnotationVisitor av = cw.visitAnnotation("L" + annCls + ";", true);
            av.visit("value", "ok");
            av.visitEnd();

            MethodVisitor init = cw.visitMethod(ACC_PUBLIC, "<init>", "()V", null, null);
            init.visitCode();
            init.visitVarInsn(ALOAD, 0);
            init.visitMethodInsn(INVOKESPECIAL, "java/lang/Object", "<init>", "()V", false);
            init.visitInsn(RETURN);
            init.visitMaxs(0, 0);
            init.visitEnd();

            // check() – read annotation via reflection
            MethodVisitor mv = cw.visitMethod(ACC_PUBLIC | ACC_STATIC, "check", "()Ljava/lang/String;", null, null);
            mv.visitCode();
            // AnnotatedClass.class.getAnnotation(MyAnnotation.class).value()
            mv.visitLdcInsn(Type.getType("L" + useCls + ";"));
            mv.visitLdcInsn(Type.getType("L" + annCls + ";"));
            mv.visitMethodInsn(INVOKEVIRTUAL, "java/lang/Class", "getAnnotation",
                    "(Ljava/lang/Class;)Ljava/lang/annotation/Annotation;", false);
            mv.visitTypeInsn(CHECKCAST, annCls);
            mv.visitMethodInsn(INVOKEINTERFACE, annCls, "value", "()Ljava/lang/String;", true);
            mv.visitInsn(ARETURN);
            mv.visitMaxs(0, 0);
            mv.visitEnd();

            cw.visitEnd();
            classes.put(useCls, cw.toByteArray());
        }

        writeJar(output, "test.gen.e.AnnotatedClass", "AnnotationType", classes);
    }

    // ─────────────────────────────────────────────────────────────────
    // Variant 6 – LambdaAndStream
    // ─────────────────────────────────────────────────────────────────

    private void generateLambdaAndStream(Path output) throws IOException {
        var classes = new LinkedHashMap<String, byte[]>();
        String cls = "test/gen/f/LambdaClass";

        ClassWriter cw = newCW();
        cw.visit(V21, ACC_PUBLIC | ACC_SUPER, cls, null, "java/lang/Object", null);

        // default constructor
        {
            MethodVisitor mv = cw.visitMethod(ACC_PUBLIC, "<init>", "()V", null, null);
            mv.visitCode();
            mv.visitVarInsn(ALOAD, 0);
            mv.visitMethodInsn(INVOKESPECIAL, "java/lang/Object", "<init>", "()V", false);
            mv.visitInsn(RETURN);
            mv.visitMaxs(0, 0);
            mv.visitEnd();
        }

        // lambda$run$0 – synthetic method for Runnable lambda body
        {
            MethodVisitor mv = cw.visitMethod(ACC_PRIVATE | ACC_STATIC | ACC_SYNTHETIC,
                    "lambda$run$0", "()V", null, null);
            mv.visitCode();
            mv.visitFieldInsn(GETSTATIC, "java/lang/System", "out", "Ljava/io/PrintStream;");
            mv.visitLdcInsn("lambda run");
            mv.visitMethodInsn(INVOKEVIRTUAL, "java/io/PrintStream", "println", "(Ljava/lang/String;)V", false);
            mv.visitInsn(RETURN);
            mv.visitMaxs(0, 0);
            mv.visitEnd();
        }

        // lambda$supply$1 – synthetic method for Supplier lambda body
        {
            MethodVisitor mv = cw.visitMethod(ACC_PRIVATE | ACC_STATIC | ACC_SYNTHETIC,
                    "lambda$supply$1", "()Ljava/lang/Object;", null, null);
            mv.visitCode();
            mv.visitLdcInsn("supplied");
            mv.visitInsn(ARETURN);
            mv.visitMaxs(0, 0);
            mv.visitEnd();
        }

        // runLambda() – creates Runnable via INVOKEDYNAMIC
        {
            MethodVisitor mv = cw.visitMethod(ACC_PUBLIC | ACC_STATIC, "runLambda", "()V", null, null);
            mv.visitCode();

            Handle metaFactory = new Handle(H_INVOKESTATIC,
                    "java/lang/invoke/LambdaMetafactory", "metafactory",
                    "(Ljava/lang/invoke/MethodHandles$Lookup;" +
                    "Ljava/lang/String;" +
                    "Ljava/lang/invoke/MethodType;" +
                    "Ljava/lang/invoke/MethodType;" +
                    "Ljava/lang/invoke/MethodHandle;" +
                    "Ljava/lang/invoke/MethodType;)" +
                    "Ljava/lang/invoke/CallSite;", false);

            Handle implHandle = new Handle(H_INVOKESTATIC, cls, "lambda$run$0", "()V", false);

            mv.visitInvokeDynamicInsn("run",
                    "()Ljava/lang/Runnable;",
                    metaFactory,
                    Type.getMethodType("()V"),
                    implHandle,
                    Type.getMethodType("()V"));

            mv.visitMethodInsn(INVOKEINTERFACE, "java/lang/Runnable", "run", "()V", true);
            mv.visitInsn(RETURN);
            mv.visitMaxs(0, 0);
            mv.visitEnd();
        }

        // supplyLambda() – Supplier via INVOKEDYNAMIC
        {
            MethodVisitor mv = cw.visitMethod(ACC_PUBLIC | ACC_STATIC, "supplyLambda", "()Ljava/lang/String;", null, null);
            mv.visitCode();

            Handle metaFactory = new Handle(H_INVOKESTATIC,
                    "java/lang/invoke/LambdaMetafactory", "metafactory",
                    "(Ljava/lang/invoke/MethodHandles$Lookup;" +
                    "Ljava/lang/String;" +
                    "Ljava/lang/invoke/MethodType;" +
                    "Ljava/lang/invoke/MethodType;" +
                    "Ljava/lang/invoke/MethodHandle;" +
                    "Ljava/lang/invoke/MethodType;)" +
                    "Ljava/lang/invoke/CallSite;", false);

            Handle implHandle = new Handle(H_INVOKESTATIC, cls, "lambda$supply$1", "()Ljava/lang/Object;", false);

            mv.visitInvokeDynamicInsn("get",
                    "()Ljava/util/function/Supplier;",
                    metaFactory,
                    Type.getMethodType("()Ljava/lang/Object;"),
                    implHandle,
                    Type.getMethodType("()Ljava/lang/Object;"));

            mv.visitMethodInsn(INVOKEINTERFACE, "java/util/function/Supplier", "get", "()Ljava/lang/Object;", true);
            mv.visitTypeInsn(CHECKCAST, "java/lang/String");
            mv.visitInsn(ARETURN);
            mv.visitMaxs(0, 0);
            mv.visitEnd();
        }

        // concat using string concatenation INVOKEDYNAMIC
        {
            MethodVisitor mv = cw.visitMethod(ACC_PUBLIC | ACC_STATIC, "concat",
                    "(Ljava/lang/String;Ljava/lang/String;)Ljava/lang/String;", null, null);
            mv.visitCode();
            // Use StringBuilder approach since makeConcatWithConstants needs specific bootstrap
            mv.visitTypeInsn(NEW, "java/lang/StringBuilder");
            mv.visitInsn(DUP);
            mv.visitMethodInsn(INVOKESPECIAL, "java/lang/StringBuilder", "<init>", "()V", false);
            mv.visitVarInsn(ALOAD, 0);
            mv.visitMethodInsn(INVOKEVIRTUAL, "java/lang/StringBuilder", "append",
                    "(Ljava/lang/String;)Ljava/lang/StringBuilder;", false);
            mv.visitVarInsn(ALOAD, 1);
            mv.visitMethodInsn(INVOKEVIRTUAL, "java/lang/StringBuilder", "append",
                    "(Ljava/lang/String;)Ljava/lang/StringBuilder;", false);
            mv.visitMethodInsn(INVOKEVIRTUAL, "java/lang/StringBuilder", "toString", "()Ljava/lang/String;", false);
            mv.visitInsn(ARETURN);
            mv.visitMaxs(0, 0);
            mv.visitEnd();
        }

        // check()
        {
            MethodVisitor mv = cw.visitMethod(ACC_PUBLIC | ACC_STATIC, "check", "()Ljava/lang/String;", null, null);
            mv.visitCode();
            mv.visitMethodInsn(INVOKESTATIC, cls, "runLambda", "()V", false);
            mv.visitMethodInsn(INVOKESTATIC, cls, "supplyLambda", "()Ljava/lang/String;", false);
            mv.visitVarInsn(ASTORE, 0);
            mv.visitLdcInsn("o");
            mv.visitLdcInsn("k");
            mv.visitMethodInsn(INVOKESTATIC, cls, "concat",
                    "(Ljava/lang/String;Ljava/lang/String;)Ljava/lang/String;", false);
            mv.visitInsn(ARETURN);
            mv.visitMaxs(0, 0);
            mv.visitEnd();
        }

        cw.visitEnd();
        classes.put(cls, cw.toByteArray());
        writeJar(output, "test.gen.f.LambdaClass", "LambdaAndStream", classes);
    }

    // ─────────────────────────────────────────────────────────────────
    // Variant 7 – StaticInnerClass
    // ─────────────────────────────────────────────────────────────────

    private void generateStaticInnerClass(Path output) throws IOException {
        var classes = new LinkedHashMap<String, byte[]>();
        String outerCls = "test/gen/g/OuterG";
        String staticInner = "test/gen/g/OuterG$StaticInner";
        String innerCls = "test/gen/g/OuterG$Inner";

        // Outer class
        {
            ClassWriter cw = newCW();
            cw.visit(V21, ACC_PUBLIC | ACC_SUPER, outerCls, null, "java/lang/Object", null);
            cw.visitField(ACC_PRIVATE, "outerField", "I", null, null).visitEnd();

            cw.visitInnerClass(staticInner, outerCls, "StaticInner", ACC_PUBLIC | ACC_STATIC);
            cw.visitInnerClass(innerCls, outerCls, "Inner", ACC_PUBLIC);

            MethodVisitor init = cw.visitMethod(ACC_PUBLIC, "<init>", "(I)V", null, null);
            init.visitCode();
            init.visitVarInsn(ALOAD, 0);
            init.visitMethodInsn(INVOKESPECIAL, "java/lang/Object", "<init>", "()V", false);
            init.visitVarInsn(ALOAD, 0);
            init.visitVarInsn(ILOAD, 1);
            init.visitFieldInsn(PUTFIELD, outerCls, "outerField", "I");
            init.visitInsn(RETURN);
            init.visitMaxs(0, 0);
            init.visitEnd();

            MethodVisitor chk = cw.visitMethod(ACC_PUBLIC | ACC_STATIC, "check", "()Ljava/lang/String;", null, null);
            chk.visitCode();
            chk.visitTypeInsn(NEW, staticInner);
            chk.visitInsn(DUP);
            chk.visitLdcInsn("hello");
            chk.visitMethodInsn(INVOKESPECIAL, staticInner, "<init>", "(Ljava/lang/String;)V", false);
            chk.visitMethodInsn(INVOKEVIRTUAL, staticInner, "greet", "()Ljava/lang/String;", false);
            chk.visitVarInsn(ASTORE, 0);
            chk.visitLdcInsn("ok");
            chk.visitInsn(ARETURN);
            chk.visitMaxs(0, 0);
            chk.visitEnd();

            cw.visitEnd();
            classes.put(outerCls, cw.toByteArray());
        }

        // StaticInner
        {
            ClassWriter cw = newCW();
            cw.visit(V21, ACC_PUBLIC | ACC_SUPER, staticInner, null, "java/lang/Object", null);
            cw.visitInnerClass(staticInner, outerCls, "StaticInner", ACC_PUBLIC | ACC_STATIC);
            cw.visitField(ACC_PRIVATE, "msg", "Ljava/lang/String;", null, null).visitEnd();

            MethodVisitor init = cw.visitMethod(ACC_PUBLIC, "<init>", "(Ljava/lang/String;)V", null, null);
            init.visitCode();
            init.visitVarInsn(ALOAD, 0);
            init.visitMethodInsn(INVOKESPECIAL, "java/lang/Object", "<init>", "()V", false);
            init.visitVarInsn(ALOAD, 0);
            init.visitVarInsn(ALOAD, 1);
            init.visitFieldInsn(PUTFIELD, staticInner, "msg", "Ljava/lang/String;");
            init.visitInsn(RETURN);
            init.visitMaxs(0, 0);
            init.visitEnd();

            MethodVisitor greet = cw.visitMethod(ACC_PUBLIC, "greet", "()Ljava/lang/String;", null, null);
            greet.visitCode();
            greet.visitVarInsn(ALOAD, 0);
            greet.visitFieldInsn(GETFIELD, staticInner, "msg", "Ljava/lang/String;");
            greet.visitInsn(ARETURN);
            greet.visitMaxs(0, 0);
            greet.visitEnd();

            cw.visitEnd();
            classes.put(staticInner, cw.toByteArray());
        }

        // Inner (non-static)
        {
            ClassWriter cw = newCW();
            cw.visit(V21, ACC_PUBLIC | ACC_SUPER, innerCls, null, "java/lang/Object", null);
            cw.visitInnerClass(innerCls, outerCls, "Inner", ACC_PUBLIC);
            cw.visitField(ACC_FINAL | ACC_SYNTHETIC, "this$0", "L" + outerCls + ";", null, null).visitEnd();
            cw.visitField(ACC_PRIVATE, "innerData", "Ljava/lang/String;", null, null).visitEnd();

            MethodVisitor init = cw.visitMethod(ACC_PUBLIC, "<init>", "(L" + outerCls + ";Ljava/lang/String;)V", null, null);
            init.visitCode();
            init.visitVarInsn(ALOAD, 0);
            init.visitMethodInsn(INVOKESPECIAL, "java/lang/Object", "<init>", "()V", false);
            init.visitVarInsn(ALOAD, 0);
            init.visitVarInsn(ALOAD, 1);
            init.visitFieldInsn(PUTFIELD, innerCls, "this$0", "L" + outerCls + ";");
            init.visitVarInsn(ALOAD, 0);
            init.visitVarInsn(ALOAD, 2);
            init.visitFieldInsn(PUTFIELD, innerCls, "innerData", "Ljava/lang/String;");
            init.visitInsn(RETURN);
            init.visitMaxs(0, 0);
            init.visitEnd();

            MethodVisitor getData = cw.visitMethod(ACC_PUBLIC, "getData", "()Ljava/lang/String;", null, null);
            getData.visitCode();
            getData.visitVarInsn(ALOAD, 0);
            getData.visitFieldInsn(GETFIELD, innerCls, "innerData", "Ljava/lang/String;");
            getData.visitInsn(ARETURN);
            getData.visitMaxs(0, 0);
            getData.visitEnd();

            cw.visitEnd();
            classes.put(innerCls, cw.toByteArray());
        }

        writeJar(output, "test.gen.g.OuterG", "StaticInnerClass", classes);
    }

    // ─────────────────────────────────────────────────────────────────
    // Variant 8 – RecordVariant
    // ─────────────────────────────────────────────────────────────────

    private void generateRecordVariant(Path output) throws IOException {
        var classes = new LinkedHashMap<String, byte[]>();
        String recCls = "test/gen/h/PersonRecord";

        ClassWriter cw = newCW();
        // Records use V16+; we'll use V17
        cw.visit(V17, ACC_PUBLIC | ACC_FINAL | ACC_SUPER, recCls,
                null, "java/lang/Record", null);

        // Record components
        RecordComponentVisitor rcName = cw.visitRecordComponent("name", "Ljava/lang/String;", null);
        rcName.visitEnd();
        RecordComponentVisitor rcAge = cw.visitRecordComponent("age", "I", null);
        rcAge.visitEnd();

        // fields
        cw.visitField(ACC_PRIVATE | ACC_FINAL, "name", "Ljava/lang/String;", null, null).visitEnd();
        cw.visitField(ACC_PRIVATE | ACC_FINAL, "age", "I", null, null).visitEnd();

        // canonical constructor
        {
            MethodVisitor mv = cw.visitMethod(ACC_PUBLIC, "<init>", "(Ljava/lang/String;I)V", null, null);
            mv.visitCode();
            mv.visitVarInsn(ALOAD, 0);
            mv.visitMethodInsn(INVOKESPECIAL, "java/lang/Record", "<init>", "()V", false);
            mv.visitVarInsn(ALOAD, 0);
            mv.visitVarInsn(ALOAD, 1);
            mv.visitFieldInsn(PUTFIELD, recCls, "name", "Ljava/lang/String;");
            mv.visitVarInsn(ALOAD, 0);
            mv.visitVarInsn(ILOAD, 2);
            mv.visitFieldInsn(PUTFIELD, recCls, "age", "I");
            mv.visitInsn(RETURN);
            mv.visitMaxs(0, 0);
            mv.visitEnd();
        }

        // accessors
        {
            MethodVisitor mv = cw.visitMethod(ACC_PUBLIC, "name", "()Ljava/lang/String;", null, null);
            mv.visitCode();
            mv.visitVarInsn(ALOAD, 0);
            mv.visitFieldInsn(GETFIELD, recCls, "name", "Ljava/lang/String;");
            mv.visitInsn(ARETURN);
            mv.visitMaxs(0, 0);
            mv.visitEnd();
        }
        {
            MethodVisitor mv = cw.visitMethod(ACC_PUBLIC, "age", "()I", null, null);
            mv.visitCode();
            mv.visitVarInsn(ALOAD, 0);
            mv.visitFieldInsn(GETFIELD, recCls, "age", "I");
            mv.visitInsn(IRETURN);
            mv.visitMaxs(0, 0);
            mv.visitEnd();
        }

        // toString
        {
            MethodVisitor mv = cw.visitMethod(ACC_PUBLIC, "toString", "()Ljava/lang/String;", null, null);
            mv.visitCode();
            mv.visitTypeInsn(NEW, "java/lang/StringBuilder");
            mv.visitInsn(DUP);
            mv.visitMethodInsn(INVOKESPECIAL, "java/lang/StringBuilder", "<init>", "()V", false);
            mv.visitLdcInsn("PersonRecord[name=");
            mv.visitMethodInsn(INVOKEVIRTUAL, "java/lang/StringBuilder", "append",
                    "(Ljava/lang/String;)Ljava/lang/StringBuilder;", false);
            mv.visitVarInsn(ALOAD, 0);
            mv.visitFieldInsn(GETFIELD, recCls, "name", "Ljava/lang/String;");
            mv.visitMethodInsn(INVOKEVIRTUAL, "java/lang/StringBuilder", "append",
                    "(Ljava/lang/String;)Ljava/lang/StringBuilder;", false);
            mv.visitLdcInsn(", age=");
            mv.visitMethodInsn(INVOKEVIRTUAL, "java/lang/StringBuilder", "append",
                    "(Ljava/lang/String;)Ljava/lang/StringBuilder;", false);
            mv.visitVarInsn(ALOAD, 0);
            mv.visitFieldInsn(GETFIELD, recCls, "age", "I");
            mv.visitMethodInsn(INVOKEVIRTUAL, "java/lang/StringBuilder", "append",
                    "(I)Ljava/lang/StringBuilder;", false);
            mv.visitLdcInsn("]");
            mv.visitMethodInsn(INVOKEVIRTUAL, "java/lang/StringBuilder", "append",
                    "(Ljava/lang/String;)Ljava/lang/StringBuilder;", false);
            mv.visitMethodInsn(INVOKEVIRTUAL, "java/lang/StringBuilder", "toString", "()Ljava/lang/String;", false);
            mv.visitInsn(ARETURN);
            mv.visitMaxs(0, 0);
            mv.visitEnd();
        }

        // hashCode, equals (minimal)
        {
            MethodVisitor mv = cw.visitMethod(ACC_PUBLIC, "hashCode", "()I", null, null);
            mv.visitCode();
            mv.visitVarInsn(ALOAD, 0);
            mv.visitFieldInsn(GETFIELD, recCls, "age", "I");
            mv.visitInsn(IRETURN);
            mv.visitMaxs(0, 0);
            mv.visitEnd();
        }
        {
            MethodVisitor mv = cw.visitMethod(ACC_PUBLIC, "equals", "(Ljava/lang/Object;)Z", null, null);
            mv.visitCode();
            mv.visitVarInsn(ALOAD, 0);
            mv.visitVarInsn(ALOAD, 1);
            Label notSame = new Label();
            mv.visitJumpInsn(IF_ACMPNE, notSame);
            mv.visitInsn(ICONST_1);
            mv.visitInsn(IRETURN);
            mv.visitLabel(notSame);
            mv.visitInsn(ICONST_0);
            mv.visitInsn(IRETURN);
            mv.visitMaxs(0, 0);
            mv.visitEnd();
        }

        // check()
        {
            MethodVisitor mv = cw.visitMethod(ACC_PUBLIC | ACC_STATIC, "check", "()Ljava/lang/String;", null, null);
            mv.visitCode();
            mv.visitTypeInsn(NEW, recCls);
            mv.visitInsn(DUP);
            mv.visitLdcInsn("Alice");
            mv.visitIntInsn(BIPUSH, 30);
            mv.visitMethodInsn(INVOKESPECIAL, recCls, "<init>", "(Ljava/lang/String;I)V", false);
            mv.visitMethodInsn(INVOKEVIRTUAL, recCls, "name", "()Ljava/lang/String;", false);
            mv.visitVarInsn(ASTORE, 0);
            mv.visitLdcInsn("ok");
            mv.visitInsn(ARETURN);
            mv.visitMaxs(0, 0);
            mv.visitEnd();
        }

        cw.visitEnd();
        classes.put(recCls, cw.toByteArray());
        writeJar(output, "test.gen.h.PersonRecord", "RecordVariant", classes);
    }

    // ─────────────────────────────────────────────────────────────────
    // Variant 9 – TryCatchFinally
    // ─────────────────────────────────────────────────────────────────

    private void generateTryCatchFinally(Path output) throws IOException {
        var classes = new LinkedHashMap<String, byte[]>();
        String cls = "test/gen/i/TryCatchClass";

        ClassWriter cw = newCW();
        cw.visit(V21, ACC_PUBLIC | ACC_SUPER, cls, null, "java/lang/Object", null);

        // default constructor
        {
            MethodVisitor mv = cw.visitMethod(ACC_PUBLIC, "<init>", "()V", null, null);
            mv.visitCode();
            mv.visitVarInsn(ALOAD, 0);
            mv.visitMethodInsn(INVOKESPECIAL, "java/lang/Object", "<init>", "()V", false);
            mv.visitInsn(RETURN);
            mv.visitMaxs(0, 0);
            mv.visitEnd();
        }

        // tryCatch() – basic try-catch
        {
            MethodVisitor mv = cw.visitMethod(ACC_PUBLIC | ACC_STATIC, "tryCatch", "()Ljava/lang/String;", null, null);
            mv.visitCode();
            Label tryStart = new Label(), tryEnd = new Label(), catchStart = new Label(), after = new Label();
            mv.visitTryCatchBlock(tryStart, tryEnd, catchStart, "java/lang/Exception");
            mv.visitLabel(tryStart);
            mv.visitLdcInsn("try");
            mv.visitVarInsn(ASTORE, 0);
            mv.visitLabel(tryEnd);
            mv.visitJumpInsn(GOTO, after);
            mv.visitLabel(catchStart);
            mv.visitVarInsn(ASTORE, 1);
            mv.visitLdcInsn("catch");
            mv.visitVarInsn(ASTORE, 0);
            mv.visitLabel(after);
            mv.visitVarInsn(ALOAD, 0);
            mv.visitInsn(ARETURN);
            mv.visitMaxs(0, 0);
            mv.visitEnd();
        }

        // multiCatch() – multi-catch
        {
            MethodVisitor mv = cw.visitMethod(ACC_PUBLIC | ACC_STATIC, "multiCatch", "(I)Ljava/lang/String;", null, null);
            mv.visitCode();
            Label tryStart = new Label(), tryEnd = new Label();
            Label catchNPE = new Label(), catchIAE = new Label(), after = new Label();
            mv.visitTryCatchBlock(tryStart, tryEnd, catchNPE, "java/lang/NullPointerException");
            mv.visitTryCatchBlock(tryStart, tryEnd, catchIAE, "java/lang/IllegalArgumentException");
            mv.visitLabel(tryStart);
            mv.visitVarInsn(ILOAD, 0);
            Label notZero = new Label();
            mv.visitJumpInsn(IFNE, notZero);
            mv.visitTypeInsn(NEW, "java/lang/NullPointerException");
            mv.visitInsn(DUP);
            mv.visitMethodInsn(INVOKESPECIAL, "java/lang/NullPointerException", "<init>", "()V", false);
            mv.visitInsn(ATHROW);
            mv.visitLabel(notZero);
            mv.visitTypeInsn(NEW, "java/lang/IllegalArgumentException");
            mv.visitInsn(DUP);
            mv.visitMethodInsn(INVOKESPECIAL, "java/lang/IllegalArgumentException", "<init>", "()V", false);
            mv.visitInsn(ATHROW);
            mv.visitLabel(tryEnd);
            mv.visitLabel(catchNPE);
            mv.visitVarInsn(ASTORE, 1);
            mv.visitLdcInsn("npe");
            mv.visitInsn(ARETURN);
            mv.visitLabel(catchIAE);
            mv.visitVarInsn(ASTORE, 1);
            mv.visitLdcInsn("iae");
            mv.visitInsn(ARETURN);
            mv.visitLabel(after);
            mv.visitLdcInsn("none");
            mv.visitInsn(ARETURN);
            mv.visitMaxs(0, 0);
            mv.visitEnd();
        }

        // tryFinally() – try-finally
        {
            MethodVisitor mv = cw.visitMethod(ACC_PUBLIC | ACC_STATIC, "tryFinally", "()Ljava/lang/String;", null, null);
            mv.visitCode();
            Label tryStart = new Label(), tryEnd = new Label(), finallyStart = new Label(), after = new Label();
            mv.visitTryCatchBlock(tryStart, tryEnd, finallyStart, null);
            mv.visitLabel(tryStart);
            mv.visitLdcInsn("result");
            mv.visitVarInsn(ASTORE, 0);
            mv.visitLabel(tryEnd);
            // finally inline
            mv.visitFieldInsn(GETSTATIC, "java/lang/System", "out", "Ljava/io/PrintStream;");
            mv.visitLdcInsn("finally");
            mv.visitMethodInsn(INVOKEVIRTUAL, "java/io/PrintStream", "println", "(Ljava/lang/String;)V", false);
            mv.visitVarInsn(ALOAD, 0);
            mv.visitInsn(ARETURN);
            mv.visitLabel(finallyStart);
            mv.visitVarInsn(ASTORE, 1);
            mv.visitFieldInsn(GETSTATIC, "java/lang/System", "out", "Ljava/io/PrintStream;");
            mv.visitLdcInsn("finally-ex");
            mv.visitMethodInsn(INVOKEVIRTUAL, "java/io/PrintStream", "println", "(Ljava/lang/String;)V", false);
            mv.visitVarInsn(ALOAD, 1);
            mv.visitInsn(ATHROW);
            mv.visitMaxs(0, 0);
            mv.visitEnd();
        }

        // check()
        {
            MethodVisitor mv = cw.visitMethod(ACC_PUBLIC | ACC_STATIC, "check", "()Ljava/lang/String;", null, null);
            mv.visitCode();
            mv.visitMethodInsn(INVOKESTATIC, cls, "tryCatch", "()Ljava/lang/String;", false);
            mv.visitVarInsn(ASTORE, 0);
            mv.visitInsn(ICONST_1);
            mv.visitMethodInsn(INVOKESTATIC, cls, "multiCatch", "(I)Ljava/lang/String;", false);
            mv.visitVarInsn(ASTORE, 1);
            mv.visitMethodInsn(INVOKESTATIC, cls, "tryFinally", "()Ljava/lang/String;", false);
            mv.visitVarInsn(ASTORE, 2);
            mv.visitLdcInsn("ok");
            mv.visitInsn(ARETURN);
            mv.visitMaxs(0, 0);
            mv.visitEnd();
        }

        cw.visitEnd();
        classes.put(cls, cw.toByteArray());
        writeJar(output, "test.gen.i.TryCatchClass", "TryCatchFinally", classes);
    }

    // ─────────────────────────────────────────────────────────────────
    // Variant 10 – SwitchExpr
    // ─────────────────────────────────────────────────────────────────

    private void generateSwitchExpr(Path output) throws IOException {
        var classes = new LinkedHashMap<String, byte[]>();
        String cls = "test/gen/j/SwitchClass";

        ClassWriter cw = newCW();
        cw.visit(V21, ACC_PUBLIC | ACC_SUPER, cls, null, "java/lang/Object", null);

        {
            MethodVisitor mv = cw.visitMethod(ACC_PUBLIC, "<init>", "()V", null, null);
            mv.visitCode();
            mv.visitVarInsn(ALOAD, 0);
            mv.visitMethodInsn(INVOKESPECIAL, "java/lang/Object", "<init>", "()V", false);
            mv.visitInsn(RETURN);
            mv.visitMaxs(0, 0);
            mv.visitEnd();
        }

        // switchOnInt(int) – uses TABLESWITCH
        {
            MethodVisitor mv = cw.visitMethod(ACC_PUBLIC | ACC_STATIC, "switchOnInt",
                    "(I)Ljava/lang/String;", null, null);
            mv.visitCode();
            mv.visitVarInsn(ILOAD, 0);
            Label case0 = new Label(), case1 = new Label(), case2 = new Label(), def = new Label();
            mv.visitTableSwitchInsn(0, 2, def, case0, case1, case2);
            mv.visitLabel(case0);
            mv.visitLdcInsn("zero");
            mv.visitInsn(ARETURN);
            mv.visitLabel(case1);
            mv.visitLdcInsn("one");
            mv.visitInsn(ARETURN);
            mv.visitLabel(case2);
            mv.visitLdcInsn("two");
            mv.visitInsn(ARETURN);
            mv.visitLabel(def);
            mv.visitLdcInsn("other");
            mv.visitInsn(ARETURN);
            mv.visitMaxs(0, 0);
            mv.visitEnd();
        }

        // switchOnString(String) – uses LOOKUPSWITCH after hashCode
        {
            MethodVisitor mv = cw.visitMethod(ACC_PUBLIC | ACC_STATIC, "switchOnString",
                    "(Ljava/lang/String;)I", null, null);
            mv.visitCode();
            mv.visitVarInsn(ALOAD, 0);
            mv.visitMethodInsn(INVOKEVIRTUAL, "java/lang/String", "hashCode", "()I", false);
            // hash of "a"=97, "b"=98, "c"=99
            Label caseA = new Label(), caseB = new Label(), caseC = new Label(), def = new Label(), after = new Label();
            Label eq1 = new Label(), eq2 = new Label(), eq3 = new Label();
            mv.visitLookupSwitchInsn(def, new int[]{97, 98, 99}, new Label[]{caseA, caseB, caseC});
            mv.visitLabel(caseA);
            mv.visitVarInsn(ALOAD, 0);
            mv.visitLdcInsn("a");
            mv.visitMethodInsn(INVOKEVIRTUAL, "java/lang/String", "equals", "(Ljava/lang/Object;)Z", false);
            mv.visitJumpInsn(IFEQ, def);
            mv.visitInsn(ICONST_1);
            mv.visitInsn(IRETURN);
            mv.visitLabel(caseB);
            mv.visitVarInsn(ALOAD, 0);
            mv.visitLdcInsn("b");
            mv.visitMethodInsn(INVOKEVIRTUAL, "java/lang/String", "equals", "(Ljava/lang/Object;)Z", false);
            mv.visitJumpInsn(IFEQ, def);
            mv.visitInsn(ICONST_2);
            mv.visitInsn(IRETURN);
            mv.visitLabel(caseC);
            mv.visitVarInsn(ALOAD, 0);
            mv.visitLdcInsn("c");
            mv.visitMethodInsn(INVOKEVIRTUAL, "java/lang/String", "equals", "(Ljava/lang/Object;)Z", false);
            mv.visitJumpInsn(IFEQ, def);
            mv.visitInsn(ICONST_3);
            mv.visitInsn(IRETURN);
            mv.visitLabel(def);
            mv.visitInsn(ICONST_M1);
            mv.visitInsn(IRETURN);
            mv.visitMaxs(0, 0);
            mv.visitEnd();
        }

        // check()
        {
            MethodVisitor mv = cw.visitMethod(ACC_PUBLIC | ACC_STATIC, "check", "()Ljava/lang/String;", null, null);
            mv.visitCode();
            mv.visitInsn(ICONST_1);
            mv.visitMethodInsn(INVOKESTATIC, cls, "switchOnInt", "(I)Ljava/lang/String;", false);
            mv.visitVarInsn(ASTORE, 0);
            mv.visitLdcInsn("b");
            mv.visitMethodInsn(INVOKESTATIC, cls, "switchOnString", "(Ljava/lang/String;)I", false);
            mv.visitVarInsn(ISTORE, 1);
            mv.visitLdcInsn("ok");
            mv.visitInsn(ARETURN);
            mv.visitMaxs(0, 0);
            mv.visitEnd();
        }

        cw.visitEnd();
        classes.put(cls, cw.toByteArray());
        writeJar(output, "test.gen.j.SwitchClass", "SwitchExpr", classes);
    }

    // ─────────────────────────────────────────────────────────────────
    // Variant 11 – StringConstants
    // ─────────────────────────────────────────────────────────────────

    private void generateStringConstants(Path output) throws IOException {
        var classes = new LinkedHashMap<String, byte[]>();
        String cls = "test/gen/k/StringConstants";

        ClassWriter cw = newCW();
        cw.visit(V21, ACC_PUBLIC | ACC_SUPER, cls, null, "java/lang/Object", null);

        // 10 static final String constants
        String[] constNames = new String[10];
        String[] constValues = new String[10];
        for (int i = 0; i < 10; i++) {
            constNames[i] = "CONST_" + i;
            constValues[i] = "value_" + i + "_" + "abcdefghij".charAt(i);
            cw.visitField(ACC_PUBLIC | ACC_STATIC | ACC_FINAL, constNames[i], "Ljava/lang/String;", null, null).visitEnd();
        }

        // <clinit> – initializes all constants
        {
            MethodVisitor mv = cw.visitMethod(ACC_STATIC, "<clinit>", "()V", null, null);
            mv.visitCode();
            for (int i = 0; i < 10; i++) {
                mv.visitLdcInsn(constValues[i]);
                mv.visitFieldInsn(PUTSTATIC, cls, constNames[i], "Ljava/lang/String;");
            }
            mv.visitInsn(RETURN);
            mv.visitMaxs(0, 0);
            mv.visitEnd();
        }

        {
            MethodVisitor mv = cw.visitMethod(ACC_PUBLIC, "<init>", "()V", null, null);
            mv.visitCode();
            mv.visitVarInsn(ALOAD, 0);
            mv.visitMethodInsn(INVOKESPECIAL, "java/lang/Object", "<init>", "()V", false);
            mv.visitInsn(RETURN);
            mv.visitMaxs(0, 0);
            mv.visitEnd();
        }

        // check() – reads CONST_5 and returns "ok" if non-null
        {
            MethodVisitor mv = cw.visitMethod(ACC_PUBLIC | ACC_STATIC, "check", "()Ljava/lang/String;", null, null);
            mv.visitCode();
            mv.visitFieldInsn(GETSTATIC, cls, "CONST_5", "Ljava/lang/String;");
            mv.visitVarInsn(ASTORE, 0);
            mv.visitVarInsn(ALOAD, 0);
            Label isNull = new Label();
            mv.visitJumpInsn(IFNULL, isNull);
            mv.visitLdcInsn("ok");
            mv.visitInsn(ARETURN);
            mv.visitLabel(isNull);
            mv.visitLdcInsn("null");
            mv.visitInsn(ARETURN);
            mv.visitMaxs(0, 0);
            mv.visitEnd();
        }

        cw.visitEnd();
        classes.put(cls, cw.toByteArray());
        writeJar(output, "test.gen.k.StringConstants", "StringConstants", classes);
    }

    // ─────────────────────────────────────────────────────────────────
    // Variant 12 – NumericConstants
    // ─────────────────────────────────────────────────────────────────

    private void generateNumericConstants(Path output) throws IOException {
        var classes = new LinkedHashMap<String, byte[]>();
        String cls = "test/gen/l/NumericConstants";

        ClassWriter cw = newCW();
        cw.visit(V21, ACC_PUBLIC | ACC_SUPER, cls, null, "java/lang/Object", null);

        cw.visitField(ACC_PUBLIC | ACC_STATIC | ACC_FINAL, "INT_VAL", "I", null, 12345).visitEnd();
        cw.visitField(ACC_PUBLIC | ACC_STATIC | ACC_FINAL, "LONG_VAL", "J", null, 9876543210L).visitEnd();
        cw.visitField(ACC_PUBLIC | ACC_STATIC | ACC_FINAL, "FLOAT_VAL", "F", null, 3.14f).visitEnd();
        cw.visitField(ACC_PUBLIC | ACC_STATIC | ACC_FINAL, "DOUBLE_VAL", "D", null, 2.718281828).visitEnd();
        cw.visitField(ACC_PUBLIC | ACC_STATIC | ACC_FINAL, "BYTE_VAL", "B", null, (byte) 0x7F).visitEnd();
        cw.visitField(ACC_PUBLIC | ACC_STATIC | ACC_FINAL, "SHORT_VAL", "S", null, (short) 32000).visitEnd();

        {
            MethodVisitor mv = cw.visitMethod(ACC_PUBLIC, "<init>", "()V", null, null);
            mv.visitCode();
            mv.visitVarInsn(ALOAD, 0);
            mv.visitMethodInsn(INVOKESPECIAL, "java/lang/Object", "<init>", "()V", false);
            mv.visitInsn(RETURN);
            mv.visitMaxs(0, 0);
            mv.visitEnd();
        }

        // arithmetic(int, long) -> double
        {
            MethodVisitor mv = cw.visitMethod(ACC_PUBLIC | ACC_STATIC, "arithmetic",
                    "(IJ)D", null, null);
            mv.visitCode();
            mv.visitVarInsn(ILOAD, 0);
            mv.visitInsn(I2D);
            mv.visitVarInsn(LLOAD, 1);
            mv.visitInsn(L2D);
            mv.visitInsn(DADD);
            mv.visitLdcInsn(3.14);
            mv.visitInsn(DMUL);
            mv.visitInsn(DRETURN);
            mv.visitMaxs(0, 0);
            mv.visitEnd();
        }

        // check()
        {
            MethodVisitor mv = cw.visitMethod(ACC_PUBLIC | ACC_STATIC, "check", "()Ljava/lang/String;", null, null);
            mv.visitCode();
            mv.visitFieldInsn(GETSTATIC, cls, "INT_VAL", "I");
            mv.visitVarInsn(ISTORE, 0);
            mv.visitFieldInsn(GETSTATIC, cls, "LONG_VAL", "J");
            mv.visitVarInsn(LSTORE, 1);
            mv.visitVarInsn(ILOAD, 0);
            mv.visitVarInsn(LLOAD, 1);
            mv.visitMethodInsn(INVOKESTATIC, cls, "arithmetic", "(IJ)D", false);
            mv.visitVarInsn(DSTORE, 3);
            mv.visitLdcInsn("ok");
            mv.visitInsn(ARETURN);
            mv.visitMaxs(0, 0);
            mv.visitEnd();
        }

        cw.visitEnd();
        classes.put(cls, cw.toByteArray());
        writeJar(output, "test.gen.l.NumericConstants", "NumericConstants", classes);
    }

    // ─────────────────────────────────────────────────────────────────
    // Variant 13 – GenericTypes
    // ─────────────────────────────────────────────────────────────────

    private void generateGenericTypes(Path output) throws IOException {
        var classes = new LinkedHashMap<String, byte[]>();
        String cls = "test/gen/m/GenericBox";

        ClassWriter cw = newCW();
        cw.visit(V21, ACC_PUBLIC | ACC_SUPER, cls, "<T:Ljava/lang/Object;>Ljava/lang/Object;",
                "java/lang/Object", null);

        cw.visitField(ACC_PRIVATE, "value", "Ljava/lang/Object;", "TT;", null).visitEnd();

        {
            MethodVisitor mv = cw.visitMethod(ACC_PUBLIC, "<init>", "(Ljava/lang/Object;)V", "(TT;)V", null);
            mv.visitCode();
            mv.visitVarInsn(ALOAD, 0);
            mv.visitMethodInsn(INVOKESPECIAL, "java/lang/Object", "<init>", "()V", false);
            mv.visitVarInsn(ALOAD, 0);
            mv.visitVarInsn(ALOAD, 1);
            mv.visitFieldInsn(PUTFIELD, cls, "value", "Ljava/lang/Object;");
            mv.visitInsn(RETURN);
            mv.visitMaxs(0, 0);
            mv.visitEnd();
        }

        // T get()
        {
            MethodVisitor mv = cw.visitMethod(ACC_PUBLIC, "get", "()Ljava/lang/Object;", "()TT;", null);
            mv.visitCode();
            mv.visitVarInsn(ALOAD, 0);
            mv.visitFieldInsn(GETFIELD, cls, "value", "Ljava/lang/Object;");
            mv.visitInsn(ARETURN);
            mv.visitMaxs(0, 0);
            mv.visitEnd();
        }

        // static <E> List<E> listOf(E e1, E e2)
        {
            MethodVisitor mv = cw.visitMethod(ACC_PUBLIC | ACC_STATIC, "listOf",
                    "(Ljava/lang/Object;Ljava/lang/Object;)Ljava/util/List;",
                    "<E:Ljava/lang/Object;>(TE;TE;)Ljava/util/List<TE;>;", null);
            mv.visitCode();
            mv.visitTypeInsn(NEW, "java/util/ArrayList");
            mv.visitInsn(DUP);
            mv.visitMethodInsn(INVOKESPECIAL, "java/util/ArrayList", "<init>", "()V", false);
            mv.visitVarInsn(ASTORE, 2);
            mv.visitVarInsn(ALOAD, 2);
            mv.visitVarInsn(ALOAD, 0);
            mv.visitMethodInsn(INVOKEINTERFACE, "java/util/List", "add", "(Ljava/lang/Object;)Z", true);
            mv.visitInsn(POP);
            mv.visitVarInsn(ALOAD, 2);
            mv.visitVarInsn(ALOAD, 1);
            mv.visitMethodInsn(INVOKEINTERFACE, "java/util/List", "add", "(Ljava/lang/Object;)Z", true);
            mv.visitInsn(POP);
            mv.visitVarInsn(ALOAD, 2);
            mv.visitInsn(ARETURN);
            mv.visitMaxs(0, 0);
            mv.visitEnd();
        }

        // static Map<String,Integer> buildMap()
        {
            MethodVisitor mv = cw.visitMethod(ACC_PUBLIC | ACC_STATIC, "buildMap",
                    "()Ljava/util/Map;",
                    "()Ljava/util/Map<Ljava/lang/String;Ljava/lang/Integer;>;", null);
            mv.visitCode();
            mv.visitTypeInsn(NEW, "java/util/HashMap");
            mv.visitInsn(DUP);
            mv.visitMethodInsn(INVOKESPECIAL, "java/util/HashMap", "<init>", "()V", false);
            mv.visitVarInsn(ASTORE, 0);
            mv.visitVarInsn(ALOAD, 0);
            mv.visitLdcInsn("one");
            mv.visitInsn(ICONST_1);
            mv.visitMethodInsn(INVOKESTATIC, "java/lang/Integer", "valueOf", "(I)Ljava/lang/Integer;", false);
            mv.visitMethodInsn(INVOKEINTERFACE, "java/util/Map", "put",
                    "(Ljava/lang/Object;Ljava/lang/Object;)Ljava/lang/Object;", true);
            mv.visitInsn(POP);
            mv.visitVarInsn(ALOAD, 0);
            mv.visitInsn(ARETURN);
            mv.visitMaxs(0, 0);
            mv.visitEnd();
        }

        // check()
        {
            MethodVisitor mv = cw.visitMethod(ACC_PUBLIC | ACC_STATIC, "check", "()Ljava/lang/String;", null, null);
            mv.visitCode();
            mv.visitTypeInsn(NEW, cls);
            mv.visitInsn(DUP);
            mv.visitLdcInsn("boxed");
            mv.visitMethodInsn(INVOKESPECIAL, cls, "<init>", "(Ljava/lang/Object;)V", false);
            mv.visitMethodInsn(INVOKEVIRTUAL, cls, "get", "()Ljava/lang/Object;", false);
            mv.visitTypeInsn(CHECKCAST, "java/lang/String");
            mv.visitVarInsn(ASTORE, 0);
            mv.visitLdcInsn("a");
            mv.visitLdcInsn("b");
            mv.visitMethodInsn(INVOKESTATIC, cls, "listOf",
                    "(Ljava/lang/Object;Ljava/lang/Object;)Ljava/util/List;", false);
            mv.visitVarInsn(ASTORE, 1);
            mv.visitMethodInsn(INVOKESTATIC, cls, "buildMap", "()Ljava/util/Map;", false);
            mv.visitVarInsn(ASTORE, 2);
            mv.visitLdcInsn("ok");
            mv.visitInsn(ARETURN);
            mv.visitMaxs(0, 0);
            mv.visitEnd();
        }

        cw.visitEnd();
        classes.put(cls, cw.toByteArray());
        writeJar(output, "test.gen.m.GenericBox", "GenericTypes", classes);
    }

    // ─────────────────────────────────────────────────────────────────
    // Variant 14 – AnonymousClass
    // ─────────────────────────────────────────────────────────────────

    private void generateAnonymousClass(Path output) throws IOException {
        var classes = new LinkedHashMap<String, byte[]>();
        String outerCls = "test/gen/n/AnonOuter";
        String anonRunnable = "test/gen/n/AnonOuter$1";
        String anonComparator = "test/gen/n/AnonOuter$2";

        // AnonOuter
        {
            ClassWriter cw = newCW();
            cw.visit(V21, ACC_PUBLIC | ACC_SUPER, outerCls, null, "java/lang/Object", null);
            cw.visitInnerClass(anonRunnable, null, null, 0);
            cw.visitInnerClass(anonComparator, null, null, 0);

            MethodVisitor init = cw.visitMethod(ACC_PUBLIC, "<init>", "()V", null, null);
            init.visitCode();
            init.visitVarInsn(ALOAD, 0);
            init.visitMethodInsn(INVOKESPECIAL, "java/lang/Object", "<init>", "()V", false);
            init.visitInsn(RETURN);
            init.visitMaxs(0, 0);
            init.visitEnd();

            // makeRunnable() -> Runnable
            MethodVisitor mr = cw.visitMethod(ACC_PUBLIC | ACC_STATIC, "makeRunnable", "()Ljava/lang/Runnable;", null, null);
            mr.visitCode();
            mr.visitTypeInsn(NEW, anonRunnable);
            mr.visitInsn(DUP);
            mr.visitMethodInsn(INVOKESPECIAL, anonRunnable, "<init>", "()V", false);
            mr.visitInsn(ARETURN);
            mr.visitMaxs(0, 0);
            mr.visitEnd();

            // makeComparator() -> Comparator
            MethodVisitor mc = cw.visitMethod(ACC_PUBLIC | ACC_STATIC, "makeComparator", "()Ljava/util/Comparator;", null, null);
            mc.visitCode();
            mc.visitTypeInsn(NEW, anonComparator);
            mc.visitInsn(DUP);
            mc.visitMethodInsn(INVOKESPECIAL, anonComparator, "<init>", "()V", false);
            mc.visitInsn(ARETURN);
            mc.visitMaxs(0, 0);
            mc.visitEnd();

            // check()
            MethodVisitor chk = cw.visitMethod(ACC_PUBLIC | ACC_STATIC, "check", "()Ljava/lang/String;", null, null);
            chk.visitCode();
            chk.visitMethodInsn(INVOKESTATIC, outerCls, "makeRunnable", "()Ljava/lang/Runnable;", false);
            chk.visitMethodInsn(INVOKEINTERFACE, "java/lang/Runnable", "run", "()V", true);
            chk.visitMethodInsn(INVOKESTATIC, outerCls, "makeComparator", "()Ljava/util/Comparator;", false);
            chk.visitLdcInsn("b");
            chk.visitLdcInsn("a");
            chk.visitMethodInsn(INVOKEINTERFACE, "java/util/Comparator", "compare",
                    "(Ljava/lang/Object;Ljava/lang/Object;)I", true);
            chk.visitVarInsn(ISTORE, 0);
            chk.visitLdcInsn("ok");
            chk.visitInsn(ARETURN);
            chk.visitMaxs(0, 0);
            chk.visitEnd();

            cw.visitEnd();
            classes.put(outerCls, cw.toByteArray());
        }

        // Anonymous Runnable
        {
            ClassWriter cw = newCW();
            cw.visit(V21, ACC_SUPER, anonRunnable, null, "java/lang/Object", new String[]{"java/lang/Runnable"});
            cw.visitInnerClass(anonRunnable, null, null, 0);

            MethodVisitor init = cw.visitMethod(0, "<init>", "()V", null, null);
            init.visitCode();
            init.visitVarInsn(ALOAD, 0);
            init.visitMethodInsn(INVOKESPECIAL, "java/lang/Object", "<init>", "()V", false);
            init.visitInsn(RETURN);
            init.visitMaxs(0, 0);
            init.visitEnd();

            MethodVisitor run = cw.visitMethod(ACC_PUBLIC, "run", "()V", null, null);
            run.visitCode();
            run.visitFieldInsn(GETSTATIC, "java/lang/System", "out", "Ljava/io/PrintStream;");
            run.visitLdcInsn("anon run");
            run.visitMethodInsn(INVOKEVIRTUAL, "java/io/PrintStream", "println", "(Ljava/lang/String;)V", false);
            run.visitInsn(RETURN);
            run.visitMaxs(0, 0);
            run.visitEnd();

            cw.visitEnd();
            classes.put(anonRunnable, cw.toByteArray());
        }

        // Anonymous Comparator
        {
            ClassWriter cw = newCW();
            cw.visit(V21, ACC_SUPER, anonComparator, null, "java/lang/Object",
                    new String[]{"java/util/Comparator"});
            cw.visitInnerClass(anonComparator, null, null, 0);

            MethodVisitor init = cw.visitMethod(0, "<init>", "()V", null, null);
            init.visitCode();
            init.visitVarInsn(ALOAD, 0);
            init.visitMethodInsn(INVOKESPECIAL, "java/lang/Object", "<init>", "()V", false);
            init.visitInsn(RETURN);
            init.visitMaxs(0, 0);
            init.visitEnd();

            MethodVisitor cmp = cw.visitMethod(ACC_PUBLIC, "compare",
                    "(Ljava/lang/Object;Ljava/lang/Object;)I", null, null);
            cmp.visitCode();
            cmp.visitVarInsn(ALOAD, 1);
            cmp.visitTypeInsn(CHECKCAST, "java/lang/String");
            cmp.visitVarInsn(ALOAD, 2);
            cmp.visitTypeInsn(CHECKCAST, "java/lang/String");
            cmp.visitMethodInsn(INVOKEVIRTUAL, "java/lang/String", "compareTo", "(Ljava/lang/String;)I", false);
            cmp.visitInsn(IRETURN);
            cmp.visitMaxs(0, 0);
            cmp.visitEnd();

            cw.visitEnd();
            classes.put(anonComparator, cw.toByteArray());
        }

        writeJar(output, "test.gen.n.AnonOuter", "AnonymousClass", classes);
    }

    // ─────────────────────────────────────────────────────────────────
    // Variant 15 – DeepPackage
    // ─────────────────────────────────────────────────────────────────

    private void generateDeepPackage(Path output) throws IOException {
        var classes = new LinkedHashMap<String, byte[]>();
        String cls = "test/gen/deep/pkg/sub/DeepClass";

        ClassWriter cw = newCW();
        cw.visit(V21, ACC_PUBLIC | ACC_SUPER, cls, null, "java/lang/Object", null);

        {
            MethodVisitor mv = cw.visitMethod(ACC_PUBLIC, "<init>", "()V", null, null);
            mv.visitCode();
            mv.visitVarInsn(ALOAD, 0);
            mv.visitMethodInsn(INVOKESPECIAL, "java/lang/Object", "<init>", "()V", false);
            mv.visitInsn(RETURN);
            mv.visitMaxs(0, 0);
            mv.visitEnd();
        }

        // chain of 5 private helpers calling each other
        String[] helpers = {"h1", "h2", "h3", "h4", "h5"};
        for (int i = 0; i < helpers.length; i++) {
            MethodVisitor mv = cw.visitMethod(ACC_PRIVATE | ACC_STATIC, helpers[i],
                    "(I)I", null, null);
            mv.visitCode();
            mv.visitVarInsn(ILOAD, 0);
            mv.visitInsn(ICONST_1);
            mv.visitInsn(IADD);
            if (i + 1 < helpers.length) {
                mv.visitMethodInsn(INVOKESTATIC, cls, helpers[i + 1], "(I)I", false);
            }
            mv.visitInsn(IRETURN);
            mv.visitMaxs(0, 0);
            mv.visitEnd();
        }

        // check()
        {
            MethodVisitor mv = cw.visitMethod(ACC_PUBLIC | ACC_STATIC, "check", "()Ljava/lang/String;", null, null);
            mv.visitCode();
            mv.visitInsn(ICONST_0);
            mv.visitMethodInsn(INVOKESTATIC, cls, "h1", "(I)I", false);
            mv.visitVarInsn(ISTORE, 0);
            mv.visitLdcInsn("ok");
            mv.visitInsn(ARETURN);
            mv.visitMaxs(0, 0);
            mv.visitEnd();
        }

        cw.visitEnd();
        classes.put(cls, cw.toByteArray());
        writeJar(output, "test.gen.deep.pkg.sub.DeepClass", "DeepPackage", classes);
    }

    // ─────────────────────────────────────────────────────────────────
    // Variant 16 – ClinitComplex
    // ─────────────────────────────────────────────────────────────────

    private void generateClinitComplex(Path output) throws IOException {
        var classes = new LinkedHashMap<String, byte[]>();
        String cls = "test/gen/p/ClinitComplex";

        ClassWriter cw = newCW();
        cw.visit(V21, ACC_PUBLIC | ACC_SUPER, cls, null, "java/lang/Object", null);

        cw.visitField(ACC_PUBLIC | ACC_STATIC, "list", "Ljava/util/List;",
                "Ljava/util/List<Ljava/lang/String;>;", null).visitEnd();
        cw.visitField(ACC_PUBLIC | ACC_STATIC, "map", "Ljava/util/Map;",
                "Ljava/util/Map<Ljava/lang/String;Ljava/lang/Integer;>;", null).visitEnd();
        cw.visitField(ACC_PUBLIC | ACC_STATIC, "computed", "I", null, null).visitEnd();

        // <clinit> – build list, map, compute value
        {
            MethodVisitor mv = cw.visitMethod(ACC_STATIC, "<clinit>", "()V", null, null);
            mv.visitCode();

            // list = new ArrayList<>();
            mv.visitTypeInsn(NEW, "java/util/ArrayList");
            mv.visitInsn(DUP);
            mv.visitMethodInsn(INVOKESPECIAL, "java/util/ArrayList", "<init>", "()V", false);
            mv.visitFieldInsn(PUTSTATIC, cls, "list", "Ljava/util/List;");

            // list.add("alpha"); list.add("beta"); list.add("gamma");
            for (String s : new String[]{"alpha", "beta", "gamma"}) {
                mv.visitFieldInsn(GETSTATIC, cls, "list", "Ljava/util/List;");
                mv.visitLdcInsn(s);
                mv.visitMethodInsn(INVOKEINTERFACE, "java/util/List", "add", "(Ljava/lang/Object;)Z", true);
                mv.visitInsn(POP);
            }

            // map = new HashMap<>();
            mv.visitTypeInsn(NEW, "java/util/HashMap");
            mv.visitInsn(DUP);
            mv.visitMethodInsn(INVOKESPECIAL, "java/util/HashMap", "<init>", "()V", false);
            mv.visitFieldInsn(PUTSTATIC, cls, "map", "Ljava/util/Map;");

            // map.put("x", 1); map.put("y", 2);
            for (int i = 0; i < 2; i++) {
                mv.visitFieldInsn(GETSTATIC, cls, "map", "Ljava/util/Map;");
                mv.visitLdcInsn(i == 0 ? "x" : "y");
                mv.visitIntInsn(BIPUSH, i + 1);
                mv.visitMethodInsn(INVOKESTATIC, "java/lang/Integer", "valueOf", "(I)Ljava/lang/Integer;", false);
                mv.visitMethodInsn(INVOKEINTERFACE, "java/util/Map", "put",
                        "(Ljava/lang/Object;Ljava/lang/Object;)Ljava/lang/Object;", true);
                mv.visitInsn(POP);
            }

            // computed = list.size() * 10 + map.size()
            mv.visitFieldInsn(GETSTATIC, cls, "list", "Ljava/util/List;");
            mv.visitMethodInsn(INVOKEINTERFACE, "java/util/List", "size", "()I", true);
            mv.visitIntInsn(BIPUSH, 10);
            mv.visitInsn(IMUL);
            mv.visitFieldInsn(GETSTATIC, cls, "map", "Ljava/util/Map;");
            mv.visitMethodInsn(INVOKEINTERFACE, "java/util/Map", "size", "()I", true);
            mv.visitInsn(IADD);
            mv.visitFieldInsn(PUTSTATIC, cls, "computed", "I");

            mv.visitInsn(RETURN);
            mv.visitMaxs(0, 0);
            mv.visitEnd();
        }

        {
            MethodVisitor mv = cw.visitMethod(ACC_PUBLIC, "<init>", "()V", null, null);
            mv.visitCode();
            mv.visitVarInsn(ALOAD, 0);
            mv.visitMethodInsn(INVOKESPECIAL, "java/lang/Object", "<init>", "()V", false);
            mv.visitInsn(RETURN);
            mv.visitMaxs(0, 0);
            mv.visitEnd();
        }

        // check()
        {
            MethodVisitor mv = cw.visitMethod(ACC_PUBLIC | ACC_STATIC, "check", "()Ljava/lang/String;", null, null);
            mv.visitCode();
            mv.visitFieldInsn(GETSTATIC, cls, "computed", "I");
            mv.visitVarInsn(ISTORE, 0);
            mv.visitVarInsn(ILOAD, 0);
            Label notZero = new Label();
            mv.visitJumpInsn(IFNE, notZero);
            mv.visitLdcInsn("zero");
            mv.visitInsn(ARETURN);
            mv.visitLabel(notZero);
            mv.visitLdcInsn("ok");
            mv.visitInsn(ARETURN);
            mv.visitMaxs(0, 0);
            mv.visitEnd();
        }

        cw.visitEnd();
        classes.put(cls, cw.toByteArray());
        writeJar(output, "test.gen.p.ClinitComplex", "ClinitComplex", classes);
    }

    // ─────────────────────────────────────────────────────────────────
    // Variant 17 – InterfaceDefault
    // ─────────────────────────────────────────────────────────────────

    private void generateInterfaceDefault(Path output) throws IOException {
        var classes = new LinkedHashMap<String, byte[]>();
        String ifaceCls = "test/gen/q/Greeter";
        String implCls  = "test/gen/q/FrenchGreeter";

        // Greeter interface
        {
            ClassWriter cw = newCW();
            cw.visit(V21, ACC_PUBLIC | ACC_ABSTRACT | ACC_INTERFACE, ifaceCls,
                    null, "java/lang/Object", null);

            // abstract greet(String) : String
            cw.visitMethod(ACC_PUBLIC | ACC_ABSTRACT, "greet", "(Ljava/lang/String;)Ljava/lang/String;", null, null).visitEnd();

            // default shout(String) : String
            {
                MethodVisitor mv = cw.visitMethod(ACC_PUBLIC, "shout", "(Ljava/lang/String;)Ljava/lang/String;", null, null);
                mv.visitCode();
                mv.visitVarInsn(ALOAD, 0);
                mv.visitVarInsn(ALOAD, 1);
                mv.visitMethodInsn(INVOKEINTERFACE, ifaceCls, "greet", "(Ljava/lang/String;)Ljava/lang/String;", true);
                mv.visitMethodInsn(INVOKEVIRTUAL, "java/lang/String", "toUpperCase", "()Ljava/lang/String;", false);
                mv.visitInsn(ARETURN);
                mv.visitMaxs(0, 0);
                mv.visitEnd();
            }

            // static of() : Greeter
            {
                MethodVisitor mv = cw.visitMethod(ACC_PUBLIC | ACC_STATIC, "englishGreeter",
                        "()L" + ifaceCls + ";", null, null);
                mv.visitCode();
                // Return a simple lambda equivalent – we'll inline an anon class reference from FrenchGreeter
                mv.visitTypeInsn(NEW, implCls);
                mv.visitInsn(DUP);
                mv.visitMethodInsn(INVOKESPECIAL, implCls, "<init>", "()V", false);
                mv.visitInsn(ARETURN);
                mv.visitMaxs(0, 0);
                mv.visitEnd();
            }

            cw.visitEnd();
            classes.put(ifaceCls, cw.toByteArray());
        }

        // FrenchGreeter implements Greeter (overrides default shout too)
        {
            ClassWriter cw = newCW();
            cw.visit(V21, ACC_PUBLIC | ACC_SUPER, implCls, null, "java/lang/Object", new String[]{ifaceCls});

            MethodVisitor init = cw.visitMethod(ACC_PUBLIC, "<init>", "()V", null, null);
            init.visitCode();
            init.visitVarInsn(ALOAD, 0);
            init.visitMethodInsn(INVOKESPECIAL, "java/lang/Object", "<init>", "()V", false);
            init.visitInsn(RETURN);
            init.visitMaxs(0, 0);
            init.visitEnd();

            // greet
            MethodVisitor greet = cw.visitMethod(ACC_PUBLIC, "greet", "(Ljava/lang/String;)Ljava/lang/String;", null, null);
            greet.visitCode();
            greet.visitTypeInsn(NEW, "java/lang/StringBuilder");
            greet.visitInsn(DUP);
            greet.visitMethodInsn(INVOKESPECIAL, "java/lang/StringBuilder", "<init>", "()V", false);
            greet.visitLdcInsn("Bonjour, ");
            greet.visitMethodInsn(INVOKEVIRTUAL, "java/lang/StringBuilder", "append",
                    "(Ljava/lang/String;)Ljava/lang/StringBuilder;", false);
            greet.visitVarInsn(ALOAD, 1);
            greet.visitMethodInsn(INVOKEVIRTUAL, "java/lang/StringBuilder", "append",
                    "(Ljava/lang/String;)Ljava/lang/StringBuilder;", false);
            greet.visitMethodInsn(INVOKEVIRTUAL, "java/lang/StringBuilder", "toString", "()Ljava/lang/String;", false);
            greet.visitInsn(ARETURN);
            greet.visitMaxs(0, 0);
            greet.visitEnd();

            // shout – override default
            MethodVisitor shout = cw.visitMethod(ACC_PUBLIC, "shout", "(Ljava/lang/String;)Ljava/lang/String;", null, null);
            shout.visitCode();
            shout.visitLdcInsn("VIVE LA FRANCE!");
            shout.visitInsn(ARETURN);
            shout.visitMaxs(0, 0);
            shout.visitEnd();

            // check()
            MethodVisitor chk = cw.visitMethod(ACC_PUBLIC | ACC_STATIC, "check", "()Ljava/lang/String;", null, null);
            chk.visitCode();
            chk.visitTypeInsn(NEW, implCls);
            chk.visitInsn(DUP);
            chk.visitMethodInsn(INVOKESPECIAL, implCls, "<init>", "()V", false);
            chk.visitVarInsn(ASTORE, 0);
            chk.visitVarInsn(ALOAD, 0);
            chk.visitLdcInsn("world");
            chk.visitMethodInsn(INVOKEVIRTUAL, implCls, "greet", "(Ljava/lang/String;)Ljava/lang/String;", false);
            chk.visitVarInsn(ASTORE, 1);
            chk.visitVarInsn(ALOAD, 0);
            chk.visitLdcInsn("test");
            chk.visitMethodInsn(INVOKEVIRTUAL, implCls, "shout", "(Ljava/lang/String;)Ljava/lang/String;", false);
            chk.visitVarInsn(ASTORE, 2);
            chk.visitLdcInsn("ok");
            chk.visitInsn(ARETURN);
            chk.visitMaxs(0, 0);
            chk.visitEnd();

            cw.visitEnd();
            classes.put(implCls, cw.toByteArray());
        }

        writeJar(output, "test.gen.q.FrenchGreeter", "InterfaceDefault", classes);
    }

    // ─────────────────────────────────────────────────────────────────
    // Variant 18 – AbstractClassChain
    // ─────────────────────────────────────────────────────────────────

    private void generateAbstractClassChain(Path output) throws IOException {
        var classes = new LinkedHashMap<String, byte[]>();
        String absCls  = "test/gen/r/AbstractShape";
        String concCls = "test/gen/r/Circle";

        // AbstractShape
        {
            ClassWriter cw = newCW();
            cw.visit(V21, ACC_PUBLIC | ACC_SUPER | ACC_ABSTRACT, absCls, null, "java/lang/Object", null);
            cw.visitField(ACC_PROTECTED, "color", "Ljava/lang/String;", null, null).visitEnd();

            MethodVisitor init = cw.visitMethod(ACC_PROTECTED, "<init>", "(Ljava/lang/String;)V", null, null);
            init.visitCode();
            init.visitVarInsn(ALOAD, 0);
            init.visitMethodInsn(INVOKESPECIAL, "java/lang/Object", "<init>", "()V", false);
            init.visitVarInsn(ALOAD, 0);
            init.visitVarInsn(ALOAD, 1);
            init.visitFieldInsn(PUTFIELD, absCls, "color", "Ljava/lang/String;");
            init.visitInsn(RETURN);
            init.visitMaxs(0, 0);
            init.visitEnd();

            cw.visitMethod(ACC_PUBLIC | ACC_ABSTRACT, "area", "()D", null, null).visitEnd();
            cw.visitMethod(ACC_PUBLIC | ACC_ABSTRACT, "perimeter", "()D", null, null).visitEnd();

            // concrete describe()
            MethodVisitor desc = cw.visitMethod(ACC_PUBLIC, "describe", "()Ljava/lang/String;", null, null);
            desc.visitCode();
            desc.visitTypeInsn(NEW, "java/lang/StringBuilder");
            desc.visitInsn(DUP);
            desc.visitMethodInsn(INVOKESPECIAL, "java/lang/StringBuilder", "<init>", "()V", false);
            desc.visitVarInsn(ALOAD, 0);
            desc.visitFieldInsn(GETFIELD, absCls, "color", "Ljava/lang/String;");
            desc.visitMethodInsn(INVOKEVIRTUAL, "java/lang/StringBuilder", "append",
                    "(Ljava/lang/String;)Ljava/lang/StringBuilder;", false);
            desc.visitLdcInsn(" shape");
            desc.visitMethodInsn(INVOKEVIRTUAL, "java/lang/StringBuilder", "append",
                    "(Ljava/lang/String;)Ljava/lang/StringBuilder;", false);
            desc.visitMethodInsn(INVOKEVIRTUAL, "java/lang/StringBuilder", "toString", "()Ljava/lang/String;", false);
            desc.visitInsn(ARETURN);
            desc.visitMaxs(0, 0);
            desc.visitEnd();

            cw.visitEnd();
            classes.put(absCls, cw.toByteArray());
        }

        // Circle extends AbstractShape
        {
            ClassWriter cw = newCW();
            cw.visit(V21, ACC_PUBLIC | ACC_SUPER, concCls, null, absCls, null);
            cw.visitField(ACC_PRIVATE, "radius", "D", null, null).visitEnd();

            MethodVisitor init = cw.visitMethod(ACC_PUBLIC, "<init>", "(Ljava/lang/String;D)V", null, null);
            init.visitCode();
            init.visitVarInsn(ALOAD, 0);
            init.visitVarInsn(ALOAD, 1);
            init.visitMethodInsn(INVOKESPECIAL, absCls, "<init>", "(Ljava/lang/String;)V", false);
            init.visitVarInsn(ALOAD, 0);
            init.visitVarInsn(DLOAD, 2);
            init.visitFieldInsn(PUTFIELD, concCls, "radius", "D");
            init.visitInsn(RETURN);
            init.visitMaxs(0, 0);
            init.visitEnd();

            // area() = PI * r * r
            MethodVisitor area = cw.visitMethod(ACC_PUBLIC, "area", "()D", null, null);
            area.visitCode();
            area.visitLdcInsn(Math.PI);
            area.visitVarInsn(ALOAD, 0);
            area.visitFieldInsn(GETFIELD, concCls, "radius", "D");
            area.visitInsn(DUP2);
            area.visitInsn(DMUL);
            area.visitInsn(DMUL);
            area.visitInsn(DRETURN);
            area.visitMaxs(0, 0);
            area.visitEnd();

            // perimeter() = 2 * PI * r
            MethodVisitor perim = cw.visitMethod(ACC_PUBLIC, "perimeter", "()D", null, null);
            perim.visitCode();
            perim.visitLdcInsn(2.0 * Math.PI);
            perim.visitVarInsn(ALOAD, 0);
            perim.visitFieldInsn(GETFIELD, concCls, "radius", "D");
            perim.visitInsn(DMUL);
            perim.visitInsn(DRETURN);
            perim.visitMaxs(0, 0);
            perim.visitEnd();

            // check()
            MethodVisitor chk = cw.visitMethod(ACC_PUBLIC | ACC_STATIC, "check", "()Ljava/lang/String;", null, null);
            chk.visitCode();
            chk.visitTypeInsn(NEW, concCls);
            chk.visitInsn(DUP);
            chk.visitLdcInsn("red");
            chk.visitLdcInsn(5.0);
            chk.visitMethodInsn(INVOKESPECIAL, concCls, "<init>", "(Ljava/lang/String;D)V", false);
            chk.visitVarInsn(ASTORE, 0);
            chk.visitVarInsn(ALOAD, 0);
            chk.visitMethodInsn(INVOKEVIRTUAL, concCls, "area", "()D", false);
            chk.visitVarInsn(DSTORE, 1);
            chk.visitVarInsn(ALOAD, 0);
            chk.visitMethodInsn(INVOKEVIRTUAL, concCls, "describe", "()Ljava/lang/String;", false);
            chk.visitVarInsn(ASTORE, 3);
            chk.visitLdcInsn("ok");
            chk.visitInsn(ARETURN);
            chk.visitMaxs(0, 0);
            chk.visitEnd();

            cw.visitEnd();
            classes.put(concCls, cw.toByteArray());
        }

        writeJar(output, "test.gen.r.Circle", "AbstractClassChain", classes);
    }

    // ─────────────────────────────────────────────────────────────────
    // Variant 19 – ExceptionTypes
    // ─────────────────────────────────────────────────────────────────

    private void generateExceptionTypes(Path output) throws IOException {
        var classes = new LinkedHashMap<String, byte[]>();
        String excCls  = "test/gen/s/AppException";
        String mainCls = "test/gen/s/ExceptionUser";

        // Custom exception
        {
            ClassWriter cw = newCW();
            cw.visit(V21, ACC_PUBLIC | ACC_SUPER, excCls, null, "java/lang/RuntimeException", null);

            cw.visitField(ACC_PRIVATE, "code", "I", null, null).visitEnd();

            MethodVisitor init = cw.visitMethod(ACC_PUBLIC, "<init>", "(Ljava/lang/String;I)V", null, null);
            init.visitCode();
            init.visitVarInsn(ALOAD, 0);
            init.visitVarInsn(ALOAD, 1);
            init.visitMethodInsn(INVOKESPECIAL, "java/lang/RuntimeException", "<init>", "(Ljava/lang/String;)V", false);
            init.visitVarInsn(ALOAD, 0);
            init.visitVarInsn(ILOAD, 2);
            init.visitFieldInsn(PUTFIELD, excCls, "code", "I");
            init.visitInsn(RETURN);
            init.visitMaxs(0, 0);
            init.visitEnd();

            MethodVisitor getCode = cw.visitMethod(ACC_PUBLIC, "getCode", "()I", null, null);
            getCode.visitCode();
            getCode.visitVarInsn(ALOAD, 0);
            getCode.visitFieldInsn(GETFIELD, excCls, "code", "I");
            getCode.visitInsn(IRETURN);
            getCode.visitMaxs(0, 0);
            getCode.visitEnd();

            cw.visitEnd();
            classes.put(excCls, cw.toByteArray());
        }

        // ExceptionUser
        {
            ClassWriter cw = newCW();
            cw.visit(V21, ACC_PUBLIC | ACC_SUPER, mainCls, null, "java/lang/Object", null);

            MethodVisitor init = cw.visitMethod(ACC_PUBLIC, "<init>", "()V", null, null);
            init.visitCode();
            init.visitVarInsn(ALOAD, 0);
            init.visitMethodInsn(INVOKESPECIAL, "java/lang/Object", "<init>", "()V", false);
            init.visitInsn(RETURN);
            init.visitMaxs(0, 0);
            init.visitEnd();

            // throwIt() throws AppException
            MethodVisitor throwIt = cw.visitMethod(ACC_PUBLIC | ACC_STATIC, "throwIt",
                    "()V", null, new String[]{excCls});
            throwIt.visitCode();
            throwIt.visitTypeInsn(NEW, excCls);
            throwIt.visitInsn(DUP);
            throwIt.visitLdcInsn("error occurred");
            throwIt.visitIntInsn(BIPUSH, 42);
            throwIt.visitMethodInsn(INVOKESPECIAL, excCls, "<init>", "(Ljava/lang/String;I)V", false);
            throwIt.visitInsn(ATHROW);
            throwIt.visitMaxs(0, 0);
            throwIt.visitEnd();

            // catchIt()
            MethodVisitor catchIt = cw.visitMethod(ACC_PUBLIC | ACC_STATIC, "catchIt",
                    "()I", null, null);
            catchIt.visitCode();
            Label tryStart = new Label(), tryEnd = new Label(), catchLabel = new Label();
            catchIt.visitTryCatchBlock(tryStart, tryEnd, catchLabel, excCls);
            catchIt.visitLabel(tryStart);
            catchIt.visitMethodInsn(INVOKESTATIC, mainCls, "throwIt", "()V", false);
            catchIt.visitLabel(tryEnd);
            catchIt.visitInsn(ICONST_0);
            catchIt.visitInsn(IRETURN);
            catchIt.visitLabel(catchLabel);
            catchIt.visitVarInsn(ASTORE, 0);
            catchIt.visitVarInsn(ALOAD, 0);
            catchIt.visitMethodInsn(INVOKEVIRTUAL, excCls, "getCode", "()I", false);
            catchIt.visitInsn(IRETURN);
            catchIt.visitMaxs(0, 0);
            catchIt.visitEnd();

            // check()
            MethodVisitor chk = cw.visitMethod(ACC_PUBLIC | ACC_STATIC, "check", "()Ljava/lang/String;", null, null);
            chk.visitCode();
            chk.visitMethodInsn(INVOKESTATIC, mainCls, "catchIt", "()I", false);
            chk.visitVarInsn(ISTORE, 0);
            chk.visitLdcInsn("ok");
            chk.visitInsn(ARETURN);
            chk.visitMaxs(0, 0);
            chk.visitEnd();

            cw.visitEnd();
            classes.put(mainCls, cw.toByteArray());
        }

        writeJar(output, "test.gen.s.ExceptionUser", "ExceptionTypes", classes);
    }

    // ─────────────────────────────────────────────────────────────────
    // Variant 20 – MultipleClasses
    // ─────────────────────────────────────────────────────────────────

    private void generateMultipleClasses(Path output) throws IOException {
        var classes = new LinkedHashMap<String, byte[]>();
        int count = 10;
        String pkg = "test/gen/t/";
        String[] classNames = new String[count];
        for (int i = 0; i < count; i++) {
            classNames[i] = pkg + "Chain" + i;
        }

        for (int i = 0; i < count; i++) {
            ClassWriter cw = newCW();
            cw.visit(V21, ACC_PUBLIC | ACC_SUPER, classNames[i], null, "java/lang/Object", null);

            cw.visitField(ACC_PUBLIC | ACC_STATIC | ACC_FINAL, "INDEX", "I", null, i).visitEnd();

            MethodVisitor init = cw.visitMethod(ACC_PUBLIC, "<init>", "()V", null, null);
            init.visitCode();
            init.visitVarInsn(ALOAD, 0);
            init.visitMethodInsn(INVOKESPECIAL, "java/lang/Object", "<init>", "()V", false);
            init.visitInsn(RETURN);
            init.visitMaxs(0, 0);
            init.visitEnd();

            // next() – returns next class index or -1
            MethodVisitor next = cw.visitMethod(ACC_PUBLIC | ACC_STATIC, "next", "()I", null, null);
            next.visitCode();
            if (i + 1 < count) {
                next.visitFieldInsn(GETSTATIC, classNames[i + 1], "INDEX", "I");
            } else {
                next.visitInsn(ICONST_M1);
            }
            next.visitInsn(IRETURN);
            next.visitMaxs(0, 0);
            next.visitEnd();

            // value() – returns something about this class
            MethodVisitor val = cw.visitMethod(ACC_PUBLIC | ACC_STATIC, "value", "()Ljava/lang/String;", null, null);
            val.visitCode();
            val.visitLdcInsn("chain-" + i);
            val.visitInsn(ARETURN);
            val.visitMaxs(0, 0);
            val.visitEnd();

            // check() only on class 0
            if (i == 0) {
                MethodVisitor chk = cw.visitMethod(ACC_PUBLIC | ACC_STATIC, "check", "()Ljava/lang/String;", null, null);
                chk.visitCode();
                // Walk the chain
                for (int j = 0; j < count; j++) {
                    chk.visitMethodInsn(INVOKESTATIC, classNames[j], "value", "()Ljava/lang/String;", false);
                    chk.visitVarInsn(ASTORE, 0);
                }
                // sum indices
                chk.visitInsn(ICONST_0);
                for (int j = 0; j < count; j++) {
                    chk.visitFieldInsn(GETSTATIC, classNames[j], "INDEX", "I");
                    chk.visitInsn(IADD);
                }
                chk.visitVarInsn(ISTORE, 1);
                chk.visitLdcInsn("ok");
                chk.visitInsn(ARETURN);
                chk.visitMaxs(0, 0);
                chk.visitEnd();
            }

            cw.visitEnd();
            classes.put(classNames[i], cw.toByteArray());
        }

        writeJar(output, "test.gen.t.Chain0", "MultipleClasses", classes);
    }
}
