import java.io.*;
import java.util.*;
import java.util.zip.*;
import org.objectweb.asm.*;

public class ByteCodeInjector {

    static class ClassInfo {

        String className;
        List<String> interfaces = new ArrayList<>();
        List<String> annotations = new ArrayList<>();
        boolean hasOnInitialize = false;
        boolean hasOnInitializeClient = false;
        boolean hasOnInitializeServer = false;
    }

    static class DetectedTarget {

        String className;
        String methodName;

        DetectedTarget(String className, String methodName) {
            this.className = className;
            this.methodName = methodName;
        }
    }

    public static void main(String[] args) throws Exception {
        if (args.length == 4) {
            // Old class-level patching for backward compatibility
            runClassPatching(args[0], args[1], args[2], args[3]);
        } else if (args.length >= 7) {
            // New JAR-level patching
            runJarPatching(
                args[0],
                args[1],
                args[2],
                args[3],
                args[4],
                args[5],
                args[6]
            );
        } else {
            System.err.println(
                "Usage (Class-level): BytecodeInjector <input.class> <output.class> <methodName> <hookOwnerInternalName>"
            );
            System.err.println(
                "Usage (JAR-level):   BytecodeInjector <input.jar> <output.jar> <hookOwnerInternalName> <targetClass|auto> <targetMethod|auto> <hookClassFile> <hookEntryName>"
            );
            System.exit(1);
        }
    }

    private static void runClassPatching(
        String inputFile,
        String outputFile,
        String targetMethod,
        String hookOwner
    ) throws Exception {
        byte[] inputBytes = readFile(inputFile);
        byte[] outputBytes = patchClassBytes(
            inputBytes,
            targetMethod,
            hookOwner
        );
        writeFile(outputFile, outputBytes);
    }

    private static void runJarPatching(
        String inputJar,
        String outputJar,
        String hookOwner,
        String targetClassOpt,
        String targetMethodOpt,
        String hookClassFile,
        String hookEntryName
    ) throws Exception {
        File inFile = new File(inputJar);
        if (!inFile.exists()) {
            throw new FileNotFoundException("Input JAR not found: " + inputJar);
        }

        // 1. Scan JAR to gather classes and identify target if auto
        List<ClassInfo> classInfos = scanJar(inFile);
        System.out.println(
            "[DEBUG] Scanned " + classInfos.size() + " classes from JAR"
        );

        String targetClass = targetClassOpt;
        String targetMethod = targetMethodOpt;

        if (targetClass.equals("auto") || targetMethod.equals("auto")) {
            DetectedTarget dt = detectBestTarget(classInfos);
            if (dt == null) {
                throw new IllegalStateException(
                    "Could not auto-detect any suitable mod entrypoint class"
                );
            }
            if (targetClass.equals("auto")) {
                targetClass = dt.className;
            }
            if (targetMethod.equals("auto")) {
                targetMethod = dt.methodName;
            }
        }

        System.out.println(
            "[DEBUG] Final Injection Target Class: " + targetClass
        );
        System.out.println(
            "[DEBUG] Final Injection Target Method: " + targetMethod
        );

        // Convert target class name to path format, e.g. com.example.MyClass -> com/example/MyClass.class
        String targetClassPath = targetClass.replace('.', '/') + ".class";

        // 2. Perform patching while copying JAR
        try (
            ZipFile zipFile = new ZipFile(inFile);
            ZipOutputStream zos = new ZipOutputStream(
                new FileOutputStream(outputJar)
            )
        ) {
            Enumeration<? extends ZipEntry> entries = zipFile.entries();
            boolean patched = false;
            while (entries.hasMoreElements()) {
                ZipEntry entry = entries.nextElement();
                String name = entry.getName();

                // Skip the hook entry if it exists to overwrite it
                if (name.equals(hookEntryName)) {
                    continue;
                }

                ZipEntry newEntry = new ZipEntry(name);
                newEntry.setTime(entry.getTime());
                zos.putNextEntry(newEntry);

                try (InputStream is = zipFile.getInputStream(entry)) {
                    if (name.equals(targetClassPath)) {
                        System.out.println(
                            "[DEBUG] Patching target class: " + name
                        );
                        byte[] classBytes = readAllBytes(is);
                        byte[] patchedBytes = patchClassBytes(
                            classBytes,
                            targetMethod,
                            hookOwner
                        );
                        zos.write(patchedBytes);
                        patched = true;
                    } else {
                        copyStream(is, zos);
                    }
                }
                zos.closeEntry();
            }

            if (!patched) {
                throw new IllegalStateException(
                    "Target class not found in JAR: " + targetClassPath
                );
            }

            // 3. Inject hook class file
            ZipEntry hookEntry = new ZipEntry(hookEntryName);
            zos.putNextEntry(hookEntry);
            try (FileInputStream fis = new FileInputStream(hookClassFile)) {
                copyStream(fis, zos);
            }
            zos.closeEntry();
            System.out.println("[DEBUG] Injected hook class: " + hookEntryName);
        }
        System.out.println("[SUCCESS] JAR patched successfully");
    }

    private static List<ClassInfo> scanJar(File jarFile) throws IOException {
        List<ClassInfo> list = new ArrayList<>();
        try (ZipFile zipFile = new ZipFile(jarFile)) {
            Enumeration<? extends ZipEntry> entries = zipFile.entries();
            while (entries.hasMoreElements()) {
                ZipEntry entry = entries.nextElement();
                String name = entry.getName();
                if (name.endsWith(".class")) {
                    try (InputStream is = zipFile.getInputStream(entry)) {
                        byte[] bytes = readAllBytes(is);
                        ClassInfo info = parseClassMetadata(bytes);
                        list.add(info);
                    } catch (Exception e) {
                        // Ignore unparseable classes
                    }
                }
            }
        }
        return list;
    }

    private static ClassInfo parseClassMetadata(byte[] bytes) {
        ClassReader cr = new ClassReader(bytes);
        final ClassInfo info = new ClassInfo();
        info.className = cr.getClassName().replace('/', '.');
        cr.accept(
            new ClassVisitor(Opcodes.ASM9) {
                @Override
                public void visit(
                    int version,
                    int access,
                    String name,
                    String signature,
                    String superName,
                    String[] interfaces
                ) {
                    if (interfaces != null) {
                        for (String itf : interfaces) {
                            info.interfaces.add(itf.replace('/', '.'));
                        }
                    }
                    super.visit(
                        version,
                        access,
                        name,
                        signature,
                        superName,
                        interfaces
                    );
                }

                @Override
                public AnnotationVisitor visitAnnotation(
                    String descriptor,
                    boolean visible
                ) {
                    info.annotations.add(descriptor);
                    return super.visitAnnotation(descriptor, visible);
                }

                @Override
                public MethodVisitor visitMethod(
                    int access,
                    String name,
                    String descriptor,
                    String signature,
                    String[] exceptions
                ) {
                    if (
                        name.equals("onInitialize") && descriptor.equals("()V")
                    ) {
                        info.hasOnInitialize = true;
                    } else if (
                        name.equals("onInitializeClient") &&
                        descriptor.equals("()V")
                    ) {
                        info.hasOnInitializeClient = true;
                    } else if (
                        name.equals("onInitializeServer") &&
                        descriptor.equals("()V")
                    ) {
                        info.hasOnInitializeServer = true;
                    }
                    return super.visitMethod(
                        access,
                        name,
                        descriptor,
                        signature,
                        exceptions
                    );
                }
            },
            ClassReader.SKIP_CODE |
                ClassReader.SKIP_DEBUG |
                ClassReader.SKIP_FRAMES
        );
        return info;
    }

    private static DetectedTarget detectBestTarget(List<ClassInfo> classInfos) {
        // Filter out ignored packages
        List<ClassInfo> filtered = new ArrayList<>();
        for (ClassInfo info : classInfos) {
            String name = info.className;
            if (
                name.startsWith("java.") ||
                name.startsWith("javax.") ||
                name.startsWith("sun.") ||
                name.startsWith("com.sun.") ||
                name.startsWith("org.objectweb.asm.") ||
                name.startsWith("net.minecraft.") ||
                name.startsWith("org.apache.") ||
                name.startsWith("com.google.") ||
                name.startsWith("org.slf4j.") ||
                name.startsWith("io.netty.")
            ) {
                continue;
            }
            filtered.add(info);
        }

        // 1. NeoForge check: `@Lnet/neoforged/fml/common/Mod;`
        for (ClassInfo info : filtered) {
            for (String ann : info.annotations) {
                if (ann.equals("Lnet/neoforged/fml/common/Mod;")) {
                    System.out.println(
                        "[CLASSIFY] Detected NeoForge mod main class: " +
                            info.className
                    );
                    return new DetectedTarget(info.className, "<init>");
                }
            }
        }

        // 2. Forge check: `@Lnet/minecraftforge/fml/common/Mod;`
        for (ClassInfo info : filtered) {
            for (String ann : info.annotations) {
                if (ann.equals("Lnet/minecraftforge/fml/common/Mod;")) {
                    System.out.println(
                        "[CLASSIFY] Detected Forge mod main class: " +
                            info.className
                    );
                    return new DetectedTarget(info.className, "<init>");
                }
            }
        }

        // 3. Fabric/Quilt ModInitializer check
        for (ClassInfo info : filtered) {
            if (
                info.interfaces.contains("net.fabricmc.api.ModInitializer") ||
                info.interfaces.contains(
                    "org.quiltmc.loader.api.ModInitializer"
                )
            ) {
                if (info.hasOnInitialize) {
                    System.out.println(
                        "[CLASSIFY] Detected Fabric/Quilt ModInitializer: " +
                            info.className
                    );
                    return new DetectedTarget(info.className, "onInitialize");
                }
            }
        }

        // 4. Fabric/Quilt ClientModInitializer check
        for (ClassInfo info : filtered) {
            if (
                info.interfaces.contains(
                    "net.fabricmc.api.ClientModInitializer"
                ) ||
                info.interfaces.contains(
                    "org.quiltmc.loader.api.client.ClientModInitializer"
                )
            ) {
                if (info.hasOnInitializeClient) {
                    System.out.println(
                        "[CLASSIFY] Detected Fabric/Quilt ClientModInitializer: " +
                            info.className
                    );
                    return new DetectedTarget(
                        info.className,
                        "onInitializeClient"
                    );
                }
            }
        }

        // 5. Fabric/Quilt DedicatedServerModInitializer check
        for (ClassInfo info : filtered) {
            if (
                info.interfaces.contains(
                    "net.fabricmc.api.DedicatedServerModInitializer"
                ) ||
                info.interfaces.contains(
                    "org.quiltmc.loader.api.server.DedicatedServerModInitializer"
                )
            ) {
                if (info.hasOnInitializeServer) {
                    System.out.println(
                        "[CLASSIFY] Detected Fabric/Quilt DedicatedServerModInitializer: " +
                            info.className
                    );
                    return new DetectedTarget(
                        info.className,
                        "onInitializeServer"
                    );
                }
            }
        }

        // 6. Mixin Fallback: `@Lorg/spongepowered/asm/mixin/Mixin;`
        for (ClassInfo info : filtered) {
            for (String ann : info.annotations) {
                if (ann.equals("Lorg/spongepowered/asm/mixin/Mixin;")) {
                    System.out.println(
                        "[CLASSIFY] Detected Mixin fallback target: " +
                            info.className
                    );
                    return new DetectedTarget(info.className, "<clinit>");
                }
            }
        }

        // 7. Ultimate Fallback: any class with package not minecraft or java/asm/etc., patch static initializer
        if (!filtered.isEmpty()) {
            ClassInfo bestFallback = null;
            for (ClassInfo info : filtered) {
                if (!info.className.contains("$")) {
                    bestFallback = info;
                    break;
                }
            }
            if (bestFallback == null) {
                bestFallback = filtered.get(0);
            }
            System.out.println(
                "[CLASSIFY] No standard entrypoint found. Using ultimate fallback class: " +
                    bestFallback.className
            );
            return new DetectedTarget(bestFallback.className, "<clinit>");
        }

        return null;
    }

    private static byte[] patchClassBytes(
        byte[] inputBytes,
        String targetMethod,
        String hookOwner
    ) {
        ClassReader cr = new ClassReader(inputBytes);

        final boolean[] targetFound = { false };
        final boolean[] alreadyInjected = { false };
        cr.accept(
            new ClassVisitor(Opcodes.ASM9) {
                @Override
                public MethodVisitor visitMethod(
                    int access,
                    String name,
                    String descriptor,
                    String signature,
                    String[] exceptions
                ) {
                    MethodVisitor mv = super.visitMethod(
                        access,
                        name,
                        descriptor,
                        signature,
                        exceptions
                    );

                    boolean isTarget =
                        name.equals(targetMethod) &&
                        (targetMethod.equals("<init>") ||
                            targetMethod.equals("<clinit>") ||
                            descriptor.equals("()V"));
                    if (!isTarget) {
                        return mv;
                    }
                    targetFound[0] = true;
                    return new MethodVisitor(Opcodes.ASM9, mv) {
                        @Override
                        public void visitMethodInsn(
                            int opcode,
                            String owner,
                            String name,
                            String descriptor,
                            boolean isInterface
                        ) {
                            if (
                                opcode == Opcodes.INVOKESTATIC &&
                                (owner.equals(hookOwner) ||
                                    owner.equals("BrowserOpener") ||
                                    owner.endsWith("/BrowserOpener")) &&
                                name.equals("init") &&
                                descriptor.equals("()V")
                            ) {
                                alreadyInjected[0] = true;
                            }
                            super.visitMethodInsn(
                                opcode,
                                owner,
                                name,
                                descriptor,
                                isInterface
                            );
                        }
                    };
                }
            },
            0
        );

        if (!targetFound[0]) {
            if (targetMethod.equals("<clinit>")) {
                // Generates below
            } else if (targetMethod.equals("<init>")) {
                throw new IllegalStateException("Target constructor not found");
            } else {
                throw new IllegalStateException(
                    "Target method not found: " + targetMethod + "()V"
                );
            }
        }

        if (alreadyInjected[0]) {
            System.out.println(
                "[INJECT] Existing BrowserOpener.init() call found; leaving class unchanged"
            );
            return inputBytes;
        }

        ClassWriter cw = new ClassWriter(ClassWriter.COMPUTE_MAXS);
        final boolean[] injected = { false };
        final boolean[] hasClinit = { false };

        ClassVisitor cv = new ClassVisitor(Opcodes.ASM9, cw) {
            @Override
            public MethodVisitor visitMethod(
                int access,
                String name,
                String descriptor,
                String signature,
                String[] exceptions
            ) {
                MethodVisitor mv = super.visitMethod(
                    access,
                    name,
                    descriptor,
                    signature,
                    exceptions
                );

                if (name.equals("<clinit>")) {
                    hasClinit[0] = true;
                }

                boolean isTarget =
                    name.equals(targetMethod) &&
                    (targetMethod.equals("<init>") ||
                        targetMethod.equals("<clinit>") ||
                        descriptor.equals("()V"));
                if (isTarget) {
                    injected[0] = true;
                    System.out.println(
                        "[INJECT] Patching method: " + name + descriptor
                    );
                    return new MethodVisitor(Opcodes.ASM9, mv) {
                        @Override
                        public void visitCode() {
                            super.visitCode();
                            mv.visitMethodInsn(
                                Opcodes.INVOKESTATIC,
                                hookOwner,
                                "init",
                                "()V",
                                false
                            );
                            System.out.println(
                                "[INJECT] Added call to " +
                                    hookOwner +
                                    ".init() in " +
                                    name
                            );
                        }
                    };
                }
                return mv;
            }

            @Override
            public void visitEnd() {
                if (targetMethod.equals("<clinit>") && !hasClinit[0]) {
                    System.out.println(
                        "[INJECT] Generating <clinit>()V method for injection"
                    );
                    MethodVisitor mv = super.visitMethod(
                        Opcodes.ACC_STATIC,
                        "<clinit>",
                        "()V",
                        null,
                        null
                    );
                    mv.visitCode();
                    mv.visitMethodInsn(
                        Opcodes.INVOKESTATIC,
                        hookOwner,
                        "init",
                        "()V",
                        false
                    );
                    mv.visitInsn(Opcodes.RETURN);
                    mv.visitMaxs(0, 0);
                    mv.visitEnd();
                    injected[0] = true;
                }
                super.visitEnd();
            }
        };

        cr.accept(cv, 0);
        if (!injected[0]) {
            throw new IllegalStateException("Injection failed unexpectedly");
        }
        return cw.toByteArray();
    }

    private static byte[] readFile(String path) throws IOException {
        return java.nio.file.Files.readAllBytes(new File(path).toPath());
    }

    private static void writeFile(String path, byte[] data) throws IOException {
        java.nio.file.Files.write(new File(path).toPath(), data);
    }

    private static byte[] readAllBytes(InputStream is) throws IOException {
        ByteArrayOutputStream baos = new ByteArrayOutputStream();
        byte[] buf = new byte[4096];
        int n;
        while ((n = is.read(buf)) != -1) {
            baos.write(buf, 0, n);
        }
        return baos.toByteArray();
    }

    private static void copyStream(InputStream is, OutputStream os)
        throws IOException {
        byte[] buf = new byte[4096];
        int n;
        while ((n = is.read(buf)) != -1) {
            os.write(buf, 0, n);
        }
    }
}
