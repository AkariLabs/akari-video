export const QUESTION_KEYS = ['genre', 'who', 'plat', 'len', 'tone', 'every'] as const;
export type QuestionKey = typeof QUESTION_KEYS[number];
export interface ChannelQuestion { key: QuestionKey; title: string; hint: string; mode: 'single' | 'multi'; freeText: boolean; options: readonly string[] }
export type ChannelAnswers = Partial<Record<QuestionKey, string[]>>;
export interface ChannelType { name: string; tier: 'free' | 'pro'; tags: readonly string[] }
export interface RankedType { name: string; tier: 'free' | 'pro'; matched: string[] }

export const CHANNEL_QUESTIONS: readonly ChannelQuestion[] = [
    { key: 'genre', title: '何を撮りますか？', hint: 'いちばん多いものを 1 つ。あとで変えられます。', mode: 'single', freeText: true, options: ['料理', '旅・Vlog', 'ゲーム', '解説・学び', '開発・テック', '美容', 'ペット', '家族の思い出'] },
    { key: 'who', title: '誰に見てほしいですか？', hint: '思い浮かぶ人に近いものを。', mode: 'single', freeText: true, options: ['はじめての人', '同じ趣味の人', '仕事の仲間', '家族・友だち', '未来の自分（記録）'] },
    { key: 'plat', title: 'どこに出しますか？', hint: 'いくつでも。', mode: 'multi', freeText: false, options: ['YouTube', 'YouTube ショート', 'TikTok', 'Instagram リール', 'X', 'まだ出さない'] },
    { key: 'len', title: '長さと向きは？', hint: 'いちばんよく作るものを。', mode: 'single', freeText: false, options: ['縦ショート 60 秒まで', '横 5〜10 分', '横 20 分以上', 'まだ決めていない'] },
    { key: 'tone', title: 'どんな雰囲気にしたいですか？', hint: '字幕・音・つなぎ方の下書きに使います。', mode: 'single', freeText: false, options: ['落ち着いた', '明るい', '面白い', 'かっこいい', 'やさしい'] },
    { key: 'every', title: '毎回入れたいことは？', hint: 'いくつでも。パートナーが毎回守る「決まりごと」になります。', mode: 'multi', freeText: false, options: ['冒頭に結論', '字幕は全部', '最後にひとこと', 'いつもの BGM', '場所と日付', '顔は出さない'] }
];

export const CHANNEL_TYPES: readonly ChannelType[] = [
    { name: '縦ショート 60 秒', tier: 'free', tags: ['縦ショート 60 秒まで', 'YouTube ショート', 'TikTok', 'Instagram リール', '明るい'] },
    { name: '料理ショート 15 秒', tier: 'pro', tags: ['料理', '縦ショート 60 秒まで', 'Instagram リール', 'はじめての人', '顔は出さない'] },
    { name: '作り置きレシピ（横）', tier: 'pro', tags: ['料理', '横 5〜10 分', 'YouTube', 'やさしい'] },
    { name: 'Vlog', tier: 'free', tags: ['旅・Vlog', '落ち着いた', '場所と日付', '未来の自分（記録）'] },
    { name: '旅のダイジェスト', tier: 'pro', tags: ['旅・Vlog', '横 5〜10 分', 'かっこいい', 'いつもの BGM'] },
    { name: 'ゲーム実況の切り抜き', tier: 'free', tags: ['ゲーム', '面白い', '同じ趣味の人', 'YouTube ショート'] },
    { name: '解説・講義', tier: 'free', tags: ['解説・学び', '横 20 分以上', '冒頭に結論', 'はじめての人'] },
    { name: '開発ログ', tier: 'pro', tags: ['開発・テック', '仕事の仲間', 'X', '横 5〜10 分', '冒頭に結論'] },
    { name: 'テック系ニュース解説', tier: 'pro', tags: ['開発・テック', '解説・学び', 'YouTube', 'X', '落ち着いた'] },
    { name: '美容のビフォーアフター', tier: 'pro', tags: ['美容', '縦ショート 60 秒まで', 'TikTok', '明るい'] },
    { name: 'ペットのショート', tier: 'free', tags: ['ペット', '縦ショート 60 秒まで', 'やさしい', '家族・友だち'] },
    { name: '家族の思い出', tier: 'free', tags: ['家族の思い出', '家族・友だち', 'やさしい', '場所と日付', 'まだ出さない'] }
];

export function rankTypes(answers: ChannelAnswers): RankedType[] {
    const chosen = new Set(QUESTION_KEYS.flatMap(key => answers[key] ?? []));
    return CHANNEL_TYPES.map((type, index) => ({ ...type, matched: type.tags.filter(tag => chosen.has(tag)), index }))
        .filter(type => type.matched.length > 0)
        .sort((a, b) => b.matched.length - a.matched.length || (a.tier === 'free' ? -1 : 1) - (b.tier === 'free' ? -1 : 1) || a.index - b.index)
        .slice(0, 3).map(({ name, tier, matched }) => ({ name, tier, matched }));
}

function section(heading: string, body: string): string { return `## ${heading}\n${body}`; }
function values(answers: ChannelAnswers, key: QuestionKey): string[] { return (answers[key] ?? []).filter(Boolean); }

export function buildChannelMarkdown(answers: ChannelAnswers, channelName: string, appliedType?: string, rest?: string): string {
    const parts = [`# ${channelName}`];
    if (values(answers, 'genre').length) parts.push(section('ジャンル', values(answers, 'genre').join('、')));
    if (values(answers, 'who').length) parts.push(section('誰に', values(answers, 'who').join('、')));
    const place = [values(answers, 'plat').join('、'), values(answers, 'len')[0]].filter(Boolean).join(' · ');
    if (place) parts.push(section('どこに出す', place));
    if (values(answers, 'tone').length) parts.push(section('雰囲気', `${values(answers, 'tone')[0]}。字幕・音・つなぎ方もこの雰囲気で`));
    if (values(answers, 'every').length) parts.push(section('毎回入れること（決まりごと）', values(answers, 'every').map(value => `- ${value}`).join('\n')));
    if (appliedType) parts.push(section('チャンネルの型', `${appliedType}（テンプレ・字幕スタイル・スキルの下書きが入る）`));
    parts.push(section('このあと深掘りすると書けること', '- ほかとの違い\n- 見る人の困りごと\n- 続けられる量'));
    parts.push(section('このチャンネルのファイル', '- design.md — 見た目の決まり（色・文字・雰囲気）\n- people.md — 人とモノ\n- notes.md — 辞書とメモ\n- skills/ — このチャンネル用のスキル\n- ライブラリ — いつも使う素材'));
    if (rest?.trim()) parts.push(rest.trimEnd());
    return `${parts.join('\n\n')}\n`;
}

export function splitMarkdownSections(text: string): { heading: string; body: string }[] {
    const sections: { heading: string; body: string }[] = [];
    let heading = '';
    let lines: string[] = [];
    const flush = (): void => { if (heading || lines.some(line => line.trim())) sections.push({ heading, body: lines.join('\n').trim() }); };
    for (const line of text.split(/\r?\n/)) {
        if (/^# (?!#)/.test(line) && !heading && !lines.some(item => item.trim())) continue;
        if (line.startsWith('## ')) { flush(); heading = line.slice(3); lines = []; }
        else lines.push(line);
    }
    flush();
    return sections;
}

export function parseChannelMarkdown(text: string): { answers: ChannelAnswers; appliedType?: string; rest: string } {
    const answers: ChannelAnswers = {};
    const unknown: string[] = [];
    let appliedType: string | undefined;
    for (const { heading, body } of splitMarkdownSections(text)) {
        switch (heading) {
            case 'ジャンル': answers.genre = body ? [body] : []; break;
            case '誰に': answers.who = body ? [body] : []; break;
            case 'どこに出す': {
                const [platforms, length] = body.split(' · ');
                if (platforms) answers.plat = platforms.split('、').filter(Boolean);
                if (length) answers.len = [length];
                else if (platforms && CHANNEL_QUESTIONS[3].options.includes(platforms)) { answers.len = [platforms]; delete answers.plat; }
                break;
            }
            case '雰囲気': answers.tone = body ? [body.split('。')[0]] : []; break;
            case '毎回入れること（決まりごと）': answers.every = body.split('\n').filter(line => line.startsWith('- ')).map(line => line.slice(2)); break;
            case 'チャンネルの型': appliedType = body.replace(/（テンプレ・字幕スタイル・スキルの下書きが入る）$/, ''); break;
            case 'このあと深掘りすると書けること':
            case 'このチャンネルのファイル': break;
            default: unknown.push(heading ? `## ${heading}\n${body}` : body);
        }
    }
    return { answers, appliedType, rest: unknown.filter(Boolean).join('\n\n') };
}

export function summarizeAnswers(answers: ChannelAnswers): string {
    return QUESTION_KEYS.map(key => values(answers, key).join('、')).filter(Boolean).join(' / ');
}

export function channelDesignPartnerPrompt(answers: ChannelAnswers): string {
    return '/channel-design ' + summarizeAnswers(answers);
}
