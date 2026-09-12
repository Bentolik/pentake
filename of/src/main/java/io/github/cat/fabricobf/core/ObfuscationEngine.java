package io.github.cat.fabricobf.core;

import io.github.cat.fabricobf.io.JarIo;
import io.github.cat.fabricobf.io.MappingFileWriter;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;

public final class ObfuscationEngine {
    private final ObfuscationAnalyzer analyzer = new ObfuscationAnalyzer();
    private final MappingGenerator mappingGenerator = new MappingGenerator();
    private final ObfuscationApplier applier = new ObfuscationApplier();
    private final MappingFileWriter mappingFileWriter = new MappingFileWriter();

    public ObfuscationResult run(ObfuscationConfig config) throws Exception {
        validateConfig(config);
        JarArchive archive = JarIo.read(config.inputJar());
        AnalysisResult analysisResult = analyzer.analyze(archive, config);
        MappingGenerationResult mappingResult = mappingGenerator.generate(analysisResult, config);
        SymbolMapping mapping = mappingResult.mapping();

        List<String> warnings = new ArrayList<>();
        warnings.addAll(analysisResult.warnings());
        warnings.addAll(mappingResult.warnings());

        if (config.dryRun()) {
            System.out.println("dry-run mapping preview:");
            System.out.println(mappingFileWriter.render(mapping));
            return new ObfuscationResult(
                    archive.classesByEntry().size(),
                    mapping.classMap().size(),
                    mapping.methodMap().size(),
                    mapping.fieldMap().size(),
                    archive.resourcesByEntry().size(),
                    warnings,
                    null,
                    null,
                    true
            );
        }

        ObfuscationApplier.ApplyResult applyResult = applier.apply(archive, analysisResult, mapping, config);
        warnings.addAll(applyResult.warnings());
        JarIo.write(config.outputJar(), applyResult.classEntries(), applyResult.resources());

        Path mappingDirectory = config.outputJar().toAbsolutePath().getParent();
        if (mappingDirectory == null) {
            mappingDirectory = Path.of(".").toAbsolutePath();
        }
        Path mappingPath = mappingFileWriter.write(mappingDirectory, mapping);

        return new ObfuscationResult(
                archive.classesByEntry().size(),
                mapping.classMap().size(),
                mapping.methodMap().size(),
                mapping.fieldMap().size(),
                archive.resourcesByEntry().size(),
                warnings,
                config.outputJar().toAbsolutePath(),
                mappingPath.toAbsolutePath(),
                false
        );
    }

    private static void validateConfig(ObfuscationConfig config) {
        if (!Files.exists(config.inputJar())) {
            throw new IllegalArgumentException("Input jar does not exist: " + config.inputJar());
        }
        if (config.inputJar().equals(config.outputJar()) && !config.dryRun()) {
            throw new IllegalArgumentException("Input and output jars must differ");
        }
    }
}
