import { parseFrontmatter } from 'akari-shell-strip/lib/common/skill-catalog';

export interface ChannelSkillDraft {
    slug: string;
    title: string;
    description: string;
    steps: string;
    reads: string[];
    copiedFrom?: string;
}

export function validateSkillSlug(slug: string): string | undefined {
    return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)
        ? undefined : '呼び名は英小文字・数字・ハイフンで（例: write-description）';
}

export function buildSkillMd(draft: ChannelSkillDraft): string {
    return `---\nname: ${draft.slug}\ndescription: ${draft.description}\n---\n\n# ${draft.title}\n\n`
        + (draft.copiedFrom ? `写し: /${draft.copiedFrom}\n\n` : '')
        + `${draft.steps}\n\n`
        + (draft.reads.length ? `読むもの: ${draft.reads.join('・')}\n` : '');
}

export function parseSkillMd(text: string): { slug: string; title: string; description: string; copiedFrom?: string } | undefined {
    const entry = parseFrontmatter(text);
    if (!entry) return undefined;
    const closing = /^---\s*$/m.exec(text.slice(4));
    const body = closing ? text.slice(4 + closing.index + closing[0].length) : '';
    const title = /^# (.+)$/m.exec(body)?.[1]?.trim() || entry.name;
    const copiedFrom = /^写し: \/([^\s]+)\s*$/m.exec(body)?.[1];
    return { slug: entry.name, title, description: entry.description, ...(copiedFrom ? { copiedFrom } : {}) };
}

export const PRESET_CHANNEL_SKILLS: readonly ChannelSkillDraft[] = [
    {
        slug: 'write-description', title: '説明欄を書く',
        description: 'この動画の説明欄を書く。書き出したあと、説明欄やチャプターを頼まれたときに使う。',
        steps: '1. channel.md の「誰に」「雰囲気」を読み、口調を合わせる\n2. 書き出した動画の構成からチャプターの時刻を拾う\n3. 冒頭 2 行に動画の要約を置き、チャプターと決まった文やリンクを続ける\n4. 本文を提案し、承認されたら planning/ に保存する',
        reads: ['channel.md', '辞書とメモ']
    },
    {
        slug: 'title-ideas', title: 'タイトル案を 5 つ', description: '書き出す前に動画のタイトル案を考えるときに使う。',
        steps: '1. channel.md で見る人と動画の約束を確かめる\n2. 動画の内容から伝える価値を一つ選ぶ\n3. 違う切り口でタイトル案を 5 つ書く\n4. design.md の雰囲気に合う案を選んで理由を添える',
        reads: ['channel.md', 'design.md']
    },
    {
        slug: 'thumbnail-copy', title: 'サムネの文言', description: '書き出す前にサムネイルの文言を考えるときに使う。',
        steps: '1. design.md の文字と色の決まりを読む\n2. 動画で一番伝えたい点を短い言葉にする\n3. 画面に収まる文言を複数提案する\n4. タイトルと並べて重複を確かめる',
        reads: ['design.md']
    },
    {
        slug: 'cut-shorts', title: 'ショートを切り出す', description: '書き出したあとに短い動画を切り出すときに使う。',
        steps: '1. 書き出した動画から一つで伝わる場面を探す\n2. 冒頭で内容が伝わる開始点を決める\n3. design.md に合わせて縦画面の文字と余白を整える\n4. 辞書とメモの表記を確かめて切り出し案を示す',
        reads: ['design.md', '辞書とメモ']
    },
    {
        slug: 'add-chapters', title: 'チャプターを付ける', description: '書き出したあとにチャプターを付けるときに使う。',
        steps: '1. channel.md で見る人と話し方を確かめる\n2. 書き出した動画を見て話題の切り替わりを拾う\n3. 時刻と短い見出しを順番に並べる\n4. 実際の切り替わりと時刻が合うか確かめる',
        reads: ['channel.md']
    },
    {
        slug: 'final-check', title: 'いつもの仕上げ', description: '編集の最後にチャンネルの決まりを確かめるときに使う。',
        steps: '1. 辞書とメモの表記と固定文を確かめる\n2. design.md の色、文字、ロゴの決まりと見比べる\n3. 字幕や音の抜けと終わり方を確かめる\n4. 直す場所を時刻付きでまとめる',
        reads: ['辞書とメモ', 'design.md']
    },
    {
        slug: 'fix-opening', title: '冒頭を詰める', description: '編集中に動画の冒頭を見直すときに使う。',
        steps: '1. channel.md で誰に向けた動画か確かめる\n2. 冒頭で待たせている場面を探す\n3. 最初に見せる内容と削る場面を提案する\n4. 変更後の冒頭が動画の約束と合うか確かめる',
        reads: ['channel.md']
    }
];

export function copiedSkillMd(sourceName: string, sourceText: string): string {
    const lines = sourceText.split(/\r?\n/);
    if (lines[0]?.trim() !== '---') return sourceText;
    const closing = lines.findIndex((line, index) => index > 0 && line.trim() === '---');
    if (closing < 0) return sourceText;
    const front = lines.slice(0, closing + 1).map(line => /^name:\s*/.test(line) ? `name: my-${sourceName}` : line);
    const body = lines.slice(closing + 1).join('\n').replace(/^\n*/, '');
    return `${front.join('\n')}\n\n写し: /${sourceName}\n\n${body}`;
}
