import { t } from '@akari-video/i18n';
export interface ProjectTemplate {
    id: string;
    name: string;
    description: string;
    planMarkdown: string;
}

export const BUILTIN_PROJECT_TEMPLATES: readonly ProjectTemplate[] = [
    {
        id: 'vertical-short', name: t('surfaces.projects.verticalShortSeconds.label'), description: t('surfaces.projects.assembleSecondsThreeStepsIntroductionMainTopic.description'),
        planMarkdown: '# 縦ショート 60 秒の企画書\n\n## 伝えたいこと\n- \n\n## 導入（0〜10 秒）\n- \n\n## 本題（10〜50 秒）\n- \n\n## 結び（50〜60 秒）\n- \n\n## 必要な素材・字幕\n- \n'
    },
    {
        id: 'horizontal-talk', name: t('surfaces.projects.sideTalk.label'), description: t('surfaces.projects.organizeSpeakingOrderShowScreen.description'),
        planMarkdown: '# 横のトークの企画書\n\n## 話すテーマ\n- \n\n## 冒頭で伝えること\n- \n\n## 話す順番\n- \n\n## 見せる素材・字幕\n- \n\n## 締めの言葉\n- \n'
    },
    {
        id: 'lesson', name: t('surfaces.projects.explanationLecture.label'), description: t('surfaces.projects.decideChapterStructureMainPointsConveyedChapter.description'),
        planMarkdown: '# 解説・講義の企画書\n\n## 対象と学べること\n- \n\n## 導入\n- \n\n## 第 1 章\n- \n\n## 第 2 章\n- \n\n## まとめ\n- \n'
    },
    {
        id: 'development-log', name: t('surfaces.projects.developmentLog.label'), description: t('surfaces.projects.connectFixReasonResult.description'),
        planMarkdown: '# 開発ログの企画書\n\n## 今回の概要\n- \n\n## 直した所\n- \n\n## 直した理由\n- \n\n## 作業の様子\n- \n\n## 結果と次の一歩\n- \n'
    }
];

export function parseTemplateMarkdown(fileName: string, text: string): ProjectTemplate {
    const stem = fileName.split(/[\\/]/).pop()!.replace(/\.md$/i, '');
    let name = stem;
    let description = stem;
    const frontMatter = text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
    if (frontMatter) {
        for (const line of frontMatter[1].split(/\r?\n/)) {
            const field = line.match(/^(name|description):\s*(.*?)\s*$/);
            if (!field) continue;
            const value = field[2].replace(/^(?:"(.*)"|'(.*)')$/, '$1$2').trim();
            if (field[1] === 'name' && value) name = value;
            if (field[1] === 'description' && value) description = value;
        }
    }
    return { id: `channel:${stem}`, name, description, planMarkdown: text };
}

export function defaultProjectTitle(templateName: string, date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${templateName} ${year}-${month}-${day}`;
}

export function planFileName(existing: string[]): string {
    const names = new Set(existing.map(name => name.toLocaleLowerCase()));
    if (!names.has('企画書.md')) return '企画書.md';
    for (let index = 2; ; index++) {
        const candidate = `企画書-${index}.md`;
        if (!names.has(candidate)) return candidate;
    }
}
