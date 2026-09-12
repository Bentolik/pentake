package io.github.cat.fabricobf.io;

import io.github.cat.fabricobf.core.MemberRef;
import io.github.cat.fabricobf.core.SymbolMapping;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;

public final class MappingFileWriter {
    public Path write(Path directory, SymbolMapping mapping) throws IOException {
        Files.createDirectories(directory);
        Path path = directory.resolve("fabric-obf-mappings.txt");
        Files.writeString(path, render(mapping), StandardCharsets.UTF_8);
        return path;
    }

    public String render(SymbolMapping mapping) {
        List<String> lines = new ArrayList<>();
        lines.add("# fabric-obf mappings");

        mapping.classMap().entrySet().stream()
                .sorted(Map.Entry.comparingByKey())
                .forEach(entry -> lines.add("CLASS " + entry.getKey() + " -> " + entry.getValue()));

        mapping.methodMap().entrySet().stream()
                .sorted(Comparator.comparing((Map.Entry<MemberRef, String> e) -> e.getKey().owner())
                        .thenComparing(e -> e.getKey().name())
                        .thenComparing(e -> e.getKey().desc()))
                .forEach(entry -> {
                    MemberRef ref = entry.getKey();
                    lines.add("METHOD " + ref.owner() + " " + ref.name() + " " + ref.desc() + " -> " + entry.getValue());
                });

        mapping.fieldMap().entrySet().stream()
                .sorted(Comparator.comparing((Map.Entry<MemberRef, String> e) -> e.getKey().owner())
                        .thenComparing(e -> e.getKey().name())
                        .thenComparing(e -> e.getKey().desc()))
                .forEach(entry -> {
                    MemberRef ref = entry.getKey();
                    lines.add("FIELD " + ref.owner() + " " + ref.name() + " " + ref.desc() + " -> " + entry.getValue());
                });

        return String.join(System.lineSeparator(), lines) + System.lineSeparator();
    }
}

