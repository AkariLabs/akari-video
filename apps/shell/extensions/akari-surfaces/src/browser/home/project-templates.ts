export interface ProjectTemplate {
    id: string;
    name: string;
    description: string;
    planMarkdown: string;
}

export const BUILTIN_PROJECT_TEMPLATES: readonly ProjectTemplate[] = [
    {
        id: 'vertical-short', name: '縦ショート 60 秒', description: '60 秒を導入・本題・結びの 3 段で組み立てます。',
        planMarkdown: '# 縦ショート 60 秒の企画書\n\n## 伝えたいこと\n- \n\n## 導入（0〜10 秒）\n- \n\n## 本題（10〜50 秒）\n- \n\n## 結び（50〜60 秒）\n- \n\n## 必要な素材・字幕\n- \n'
    },
    {
        id: 'horizontal-talk', name: '横のトーク', description: '話す順番と画面に見せるものを整理します。',
        planMarkdown: '# 横のトークの企画書\n\n## 話すテーマ\n- \n\n## 冒頭で伝えること\n- \n\n## 話す順番\n- \n\n## 見せる素材・字幕\n- \n\n## 締めの言葉\n- \n'
    },
    {
        id: 'lesson', name: '解説・講義', description: '章立てと各章で伝える要点を決めます。',
        planMarkdown: '# 解説・講義の企画書\n\n## 対象と学べること\n- \n\n## 導入\n- \n\n## 第 1 章\n- \n\n## 第 2 章\n- \n\n## まとめ\n- \n'
    },
    {
        id: 'development-log', name: '開発ログ', description: '直した所から理由、結果へつなぎます。',
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
    return `${templateName} ${date.toISOString().slice(0, 10)}`;
}

export function planFileName(existing: string[]): string {
    const names = new Set(existing.map(name => name.toLocaleLowerCase()));
    if (!names.has('企画書.md')) return '企画書.md';
    for (let index = 2; ; index++) {
        const candidate = `企画書-${index}.md`;
        if (!names.has(candidate)) return candidate;
    }
}
