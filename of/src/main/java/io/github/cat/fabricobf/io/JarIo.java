package io.github.cat.fabricobf.io;

import io.github.cat.fabricobf.core.ClassData;
import io.github.cat.fabricobf.core.JarArchive;
import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.jar.JarEntry;
import java.util.jar.JarFile;
import java.util.jar.JarOutputStream;
import org.objectweb.asm.ClassReader;
import org.objectweb.asm.tree.ClassNode;

public final class JarIo {
    private static final long FIXED_TIMESTAMP = 0L;

    private JarIo() {
    }

    public static JarArchive read(Path inputJar) throws IOException {
        Map<String, ClassData> classes = new LinkedHashMap<>();
        Map<String, byte[]> resources = new LinkedHashMap<>();
        try (JarFile jarFile = new JarFile(inputJar.toFile())) {
            jarFile.stream()
                    .filter(entry -> !entry.isDirectory())
                    .forEach(entry -> {
                        try (InputStream in = new BufferedInputStream(jarFile.getInputStream(entry))) {
                            byte[] bytes = in.readAllBytes();
                            if (entry.getName().endsWith(".class")) {
                                ClassNode classNode = new ClassNode();
                                new ClassReader(bytes).accept(classNode, ClassReader.EXPAND_FRAMES);
                                classes.put(entry.getName(), new ClassData(entry.getName(), bytes, classNode));
                            } else {
                                resources.put(entry.getName(), bytes);
                            }
                        } catch (IOException ex) {
                            throw new IllegalStateException("Failed reading jar entry " + entry.getName(), ex);
                        }
                    });
        }
        return new JarArchive(classes, resources);
    }

    public static void write(Path outputJar, Map<String, byte[]> classEntries, Map<String, byte[]> resources) throws IOException {
        Path parent = outputJar.getParent();
        if (parent != null) {
            Files.createDirectories(parent);
        }

        List<Map.Entry<String, byte[]>> allEntries = new ArrayList<>();
        allEntries.addAll(resources.entrySet());
        allEntries.addAll(classEntries.entrySet());
        allEntries.sort(Comparator.comparing(Map.Entry::getKey));

        try (JarOutputStream jarOutputStream = new JarOutputStream(
                new BufferedOutputStream(Files.newOutputStream(outputJar)))
        ) {
            for (Map.Entry<String, byte[]> entry : allEntries) {
                JarEntry jarEntry = new JarEntry(entry.getKey());
                jarEntry.setTime(FIXED_TIMESTAMP);
                jarOutputStream.putNextEntry(jarEntry);
                jarOutputStream.write(entry.getValue());
                jarOutputStream.closeEntry();
            }
        }
    }
}

