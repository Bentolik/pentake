package io.github.cat.fabricobf.core;

import java.nio.file.Path;
import java.util.List;

public record ObfuscationResult(
        int classesScanned,
        int classesRenamed,
        int methodsRenamed,
        int fieldsRenamed,
        int resourcesCopied,
        List<String> warnings,
        Path outputJarPath,
        Path mappingFilePath,
        boolean dryRun
) {
    public String summaryText() {
        StringBuilder sb = new StringBuilder();
        sb.append("fabric-obf summary").append(System.lineSeparator());
        sb.append("  classes scanned: ").append(classesScanned).append(System.lineSeparator());
        sb.append("  classes renamed: ").append(classesRenamed).append(System.lineSeparator());
        sb.append("  methods renamed: ").append(methodsRenamed).append(System.lineSeparator());
        sb.append("  fields renamed: ").append(fieldsRenamed).append(System.lineSeparator());
        sb.append("  resources copied: ").append(resourcesCopied).append(System.lineSeparator());
        sb.append("  warnings/skips: ").append(warnings.size()).append(System.lineSeparator());
        if (!warnings.isEmpty()) {
            for (String warning : warnings) {
                sb.append("    - ").append(warning).append(System.lineSeparator());
            }
        }
        if (dryRun) {
            sb.append("  dry-run: no output jar written").append(System.lineSeparator());
            if (mappingFilePath != null) {
                sb.append("  mapping report: ").append(mappingFilePath).append(System.lineSeparator());
            }
        } else {
            sb.append("  output jar: ").append(outputJarPath).append(System.lineSeparator());
            sb.append("  mappings: ").append(mappingFilePath).append(System.lineSeparator());
        }
        return sb.toString();
    }
}

