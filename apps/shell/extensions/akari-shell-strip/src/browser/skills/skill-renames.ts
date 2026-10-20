import * as skillRenames from '../../../../../../../skills/renames.json';
import { SkillEntry, skillDisplay } from '../../common/skill-catalog';

export interface SkillRenameEntry { from: string; to: string }

/** `skills/renames.json` is the single rename table; the dictionaries only carry new names. */
export const SKILL_RENAMES: readonly SkillRenameEntry[] =
    (skillRenames as unknown as { renames?: SkillRenameEntry[] }).renames ?? [];

/**
 * Follow the rename table (a → b → c folds to c) before looking anything up. A cycle falls back
 * to the original name; the repository test rejects cycles in the table itself.
 */
export function resolveSkillName(name: string, renames: readonly SkillRenameEntry[] = SKILL_RENAMES): string {
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
 * Look up the catalog title / summary through the rename table. The returned `name` is the
 * catalog title (the new name); callers that open `<project>/.claude/skills/<name>/SKILL.md`
 * must keep using the entry's own directory name.
 */
export function resolvedSkillDisplay(
    entry: SkillEntry,
    renames: readonly SkillRenameEntry[] = SKILL_RENAMES
): SkillEntry {
    const name = resolveSkillName(entry.name, renames);
    return name === entry.name ? skillDisplay(entry) : skillDisplay({ ...entry, name });
}

/** The catalog summary for an entry, resolving an old project copy to the new skill name. */
export function resolvedSkillDescription(
    entry: SkillEntry,
    renames: readonly SkillRenameEntry[] = SKILL_RENAMES
): string {
    return resolvedSkillDisplay(entry, renames).description;
}
