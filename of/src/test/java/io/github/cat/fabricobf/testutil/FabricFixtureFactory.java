package io.github.cat.fabricobf.testutil;

import java.io.IOException;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.jar.Attributes;
import java.util.jar.JarEntry;
import java.util.jar.JarOutputStream;
import java.util.jar.Manifest;
import org.objectweb.asm.AnnotationVisitor;
import org.objectweb.asm.ClassWriter;
import org.objectweb.asm.Label;
import org.objectweb.asm.MethodVisitor;
import org.objectweb.asm.Opcodes;
import org.objectweb.asm.Type;

public final class FabricFixtureFactory {
    private FabricFixtureFactory() {
    }

    public static Path createBasicFixtureJar(Path directory, String fileName) throws IOException {
        Files.createDirectories(directory);
        Path jarPath = directory.resolve(fileName);

        Manifest manifest = new Manifest();
        manifest.getMainAttributes().put(Attributes.Name.MANIFEST_VERSION, "1.0");
        manifest.getMainAttributes().putValue("Created-By", "fabric-obf-test");

        try (OutputStream out = Files.newOutputStream(jarPath);
             JarOutputStream jarOut = new JarOutputStream(out, manifest)) {
            writeEntry(jarOut, "fabric.mod.json", fabricModJson().getBytes(StandardCharsets.UTF_8));
            writeEntry(jarOut, "test.mixins.json", mixinConfigJson().getBytes(StandardCharsets.UTF_8));
            writeEntry(jarOut, "test.accesswidener", accessWidener().getBytes(StandardCharsets.UTF_8));
            writeEntry(jarOut, "assets/testmod/lang/en_us.json", "{\"text\":\"ok\"}".getBytes(StandardCharsets.UTF_8));
            writeEntry(jarOut, "com/example/mod/EntryPoint.class", entryPointBytes());
            writeEntry(jarOut, "com/example/mod/Helper.class", helperBytes());
            writeEntry(jarOut, "com/example/mod/settings/SettingBuilder.class", settingBuilderBytes());
            writeEntry(jarOut, "com/example/mod/settings/BooleanSetting$Builder.class", booleanSettingBuilderBytes());
            writeEntry(jarOut, "com/example/mod/records/UserRecord.class", userRecordBytes());
            writeEntry(jarOut, "com/example/mod/client/system/PojoInfo.class", pojoInfoBytes());
            writeEntry(jarOut, "com/example/mod/client/system/GsonUser.class", gsonUserBytes());
            writeEntry(jarOut, "com/example/mod/client/system/JsonSerializable.class", jsonSerializableBytes());
            writeEntry(jarOut, "com/example/mod/client/system/Config.class", persistentConfigBytes());
            writeEntry(jarOut, "com/example/mod/modules/ModuleFile.class", moduleFileBytes());
            writeEntry(jarOut, "com/example/mod/TargetClass.class", targetClassBytes());
            writeEntry(jarOut, "com/example/mod/mixin/MyMixin.class", mixinClassBytes());
        }
        return jarPath;
    }

    public static Path createMalformedFabricModJar(Path directory, String fileName) throws IOException {
        Files.createDirectories(directory);
        Path jarPath = directory.resolve(fileName);
        try (OutputStream out = Files.newOutputStream(jarPath);
             JarOutputStream jarOut = new JarOutputStream(out)) {
            writeEntry(jarOut, "fabric.mod.json", "{bad-json".getBytes(StandardCharsets.UTF_8));
            writeEntry(jarOut, "com/example/mod/EntryPoint.class", entryPointBytes());
        }
        return jarPath;
    }

    private static void writeEntry(JarOutputStream jarOut, String name, byte[] bytes) throws IOException {
        JarEntry entry = new JarEntry(name);
        entry.setTime(0L);
        jarOut.putNextEntry(entry);
        jarOut.write(bytes);
        jarOut.closeEntry();
    }

    private static String fabricModJson() {
        return """
                {
                  "schemaVersion": 1,
                  "id": "testmod",
                  "version": "1.0.0",
                  "entrypoints": {
                    "main": [
                      "com.example.mod.EntryPoint::init"
                    ]
                  },
                  "mixins": [
                    "test.mixins.json"
                  ],
                  "accessWidener": "test.accesswidener"
                }
                """;
    }

    private static String mixinConfigJson() {
        return """
                {
                  "required": true,
                  "package": "com.example.mod.mixin",
                  "mixins": [
                    "MyMixin"
                  ]
                }
                """;
    }

    private static String accessWidener() {
        return """
                accessWidener v2 named
                accessible field com/example/mod/Helper widenedField I
                accessible method com/example/mod/Helper useFields ()Ljava/lang/String;
                """;
    }

    private static byte[] entryPointBytes() {
        ClassWriter cw = new ClassWriter(0);
        cw.visit(Opcodes.V21, Opcodes.ACC_PUBLIC, "com/example/mod/EntryPoint", null, "java/lang/Object", null);

        MethodVisitor initCtor = cw.visitMethod(Opcodes.ACC_PUBLIC, "<init>", "()V", null, null);
        initCtor.visitCode();
        initCtor.visitVarInsn(Opcodes.ALOAD, 0);
        initCtor.visitMethodInsn(Opcodes.INVOKESPECIAL, "java/lang/Object", "<init>", "()V", false);
        initCtor.visitInsn(Opcodes.RETURN);
        initCtor.visitMaxs(1, 1);
        initCtor.visitEnd();

        MethodVisitor init = cw.visitMethod(Opcodes.ACC_PUBLIC | Opcodes.ACC_STATIC, "init", "()Ljava/lang/String;", null, null);
        init.visitCode();
        init.visitTypeInsn(Opcodes.NEW, "com/example/mod/settings/BooleanSetting$Builder");
        init.visitInsn(Opcodes.DUP);
        init.visitMethodInsn(Opcodes.INVOKESPECIAL, "com/example/mod/settings/BooleanSetting$Builder", "<init>", "()V", false);
        init.visitMethodInsn(Opcodes.INVOKEVIRTUAL, "com/example/mod/settings/BooleanSetting$Builder", "buildSetting", "()Ljava/lang/String;", false);
        init.visitVarInsn(Opcodes.ASTORE, 0);
        init.visitTypeInsn(Opcodes.NEW, "com/example/mod/Helper");
        init.visitInsn(Opcodes.DUP);
        init.visitMethodInsn(Opcodes.INVOKESPECIAL, "com/example/mod/Helper", "<init>", "()V", false);
        init.visitMethodInsn(Opcodes.INVOKEVIRTUAL, "com/example/mod/Helper", "callHidden", "()Ljava/lang/String;", false);
        init.visitVarInsn(Opcodes.ALOAD, 0);
        init.visitMethodInsn(Opcodes.INVOKEVIRTUAL, "java/lang/String", "concat", "(Ljava/lang/String;)Ljava/lang/String;", false);
        init.visitInsn(Opcodes.ARETURN);
        init.visitMaxs(2, 1);
        init.visitEnd();

        cw.visitEnd();
        return cw.toByteArray();
    }

    private static byte[] helperBytes() {
        ClassWriter cw = new ClassWriter(0);
        cw.visit(Opcodes.V21, Opcodes.ACC_PUBLIC | Opcodes.ACC_FINAL, "com/example/mod/Helper", null, "java/lang/Object", null);
        cw.visitSource("Helper.java", null);

        cw.visitField(Opcodes.ACC_PRIVATE, "hiddenField", "Ljava/lang/String;", null, null).visitEnd();
        cw.visitField(Opcodes.ACC_PROTECTED, "widenedField", "I", null, null).visitEnd();
        cw.visitField(0, "packageField", "I", null, null).visitEnd();

        MethodVisitor ctor = cw.visitMethod(Opcodes.ACC_PUBLIC, "<init>", "()V", null, null);
        ctor.visitCode();
        ctor.visitVarInsn(Opcodes.ALOAD, 0);
        ctor.visitMethodInsn(Opcodes.INVOKESPECIAL, "java/lang/Object", "<init>", "()V", false);
        ctor.visitVarInsn(Opcodes.ALOAD, 0);
        ctor.visitLdcInsn("boot");
        ctor.visitFieldInsn(Opcodes.PUTFIELD, "com/example/mod/Helper", "hiddenField", "Ljava/lang/String;");
        ctor.visitVarInsn(Opcodes.ALOAD, 0);
        ctor.visitIntInsn(Opcodes.BIPUSH, 7);
        ctor.visitFieldInsn(Opcodes.PUTFIELD, "com/example/mod/Helper", "widenedField", "I");
        ctor.visitInsn(Opcodes.RETURN);
        ctor.visitMaxs(2, 1);
        ctor.visitEnd();

        MethodVisitor hidden = cw.visitMethod(Opcodes.ACC_PRIVATE, "hidden", "()Ljava/lang/String;", null, null);
        hidden.visitCode();
        Label hiddenLine = new Label();
        hidden.visitLabel(hiddenLine);
        hidden.visitLineNumber(42, hiddenLine);
        hidden.visitLdcInsn("secret");
        hidden.visitInsn(Opcodes.ARETURN);
        hidden.visitMaxs(1, 1);
        hidden.visitEnd();

        MethodVisitor packageMethod = cw.visitMethod(Opcodes.ACC_FINAL, "packageMethod", "()Ljava/lang/String;", null, null);
        packageMethod.visitCode();
        packageMethod.visitLdcInsn("pkg");
        packageMethod.visitInsn(Opcodes.ARETURN);
        packageMethod.visitMaxs(1, 1);
        packageMethod.visitEnd();

        MethodVisitor callHidden = cw.visitMethod(Opcodes.ACC_PUBLIC, "callHidden", "()Ljava/lang/String;", null, null);
        callHidden.visitCode();
        callHidden.visitVarInsn(Opcodes.ALOAD, 0);
        callHidden.visitMethodInsn(Opcodes.INVOKEVIRTUAL, "com/example/mod/Helper", "hidden", "()Ljava/lang/String;", false);
        callHidden.visitInsn(Opcodes.ARETURN);
        callHidden.visitMaxs(1, 1);
        callHidden.visitEnd();

        MethodVisitor useFields = cw.visitMethod(Opcodes.ACC_PUBLIC, "useFields", "()Ljava/lang/String;", null, null);
        useFields.visitCode();
        useFields.visitTypeInsn(Opcodes.NEW, "java/lang/StringBuilder");
        useFields.visitInsn(Opcodes.DUP);
        useFields.visitMethodInsn(Opcodes.INVOKESPECIAL, "java/lang/StringBuilder", "<init>", "()V", false);
        useFields.visitVarInsn(Opcodes.ALOAD, 0);
        useFields.visitFieldInsn(Opcodes.GETFIELD, "com/example/mod/Helper", "hiddenField", "Ljava/lang/String;");
        useFields.visitMethodInsn(
                Opcodes.INVOKEVIRTUAL,
                "java/lang/StringBuilder",
                "append",
                "(Ljava/lang/String;)Ljava/lang/StringBuilder;",
                false
        );
        useFields.visitVarInsn(Opcodes.ALOAD, 0);
        useFields.visitFieldInsn(Opcodes.GETFIELD, "com/example/mod/Helper", "widenedField", "I");
        useFields.visitMethodInsn(Opcodes.INVOKEVIRTUAL, "java/lang/StringBuilder", "append", "(I)Ljava/lang/StringBuilder;", false);
        useFields.visitMethodInsn(Opcodes.INVOKEVIRTUAL, "java/lang/StringBuilder", "toString", "()Ljava/lang/String;", false);
        useFields.visitInsn(Opcodes.ARETURN);
        useFields.visitMaxs(2, 1);
        useFields.visitEnd();

        cw.visitEnd();
        return cw.toByteArray();
    }

    private static byte[] targetClassBytes() {
        ClassWriter cw = new ClassWriter(0);
        cw.visit(Opcodes.V21, Opcodes.ACC_PUBLIC, "com/example/mod/TargetClass", null, "java/lang/Object", null);

        MethodVisitor ctor = cw.visitMethod(Opcodes.ACC_PUBLIC, "<init>", "()V", null, null);
        ctor.visitCode();
        ctor.visitVarInsn(Opcodes.ALOAD, 0);
        ctor.visitMethodInsn(Opcodes.INVOKESPECIAL, "java/lang/Object", "<init>", "()V", false);
        ctor.visitInsn(Opcodes.RETURN);
        ctor.visitMaxs(1, 1);
        ctor.visitEnd();

        MethodVisitor targetMethod = cw.visitMethod(Opcodes.ACC_PROTECTED, "targetMethod", "()V", null, null);
        targetMethod.visitCode();
        targetMethod.visitInsn(Opcodes.RETURN);
        targetMethod.visitMaxs(0, 1);
        targetMethod.visitEnd();

        cw.visitEnd();
        return cw.toByteArray();
    }

    private static byte[] settingBuilderBytes() {
        ClassWriter cw = new ClassWriter(0);
        cw.visit(
                Opcodes.V21,
                Opcodes.ACC_PUBLIC,
                "com/example/mod/settings/SettingBuilder",
                null,
                "java/lang/Object",
                null
        );

        cw.visitField(Opcodes.ACC_PROTECTED, "name", "Ljava/lang/String;", null, null).visitEnd();

        MethodVisitor ctor = cw.visitMethod(Opcodes.ACC_PUBLIC, "<init>", "()V", null, null);
        ctor.visitCode();
        ctor.visitVarInsn(Opcodes.ALOAD, 0);
        ctor.visitMethodInsn(Opcodes.INVOKESPECIAL, "java/lang/Object", "<init>", "()V", false);
        ctor.visitVarInsn(Opcodes.ALOAD, 0);
        ctor.visitLdcInsn("builder");
        ctor.visitFieldInsn(Opcodes.PUTFIELD, "com/example/mod/settings/SettingBuilder", "name", "Ljava/lang/String;");
        ctor.visitInsn(Opcodes.RETURN);
        ctor.visitMaxs(2, 1);
        ctor.visitEnd();

        cw.visitEnd();
        return cw.toByteArray();
    }

    private static byte[] booleanSettingBuilderBytes() {
        ClassWriter cw = new ClassWriter(0);
        cw.visit(
                Opcodes.V21,
                Opcodes.ACC_PUBLIC,
                "com/example/mod/settings/BooleanSetting$Builder",
                null,
                "com/example/mod/settings/SettingBuilder",
                null
        );

        MethodVisitor ctor = cw.visitMethod(Opcodes.ACC_PUBLIC, "<init>", "()V", null, null);
        ctor.visitCode();
        ctor.visitVarInsn(Opcodes.ALOAD, 0);
        ctor.visitMethodInsn(Opcodes.INVOKESPECIAL, "com/example/mod/settings/SettingBuilder", "<init>", "()V", false);
        ctor.visitInsn(Opcodes.RETURN);
        ctor.visitMaxs(1, 1);
        ctor.visitEnd();

        MethodVisitor buildSetting = cw.visitMethod(
                Opcodes.ACC_PUBLIC,
                "buildSetting",
                "()Ljava/lang/String;",
                null,
                null
        );
        buildSetting.visitCode();
        buildSetting.visitVarInsn(Opcodes.ALOAD, 0);
        // Important: owner is the subclass, matching the real crash pattern.
        buildSetting.visitFieldInsn(
                Opcodes.GETFIELD,
                "com/example/mod/settings/BooleanSetting$Builder",
                "name",
                "Ljava/lang/String;"
        );
        buildSetting.visitInsn(Opcodes.ARETURN);
        buildSetting.visitMaxs(1, 1);
        buildSetting.visitEnd();

        cw.visitEnd();
        return cw.toByteArray();
    }

    private static byte[] mixinClassBytes() {
        ClassWriter cw = new ClassWriter(0);
        cw.visit(Opcodes.V21, Opcodes.ACC_PUBLIC, "com/example/mod/mixin/MyMixin", null, "java/lang/Object", null);
        AnnotationVisitor mixinAnno = cw.visitAnnotation("Lorg/spongepowered/asm/mixin/Mixin;", false);
        AnnotationVisitor valueArray = mixinAnno.visitArray("value");
        valueArray.visit(null, Type.getObjectType("com/example/mod/TargetClass"));
        valueArray.visitEnd();
        mixinAnno.visitEnd();

        MethodVisitor ctor = cw.visitMethod(Opcodes.ACC_PUBLIC, "<init>", "()V", null, null);
        ctor.visitCode();
        ctor.visitVarInsn(Opcodes.ALOAD, 0);
        ctor.visitMethodInsn(Opcodes.INVOKESPECIAL, "java/lang/Object", "<init>", "()V", false);
        ctor.visitInsn(Opcodes.RETURN);
        ctor.visitMaxs(1, 1);
        ctor.visitEnd();

        MethodVisitor inject = cw.visitMethod(Opcodes.ACC_PRIVATE, "onTarget", "()V", null, null);
        AnnotationVisitor injectAnno = inject.visitAnnotation("Lorg/spongepowered/asm/mixin/injection/Inject;", false);
        injectAnno.visit("method", "targetMethod()V");
        injectAnno.visitEnd();
        inject.visitCode();
        Label l0 = new Label();
        inject.visitLabel(l0);
        inject.visitInsn(Opcodes.RETURN);
        inject.visitMaxs(0, 1);
        inject.visitEnd();

        cw.visitEnd();
        return cw.toByteArray();
    }

    private static byte[] userRecordBytes() {
        ClassWriter cw = new ClassWriter(0);
        cw.visit(
                Opcodes.V21,
                Opcodes.ACC_PUBLIC | Opcodes.ACC_FINAL | Opcodes.ACC_SUPER | Opcodes.ACC_RECORD,
                "com/example/mod/records/UserRecord",
                null,
                "java/lang/Record",
                null
        );
        cw.visitRecordComponent("name", "Ljava/lang/String;", null).visitEnd();
        cw.visitField(Opcodes.ACC_PRIVATE | Opcodes.ACC_FINAL, "name", "Ljava/lang/String;", null, null).visitEnd();

        MethodVisitor ctor = cw.visitMethod(Opcodes.ACC_PUBLIC, "<init>", "(Ljava/lang/String;)V", null, null);
        ctor.visitCode();
        ctor.visitVarInsn(Opcodes.ALOAD, 0);
        ctor.visitMethodInsn(Opcodes.INVOKESPECIAL, "java/lang/Record", "<init>", "()V", false);
        ctor.visitVarInsn(Opcodes.ALOAD, 0);
        ctor.visitVarInsn(Opcodes.ALOAD, 1);
        ctor.visitFieldInsn(Opcodes.PUTFIELD, "com/example/mod/records/UserRecord", "name", "Ljava/lang/String;");
        ctor.visitInsn(Opcodes.RETURN);
        ctor.visitMaxs(2, 2);
        ctor.visitEnd();

        MethodVisitor accessor = cw.visitMethod(Opcodes.ACC_PUBLIC, "name", "()Ljava/lang/String;", null, null);
        accessor.visitCode();
        accessor.visitVarInsn(Opcodes.ALOAD, 0);
        accessor.visitFieldInsn(Opcodes.GETFIELD, "com/example/mod/records/UserRecord", "name", "Ljava/lang/String;");
        accessor.visitInsn(Opcodes.ARETURN);
        accessor.visitMaxs(1, 1);
        accessor.visitEnd();

        cw.visitEnd();
        return cw.toByteArray();
    }

    private static byte[] pojoInfoBytes() {
        ClassWriter cw = new ClassWriter(0);
        cw.visit(
                Opcodes.V21,
                Opcodes.ACC_PUBLIC,
                "com/example/mod/client/system/PojoInfo",
                null,
                "java/lang/Object",
                null
        );

        cw.visitField(Opcodes.ACC_PRIVATE, "versionString", "Ljava/lang/String;", null, null).visitEnd();
        cw.visitField(Opcodes.ACC_PRIVATE, "latest", "Ljava/lang/String;", null, null).visitEnd();

        MethodVisitor ctor = cw.visitMethod(Opcodes.ACC_PUBLIC, "<init>", "()V", null, null);
        ctor.visitCode();
        ctor.visitVarInsn(Opcodes.ALOAD, 0);
        ctor.visitMethodInsn(Opcodes.INVOKESPECIAL, "java/lang/Object", "<init>", "()V", false);
        ctor.visitInsn(Opcodes.RETURN);
        ctor.visitMaxs(1, 1);
        ctor.visitEnd();

        cw.visitEnd();
        return cw.toByteArray();
    }

    private static byte[] gsonUserBytes() {
        ClassWriter cw = new ClassWriter(0);
        cw.visit(
                Opcodes.V21,
                Opcodes.ACC_PUBLIC,
                "com/example/mod/client/system/GsonUser",
                null,
                "java/lang/Object",
                null
        );

        MethodVisitor ctor = cw.visitMethod(Opcodes.ACC_PUBLIC, "<init>", "()V", null, null);
        ctor.visitCode();
        ctor.visitVarInsn(Opcodes.ALOAD, 0);
        ctor.visitMethodInsn(Opcodes.INVOKESPECIAL, "java/lang/Object", "<init>", "()V", false);
        ctor.visitInsn(Opcodes.RETURN);
        ctor.visitMaxs(1, 1);
        ctor.visitEnd();

        MethodVisitor use = cw.visitMethod(Opcodes.ACC_PUBLIC | Opcodes.ACC_STATIC, "fromJson", "(Lcom/google/gson/Gson;Ljava/lang/String;)Ljava/lang/Object;", null, null);
        use.visitCode();
        use.visitVarInsn(Opcodes.ALOAD, 0);
        use.visitVarInsn(Opcodes.ALOAD, 1);
        use.visitLdcInsn(Type.getObjectType("com/example/mod/client/system/PojoInfo"));
        use.visitMethodInsn(
                Opcodes.INVOKEVIRTUAL,
                "com/google/gson/Gson",
                "fromJson",
                "(Ljava/lang/String;Ljava/lang/Class;)Ljava/lang/Object;",
                false
        );
        use.visitInsn(Opcodes.ARETURN);
        use.visitMaxs(3, 2);
        use.visitEnd();

        cw.visitEnd();
        return cw.toByteArray();
    }

    private static byte[] jsonSerializableBytes() {
        ClassWriter cw = new ClassWriter(0);
        cw.visit(
                Opcodes.V21,
                Opcodes.ACC_PUBLIC | Opcodes.ACC_ABSTRACT | Opcodes.ACC_INTERFACE,
                "com/example/mod/client/system/JsonSerializable",
                null,
                "java/lang/Object",
                null
        );
        cw.visitEnd();
        return cw.toByteArray();
    }

    private static byte[] persistentConfigBytes() {
        ClassWriter cw = new ClassWriter(0);
        cw.visit(
                Opcodes.V21,
                Opcodes.ACC_PUBLIC,
                "com/example/mod/client/system/Config",
                null,
                "java/lang/Object",
                new String[]{"com/example/mod/client/system/JsonSerializable"}
        );

        cw.visitField(
                Opcodes.ACC_PRIVATE,
                "moduleEntries",
                "Ljava/util/Map;",
                "Ljava/util/Map<Ljava/lang/String;Lcom/example/mod/modules/ModuleFile;>;",
                null
        ).visitEnd();

        MethodVisitor ctor = cw.visitMethod(Opcodes.ACC_PUBLIC, "<init>", "()V", null, null);
        ctor.visitCode();
        ctor.visitVarInsn(Opcodes.ALOAD, 0);
        ctor.visitMethodInsn(Opcodes.INVOKESPECIAL, "java/lang/Object", "<init>", "()V", false);
        ctor.visitInsn(Opcodes.RETURN);
        ctor.visitMaxs(1, 1);
        ctor.visitEnd();

        MethodVisitor getter = cw.visitMethod(Opcodes.ACC_PUBLIC, "getModuleEntries", "()Ljava/util/Map;", null, null);
        getter.visitCode();
        getter.visitVarInsn(Opcodes.ALOAD, 0);
        getter.visitFieldInsn(
                Opcodes.GETFIELD,
                "com/example/mod/client/system/Config",
                "moduleEntries",
                "Ljava/util/Map;"
        );
        getter.visitInsn(Opcodes.ARETURN);
        getter.visitMaxs(1, 1);
        getter.visitEnd();

        cw.visitEnd();
        return cw.toByteArray();
    }

    private static byte[] moduleFileBytes() {
        ClassWriter cw = new ClassWriter(0);
        cw.visit(Opcodes.V21, Opcodes.ACC_PUBLIC, "com/example/mod/modules/ModuleFile", null, "java/lang/Object", null);

        cw.visitField(
                Opcodes.ACC_PRIVATE,
                "booleanEntries",
                "Ljava/util/Map;",
                "Ljava/util/Map<Ljava/lang/String;Ljava/lang/Boolean;>;",
                null
        ).visitEnd();
        cw.visitField(
                Opcodes.ACC_PRIVATE,
                "integerEntries",
                "Ljava/util/Map;",
                "Ljava/util/Map<Ljava/lang/String;Ljava/lang/Integer;>;",
                null
        ).visitEnd();

        MethodVisitor ctor = cw.visitMethod(Opcodes.ACC_PUBLIC, "<init>", "()V", null, null);
        ctor.visitCode();
        ctor.visitVarInsn(Opcodes.ALOAD, 0);
        ctor.visitMethodInsn(Opcodes.INVOKESPECIAL, "java/lang/Object", "<init>", "()V", false);
        ctor.visitInsn(Opcodes.RETURN);
        ctor.visitMaxs(1, 1);
        ctor.visitEnd();

        MethodVisitor getter = cw.visitMethod(Opcodes.ACC_PUBLIC, "getBooleanEntries", "()Ljava/util/Map;", null, null);
        getter.visitCode();
        getter.visitVarInsn(Opcodes.ALOAD, 0);
        getter.visitFieldInsn(
                Opcodes.GETFIELD,
                "com/example/mod/modules/ModuleFile",
                "booleanEntries",
                "Ljava/util/Map;"
        );
        getter.visitInsn(Opcodes.ARETURN);
        getter.visitMaxs(1, 1);
        getter.visitEnd();

        cw.visitEnd();
        return cw.toByteArray();
    }
}
