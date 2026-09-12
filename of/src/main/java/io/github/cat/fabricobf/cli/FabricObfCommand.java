package io.github.cat.fabricobf.cli;

import io.github.cat.fabricobf.core.ObfuscationConfig;
import io.github.cat.fabricobf.core.ObfuscationEngine;
import io.github.cat.fabricobf.core.ObfuscationResult;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.Callable;
import picocli.CommandLine.Command;
import picocli.CommandLine.Option;

@Command(
        name = "fabric-obf",
        mixinStandardHelpOptions = true,
        version = "fabric-obf 1.0.0",
        description = "Safety-first Fabric mod obfuscator.",
        footer = {
                "",
                "Examples:",
                "  java -jar fabric-obf.jar --in mymod.jar --out mymod-obf.jar",
                "  java -jar fabric-obf.jar --in mymod.jar --out mymod-obf.jar --seed 1337 --keep '^C:com/example/api/.*$'",
                "  java -jar fabric-obf.jar --in mymod.jar --out mymod-obf.jar --rename-classes --string-encryption",
                "  java -jar fabric-obf.jar --in mymod.jar --out mymod-obf.jar --aggressive",
                "  java -jar fabric-obf.jar --in mymod.jar --out mymod-obf.jar --max",
                "  java -jar fabric-obf.jar --in mymod.jar --out mymod-obf.jar --ultra",
                "  java -jar fabric-obf.jar --in mymod.jar --out mymod-obf.jar --insane",
                "  java -jar fabric-obf.jar --in mymod.jar --out mymod-obf.jar --dry-run"
        }
)
public final class FabricObfCommand implements Callable<Integer> {
    @Option(names = "--in", required = true, description = "Input Fabric mod jar.")
    private Path input;

    @Option(names = "--out", required = true, description = "Output obfuscated jar.")
    private Path output;

    @Option(names = "--seed", defaultValue = "0", description = "Deterministic renaming seed.")
    private long seed;

    @Option(names = "--dry-run", description = "Analyze and generate mapping without writing output jar.")
    private boolean dryRun;

    @Option(names = "--keep", description = "Regex keep rule. Repeatable.")
    private List<String> keepRules = new ArrayList<>();

    @Option(names = "--rename-classes", description = "Enable class renaming in mod-owned packages.")
    private boolean renameClasses;

    @Option(names = "--string-encryption", description = "Opt-in conservative string encryption (constants-only).")
    private boolean stringEncryption;

    @Option(names = "--strip-debug", description = "Strip SourceFile, line numbers, and local variable debug metadata.")
    private boolean stripDebug;

    @Option(names = "--aggressive", description = "Enable stronger safe obfuscation: class renaming, string encryption, and debug stripping.")
    private boolean aggressive;

    @Option(names = "--max", description = "Enable strongest mode: aggressive plus control-flow obfuscation and broader string encryption.")
    private boolean max;

    @Option(names = "--ultra", description = "Enable ultra mode: max plus arithmetic constant obfuscation.")
    private boolean ultra;

    @Option(names = "--insane", description = "Enable highest-risk mode: ultra plus heavier control-flow and primitive constant obfuscation.")
    private boolean insane;

    @Override
    public Integer call() {
        ObfuscationConfig config = new ObfuscationConfig(
                input,
                output,
                seed,
                dryRun,
                keepRules,
                renameClasses,
                stringEncryption,
                aggressive,
                max,
                ultra,
                insane,
                stripDebug
        );
        try {
            ObfuscationResult result = new ObfuscationEngine().run(config);
            System.out.println(result.summaryText());
            return 0;
        } catch (Exception ex) {
            System.err.println("fabric-obf failed: " + ex.getMessage());
            return 1;
        }
    }
}
