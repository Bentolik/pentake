const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const bcrypt = require('bcryptjs');

const DB_PATH = path.join(__dirname, 'database.sqlite');
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
        console.log(`[Database] Seeded default admin account: user='admin', pass='${adminPass}'`);
    }
}

module.exports = {
    initDatabase,
    run,
    get,
    all,
    
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
            build.files = JSON.parse(build.files);
        }
        return build;
    },

    async listBuilds(userId = null) {
        if (userId) {
            const builds = await all('SELECT * FROM builds WHERE userId = ? ORDER BY createdAt DESC', [userId]);
            return builds.map(b => ({ ...b, files: JSON.parse(b.files) }));
        } else {
            const builds = await all('SELECT builds.*, users.username FROM builds JOIN users ON builds.userId = users.id ORDER BY builds.createdAt DESC');
            return builds.map(b => ({ ...b, files: JSON.parse(b.files) }));
        }
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
