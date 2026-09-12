const assert = require('assert');
const http = require('http');
const path = require('path');
const db = require('../db');

// ==================== HTTP HELPER ====================
function request(method, reqPath, body = null, headers = {}) {
    return new Promise((resolve, reject) => {
        const payload = body ? JSON.stringify(body) : '';
        const options = {
            hostname: 'localhost',
            port: 3001,  // Use 3001 for tests to avoid conflicts with production server
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
        if (body) req.write(payload);
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

// ==================== TEST RUNNER ====================
async function runTests() {
    console.log('[TEST SUITE] Starting automated verification...');
    console.log('');

    let testsPassed = 0;
    let testsFailed = 0;

    // Initialize DB (test env)
    await db.initDatabase();
    
    // Clean up previous test users to allow fresh registration tests to pass
    await db.run("DELETE FROM users WHERE username IN ('agent_test_001', 'admin_test_001')");
    await db.run("DELETE FROM action_logs WHERE username IN ('agent_test_001', 'admin_test_001')");

    // Fork the server on a separate test port
    const serverProcess = require('child_process').fork(
        path.join(__dirname, '../server.js'),
        [],
        {
            env: {
                ...process.env,
                PORT: '3001',
                ADMIN_PASSWORD: 'testadmincode2026',
                API_KEY: 'test-api-key-12345',
                SECRET_KEY: 'test-jwt-secret-key',
                NODE_ENV: 'test'
            },
            silent: true  // Suppress server stdout/stderr in test output
        }
    );

    // Give server time to start
    await new Promise(r => setTimeout(r, 2500));

    const pass = (n, msg) => { console.log(`  ✅ [TEST ${n}] PASS: ${msg}`); testsPassed++; };
    const fail = (n, msg, err) => { console.error(`  ❌ [TEST ${n}] FAIL: ${msg}`); if (err) console.error('     ', err.message || err); testsFailed++; };

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

        // ========== CUSTOM JAR INJECTION & UPLOAD ACCESS ==========
        console.log('');
        console.log('--- Custom JAR Injection & File Upload Security ---');

        // Test 14: Standard user denied file upload endpoint
        try {
            const res = await request('POST', '/api/files/upload', {}, { Cookie: standardCookie });
            assert.strictEqual(res.status, 403, `Expected 403 got ${res.status}`);
            pass(14, 'Standard user cannot upload files (403 Forbidden)');
        } catch (e) { fail(14, 'Standard user upload rejection', e); }

        // Test 15: Admin user can access file upload endpoint
        try {
            const res = await request('POST', '/api/files/upload', {}, { Cookie: adminCookie });
            // Since no files were attached, it should pass requireAdmin but fail multer validation with 400 Bad Request
            assert.strictEqual(res.status, 400, `Expected 400 got ${res.status}`);
            assert.strictEqual(res.body.error, 'No files uploaded');
            pass(15, 'Admin user can access file upload endpoint (passed authentication)');
        } catch (e) { fail(15, 'Admin upload access', e); }

        // Test 16: Build generation fails when custom JAR does not exist
        try {
            const res = await request('POST', '/api/build/generate', { jarFilename: 'non_existent_custom_jar.jar' }, { Cookie: adminCookie });
            assert.strictEqual(res.status, 500, `Expected 500 got ${res.status}`);
            assert.ok(res.body.error && res.body.error.includes('Target JAR file not found'), `Expected error message to mention target JAR not found, got: ${JSON.stringify(res.body)}`);
            pass(16, 'Build generation rejects non-existent custom JAR file');
        } catch (e) { fail(16, 'Custom JAR validation', e); }

        // ========== LOGOUT ==========
        console.log('');
        console.log('--- Logout Flow ---');

        // Test 17: Logout clears session
        try {
            const res = await request('POST', '/api/auth/logout', null, { Cookie: standardCookie });
            assert.strictEqual(res.status, 200, `Expected 200 got ${res.status}`);
            
            // Verify the Set-Cookie clears auth_token
            const setCookieStr = JSON.stringify(res.headers['set-cookie'] || '');
            assert.ok(setCookieStr.includes('auth_token=;') || setCookieStr.includes('auth_token=,'),
                'Logout must clear auth_token cookie');
            pass(17, 'Logout clears auth_token cookie');
        } catch (e) { fail(17, 'Logout flow', e); }

    } catch (globalErr) {
        console.error('\n[CRITICAL] Test runner encountered an unhandled error:');
        console.error(globalErr);
    } finally {
        serverProcess.kill();

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
