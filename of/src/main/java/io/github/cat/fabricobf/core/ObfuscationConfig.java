package io.github.cat.fabricobf.core;

import java.nio.file.Path;
import java.util.List;

public record ObfuscationConfig(
        Path inputJar,
        Path outputJar,
        long seed,
        boolean dryRun,
        List<String> keepRegexRules,
        boolean renameClasses,
        boolean stringEncryption,
        boolean aggressive,
        boolean max,
        boolean ultra,
        boolean insane,
        boolean stripDebug
) {
    public ObfuscationConfig(
            Path inputJar,
            Path outputJar,
            long seed,
            boolean dryRun,
            List<String> keepRegexRules,
            boolean renameClasses,
            boolean stringEncryption
    ) {
        this(inputJar, outputJar, seed, dryRun, keepRegexRules, renameClasses, stringEncryption, false, false, false, false, false);
    }

    public boolean effectiveRenameClasses() {
        return renameClasses || aggressive || max || ultra || insane;
    }

    public boolean effectiveAggressive() {
        return aggressive || max || ultra || insane;
    }

    public boolean effectiveStringEncryption() {
        return stringEncryption || aggressive || max || ultra || insane;
    }

    public boolean effectiveStripDebug() {
        return stripDebug || aggressive || max || ultra || insane;
    }

    public boolean effectiveMaxMode() {
        return max || ultra || insane;
    }

    public boolean effectiveUltraMode() {
        return ultra || insane;
    }

    public boolean effectiveInsaneMode() {
        return insane;
    }
}
