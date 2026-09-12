package io.github.cat.fabricobf.core;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.google.gson.Gson;
import io.github.cat.fabricobf.testutil.FabricFixtureFactory;
import java.net.URL;
import java.net.URLClassLoader;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;
import java.util.jar.JarFile;
import org.objectweb.asm.ClassReader;
import org.objectweb.asm.tree.AbstractInsnNode;
import org.objectweb.asm.tree.ClassNode;
import org.objectweb.asm.tree.LineNumberNode;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class ObfuscationEngineIntegrationTest {
    @TempDir
    Path tempDir;

    @Test
    void obfuscatesFixtureSafelyAndLoadsAtRuntime() throws Exception {
        Path input = FabricFixtureFactory.createBasicFixtureJar(tempDir, "input.jar");
        Path output = tempDir.resolve("output.jar");

        ObfuscationResult result = new ObfuscationEngine().run(new ObfuscationConfig(
                input,
                output,
                1234L,
                false,
                java.util.List.of(),
                false,
                true
        ));

        assertTrue(Files.exists(output));
        assertNotNull(result.mappingFilePath());
        assertTrue(Files.exists(result.mappingFilePath()));
        assertTrue(result.methodsRenamed() > 0);
        assertTrue(result.fieldsRenamed() > 0);

        String mappings = Files.readString(result.mappingFilePath(), StandardCharsets.UTF_8);
        assertFalse(mappings.contains("CLASS com/example/mod/EntryPoint ->"));
        assertFalse(mappings.contains("CLASS com/example/mod/mixin/MyMixin ->"));
        assertFalse(mappings.contains("METHOD com/example/mod/TargetClass targetMethod ()V ->"));
        assertTrue(mappings.contains("METHOD com/example/mod/Helper hidden ()Ljava/lang/String; ->"));
        assertFalse(mappings.contains("FIELD com/example/mod/settings/SettingBuilder name Ljava/lang/String; ->"));
        assertFalse(mappings.contains("FIELD com/example/mod/client/system/PojoInfo versionString Ljava/lang/String; ->"));
        assertFalse(mappings.contains("FIELD com/example/mod/client/system/PojoInfo latest Ljava/lang/String; ->"));

        try (JarFile jarFile = new JarFile(output.toFile())) {
            assertNotNull(jarFile.getEntry("META-INF/MANIFEST.MF"));
            assertNotNull(jarFile.getEntry("assets/testmod/lang/en_us.json"));
        }

        try (URLClassLoader classLoader = new URLClassLoader(new URL[]{output.toUri().toURL()})) {
            Class<?> entryPoint = classLoader.loadClass("com.example.mod.EntryPoint");
            Object value = entryPoint.getMethod("init").invoke(null);
            assertEquals("secretbuilder", value);

            Class<?> userRecord = classLoader.loadClass("com.example.mod.records.UserRecord");
            Object record = userRecord.getConstructor(String.class).newInstance("Jayyy_Vn");
            String json = new Gson().toJson(record);
            assertTrue(json.contains("\"name\":\"Jayyy_Vn\""));
        }
    }

    @Test
    void deterministicOutputWithSameSeed() throws Exception {
        Path input = FabricFixtureFactory.createBasicFixtureJar(tempDir, "det-input.jar");
        Path dir1 = Files.createDirectories(tempDir.resolve("run1"));
        Path dir2 = Files.createDirectories(tempDir.resolve("run2"));
        Path out1 = dir1.resolve("out.jar");
        Path out2 = dir2.resolve("out.jar");

        ObfuscationEngine engine = new ObfuscationEngine();
        ObfuscationResult first = engine.run(new ObfuscationConfig(
                input,
                out1,
                555L,
                false,
                java.util.List.of(),
                false,
                false
        ));
        ObfuscationResult second = engine.run(new ObfuscationConfig(
                input,
                out2,
                555L,
                false,
                java.util.List.of(),
                false,
                false
        ));

        assertArrayEquals(Files.readAllBytes(out1), Files.readAllBytes(out2));
        assertArrayEquals(
                Files.readAllBytes(first.mappingFilePath()),
                Files.readAllBytes(second.mappingFilePath())
        );
    }

    @Test
    void dryRunDoesNotWriteOutputJar() throws Exception {
        Path input = FabricFixtureFactory.createBasicFixtureJar(tempDir, "dry-input.jar");
        Path output = tempDir.resolve("dry-out.jar");

        ObfuscationResult result = new ObfuscationEngine().run(new ObfuscationConfig(
                input,
                output,
                7L,
                true,
                java.util.List.of(),
                false,
                false
        ));

        assertTrue(result.dryRun());
        assertFalse(Files.exists(output));
        assertEquals(12, result.classesScanned());
    }

    @Test
    void renameClassesOptionRenamesEligibleClasses() throws Exception {
        Path input = FabricFixtureFactory.createBasicFixtureJar(tempDir, "class-input.jar");
        Path output = tempDir.resolve("class-out.jar");
        ObfuscationResult result = new ObfuscationEngine().run(new ObfuscationConfig(
                input,
                output,
                9L,
                false,
                java.util.List.of(),
                true,
                false
        ));
        assertTrue(result.classesRenamed() > 0);
    }

    @Test
    void aggressiveModeKeepsPersistedJsonFieldsAndStripsDebugMetadata() throws Exception {
        Path input = FabricFixtureFactory.createBasicFixtureJar(tempDir, "aggressive-input.jar");
        Path output = tempDir.resolve("aggressive-out.jar");

        ObfuscationResult result = new ObfuscationEngine().run(new ObfuscationConfig(
                input,
                output,
                20260522L,
                false,
                java.util.List.of(),
                false,
                false,
                true,
                false,
                false,
                false,
                false
        ));

        assertTrue(result.classesRenamed() > 0);
        String mappings = Files.readString(result.mappingFilePath(), StandardCharsets.UTF_8);
        assertTrue(mappings.contains("CLASS com/example/mod/Helper ->"));
        assertFalse(mappings.contains("FIELD com/example/mod/client/system/Config moduleEntries Ljava/util/Map; ->"));
        assertFalse(mappings.contains("FIELD com/example/mod/modules/ModuleFile booleanEntries Ljava/util/Map; ->"));
        assertFalse(mappings.contains("FIELD com/example/mod/modules/ModuleFile integerEntries Ljava/util/Map; ->"));

        String configName = mappedClassName(mappings, "com/example/mod/client/system/Config");
        try (URLClassLoader classLoader = new URLClassLoader(new URL[]{output.toUri().toURL()})) {
            Class<?> configClass = classLoader.loadClass(configName.replace('/', '.'));
            String json = """
                    {
                      "moduleEntries": {
                        "combat": {
                          "booleanEntries": {"enabled": true},
                          "integerEntries": {"key": 42}
                        }
                      }
                    }
                    """;
            Object config = new Gson().fromJson(json, configClass);
            Map<?, ?> moduleEntries = (Map<?, ?>) configClass.getMethod("getModuleEntries").invoke(config);
            assertNotNull(moduleEntries);
            Object moduleFile = moduleEntries.get("combat");
            assertNotNull(moduleFile);

            var booleanEntries = moduleFile.getClass().getDeclaredField("booleanEntries");
            booleanEntries.setAccessible(true);
            Map<?, ?> booleans = (Map<?, ?>) booleanEntries.get(moduleFile);
            assertEquals(Boolean.TRUE, booleans.get("enabled"));
        }

        try (JarFile jarFile = new JarFile(output.toFile())) {
            String helperEntry = mappedClassName(mappings, "com/example/mod/Helper") + ".class";
            byte[] helperBytes = jarFile.getInputStream(jarFile.getEntry(helperEntry)).readAllBytes();
            String helperClassText = new String(helperBytes, StandardCharsets.ISO_8859_1);
            assertFalse(helperClassText.contains("boot"));
            assertFalse(helperClassText.contains("pkg"));
            assertFalse(helperClassText.contains("secret"));

            ClassNode node = new ClassNode();
            new ClassReader(helperBytes).accept(node, 0);
            assertEquals(null, node.sourceFile);
            assertFalse(hasLineNumbers(node));
        }
    }

    @Test
    void maxModeAddsControlFlowNoiseAndPreservesRuntimeBehavior() throws Exception {
        Path input = FabricFixtureFactory.createBasicFixtureJar(tempDir, "max-input.jar");
        Path output = tempDir.resolve("max-out.jar");

        ObfuscationResult result = new ObfuscationEngine().run(new ObfuscationConfig(
                input,
                output,
                20260522L,
                false,
                java.util.List.of(),
                false,
                false,
                false,
                true,
                false,
                false,
                false
        ));

        assertTrue(result.classesRenamed() > 0);
        String mappings = Files.readString(result.mappingFilePath(), StandardCharsets.UTF_8);

        try (URLClassLoader classLoader = new URLClassLoader(new URL[]{output.toUri().toURL()})) {
            Class<?> entryPoint = classLoader.loadClass("com.example.mod.EntryPoint");
            Object value = entryPoint.getMethod("init").invoke(null);
            assertEquals("secretbuilder", value);
        }

        try (JarFile jarFile = new JarFile(output.toFile())) {
            String helperEntry = mappedClassName(mappings, "com/example/mod/Helper") + ".class";
            byte[] helperBytes = jarFile.getInputStream(jarFile.getEntry(helperEntry)).readAllBytes();
            String helperClassText = new String(helperBytes, StandardCharsets.ISO_8859_1);
            assertTrue(helperClassText.contains("$cf$"));
            assertFalse(helperClassText.contains("secret"));
        }
    }

    @Test
    void ultraModeObfuscatesNumericConstantsAndPreservesRuntimeBehavior() throws Exception {
        Path input = FabricFixtureFactory.createBasicFixtureJar(tempDir, "ultra-input.jar");
        Path output = tempDir.resolve("ultra-out.jar");

        ObfuscationResult result = new ObfuscationEngine().run(new ObfuscationConfig(
                input,
                output,
                20260522L,
                false,
                java.util.List.of(),
                false,
                false,
                false,
                false,
                true,
                false,
                false
        ));

        String mappings = Files.readString(result.mappingFilePath(), StandardCharsets.UTF_8);
        assertTrue(result.classesRenamed() > 0);

        try (URLClassLoader classLoader = new URLClassLoader(new URL[]{output.toUri().toURL()})) {
            Class<?> entryPoint = classLoader.loadClass("com.example.mod.EntryPoint");
            Object value = entryPoint.getMethod("init").invoke(null);
            assertEquals("secretbuilder", value);
        }

        try (JarFile jarFile = new JarFile(output.toFile())) {
            String helperEntry = mappedClassName(mappings, "com/example/mod/Helper") + ".class";
            byte[] helperBytes = jarFile.getInputStream(jarFile.getEntry(helperEntry)).readAllBytes();
            String helperClassText = new String(helperBytes, StandardCharsets.ISO_8859_1);
            assertTrue(helperClassText.contains("$cf$"));
            assertTrue(helperClassText.contains("$fabricobf$dec$"));
        }
    }

    @Test
    void insaneModeAddsHeavierNoiseAndPreservesRuntimeBehavior() throws Exception {
        Path input = FabricFixtureFactory.createBasicFixtureJar(tempDir, "insane-input.jar");
        Path output = tempDir.resolve("insane-out.jar");

        ObfuscationResult result = new ObfuscationEngine().run(new ObfuscationConfig(
                input,
                output,
                20260522L,
                false,
                java.util.List.of(),
                false,
                false,
                false,
                false,
                false,
                true,
                false
        ));

        String mappings = Files.readString(result.mappingFilePath(), StandardCharsets.UTF_8);
        assertTrue(result.classesRenamed() > 0);

        try (URLClassLoader classLoader = new URLClassLoader(new URL[]{output.toUri().toURL()})) {
            Class<?> entryPoint = classLoader.loadClass("com.example.mod.EntryPoint");
            Object value = entryPoint.getMethod("init").invoke(null);
            assertEquals("secretbuilder", value);
        }

        try (JarFile jarFile = new JarFile(output.toFile())) {
            String helperEntry = mappedClassName(mappings, "com/example/mod/Helper") + ".class";
            byte[] helperBytes = jarFile.getInputStream(jarFile.getEntry(helperEntry)).readAllBytes();
            String helperClassText = new String(helperBytes, StandardCharsets.ISO_8859_1);
            assertTrue(helperClassText.contains("$fabricobf$dec$"));
            assertTrue(jarContainsText(jarFile, "$cf$ret$"));
        }
    }

    private static String mappedClassName(String mappings, String owner) {
        String prefix = "CLASS " + owner + " -> ";
        for (String line : mappings.split("\\R")) {
            if (line.startsWith(prefix)) {
                return line.substring(prefix.length());
            }
        }
        return owner;
    }

    private static boolean hasLineNumbers(ClassNode node) {
        return node.methods.stream().anyMatch(method -> {
            for (AbstractInsnNode insn = method.instructions.getFirst(); insn != null; insn = insn.getNext()) {
                if (insn instanceof LineNumberNode) {
                    return true;
                }
            }
            return false;
        });
    }

    private static boolean jarContainsText(JarFile jarFile, String text) {
        return jarFile.stream()
                .filter(entry -> !entry.isDirectory() && entry.getName().endsWith(".class"))
                .anyMatch(entry -> {
                    try {
                        byte[] bytes = jarFile.getInputStream(entry).readAllBytes();
                        return new String(bytes, StandardCharsets.ISO_8859_1).contains(text);
                    } catch (Exception ignored) {
                        return false;
                    }
                });
    }
}
