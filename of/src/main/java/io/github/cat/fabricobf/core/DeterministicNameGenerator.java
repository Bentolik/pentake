package io.github.cat.fabricobf.core;

import java.util.Random;
import java.util.Set;

public final class DeterministicNameGenerator {
    private final Random random;

    public DeterministicNameGenerator(long seed) {
        this.random = new Random(seed);
    }

    public String nextIdentifier(Set<String> used) {
        while (true) {
            long value = random.nextLong();
            String candidate = "o" + Long.toUnsignedString(value, 36);
            if (!used.contains(candidate)) {
                return candidate;
            }
        }
    }
}

