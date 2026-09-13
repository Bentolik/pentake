const fs = require('fs-extra');
const path = require('path');

const MS = 1000;
const HOUR_MS = 60 * 60 * MS;
const DAY_MS = 24 * HOUR_MS;

const DEFAULT_CLEANUP_INTERVAL_MS = HOUR_MS;
const DEFAULT_TEMP_RETENTION_MS = HOUR_MS;
const DEFAULT_UPLOAD_RETENTION_MS = 30 * DAY_MS;

function positiveInt(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : fallback;
}

function positiveMs(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * Cleanup configuration assembled from environment variables. All retention
 * values are milliseconds; a zero/empty env value falls back to the default.
 */
function configFromEnv(dirs) {
    return {
        uploadsDir: dirs.uploadsDir,
        sharedFilesDir: dirs.sharedFilesDir,
        buildsDir: dirs.buildsDir,
        tempRetentionMs: positiveMs(process.env.TEMP_RETENTION_MINUTES, DEFAULT_TEMP_RETENTION_MS / MS / 60) * 60 * MS,
        uploadRetentionMs: positiveInt(process.env.UPLOAD_RETENTION_DAYS, DEFAULT_UPLOAD_RETENTION_MS / DAY_MS) * DAY_MS,
        sharedRetentionMs: positiveInt(process.env.SHARED_RETENTION_DAYS, 0) * DAY_MS,
        maxSharedJars: positiveInt(process.env.MAX_SHARED_JARS, 20)
    };
}

async function* walkFiles(dir, rel = '') {
    let entries;
    try {
        entries = await fs.readdir(dir);
    } catch {
        return;
    }
    for (const entry of entries) {
        const full = path.join(dir, entry);
        const childRel = rel ? path.join(rel, entry) : entry;
        let st;
        try {
            st = await fs.lstat(full);
        } catch {
            continue;
        }
        if (st.isDirectory()) {
            yield* walkFiles(full, childRel);
        } else if (st.isFile()) {
            yield { file: full, rel: childRel, mtimeMs: st.mtimeMs };
        }
    }
}

async function purgeDir(dir, retentionMs) {
    let removed = 0;
    const cutoff = Date.now() - retentionMs;
    for await (const { file, mtimeMs } of walkFiles(dir)) {
        if (mtimeMs < cutoff) {
            try {
                await fs.remove(file);
                removed += 1;
            } catch (_) {}
        }
    }
    return removed;
}

async function newestMtime(dir) {
    let newest = 0;
    for await (const { mtimeMs } of walkFiles(dir)) {
        if (mtimeMs > newest) newest = mtimeMs;
    }
    return newest;
}

/**
 * One full sweep:
 *  1. temp dirs (uploads/temp, shared-files/temp) and build temp dirs
 *  2. exfil files under uploads/
 *  3. legacy (UUID) log dirs that have aged out entirely
 *  4. shared-files: optional age-out + jar count cap
 * Returns a counts object for logging.
 */
async function runCleanupOnce(config) {
    const result = {
        tempRemoved: 0,
        uploadRemoved: 0,
        legacyDirsRemoved: 0,
        sharedRemoved: 0,
        jarsRemoved: 0
    };

    const tempDirs = [
        path.join(config.uploadsDir, 'temp'),
        path.join(config.sharedFilesDir, 'temp')
    ];

    let buildsTemp = [];
    try {
        const userDirs = await fs.readdir(config.buildsDir);
        buildsTemp = userDirs
            .filter((d) => d.startsWith('user_'))
            .map((d) => path.join(config.buildsDir, d, 'temp'));
    } catch (_) {}

    for (const dir of [...tempDirs, ...buildsTemp]) {
        result.tempRemoved += await purgeDir(dir, config.tempRetentionMs);
    }

    const cutoff = Date.now() - config.uploadRetentionMs;
    let entries;
    try {
        entries = await fs.readdir(config.uploadsDir);
    } catch {
        entries = [];
    }

    for (const entry of entries) {
        if (entry === 'temp') continue;
        const dir = path.join(config.uploadsDir, entry);
        let st;
        try {
            st = await fs.stat(dir);
        } catch {
            continue;
        }
        if (!st.isDirectory()) continue;

        if (!entry.startsWith('user_')) {
            const newest = await newestMtime(dir);
            if (newest === 0 || newest < cutoff) {
                try {
                    await fs.remove(dir);
                    result.legacyDirsRemoved += 1;
                } catch (_) {}
            }
            continue;
        }

        for await (const { file, rel, mtimeMs } of walkFiles(dir)) {
            if (rel === 'meta.json') continue;
            if (mtimeMs < cutoff) {
                try {
                    await fs.remove(file);
                    result.uploadRemoved += 1;
                } catch (_) {}
            }
        }
    }

    if (config.sharedRetentionMs > 0) {
        result.sharedRemoved += await purgeDir(config.sharedFilesDir, config.sharedRetentionMs);
    }

    if (config.maxSharedJars > 0) {
        let files;
        try {
            files = (await fs.readdir(config.sharedFilesDir))
                .filter((f) => f.toLowerCase().endsWith('.jar'))
                .map((f) => path.join(config.sharedFilesDir, f));
        } catch {
            files = [];
        }
        const stats = [];
        for (const f of files) {
            try {
                const st = await fs.stat(f);
                stats.push({ file: f, mtimeMs: st.mtimeMs });
            } catch (_) {}
        }
        stats.sort((a, b) => b.mtimeMs - a.mtimeMs);
        for (const { file } of stats.slice(config.maxSharedJars)) {
            try {
                await fs.remove(file);
                result.jarsRemoved += 1;
            } catch (_) {}
        }
    }

    return result;
}

/**
 * Start the periodic sweep. `getConfig` is re-invoked every tick so live env
 * changes apply without a restart. Returns the interval handle (unref'd).
 */
function startCleanupScheduler(getConfig, intervalMs = DEFAULT_CLEANUP_INTERVAL_MS) {
    const run = () => {
        runCleanupOnce(getConfig())
            .then((r) => {
                const total = r.tempRemoved + r.uploadRemoved + r.legacyDirsRemoved + r.sharedRemoved + r.jarsRemoved;
                if (total > 0) {
                    console.log(`[Cleanup] ${total} stale file(s) removed (temp=${r.tempRemoved}, uploads=${r.uploadRemoved}, legacyDirs=${r.legacyDirsRemoved}, shared=${r.sharedRemoved}, jars=${r.jarsRemoved})`);
                }
            })
            .catch((err) => console.error('[Cleanup] sweep failed:', err.message));
    };
    run();
    return setInterval(run, intervalMs);
}

module.exports = {
    runCleanupOnce,
    startCleanupScheduler,
    configFromEnv
};