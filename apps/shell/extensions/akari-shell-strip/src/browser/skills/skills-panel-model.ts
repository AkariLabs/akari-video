export const SKILLS_PANEL_TEXT = {
    heading: 'スキル',
    subtitle: 'パートナーに頼める決まった仕事',
    empty: 'このプロジェクトにはまだスキルがありません。',
    ask: 'パートナーに頼む',
    add: 'スキルを作る・足す…',
    addHint: 'スキルの追加はこの版ではパートナーに頼んでください（例: /create-skill）'
} as const;

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
