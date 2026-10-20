import { t } from '../../common/shell-text';
import { resolveSkillName, SKILL_RENAMES, SkillRenameEntry } from './skill-renames';

export const SKILLS_PANEL_TEXT = {
    get heading() { return t('shell.skills.panel.skillsLabel'); },
    get subtitle() { return t('shell.skills.panel.readyMadeTasksAskPartnerDoAlsoUseSkillNameStatus'); },
    get empty() { return t('shell.skills.panel.projectNoSkillsYetMessage'); },
    get ask() { return t('shell.skills.panel.askPartnerAction'); },
    get add() { return t('shell.skills.panel.createAddSkillAction'); },
    get addHint() { return t('shell.skills.panel.askPartnerAddSkillVersionExampleCreateSkillMessage'); }
} as const;

export type SkillCategory = 'plan' | 'analysis' | 'material' | 'edit' | 'review' | 'export' | 'setup' | 'other';

export const SKILL_CATEGORY_ORDER: readonly SkillCategory[] =
    ['plan', 'analysis', 'material', 'edit', 'review', 'export', 'setup', 'other'];

const CATEGORY_WORDS: ReadonlyArray<readonly [SkillCategory, readonly string[]]> = [
    ['plan', ['research', 'plan', 'ideate']],
    ['analysis', ['analyze', 'analysis', 'interpret', 'transcri', 'inspect', 'diagnos']],
    ['material', ['import', 'material', 'harvest', 'narration', 'media', 'image', 'video', 'library', 'audio']],
    ['edit', ['edit', 'cut', 'caption', 'telop', 'mix']],
    ['review', ['review', 'lint', 'report', 'check', 'address']],
    ['export', ['export', 'publish', 'upload']],
    ['setup', ['setup', 'connect', 'install', 'manage']]
];

export function skillCategory(
    name: string,
    _description: string,
    renames: readonly SkillRenameEntry[] = SKILL_RENAMES
): SkillCategory {
    const resolved = resolveSkillName(name, renames);
    const words = new Set(resolved.toLowerCase().split('-'));
    if (words.has('lint')) return 'review';
    for (const [category, candidates] of CATEGORY_WORDS) {
        if (candidates.some(word => category === 'analysis'
            ? [...words].some(nameWord => nameWord.startsWith(word))
            : words.has(word))) return category;
    }
    return 'other';
}

export function skillCategoryLabel(category: SkillCategory): string {
    return t(`shell.skills.category.${category}Label`);
}

export function groupSkillsByCategory<T extends { name: string; description: string }>(
    skills: readonly T[],
    renames: readonly SkillRenameEntry[] = SKILL_RENAMES
): Array<{ category: SkillCategory; label: string; skills: T[] }> {
    return SKILL_CATEGORY_ORDER.map(category => ({
        category,
        label: skillCategoryLabel(category),
        skills: skills.filter(skill => skillCategory(skill.name, skill.description, renames) === category)
    })).filter(group => group.skills.length > 0);
}

export function skillPromptText(name: string): string {
    return `/${name} `;
}

export function skillAskOutcomeMessage(result: unknown, name: string): { kind: 'info' | 'warn' | 'none'; text: string } {
    if (result === 'typed') return { kind: 'none', text: '' };
    if (result === 'unsupported') {
        return { kind: 'info', text: t('shell.skills.panel.copiedPasteChatStatus', { name }) };
    }
    return { kind: 'warn', text: t('shell.skills.panel.openPartnerAskingAction') };
}

export function skillsPanelNote(projectName: string | undefined): string {
    const intro = t('shell.skills.panel.alsoUseSkillNamePartnerMessage');
    return projectName ? `${intro}${t('shell.skills.panel.usedOpenProjectMessage', { name: projectName })}` : intro;
}
