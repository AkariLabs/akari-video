import { getLanguage } from '@akari-video/i18n';
import * as jaSkills from '../../../../../../packages/i18n/locales/ja/skills.json';
import * as enSkills from '../../../../../../packages/i18n/locales/en/skills.json';

export interface SkillEntry { name: string; description: string }

/** Keep frontmatter intact for consumers that need the source metadata. */
export function skillDisplay(entry: SkillEntry): SkillEntry {
    const catalog: Record<string, string> = getLanguage() === 'ja' ? jaSkills : enSkills;
    const value = (role: 'title' | 'summary', fallback: string): string => {
        const catalogName = entry.name.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
        const key = `skills.catalog.${catalogName}.${role}`;
        const english: Record<string, string> = enSkills;
        return catalog[key] ?? english[key] ?? fallback;
    };
    return { name: value('title', entry.name), description: value('summary', entry.description) };
}

export function parseFrontmatter(content: string): SkillEntry | undefined {
    const lines = content.split(/\r?\n/);
    if (lines[0]?.trim() !== '---') return undefined;
    let name: string | undefined;
    let description: string | undefined;
    let closed = false;
    for (let i = 1; i < lines.length; i++) {
        const line = lines[i];
        if (line.trim() === '---') { closed = true; break; }
        const match = /^([a-zA-Z_-]+):\s?(.*)$/.exec(line);
        if (match?.[1] === 'name') name = match[2].trim();
        if (match?.[1] === 'description') description = match[2].trim();
    }
    return closed && name ? { name, description: description ?? '' } : undefined;
}
