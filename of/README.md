# fabric-obf

`fabric-obf` is a safety-first obfuscator for Fabric mod jars.  
It focuses on deterministic renaming while preserving Fabric runtime behavior.

## Build

```bash
./gradlew shadowJar
```

Output jar:

`build/libs/fabric-obf.jar`

## Usage

```bash
java -jar build/libs/fabric-obf.jar --in <input.jar> --out <output.jar> [options]
```

Examples:

```bash
java -jar build/libs/fabric-obf.jar --in mymod.jar --out mymod-obf.jar
java -jar build/libs/fabric-obf.jar --in mymod.jar --out mymod-obf.jar --seed 1337
java -jar build/libs/fabric-obf.jar --in mymod.jar --out mymod-obf.jar --keep "^M:com/example/api/.*$"
java -jar build/libs/fabric-obf.jar --in mymod.jar --out mymod-obf.jar --rename-classes --string-encryption
java -jar build/libs/fabric-obf.jar --in mymod.jar --out mymod-obf.jar --aggressive
java -jar build/libs/fabric-obf.jar --in mymod.jar --out mymod-obf.jar --max
java -jar build/libs/fabric-obf.jar --in mymod.jar --out mymod-obf.jar --ultra
java -jar build/libs/fabric-obf.jar --in mymod.jar --out mymod-obf.jar --insane
java -jar build/libs/fabric-obf.jar --in mymod.jar --out mymod-obf.jar --dry-run
```

## How To Run On A Real Fabric Mod Jar

1. Build the tool:
   - `./gradlew shadowJar`
2. Run dry-run first:
   - `java -jar build/libs/fabric-obf.jar --in yourmod.jar --out yourmod-obf.jar --dry-run`
3. Run actual obfuscation:
   - `java -jar build/libs/fabric-obf.jar --in yourmod.jar --out yourmod-obf.jar --seed 1337`
4. Check generated mapping:
   - `fabric-obf-mappings.txt` in the output jar directory.
5. Smoke-test in a dev Fabric instance before release.

## Architecture

Pipeline:

1. Analyze jar + Fabric metadata:
   - parse `fabric.mod.json`
   - parse declared mixin config files
   - parse access widener
   - inspect mixin class annotations for target class/member references
   - build centralized keep-set
2. Generate deterministic mapping:
   - seeded generator
   - stable symbol ordering
   - conservative eligibility checks (skip+warn on uncertainty)
3. Apply remap:
   - ASM `ClassRemapper` with custom remapper
   - preserve manifest/resources
   - write deterministic jar output (stable order + fixed timestamps)

## Safety Model

Never renamed:

- Fabric entrypoint classes/method names
- mixin classes
- mixin target class/member names discovered from annotations/configs
- access widener referenced symbols
- symbols under:
  - `net.minecraft`
  - `net.fabricmc`
  - `org.spongepowered`
  - `com.mojang`
- synthetic/bridge methods
- Java serialization hooks and `serialVersionUID`
- common JSON-annotated fields
- members in detected Gson/JSON model classes (including `client/system`-style model packages)
- persisted JSON field names reachable from config/profile/script state

Default rename scope:

- mod-owned classes only (inferred from jar classes minus excluded namespaces)
- non-public methods with conservative hierarchy checks
- private fields only (non-private fields are skipped with warnings)
- class renaming disabled by default (`--rename-classes` to enable)

Optional (`--string-encryption`):

- constants-only transform in eligible private methods
- skips unsupported methods and emits warnings

Aggressive (`--aggressive`):

- enables class renaming, string encryption, and debug metadata stripping
- preserves package paths for renamed classes
- keeps Fabric, Mixin, access widener, record, and persisted JSON boundaries stable

Max (`--max`):

- includes all aggressive behaviors
- adds control-flow noise blocks in eligible methods
- upgrades string encryption to seeded XOR+Base64 with reversed payloads
- lifts eligible `static final String` constants into runtime decode in `<clinit>`

Ultra (`--ultra`):

- includes all max behaviors
- obfuscates integer constants via runtime xor reconstruction
- enables more rename opportunities in `invokedynamic`-using methods via effective aggressive behavior

Insane (`--insane`):

- includes all ultra behaviors
- adds additional runtime opaque control-flow blocks in eligible void-return methods
- obfuscates `int`, `long`, `float`, and `double` constants with runtime reconstruction

## Determinism And Outputs

- Same input + same seed => deterministic mapping and jar bytes.
- Mapping file:
  - `fabric-obf-mappings.txt`
  - format:
    - `CLASS <old> -> <new>`
    - `METHOD <owner> <oldName> <desc> -> <newName>`
    - `FIELD <owner> <oldName> <desc> -> <newName>`

## Known Limitations

- No control-flow obfuscation in v1 (intentional).
- Access widener entries are kept stable (not rewritten).
- Conservative method safety checks may skip rename opportunities.
- Reflection- or string-based symbol lookups outside detected keep rules may require explicit `--keep` patterns.
