import { dirname, join } from 'path';
import type { ProjectSkillsSyncOutcome } from '../common/akari-project-protocol';

/**
 * Project-side copy of the bundled skills tree.
 *
 * `installProjectSkills()` runs only when a project is created or converted, so a project made
 * before a skill was bundled never receives it (record-playbook and older projects, reported
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
 * Every failure is collected by name and reported; it never aborts the copy.
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
    try {
        await fs.writeFile(join(destination, SKILLS_VERSION_FILE), `${signature}\n`, 'utf8');
    } catch (error) {
        failures.push(SKILLS_VERSION_FILE);
        warn(`could not write ${SKILLS_VERSION_FILE}`, error);
    }

    return { synced: true, added: plan.added, updated: plan.updated, failed: unique(failures) };
}
