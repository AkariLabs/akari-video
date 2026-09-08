export interface AkariMenuRow {
    id: string;
    label: string;
    icon: string;
}

export function akariMenuRows(): AkariMenuRow[] {
    return [
        { id: 'akari.partner.beginOnboarding', label: 'パートナー', icon: 'codicon codicon-add' },
        { id: 'akari.daihon.open', label: '台本', icon: 'codicon codicon-list-selection' },
        { id: 'akari.cuts.open', label: 'カット候補', icon: 'codicon codicon-checklist' },
        { id: 'akari.review.open', label: '注釈', icon: 'codicon codicon-comment-discussion' },
        { id: 'akari.annotations.open', label: 'タイムライン（下パネル）', icon: 'codicon codicon-comment' },
        { id: 'akari.menu.openOverview', label: 'ホーム', icon: 'codicon codicon-home' },
        { id: 'akari.home.openFirstRunSetup', label: 'セットアップ', icon: 'codicon codicon-tools' },
        { id: 'akari.home.openProjectLauncher', label: 'プロジェクト・ランチャー', icon: 'codicon codicon-layout' },
        { id: 'akari.project.showChanges', label: '変更を見る', icon: 'codicon codicon-diff' }
    ];
}
