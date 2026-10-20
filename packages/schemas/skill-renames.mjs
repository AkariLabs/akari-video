import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Skill rename table (`skills/renames.json`) — the single source of truth for old → new names.
 *
 * The table stays empty until a skill is actually renamed. Everything here is pure except the
 * small file helpers at the bottom, so both the app (via its own copy of the resolver) and the
 * repository tests can use the same rules:
 *
 *   - `from` is unique and must not exist as a bundled skill any more,
 *   - `to` (after following a chain) must exist as `skills/<to>/SKILL.md`,
 *   - a chain a → b → c resolves to c.
 */

export const SKILL_RENAMES_FILE = 'renames.json';
export const SKILL_RENAMES_RELATIVE_PATH = 'skills/renames.json';
export const SKILLS_COPIES_FILE = 'AKARI-SKILLS-COPIES.json';
export const SKILL_COPIES_MANIFEST_VERSION = 1;
export const SKILL_RENAME_MARKER = '旧名';

const MODULE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SKILL_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Empty table used when a repository has no renames yet. */
export function emptySkillRenameTable() {
    return { version: 1, renames: [] };
}

/**
 * Parse and shape-check a table. This path is used by the zero-dependency launcher, so it does
 * not load a JSON-schema validator; `skill-renames.schema.json` is the same shape and is
 * exercised by the schema test with Ajv.
 */
export function parseSkillRenameTable(text) {
    const value = JSON.parse(text);
    const fail = message => {
        throw new Error(`invalid skill rename table: ${message}`);
    };
    if (!value || value.version !== 1 || !Array.isArray(value.renames)) {
        fail('version must be 1 and renames must be an array');
    }
    const extraKeys = Object.keys(value).filter(key => key !== 'version' && key !== 'renames');
    if (extraKeys.length) fail(`unknown key ${extraKeys[0]}`);
    const renames = value.renames.map((row, index) => {
        if (!row || typeof row !== 'object') fail(`renames[${index}] must be an object`);
        const extra = Object.keys(row).filter(key => !['from', 'to', 'since'].includes(key));
        if (extra.length) fail(`renames[${index}] has unknown key ${extra[0]}`);
        for (const key of ['from', 'to', 'since']) {
            if (typeof row[key] !== 'string' || !row[key].trim()) fail(`renames[${index}].${key} is required`);
        }
        for (const key of ['from', 'to']) {
            if (!SKILL_NAME_PATTERN.test(row[key])) fail(`renames[${index}].${key} is not a skill name`);
        }
        return { from: row.from, to: row.to, since: row.since };
    });
    return { version: 1, renames };
}

/** Read `skills/renames.json`; a missing file means "no renames yet". */
export function loadSkillRenames(skillsRoot = path.join(MODULE_ROOT, 'skills')) {
    try {
        return parseSkillRenameTable(readFileSync(path.join(skillsRoot, SKILL_RENAMES_FILE), 'utf8'));
    } catch (error) {
        if (error && error.code === 'ENOENT') return emptySkillRenameTable();
        throw error;
    }
}

/**
 * Follow a → b → c to c. Cycles resolve to the original name (the validator reports them).
 */
export function resolveSkillName(renames, name) {
    const mapping = new Map((renames ?? []).map(row => [row.from, row.to]));
    let current = name;
    const seen = new Set();
    while (mapping.has(current)) {
        if (seen.has(current)) return name;
        seen.add(current);
        current = mapping.get(current);
    }
    return current;
}

/** True when the target directory exists (a skill is a directory with SKILL.md). */
function skillExists(skillsRoot, name) {
    try {
        return statSync(path.join(skillsRoot, name, 'SKILL.md')).isFile();
    } catch {
        return false;
    }
}

/**
 * Referential checks (the JSON Schema covers the shape; the schema test does both).
 * `skillsRoot` defaults to the repository `skills/` directory.
 * Returns `{ ok, errors }`; every error is a human-readable line (tests assert on the content).
 */
export function validateSkillRenames(value, options = {}) {
    const skillsRoot = options.skillsRoot ?? path.join(MODULE_ROOT, 'skills');
    const errors = [];
    const renames = Array.isArray(value?.renames) ? value.renames : [];
    const seenFrom = new Set();
    for (const [index, row] of renames.entries()) {
        if (!row || typeof row.from !== 'string' || typeof row.to !== 'string') continue;
        if (seenFrom.has(row.from)) errors.push(`renames[${index}].from duplicates ${row.from}`);
        seenFrom.add(row.from);
        const resolved = resolveSkillName(renames, row.to);
        if (!skillExists(skillsRoot, resolved)) {
            errors.push(`renames[${index}].to ${row.to} → ${resolved} has no skills/${resolved}/SKILL.md`);
        }
        if (skillExists(skillsRoot, row.from)) {
            errors.push(`renames[${index}].from ${row.from} still exists as skills/${row.from}/SKILL.md`);
        }
        if (row.from === row.to) errors.push(`renames[${index}] maps ${row.from} to itself`);
    }
    // Walk each from with cycle detection: the resolver alone cannot distinguish "unknown name"
    // from "cycle", so repeat the walk here.
    const mapping = new Map(renames.filter(row => row?.from).map(row => [row.from, row.to]));
    for (const row of renames) {
        if (!row?.from) continue;
        const seen = new Set();
        let current = row.from;
        while (mapping.has(current)) {
            if (seen.has(current)) {
                errors.push(`rename chain from ${row.from} has a cycle at ${current}`);
                break;
            }
            seen.add(current);
            current = mapping.get(current);
        }
    }
    return { ok: errors.length === 0, errors };
}

/** `（旧名: <from>）` — the one allowed old-name occurrence, at the end of the new description. */
export function oldNameMarker(from) {
    return `（旧名: ${from}）`;
}

/** Frontmatter `description` of a SKILL.md (single-line descriptions, as authored today). */
export function skillDescription(markdown) {
    const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(markdown);
    if (!match) return undefined;
    const line = /^description:\s?(.*)$/m.exec(match[1]);
    return line ? line[1].trim() : undefined;
}

/** How many times the allowed marker appears in the description. */
export function oldNameMarkerCount(markdown, from) {
    const description = skillDescription(markdown);
    if (description === undefined) return 0;
    return description.split(oldNameMarker(from)).length - 1;
}

function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Old-name references in skill-name contexts:
 *   - `skills/<from>/...`
 *   - `/<from>` (slash command, with a boundary so `/new-<from>` does not match)
 *   - `` `<from>` `` (inline code)
 *
 * `allowDescriptionMarker` removes the one sanctioned `（旧名: <from>）` first; pass it only for
 * the renamed skill's own SKILL.md.
 */
export function findOldNameReferences(text, renames, options = {}) {
    const allowedMarkers = new Set(options.allowedMarkerFroms
        ?? (options.allowDescriptionMarker ? (renames ?? []).map(row => row.from) : []));
    const hits = [];
    for (const row of renames ?? []) {
        let source = text;
        if (allowedMarkers.has(row.from)) {
            source = source.split(oldNameMarker(row.from)).join('');
        }
        const from = escapeRegExp(row.from);
        const patterns = [
            new RegExp(`(?:^|[^A-Za-z0-9_-])skills/${from}(?![A-Za-z0-9_-])`, 'm'),
            new RegExp(`(?:^|[^A-Za-z0-9_/-])/${from}(?![A-Za-z0-9_-])`, 'm'),
            new RegExp('`' + from + '`', 'm')
        ];
        if (patterns.some(pattern => pattern.test(source))) hits.push({ from: row.from, to: row.to });
    }
    return hits;
}

const REFERENCE_ROOTS = ['skills', 'docs', 'plugin', 'templates'];
const REFERENCE_FILES = ['AGENTS.md', 'README.md', 'README.ja.md'];
const REFERENCE_EXTENSIONS = new Set(['.md', '.json', '.mjs', '.js', '.ts', '.tsx', '.yml', '.yaml', '.txt']);
const REFERENCE_SKIP_DIRECTORIES = new Set(['node_modules', '.git', 'lib', 'dist', 'fixtures', 'dev-fixtures', 'evidence']);

/** CHANGELOG / release notes are history: they keep the old name on purpose. */
export function isExcludedReferenceFile(relative) {
    if (relative.split(path.sep).join('/') === SKILL_RENAMES_RELATIVE_PATH) return true;
    const base = path.basename(relative).toLowerCase();
    if (base.startsWith('changelog')) return true;
    if (base.startsWith('release') && /(?:note|changelog)/.test(base)) return true;
    if (/(?:^|\/)(?:release-notes?|releases?)(?:\/|$)/i.test(relative)) return true;
    return false;
}

function textFile(absolute) {
    return REFERENCE_EXTENSIONS.has(path.extname(absolute).toLowerCase());
}

/**
 * Walk the repository surfaces named by the contract and return
 * `{ file, from, to }` for every old-name reference. The live repository is expected to return
 * `[]` while the table is empty; the test also builds a fixture that must go red then green.
 */
export function collectOldNameReferences(root, renames) {
    const hits = [];
    if (!renames?.length) return hits;
    const visit = absolute => {
        const relative = path.relative(root, absolute);
        if (isExcludedReferenceFile(relative)) return;
        let text;
        try {
            text = readFileSync(absolute, 'utf8');
        } catch {
            return;
        }
        const allowed = path.relative(root, absolute).split(path.sep).join('/');
        const allowedMarkerFroms = renames
            .filter(row => allowed === `skills/${row.to}/SKILL.md`
                || allowed === `skills/${resolveSkillName(renames, row.to)}/SKILL.md`)
            .map(row => row.from);
        for (const hit of findOldNameReferences(text, renames, { allowedMarkerFroms })) {
            hits.push({ file: relative, from: hit.from, to: hit.to });
        }
    };
    const walk = directory => {
        for (const entry of readdirSync(directory, { withFileTypes: true })) {
            if (entry.name.startsWith('.') || REFERENCE_SKIP_DIRECTORIES.has(entry.name)) continue;
            const absolute = path.join(directory, entry.name);
            if (entry.isDirectory()) walk(absolute);
            else if (entry.isFile() && textFile(absolute)) visit(absolute);
        }
    };
    for (const directory of REFERENCE_ROOTS) {
        const absolute = path.join(root, directory);
        try {
            if (statSync(absolute).isDirectory()) walk(absolute);
        } catch {
            // Surface does not exist in this checkout.
        }
    }
    for (const file of REFERENCE_FILES) {
        const absolute = path.join(root, file);
        try {
            if (statSync(absolute).isFile()) visit(absolute);
        } catch {
            // Surface does not exist in this checkout.
        }
    }
    return hits;
}

// ── file helpers used by sync / scaffold ─────────────────────────────────────

function ignoredCopyName(name) {
    return name === '.gitkeep' || name === '.DS_Store' || name === 'dev-fixtures';
}

/**
 * Relative paths of the files a skill copy contains, sorted. `.gitkeep` / `.DS_Store` and the
 * `dev-fixtures/` development samples are not part of a project copy.
 */
export async function listSkillFiles(fs, directory) {
    const files = [];
    const walk = async (current, relative) => {
        const entries = (await fs.readdir(current, { withFileTypes: true }))
            .filter(entry => !ignoredCopyName(entry.name))
            .sort((left, right) => left.name.localeCompare(right.name));
        for (const entry of entries) {
            const absolute = path.join(current, entry.name);
            const relativePath = relative ? `${relative}/${entry.name}` : entry.name;
            if (entry.isDirectory()) await walk(absolute, relativePath);
            else if (entry.isFile()) files.push(relativePath);
        }
    };
    await walk(directory, '');
    return files.sort();
}

/**
 * Hash of the listed files (relative paths + bytes). Passing an explicit list lets the cleanup
 * hash only the files the previous install wrote, so a user's extra file shows up as a mismatch
 * instead of being silently folded into the stamp.
 */
export async function hashSkillTree(fs, directory, files) {
    const { createHash } = await import('node:crypto');
    const hash = createHash('sha256');
    for (const relativePath of [...(files ?? await listSkillFiles(fs, directory))].sort()) {
        hash.update(relativePath);
        hash.update(await fs.readFile(path.join(directory, relativePath)));
    }
    return hash.digest('hex').slice(0, 16);
}

export async function readSkillCopiesManifest(fs, destination) {
    try {
        const parsed = JSON.parse(await fs.readFile(path.join(destination, SKILLS_COPIES_FILE), 'utf8'));
        if (parsed?.version !== SKILL_COPIES_MANIFEST_VERSION || typeof parsed.skills !== 'object' || !parsed.skills) {
            return { version: SKILL_COPIES_MANIFEST_VERSION, skills: {} };
        }
        return { version: SKILL_COPIES_MANIFEST_VERSION, skills: { ...parsed.skills } };
    } catch {
        return { version: SKILL_COPIES_MANIFEST_VERSION, skills: {} };
    }
}

/**
 * Write the per-skill stamps after the project copy is final. The stamp lists the bundled files
 * (from `source`) and hashes their bytes in the project (the analysis schema is rewritten with a
 * provenance comment, so hashing the bundled source would look like a user edit).
 */
export async function writeSkillCopiesManifest(fs, destination, source, names) {
    const skills = {};
    for (const name of [...names].sort()) {
        const files = await listSkillFiles(fs, path.join(source, name));
        skills[name] = {
            hash: await hashSkillTree(fs, path.join(destination, name), files),
            files
        };
    }
    const body = `${JSON.stringify({ version: SKILL_COPIES_MANIFEST_VERSION, skills }, null, 2)}\n`;
    await fs.writeFile(path.join(destination, SKILLS_COPIES_FILE), body, 'utf8');
    return skills;
}

/**
 * Remove old-name copies that still match the stamp written by the previous install/sync.
 * Anything else (no stamp, changed bytes, extra files) is kept and reported as `kept`, so a
 * user's edits are never deleted. Deletion failures are reported as `failed` and must prevent
 * the caller from advancing `AKARI-SKILLS-VERSION`.
 */
export async function cleanupRenamedSkillCopies(options) {
    const { fs, destination, renames } = options;
    const onWarn = options.warn ?? (() => undefined);
    const manifest = await readSkillCopiesManifest(fs, destination);
    const removed = [];
    const kept = [];
    const failed = [];
    for (const row of renames ?? []) {
        const oldPath = path.join(destination, row.from);
        let info;
        try {
            info = await fs.stat(oldPath);
        } catch (error) {
            if (error && error.code === 'ENOENT') continue;
            failed.push(row.from);
            onWarn(`could not inspect the old skill copy ${row.from}`, error);
            continue;
        }
        const expected = manifest.skills[row.from];
        if (!info.isDirectory() || !expected || !Array.isArray(expected.files) || typeof expected.hash !== 'string') {
            kept.push({ from: row.from, to: row.to });
            continue;
        }
        let actual;
        try {
            const files = await listSkillFiles(fs, oldPath);
            const expectedFiles = [...expected.files].sort();
            if (files.length !== expectedFiles.length
                || files.some((file, index) => file !== expectedFiles[index])) {
                // An extra file or a missing file is a user change: never delete it.
                kept.push({ from: row.from, to: row.to });
                continue;
            }
            actual = await hashSkillTree(fs, oldPath, expectedFiles);
        } catch (error) {
            kept.push({ from: row.from, to: row.to });
            onWarn(`could not compare the old skill copy ${row.from}`, error);
            continue;
        }
        if (actual !== expected.hash) {
            kept.push({ from: row.from, to: row.to });
            continue;
        }
        try {
            await fs.rm(oldPath, { recursive: true, force: true });
            removed.push(row.from);
        } catch (error) {
            failed.push(row.from);
            onWarn(`could not remove the old skill copy ${row.from}`, error);
        }
    }
    return { removed, kept, failed };
}
