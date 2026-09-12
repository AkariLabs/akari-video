"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_HISTORY_KEEP = exports.DEFAULT_HISTORY_FILES = void 0;
exports.snapshot = snapshot;
exports.list = list;
exports.restore = restore;
const crypto_1 = require("crypto");
const fs_1 = require("fs");
const path_1 = require("path");
exports.DEFAULT_HISTORY_FILES = ['edit.json', 'captions.json'];
exports.DEFAULT_HISTORY_KEEP = 100;
const historyDir = (projectDir) => (0, path_1.join)(projectDir, '.akari', 'history');
const hash = (content) => (0, crypto_1.createHash)('sha256').update(content).digest('hex');
function safeFiles(files) {
    return [...new Set(files)].filter(file => (0, path_1.basename)(file) === file && file !== '.' && file !== '..');
}
function slug(label) {
    const value = label.normalize('NFKC').toLowerCase()
        .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 48);
    return value || 'history';
}
async function exists(path) {
    try {
        await fs_1.promises.access(path);
        return true;
    }
    catch {
        return false;
    }
}
async function reserveId(directory, base) {
    for (let serial = 1;; serial += 1) {
        const id = serial === 1 ? base : `${base}-${serial}`;
        try {
            await fs_1.promises.mkdir((0, path_1.join)(directory, id));
            return id;
        }
        catch (error) {
            if (error.code !== 'EEXIST')
                throw error;
        }
    }
}
async function prune(directory, keep) {
    const names = await fs_1.promises.readdir(directory, { withFileTypes: true });
    const directories = names.filter(entry => entry.isDirectory()).map(entry => entry.name).sort();
    for (const name of directories.slice(0, Math.max(0, directories.length - keep))) {
        await fs_1.promises.rm((0, path_1.join)(directory, name), { recursive: true, force: true });
    }
}
async function snapshot(options) {
    const files = safeFiles(options.files ?? exports.DEFAULT_HISTORY_FILES);
    const contents = new Map();
    for (const file of files) {
        try {
            contents.set(file, await fs_1.promises.readFile((0, path_1.join)(options.projectDir, file)));
        }
        catch (error) {
            if (error.code !== 'ENOENT')
                throw error;
        }
    }
    if (contents.size === 0)
        return null;
    const at = (options.now ?? new Date()).toISOString();
    const directory = historyDir(options.projectDir);
    await fs_1.promises.mkdir(directory, { recursive: true });
    const stamp = at.replace(/[:.]/g, '-');
    const id = await reserveId(directory, `${stamp}-${slug(options.label)}`);
    const destination = (0, path_1.join)(directory, id);
    const savedFiles = [...contents.keys()];
    const meta = {
        id,
        label: options.label,
        at,
        files: savedFiles,
        sha256: Object.fromEntries([...contents].map(([file, content]) => [file, hash(content)]))
    };
    try {
        await Promise.all([...contents].map(([file, content]) => fs_1.promises.writeFile((0, path_1.join)(destination, file), content)));
        await fs_1.promises.writeFile((0, path_1.join)(destination, 'meta.json'), `${JSON.stringify(meta, null, 2)}\n`);
    }
    catch (error) {
        await fs_1.promises.rm(destination, { recursive: true, force: true });
        throw error;
    }
    await prune(directory, Math.max(1, options.keep ?? exports.DEFAULT_HISTORY_KEEP));
    return meta;
}
async function readDirectoryEntry(directory, id) {
    try {
        const value = JSON.parse(await fs_1.promises.readFile((0, path_1.join)(directory, id, 'meta.json'), 'utf8'));
        if (typeof value.label !== 'string' || typeof value.at !== 'string' || !Array.isArray(value.files))
            return null;
        return {
            id,
            label: value.label,
            at: value.at,
            files: safeFiles(value.files.filter((file) => typeof file === 'string')),
            sha256: value.sha256 && typeof value.sha256 === 'object' ? value.sha256 : {}
        };
    }
    catch {
        return null;
    }
}
async function readLegacyEntry(directory, name) {
    try {
        const content = await fs_1.promises.readFile((0, path_1.join)(directory, name));
        const stat = await fs_1.promises.stat((0, path_1.join)(directory, name));
        return {
            id: name,
            label: '旧プレビュー履歴',
            at: stat.mtime.toISOString(),
            files: ['edit.json'],
            sha256: { 'edit.json': hash(content) },
            legacy: true,
            bytes: stat.size
        };
    }
    catch {
        return null;
    }
}
async function list(projectDir) {
    const directory = historyDir(projectDir);
    let entries;
    try {
        await prune(directory, exports.DEFAULT_HISTORY_KEEP);
        entries = await fs_1.promises.readdir(directory, { withFileTypes: true });
    }
    catch {
        return [];
    }
    const loaded = await Promise.all(entries.map(entry => {
        if (entry.isDirectory())
            return readDirectoryEntry(directory, entry.name);
        if (entry.isFile() && /^edit-[\w.-]+\.json$/.test(entry.name))
            return readLegacyEntry(directory, entry.name);
        return Promise.resolve(null);
    }));
    return loaded.filter((entry) => entry !== null)
        .sort((a, b) => b.at.localeCompare(a.at) || b.id.localeCompare(a.id));
}
async function atomicWrite(filePath, content) {
    const temporary = `${filePath}.tmp-${process.pid}-${Date.now()}`;
    await fs_1.promises.writeFile(temporary, content);
    await fs_1.promises.rename(temporary, filePath);
}
async function restore(projectDir, id, options = {}) {
    if (typeof id !== 'string' || (0, path_1.basename)(id) !== id || id === '.' || id === '..') {
        throw new Error('Invalid history id');
    }
    const directory = historyDir(projectDir);
    const legacy = /^edit-[\w.-]+\.json$/.test(id) && await exists((0, path_1.join)(directory, id));
    const entry = legacy ? await readLegacyEntry(directory, id) : await readDirectoryEntry(directory, id);
    if (!entry)
        throw new Error('History entry not found');
    const candidates = {};
    if (legacy) {
        candidates['edit.json'] = await fs_1.promises.readFile((0, path_1.join)(directory, id), 'utf8');
    }
    else {
        for (const file of safeFiles(entry.files)) {
            const content = await fs_1.promises.readFile((0, path_1.join)(directory, id, file));
            if (entry.sha256[file] && hash(content) !== entry.sha256[file]) {
                throw new Error(`History file checksum mismatch: ${file}`);
            }
            candidates[file] = content.toString('utf8');
        }
    }
    if (Object.keys(candidates).length === 0)
        throw new Error('History entry contains no files');
    const before = await snapshot({
        projectDir,
        label: `restore-from-${id}`,
        files: options.files ?? exports.DEFAULT_HISTORY_FILES
    });
    if (options.write)
        await options.write(candidates);
    else
        await Promise.all(Object.entries(candidates).map(([file, content]) => atomicWrite((0, path_1.join)(projectDir, file), content)));
    return { restored: entry, snapshot: before };
}
