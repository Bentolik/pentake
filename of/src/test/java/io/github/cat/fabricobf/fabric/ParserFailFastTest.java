package io.github.cat.fabricobf.fabric;

import static org.junit.jupiter.api.Assertions.assertThrows;

import java.nio.charset.StandardCharsets;
import org.junit.jupiter.api.Test;

class ParserFailFastTest {
    @Test
    void fabricModParserFailsOnMalformedJson() {
        FabricModJsonParser parser = new FabricModJsonParser();
        assertThrows(IllegalArgumentException.class, () -> parser.parse("{bad-json".getBytes(StandardCharsets.UTF_8)));
    }

    @Test
    void mixinParserFailsOnMalformedJson() {
        MixinConfigParser parser = new MixinConfigParser();
        assertThrows(
                IllegalArgumentException.class,
                () -> parser.parse("{not-valid".getBytes(StandardCharsets.UTF_8), "broken.mixins.json")
        );
    }

    @Test
    void accessWidenerParserFailsOnMissingHeader() {
        AccessWidenerParser parser = new AccessWidenerParser();
        assertThrows(
                IllegalArgumentException.class,
                () -> parser.parse("accessible class a/b/C".getBytes(StandardCharsets.UTF_8), "broken.accesswidener")
        );
    }
}

