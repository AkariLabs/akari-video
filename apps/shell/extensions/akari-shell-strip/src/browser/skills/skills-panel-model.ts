export const SKILLS_PANEL_TEXT = {
    heading: 'スキル',
    subtitle: 'パートナーに頼める決まった仕事。/呼び名 でも呼べます',
    empty: 'このプロジェクトにはまだスキルがありません。',
    ask: 'パートナーに頼む',
    add: 'スキルを作る・足す…',
    addHint: 'スキルの追加はこの版ではパートナーに頼んでください（例: /create-skill）'
} as const;

export type SkillCategory = 'plan' | 'material' | 'edit' | 'review' | 'export' | 'setup' | 'other';

export const SKILL_CATEGORY_ORDER: readonly SkillCategory[] =
    ['plan', 'material', 'edit', 'review', 'export', 'setup', 'other'];

const CATEGORY_WORDS: ReadonlyArray<readonly [SkillCategory, readonly string[]]> = [
    ['plan', ['research', 'plan', 'ideate']],
    ['material', ['import', 'material', 'harvest', 'narration', 'media', 'library', 'audio']],
    ['edit', ['edit', 'cut', 'caption', 'telop', 'mix']],
    ['review', ['review', 'lint', 'report', 'check', 'address']],
    ['export', ['export', 'publish', 'upload']],
    ['setup', ['setup', 'connect', 'install', 'manage']]
];

const CATEGORY_LABELS: Record<SkillCategory, string> = {
    plan: '企画', material: '素材', edit: '編集', review: '確認',
    export: '書き出し', setup: 'セットアップ', other: 'その他'
};

export function skillCategory(name: string, _description: string): SkillCategory {
    const words = new Set(name.toLowerCase().split('-'));
    for (const [category, candidates] of CATEGORY_WORDS) {
        if (candidates.some(word => words.has(word))) return category;
    }
    return 'other';
}

export function skillCategoryLabel(category: SkillCategory): string {
    return CATEGORY_LABELS[category];
}

export function groupSkillsByCategory<T extends { name: string; description: string }>(skills: readonly T[]): Array<{ category: SkillCategory; label: string; skills: T[] }> {
    return SKILL_CATEGORY_ORDER.map(category => ({
        category,
        label: skillCategoryLabel(category),
        skills: skills.filter(skill => skillCategory(skill.name, skill.description) === category)
    })).filter(group => group.skills.length > 0);
}

export function skillPromptText(name: string): string {
    return `/${name} `;
}

export function skillAskOutcomeMessage(result: unknown, name: string): { kind: 'info' | 'warn' | 'none'; text: string } {
    if (result === 'typed') return { kind: 'none', text: '' };
    if (result === 'unsupported') {
        return { kind: 'info', text: `「/${name}」をコピーしました。チャットに貼り付けてください` };
    }
    return { kind: 'warn', text: 'パートナーを開いてから頼んでください' };
}

export function skillsPanelNote(projectName: string | undefined): string {
    const intro = 'パートナーの中で `/呼び名` でも呼べます。';
    return projectName ? `${intro}いま開いている「${projectName}」に使います。` : intro;
}
