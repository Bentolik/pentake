package io.github.cat.fabricobf.core;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;

import io.github.cat.fabricobf.io.JarIo;
import io.github.cat.fabricobf.testutil.FabricFixtureFactory;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class MappingGeneratorDeterminismTest {
    @TempDir
    Path tempDir;

    @Test
    void sameSeedProducesSameMappingDifferentSeedProducesDifferentMapping() throws Exception {
        Path fixture = FabricFixtureFactory.createBasicFixtureJar(tempDir, "fixture.jar");
        JarArchive archive = JarIo.read(fixture);

        ObfuscationConfig configA = new ObfuscationConfig(
                fixture,
                tempDir.resolve("out-a.jar"),
                42L,
                true,
                java.util.List.of(),
                false,
                false
        );
        ObfuscationConfig configB = new ObfuscationConfig(
                fixture,
                tempDir.resolve("out-b.jar"),
                42L,
                true,
                java.util.List.of(),
                false,
                false
        );
        ObfuscationConfig configC = new ObfuscationConfig(
                fixture,
                tempDir.resolve("out-c.jar"),
                99L,
                true,
                java.util.List.of(),
                false,
                false
        );

        ObfuscationAnalyzer analyzer = new ObfuscationAnalyzer();
        MappingGenerator generator = new MappingGenerator();

        AnalysisResult analysis = analyzer.analyze(archive, configA);
        SymbolMapping mapA = generator.generate(analysis, configA).mapping();
        SymbolMapping mapB = generator.generate(analysis, configB).mapping();
        SymbolMapping mapC = generator.generate(analysis, configC).mapping();

        assertEquals(mapA.methodMap(), mapB.methodMap());
        assertEquals(mapA.fieldMap(), mapB.fieldMap());
        assertNotEquals(mapA.methodMap(), mapC.methodMap());
    }
}

