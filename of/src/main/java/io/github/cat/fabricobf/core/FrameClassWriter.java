package io.github.cat.fabricobf.core;

import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.jar.JarFile;
import org.objectweb.asm.ClassReader;
import org.objectweb.asm.ClassWriter;
import org.objectweb.asm.Opcodes;
import org.objectweb.asm.tree.ClassNode;

final class FrameClassWriter extends ClassWriter {
    private static Map<String, Path> defaultClasspathIndex;

    private final Map<String, ClassInfo> knownClasses = new HashMap<>();
    private final Map<String, String> originalToMapped;
    private final Map<String, String> mappedToOriginal = new HashMap<>();
    private final Map<String, Path> classpathIndex;
    private final Set<String> missingClasses = new HashSet<>();

    FrameClassWriter(
            int flags,
            Map<String, ClassData> ownedClasses,
            SymbolMapping mapping
    ) {
        super(flags);
        this.originalToMapped = mapping.classMap();
        mapping.classMap().forEach((original, mapped) -> mappedToOriginal.put(mapped, original));
        ownedClasses.forEach((owner, data) -> knownClasses.put(owner, ClassInfo.from(data.classNode())));
        this.classpathIndex = defaultClasspathIndex();
    }

    @Override
    protected String getCommonSuperClass(String type1, String type2) {
        if (type1.equals(type2)) {
            return type1;
        }
        if (type1.startsWith("[") || type2.startsWith("[")) {
            return "java/lang/Object";
        }

        String original1 = toOriginal(type1);
        String original2 = toOriginal(type2);
        String common = commonOriginalSuperClass(original1, original2);
        return originalToMapped.getOrDefault(common, common);
    }

    private String commonOriginalSuperClass(String type1, String type2) {
        if (isAssignableFrom(type1, type2)) {
            return type1;
        }
        if (isAssignableFrom(type2, type1)) {
            return type2;
        }

        ClassInfo first = resolve(type1);
        ClassInfo second = resolve(type2);
        if (first == null || second == null || first.isInterface() || second.isInterface()) {
            return "java/lang/Object";
        }

        String current = first.superName();
        while (current != null) {
            if (isAssignableFrom(current, type2)) {
                return current;
            }
            ClassInfo info = resolve(current);
            current = info == null ? null : info.superName();
        }
        return "java/lang/Object";
    }

    private boolean isAssignableFrom(String target, String candidate) {
        if (target.equals(candidate)) {
            return true;
        }
        ClassInfo candidateInfo = resolve(candidate);
        if (candidateInfo == null) {
            return false;
        }
        for (String iface : candidateInfo.interfaces()) {
            if (isAssignableFrom(target, iface)) {
                return true;
            }
        }
        String superName = candidateInfo.superName();
        return superName != null && isAssignableFrom(target, superName);
    }

    private ClassInfo resolve(String type) {
        String original = toOriginal(type);
        if ("java/lang/Object".equals(original)) {
            return ClassInfo.OBJECT;
        }
        ClassInfo existing = knownClasses.get(original);
        if (existing != null || missingClasses.contains(original)) {
            return existing;
        }

        ClassInfo loaded = loadClassInfo(original);
        if (loaded == null) {
            missingClasses.add(original);
        } else {
            knownClasses.put(original, loaded);
        }
        return loaded;
    }

    private ClassInfo loadClassInfo(String internalName) {
        Path jar = classpathIndex.get(internalName);
        if (jar != null) {
            try (JarFile jarFile = new JarFile(jar.toFile())) {
                var entry = jarFile.getEntry(internalName + ".class");
                if (entry != null) {
                    try (InputStream input = jarFile.getInputStream(entry)) {
                        return readClassInfo(input);
                    }
                }
            } catch (IOException ignored) {
                return null;
            }
        }

        try (InputStream input = ClassLoader.getSystemResourceAsStream(internalName + ".class")) {
            return input == null ? null : readClassInfo(input);
        } catch (IOException ignored) {
            return null;
        }
    }

    private static ClassInfo readClassInfo(InputStream input) throws IOException {
        ClassNode node = new ClassNode();
        new ClassReader(input.readAllBytes()).accept(
                node,
                ClassReader.SKIP_CODE | ClassReader.SKIP_DEBUG | ClassReader.SKIP_FRAMES
        );
        return ClassInfo.from(node);
    }

    private String toOriginal(String type) {
        return mappedToOriginal.getOrDefault(type, type);
    }

    private static synchronized Map<String, Path> defaultClasspathIndex() {
        if (defaultClasspathIndex != null) {
            return defaultClasspathIndex;
        }
        Map<String, Path> index = new HashMap<>();
        for (Path root : defaultLibraryRoots()) {
            if (!Files.isDirectory(root)) {
                continue;
            }
            try (var paths = Files.walk(root)) {
                paths.filter(path -> path.getFileName().toString().endsWith(".jar"))
                        .forEach(path -> indexJar(index, path));
            } catch (IOException ignored) {
                // Missing or unreadable launcher caches should not prevent obfuscation.
            }
        }
        defaultClasspathIndex = Map.copyOf(index);
        return defaultClasspathIndex;
    }

    private static void indexJar(Map<String, Path> index, Path jar) {
        try (JarFile jarFile = new JarFile(jar.toFile())) {
            jarFile.stream()
                    .filter(entry -> !entry.isDirectory() && entry.getName().endsWith(".class"))
                    .forEach(entry -> {
                        String internalName = entry.getName().substring(0, entry.getName().length() - ".class".length());
                        index.putIfAbsent(internalName, jar);
                    });
        } catch (IOException ignored) {
            // Corrupt jars in a launcher cache are ignored; missing classes fall back gracefully.
        }
    }

    private static List<Path> defaultLibraryRoots() {
        String appData = System.getenv("APPDATA");
        String userHome = System.getProperty("user.home");
        String os = System.getProperty("os.name", "").toLowerCase(Locale.ROOT);

        List<Path> roots = new ArrayList<>();

        // Windows — PrismLauncher and vanilla Minecraft
        if (appData != null) {
            roots.add(Path.of(appData, "PrismLauncher", "libraries"));
            roots.add(Path.of(appData, ".minecraft", "libraries"));
        }
        if (userHome != null) {
            roots.add(Path.of(userHome, "AppData", "Roaming", "PrismLauncher", "libraries"));
            roots.add(Path.of(userHome, "AppData", "Roaming", ".minecraft", "libraries"));
        }

        // macOS — ~/Library/Application Support
        if (os.contains("mac") && userHome != null) {
            roots.add(Path.of(userHome, "Library", "Application Support", "minecraft", "libraries"));
            roots.add(Path.of(userHome, "Library", "Application Support", "PrismLauncher", "libraries"));
        }

        // Linux — XDG_DATA_HOME, ~/.local/share, and ~/.minecraft
        if (!os.contains("win") && !os.contains("mac") && userHome != null) {
            String xdgData = System.getenv("XDG_DATA_HOME");
            if (xdgData != null) {
                roots.add(Path.of(xdgData, "PrismLauncher", "libraries"));
            }
            roots.add(Path.of(userHome, ".local", "share", "PrismLauncher", "libraries"));
            roots.add(Path.of(userHome, ".minecraft", "libraries"));
        }

        return List.copyOf(roots);
    }

    private record ClassInfo(String superName, List<String> interfaces, boolean isInterface) {
        private static final ClassInfo OBJECT = new ClassInfo(null, List.of(), false);

        private static ClassInfo from(ClassNode node) {
            return new ClassInfo(
                    node.superName,
                    List.copyOf(node.interfaces),
                    (node.access & Opcodes.ACC_INTERFACE) != 0
            );
        }
    }
}
