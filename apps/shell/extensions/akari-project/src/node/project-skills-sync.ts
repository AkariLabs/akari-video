import { createHash } from 'crypto';
import { dirname, join } from 'path';
import type { ProjectSkillsSyncOutcome } from '../common/akari-project-protocol';
import { t } from '../common/project-text';

/**
 * Project-side copy of the bundled skills tree.
 *
 * `installProjectSkills()` runs only when a project is created or converted, so a project made
 * before a skill was bundled never receives it (harvest-playbook and older projects, reported
 * 2026-10-19). This module owns the decision part of the open-time sync: whether anything has to
 * be written, and which bundled skill directories are new versus already present. The file system
 * is injected the same way `AkariProjectServiceImpl.fsImpl` is, so the decision and the copy can
 * be exercised with an in-memory fs.
 *
 * Rules kept from `copySkillsTree` / `installProjectSkills`:
 *   - only bundled entries are copied; nothing is ever deleted (user skills and user files inside
 *     bundled skill directories stay),
 *   - `.gitkeep` and `.DS_Store` are not copied, nested symbolic links are skipped with a warning,
 *   - `AKARI-SKILLS-VERSION` is written last, in the same `<signature>\n` form.
 */

export const SKILLS_VERSION_FILE = 'AKARI-SKILLS-VERSION';
export const SKILLS_COPIES_FILE = 'AKARI-SKILLS-COPIES.json';

/** One row of `skills/renames.json`. */
export interface SkillRename {
    from: string;
    to: string;
    since: string;
}

interface SkillCopyStamp {
    hash: string;
    files: string[];
}

interface SkillCopiesManifest {
    version: 1;
    skills: Record<string, SkillCopyStamp>;
}

/** The narrow slice of `fs.promises` this module needs (overridable for tests). */
export interface SkillsSyncFs {
    readdir(path: string, options: { withFileTypes: true }): Promise<Array<{
        name: string;
        isDirectory(): boolean;
        isFile(): boolean;
        isSymbolicLink(): boolean;
    }>>;
    readFile(path: string): Promise<Buffer>;
    readFile(path: string, encoding: 'utf8'): Promise<string>;
    writeFile(path: string, data: string | Buffer, encoding?: 'utf8'): Promise<void>;
    mkdir(path: string, options: { recursive: true }): Promise<unknown>;
    stat(path: string): Promise<{ isFile(): boolean; isDirectory(): boolean }>;
    rm(path: string, options: { recursive: boolean; force: boolean }): Promise<void>;
}

export interface ProjectSkillsSyncOptions {
    fs: SkillsSyncFs;
    /** Bundled skills root (`lib/skills` or the repository `skills/`). */
    source: string;
    /** `<project>/.claude/skills`. */
    destination: string;
    /** Signature of the bundled tree, as written to AKARI-SKILLS-VERSION. */
    signature: string;
    /** Overwrite even when the installed signature already matches (manual command). */
    force?: boolean;
    /** Raw `analysis.schema.json`; the provenance comment is appended before writing. */
    schema?: { text: string; provenance: string };
    /** Where per-file failures go; the caller prefixes them with its own tag. */
    warn?: (message: string, error?: unknown) => void;
    /** Rename table; tests inject a fixture table. Defaults to `<source>/renames.json`. */
    renames?: SkillRename[];
}

export interface ProjectSkillsSyncPlan {
    added: string[];
    updated: string[];
}

const IGNORED_NAMES = new Set(['.gitkeep', '.DS_Store']);

/** True when the project copy is missing or was made from a different bundled tree. */
export function skillsSyncRequired(installed: string | undefined, bundled: string, force = false): boolean {
    return force || installed === undefined || installed.trim() !== bundled;
}

export async function readInstalledSkillsSignature(
    fs: SkillsSyncFs,
    destination: string
): Promise<string | undefined> {
    try {
        return (await fs.readFile(join(destination, SKILLS_VERSION_FILE), 'utf8')).trim();
    } catch {
        return undefined;
    }
}

async function pathExists(fs: SkillsSyncFs, target: string): Promise<boolean> {
    try {
        await fs.stat(target);
        return true;
    } catch {
        return false;
    }
}

async function bundledSkillFileExists(fs: SkillsSyncFs, source: string, name: string): Promise<boolean> {
    try {
        return (await fs.stat(join(source, name, 'SKILL.md'))).isFile();
    } catch {
        return false;
    }
}

/** Follow a → b → c to c. A cycle resolves to the original name so the caller can ignore it. */
export function resolveSkillRename(renames: readonly SkillRename[], name: string): string {
    const mapping = new Map(renames.map(row => [row.from, row.to]));
    let current = name;
    const seen = new Set<string>();
    while (mapping.has(current)) {
        if (seen.has(current)) return name;
        seen.add(current);
        current = mapping.get(current)!;
    }
    return current;
}

/**
 * Read `<source>/renames.json` and keep only rows that are safe to act on: `to` (after folding
 * a chain) must be a bundled skill and `from` must no longer be bundled. A malformed table is a
 * warning, never a reason to delete a project copy.
 */
export async function readSkillRenames(
    fs: SkillsSyncFs,
    source: string,
    warn: (message: string, error?: unknown) => void = () => undefined
): Promise<SkillRename[]> {
    let text: string;
    try {
        text = await fs.readFile(join(source, 'renames.json'), 'utf8');
    } catch (error) {
        if ((error as { code?: string })?.code !== 'ENOENT') {
            warn('could not read the skill rename table', error);
        }
        return [];
    }
    let parsed: { version?: unknown; renames?: unknown };
    try {
        parsed = JSON.parse(text) as { version?: unknown; renames?: unknown };
    } catch (error) {
        warn('could not parse the skill rename table', error);
        return [];
    }
    if (parsed.version !== 1 || !Array.isArray(parsed.renames)) {
        warn('ignored the skill rename table: version must be 1 and renames must be an array');
        return [];
    }
    const rows = parsed.renames.filter((row): row is SkillRename =>
        Boolean(row) && typeof row.from === 'string' && typeof row.to === 'string' && typeof row.since === 'string');
    if (rows.length !== parsed.renames.length) {
        warn('ignored malformed skill rename rows');
    }
    const valid: SkillRename[] = [];
    for (const row of rows) {
        const target = resolveSkillRename(rows, row.to);
        if (!(await bundledSkillFileExists(fs, source, target))) {
            warn(`ignored skill rename ${row.from} → ${row.to}: ${target} is not a bundled skill`);
            continue;
        }
        if (await pathExists(fs, join(source, row.from))) {
            warn(`ignored skill rename ${row.from} → ${row.to}: ${row.from} is still bundled`);
            continue;
        }
        valid.push({ from: row.from, to: target, since: row.since });
    }
    return valid;
}

/**
 * Relative paths of the files a skill copy contains, sorted. These are the files the previous
 * install wrote; the cleanup compares this exact list so a user's extra file is a mismatch
 * instead of being silently folded into the stamp.
 */
export async function listSkillFiles(fs: SkillsSyncFs, directory: string): Promise<string[]> {
    const files: string[] = [];
    const walk = async (current: string, relative: string): Promise<void> => {
        const entries = (await fs.readdir(current, { withFileTypes: true }))
            .filter(entry => !IGNORED_NAMES.has(entry.name))
            .sort((left, right) => left.name.localeCompare(right.name));
        for (const entry of entries) {
            const absolute = join(current, entry.name);
            const relativePath = relative ? `${relative}/${entry.name}` : entry.name;
            if (entry.isDirectory()) {
                await walk(absolute, relativePath);
            } else if (entry.isFile()) {
                files.push(relativePath);
            }
        }
    };
    await walk(directory, '');
    return files.sort();
}

/**
 * Content hash of the listed files (relative path + bytes). This is the per-skill stamp written
 * to `AKARI-SKILLS-COPIES.json`: the next sync removes an old-name copy only when every file the
 * previous install wrote still has the same bytes and no extra file was added.
 */
export async function hashSkillTree(
    fs: SkillsSyncFs,
    directory: string,
    files?: readonly string[]
): Promise<string> {
    const hash = createHash('sha256');
    const list = files ?? await listSkillFiles(fs, directory);
    for (const relativePath of [...list].sort()) {
        hash.update(relativePath);
        hash.update(await fs.readFile(join(directory, relativePath)));
    }
    return hash.digest('hex').slice(0, 16);
}

export async function readSkillCopiesManifest(fs: SkillsSyncFs, destination: string): Promise<SkillCopiesManifest> {
    try {
        const parsed = JSON.parse(await fs.readFile(join(destination, SKILLS_COPIES_FILE), 'utf8')) as {
            version?: unknown; skills?: unknown;
        };
        if (parsed.version === 1 && parsed.skills && typeof parsed.skills === 'object') {
            return { version: 1, skills: { ...(parsed.skills as Record<string, SkillCopyStamp>) } };
        }
    } catch {
        // Missing or unreadable: every old copy counts as "cannot prove unchanged".
    }
    return { version: 1, skills: {} };
}

/**
 * Write the per-skill stamps after the project copy is final. The stamp lists the bundled files
 * (from `source`) and hashes their bytes in the project; `analyze-footage` is rewritten with a
 * provenance comment, so hashing the bundled source would look like a user edit.
 */
export async function writeSkillCopiesManifest(
    fs: SkillsSyncFs,
    destination: string,
    source: string,
    names: readonly string[]
): Promise<Record<string, SkillCopyStamp>> {
    const skills: Record<string, SkillCopyStamp> = {};
    for (const name of [...names].sort()) {
        const files = await listSkillFiles(fs, join(source, name));
        skills[name] = {
            hash: await hashSkillTree(fs, join(destination, name), files),
            files
        };
    }
    await fs.writeFile(join(destination, SKILLS_COPIES_FILE),
        `${JSON.stringify({ version: 1, skills }, null, 2)}\n`, 'utf8');
    return skills;
}

/**
 * Decide and perform the old-name cleanup. Only a copy whose bytes match the stamp from the
 * previous sync is deleted; a copy the user changed (or one with no stamp) is kept and returned
 * as `kept`, so the caller can surface one warning line. A failed `rm` is a `failed` item: the
 * caller must not advance `AKARI-SKILLS-VERSION` in that case.
 */
export async function cleanupRenamedSkillCopies(options: {
    fs: SkillsSyncFs;
    destination: string;
    renames: readonly SkillRename[];
    warn?: (message: string, error?: unknown) => void;
}): Promise<{
    removed: string[];
    kept: Array<{ from: string; to: string }>;
    failed: string[];
}> {
    const { fs, destination, renames } = options;
    const warn = options.warn ?? (() => undefined);
    const manifest = await readSkillCopiesManifest(fs, destination);
    const removed: string[] = [];
    const kept: Array<{ from: string; to: string }> = [];
    const failed: string[] = [];
    for (const row of renames) {
        const oldPath = join(destination, row.from);
        let info: Awaited<ReturnType<SkillsSyncFs['stat']>>;
        try {
            info = await fs.stat(oldPath);
        } catch (error) {
            if ((error as { code?: string })?.code === 'ENOENT') continue;
            failed.push(row.from);
            warn(`could not inspect the old skill copy ${row.from}`, error);
            continue;
        }
        const expected = manifest.skills[row.from];
        if (!info.isDirectory() || !expected || !Array.isArray(expected.files) || typeof expected.hash !== 'string') {
            kept.push({ from: row.from, to: row.to });
            continue;
        }
        let actual: string;
        try {
            const expectedFiles = [...expected.files].sort();
            const files = await listSkillFiles(fs, oldPath);
            if (files.length !== expectedFiles.length
                || files.some((file, index) => file !== expectedFiles[index])) {
                // An extra file or a missing file is a user change: never delete it.
                kept.push({ from: row.from, to: row.to });
                continue;
            }
            actual = await hashSkillTree(fs, oldPath, expectedFiles);
        } catch (error) {
            kept.push({ from: row.from, to: row.to });
            warn(`could not compare the old skill copy ${row.from}`, error);
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
            warn(`could not remove the old skill copy ${row.from}`, error);
        }
    }
    return { removed, kept, failed };
}

function withWarnings(outcome: ProjectSkillsSyncOutcome, warnings: string[]): ProjectSkillsSyncOutcome {
    return warnings.length ? { ...outcome, warnings } : outcome;
}

/**
 * Bundled skill directory names, sorted. Dot entries are skipped like `copySkillsTree` does, so
 * a stray `.DS_Store` file is not mistaken for a skill.
 */
export async function bundledSkillNames(fs: SkillsSyncFs, source: string): Promise<string[]> {
    const entries = await fs.readdir(source, { withFileTypes: true });
    return entries
        .filter(entry => entry.isDirectory() && !entry.name.startsWith('.'))
        .map(entry => entry.name)
        .sort((left, right) => left.localeCompare(right));
}

/**
 * Which bundled skills would be added (no directory yet) and which would be overwritten.
 * Directories that exist in the project but are not bundled are never listed: they are the
 * user's own skills and the sync must not touch them.
 */
export async function planProjectSkillsSync(
    fs: SkillsSyncFs,
    source: string,
    destination: string
): Promise<ProjectSkillsSyncPlan> {
    const bundled = await bundledSkillNames(fs, source);
    let installed: Set<string>;
    try {
        installed = new Set((await fs.readdir(destination, { withFileTypes: true }))
            .filter(entry => entry.isDirectory())
            .map(entry => entry.name));
    } catch {
        installed = new Set();
    }
    return {
        added: bundled.filter(name => !installed.has(name)),
        updated: bundled.filter(name => installed.has(name))
    };
}

async function copyTree(
    fs: SkillsSyncFs,
    source: string,
    destination: string,
    relative: string,
    failures: string[],
    warn: (message: string, error?: unknown) => void
): Promise<void> {
    try {
        await fs.mkdir(destination, { recursive: true });
    } catch (error) {
        failures.push(relative);
        warn(`could not create ${relative}`, error);
        return;
    }
    let entries: Awaited<ReturnType<SkillsSyncFs['readdir']>>;
    try {
        entries = await fs.readdir(source, { withFileTypes: true });
    } catch (error) {
        failures.push(relative);
        warn(`could not read ${relative}`, error);
        return;
    }
    for (const entry of entries) {
        if (IGNORED_NAMES.has(entry.name)) {
            continue;
        }
        const from = join(source, entry.name);
        const to = join(destination, entry.name);
        const child = `${relative}/${entry.name}`;
        if (entry.isDirectory()) {
            await copyTree(fs, from, to, child, failures, warn);
        } else if (entry.isSymbolicLink()) {
            warn(`skipped symbolic link ${child}`);
        } else if (entry.isFile()) {
            try {
                await fs.writeFile(to, await fs.readFile(from));
            } catch (error) {
                // A read-only file, EPERM or EBUSY must not stop the rest of the sync: the
                // project still opens and the remaining skills are still updated.
                failures.push(child);
                warn(`could not write ${child}`, error);
            }
        }
    }
}

async function writeSkillsSchema(
    fs: SkillsSyncFs,
    destination: string,
    schema: { text: string; provenance: string },
    failures: string[],
    warn: (message: string, error?: unknown) => void
): Promise<void> {
    const relative = 'analyze-footage/references/analysis.schema.json';
    const target = join(destination, 'analyze-footage', 'references', 'analysis.schema.json');
    try {
        const parsed = JSON.parse(schema.text) as { $comment?: unknown };
        parsed.$comment = typeof parsed.$comment === 'string'
            ? `${parsed.$comment} ${schema.provenance}`
            : schema.provenance;
        await fs.mkdir(dirname(target), { recursive: true });
        await fs.writeFile(target, `${JSON.stringify(parsed, null, 2)}\n`, 'utf8');
    } catch (error) {
        failures.push(relative);
        warn(`could not write ${relative}`, error);
    }
}

function unique(values: string[]): string[] {
    return [...new Set(values)];
}

/**
 * Copy the bundled skills over the project copy. Returns `synced: false` without writing anything
 * when the installed signature already matches and `force` is not set (so mtimes do not change).
 * Every failure is collected by name and reported; it never aborts the copy. When anything failed,
 * `AKARI-SKILLS-VERSION` keeps its old value so the next open retries the sync.
 */
export async function syncProjectSkillsTree(options: ProjectSkillsSyncOptions): Promise<ProjectSkillsSyncOutcome> {
    const { fs, source, destination, signature, force, schema } = options;
    const warn = options.warn ?? (() => undefined);
    const installed = await readInstalledSkillsSignature(fs, destination);
    if (!skillsSyncRequired(installed, signature, force)) {
        return { synced: false, added: [], updated: [], failed: [] };
    }

    const failures: string[] = [];
    let plan: ProjectSkillsSyncPlan;
    try {
        plan = await planProjectSkillsSync(fs, source, destination);
    } catch (error) {
        warn('could not read the bundled skills tree', error);
        return { synced: false, added: [], updated: [], failed: ['.claude/skills'] };
    }

    try {
        await fs.mkdir(destination, { recursive: true });
    } catch (error) {
        warn('could not create .claude/skills', error);
        return { synced: false, added: plan.added, updated: plan.updated, failed: ['.claude/skills'] };
    }

    for (const name of [...plan.added, ...plan.updated]) {
        await copyTree(fs, join(source, name), join(destination, name), name, failures, warn);
    }
    if (schema) {
        await writeSkillsSchema(fs, destination, schema, failures, warn);
    }
    if (failures.length > 0) {
        // 司令塔の裁定（2026-10-19 合流時）: 1 つでも書けなかったら署名は更新しない。次に開いたとき
        // にもう一度同期が走り、書けるようになっていれば揃う（部分失敗を「済み」にしない）。
        warn(`${unique(failures).length} item(s) could not be written; ${SKILLS_VERSION_FILE} is left unchanged so the next open retries`);
        return { synced: true, added: plan.added, updated: plan.updated, failed: unique(failures) };
    }

    // The rename cleanup runs only after the new tree has been written successfully, so an
    // interrupted sync never leaves neither the old nor the new copy. `from` and `to` are
    // different directories, so the order does not affect the copy above.
    const renames = options.renames ?? await readSkillRenames(fs, source, warn);
    const cleanup = await cleanupRenamedSkillCopies({ fs, destination, renames, warn });
    if (cleanup.failed.length > 0) {
        failures.push(...cleanup.failed);
        warn(`${unique(failures).length} item(s) could not be removed; ${SKILLS_VERSION_FILE} is left unchanged so the next open retries`);
        return {
            synced: true,
            added: plan.added,
            updated: plan.updated,
            failed: unique(failures)
        };
    }
    const warnings = cleanup.kept.map(({ from, to }) =>
        t('project.workspace.service.renamedSkillCopyKeptWarning', { name: from, to }));

    try {
        const bundled = await bundledSkillNames(fs, source);
        await writeSkillCopiesManifest(fs, destination, source, bundled);
    } catch (error) {
        failures.push(SKILLS_COPIES_FILE);
        warn(`could not write ${SKILLS_COPIES_FILE}`, error);
        return { synced: true, added: plan.added, updated: plan.updated, failed: unique(failures) };
    }
    try {
        await fs.writeFile(join(destination, SKILLS_VERSION_FILE), `${signature}\n`, 'utf8');
    } catch (error) {
        failures.push(SKILLS_VERSION_FILE);
        warn(`could not write ${SKILLS_VERSION_FILE}`, error);
    }

    return withWarnings(
        { synced: true, added: plan.added, updated: plan.updated, failed: unique(failures) },
        warnings
    );
}
