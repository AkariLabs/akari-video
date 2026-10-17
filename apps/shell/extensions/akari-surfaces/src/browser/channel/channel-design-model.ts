import { t } from '@akari-video/i18n';
export const QUESTION_KEYS = ['genre', 'who', 'plat', 'len', 'tone', 'every'] as const;
export type QuestionKey = typeof QUESTION_KEYS[number];
export interface ChannelQuestion { key: QuestionKey; title: string; hint: string; mode: 'single' | 'multi'; freeText: boolean; options: readonly string[] }
export type ChannelAnswers = Partial<Record<QuestionKey, string[]>>;
export interface ChannelType { name: string; tier: 'free' | 'pro'; tags: readonly string[] }
export interface RankedType { name: string; tier: 'free' | 'pro'; matched: string[] }

export const CHANNEL_QUESTIONS: readonly ChannelQuestion[] = [
    { key: 'genre', title: t('surfaces.channelDesign.genre.title'), hint: t('surfaces.channelDesign.genre.hint'), mode: 'single', freeText: true, options: [t('surfaces.channelDesign.cooking.label'), t('surfaces.channelDesign.travelVlogs.label'), t('surfaces.channelDesign.gaming.label'), t('surfaces.channelDesign.explainersLearning.label'), t('surfaces.channelDesign.developmentTech.label'), t('surfaces.channelDesign.beauty.label'), t('surfaces.channelDesign.pets.label'), t('surfaces.channelDesign.familyMemories.label')] },
    { key: 'who', title: t('surfaces.channelDesign.who.title'), hint: t('surfaces.channelDesign.who.hint'), mode: 'single', freeText: true, options: [t('surfaces.channelDesign.newViewers.label'), t('surfaces.channelDesign.peopleSameInterests.label'), t('surfaces.channelDesign.colleagues.label'), t('surfaces.channelDesign.familyFriends.label'), t('surfaces.channelDesign.futureSelfRecord.label')] },
    { key: 'plat', title: t('surfaces.channelDesign.platform.title'), hint: t('surfaces.channelDesign.platform.hint'), mode: 'multi', freeText: false, options: [t('surfaces.channelDesign.youtube.label'), t('surfaces.channelDesign.youtubeShorts.label'), t('surfaces.channelDesign.tiktok.label'), t('surfaces.channelDesign.instagramReels.label'), t('surfaces.channelDesign.x.label'), t('surfaces.channelDesign.sharingYet.label')] },
    { key: 'len', title: t('surfaces.channelDesign.length.title'), hint: t('surfaces.channelDesign.length.hint'), mode: 'single', freeText: false, options: [t('surfaces.channelDesign.verticalShortUpSeconds.label'), t('surfaces.channelDesign.landscapeFiveToTenMinutes.option'), t('surfaces.channelDesign.landscapeOverTwentyMinutes.option'), t('surfaces.channelDesign.sureYet.label')] },
    { key: 'tone', title: t('surfaces.channelDesign.tone.title'), hint: t('surfaces.channelDesign.tone.hint'), mode: 'single', freeText: false, options: [t('surfaces.channelDesign.calm.label'), t('surfaces.channelDesign.bright.label'), t('surfaces.channelDesign.fun.label'), t('surfaces.channelDesign.bold.label'), t('surfaces.channelDesign.gentle.label')] },
    { key: 'every', title: t('surfaces.channelDesign.every.title'), hint: t('surfaces.channelDesign.every.hint'), mode: 'multi', freeText: false, options: [t('surfaces.channelDesign.leadConclusion.label'), t('surfaces.channelDesign.captionsThroughout.label'), t('surfaces.channelDesign.closingLine.label'), t('surfaces.channelDesign.usualMusic.label'), t('surfaces.channelDesign.placeDate.label'), t('surfaces.channelDesign.noFaces.label')] }
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

const canonicalChoices = new Map<string, string>([
    [t('surfaces.channelDesign.cooking.label'), t('surfaces.channelDesign.cooking.label', {}, 'ja')],
    [t('surfaces.channelDesign.travelVlogs.label'), t('surfaces.channelDesign.travelVlogs.label', {}, 'ja')],
    [t('surfaces.channelDesign.gaming.label'), t('surfaces.channelDesign.gaming.label', {}, 'ja')],
    [t('surfaces.channelDesign.explainersLearning.label'), t('surfaces.channelDesign.explainersLearning.label', {}, 'ja')],
    [t('surfaces.channelDesign.developmentTech.label'), t('surfaces.channelDesign.developmentTech.label', {}, 'ja')],
    [t('surfaces.channelDesign.beauty.label'), t('surfaces.channelDesign.beauty.label', {}, 'ja')],
    [t('surfaces.channelDesign.pets.label'), t('surfaces.channelDesign.pets.label', {}, 'ja')],
    [t('surfaces.channelDesign.familyMemories.label'), t('surfaces.channelDesign.familyMemories.label', {}, 'ja')],
    [t('surfaces.channelDesign.newViewers.label'), t('surfaces.channelDesign.newViewers.label', {}, 'ja')],
    [t('surfaces.channelDesign.peopleSameInterests.label'), t('surfaces.channelDesign.peopleSameInterests.label', {}, 'ja')],
    [t('surfaces.channelDesign.colleagues.label'), t('surfaces.channelDesign.colleagues.label', {}, 'ja')],
    [t('surfaces.channelDesign.familyFriends.label'), t('surfaces.channelDesign.familyFriends.label', {}, 'ja')],
    [t('surfaces.channelDesign.futureSelfRecord.label'), t('surfaces.channelDesign.futureSelfRecord.label', {}, 'ja')],
    [t('surfaces.channelDesign.youtube.label'), t('surfaces.channelDesign.youtube.label', {}, 'ja')],
    [t('surfaces.channelDesign.youtubeShorts.label'), t('surfaces.channelDesign.youtubeShorts.label', {}, 'ja')],
    [t('surfaces.channelDesign.tiktok.label'), t('surfaces.channelDesign.tiktok.label', {}, 'ja')],
    [t('surfaces.channelDesign.instagramReels.label'), t('surfaces.channelDesign.instagramReels.label', {}, 'ja')],
    [t('surfaces.channelDesign.x.label'), t('surfaces.channelDesign.x.label', {}, 'ja')],
    [t('surfaces.channelDesign.sharingYet.label'), t('surfaces.channelDesign.sharingYet.label', {}, 'ja')],
    [t('surfaces.channelDesign.verticalShortUpSeconds.label'), t('surfaces.channelDesign.verticalShortUpSeconds.label', {}, 'ja')],
    [t('surfaces.channelDesign.landscapeFiveToTenMinutes.option'), t('surfaces.channelDesign.landscapeFiveToTenMinutes.option', {}, 'ja')],
    [t('surfaces.channelDesign.landscapeOverTwentyMinutes.option'), t('surfaces.channelDesign.landscapeOverTwentyMinutes.option', {}, 'ja')],
    [t('surfaces.channelDesign.sureYet.label'), t('surfaces.channelDesign.sureYet.label', {}, 'ja')],
    [t('surfaces.channelDesign.calm.label'), t('surfaces.channelDesign.calm.label', {}, 'ja')],
    [t('surfaces.channelDesign.bright.label'), t('surfaces.channelDesign.bright.label', {}, 'ja')],
    [t('surfaces.channelDesign.fun.label'), t('surfaces.channelDesign.fun.label', {}, 'ja')],
    [t('surfaces.channelDesign.bold.label'), t('surfaces.channelDesign.bold.label', {}, 'ja')],
    [t('surfaces.channelDesign.gentle.label'), t('surfaces.channelDesign.gentle.label', {}, 'ja')],
    [t('surfaces.channelDesign.leadConclusion.label'), t('surfaces.channelDesign.leadConclusion.label', {}, 'ja')],
    [t('surfaces.channelDesign.captionsThroughout.label'), t('surfaces.channelDesign.captionsThroughout.label', {}, 'ja')],
    [t('surfaces.channelDesign.closingLine.label'), t('surfaces.channelDesign.closingLine.label', {}, 'ja')],
    [t('surfaces.channelDesign.usualMusic.label'), t('surfaces.channelDesign.usualMusic.label', {}, 'ja')],
    [t('surfaces.channelDesign.placeDate.label'), t('surfaces.channelDesign.placeDate.label', {}, 'ja')],
    [t('surfaces.channelDesign.noFaces.label'), t('surfaces.channelDesign.noFaces.label', {}, 'ja')]
]);
const localizedChoices = new Map<string, string>([
    [t('surfaces.channelDesign.cooking.label', {}, 'ja'), t('surfaces.channelDesign.cooking.label')],
    [t('surfaces.channelDesign.travelVlogs.label', {}, 'ja'), t('surfaces.channelDesign.travelVlogs.label')],
    [t('surfaces.channelDesign.gaming.label', {}, 'ja'), t('surfaces.channelDesign.gaming.label')],
    [t('surfaces.channelDesign.explainersLearning.label', {}, 'ja'), t('surfaces.channelDesign.explainersLearning.label')],
    [t('surfaces.channelDesign.developmentTech.label', {}, 'ja'), t('surfaces.channelDesign.developmentTech.label')],
    [t('surfaces.channelDesign.beauty.label', {}, 'ja'), t('surfaces.channelDesign.beauty.label')],
    [t('surfaces.channelDesign.pets.label', {}, 'ja'), t('surfaces.channelDesign.pets.label')],
    [t('surfaces.channelDesign.familyMemories.label', {}, 'ja'), t('surfaces.channelDesign.familyMemories.label')],
    [t('surfaces.channelDesign.newViewers.label', {}, 'ja'), t('surfaces.channelDesign.newViewers.label')],
    [t('surfaces.channelDesign.peopleSameInterests.label', {}, 'ja'), t('surfaces.channelDesign.peopleSameInterests.label')],
    [t('surfaces.channelDesign.colleagues.label', {}, 'ja'), t('surfaces.channelDesign.colleagues.label')],
    [t('surfaces.channelDesign.familyFriends.label', {}, 'ja'), t('surfaces.channelDesign.familyFriends.label')],
    [t('surfaces.channelDesign.futureSelfRecord.label', {}, 'ja'), t('surfaces.channelDesign.futureSelfRecord.label')],
    [t('surfaces.channelDesign.youtube.label', {}, 'ja'), t('surfaces.channelDesign.youtube.label')],
    [t('surfaces.channelDesign.youtubeShorts.label', {}, 'ja'), t('surfaces.channelDesign.youtubeShorts.label')],
    [t('surfaces.channelDesign.tiktok.label', {}, 'ja'), t('surfaces.channelDesign.tiktok.label')],
    [t('surfaces.channelDesign.instagramReels.label', {}, 'ja'), t('surfaces.channelDesign.instagramReels.label')],
    [t('surfaces.channelDesign.x.label', {}, 'ja'), t('surfaces.channelDesign.x.label')],
    [t('surfaces.channelDesign.sharingYet.label', {}, 'ja'), t('surfaces.channelDesign.sharingYet.label')],
    [t('surfaces.channelDesign.verticalShortUpSeconds.label', {}, 'ja'), t('surfaces.channelDesign.verticalShortUpSeconds.label')],
    [t('surfaces.channelDesign.landscapeFiveToTenMinutes.option', {}, 'ja'), t('surfaces.channelDesign.landscapeFiveToTenMinutes.option')],
    [t('surfaces.channelDesign.landscapeOverTwentyMinutes.option', {}, 'ja'), t('surfaces.channelDesign.landscapeOverTwentyMinutes.option')],
    [t('surfaces.channelDesign.sureYet.label', {}, 'ja'), t('surfaces.channelDesign.sureYet.label')],
    [t('surfaces.channelDesign.calm.label', {}, 'ja'), t('surfaces.channelDesign.calm.label')],
    [t('surfaces.channelDesign.bright.label', {}, 'ja'), t('surfaces.channelDesign.bright.label')],
    [t('surfaces.channelDesign.fun.label', {}, 'ja'), t('surfaces.channelDesign.fun.label')],
    [t('surfaces.channelDesign.bold.label', {}, 'ja'), t('surfaces.channelDesign.bold.label')],
    [t('surfaces.channelDesign.gentle.label', {}, 'ja'), t('surfaces.channelDesign.gentle.label')],
    [t('surfaces.channelDesign.leadConclusion.label', {}, 'ja'), t('surfaces.channelDesign.leadConclusion.label')],
    [t('surfaces.channelDesign.captionsThroughout.label', {}, 'ja'), t('surfaces.channelDesign.captionsThroughout.label')],
    [t('surfaces.channelDesign.closingLine.label', {}, 'ja'), t('surfaces.channelDesign.closingLine.label')],
    [t('surfaces.channelDesign.usualMusic.label', {}, 'ja'), t('surfaces.channelDesign.usualMusic.label')],
    [t('surfaces.channelDesign.placeDate.label', {}, 'ja'), t('surfaces.channelDesign.placeDate.label')],
    [t('surfaces.channelDesign.noFaces.label', {}, 'ja'), t('surfaces.channelDesign.noFaces.label')]
]);
function canonicalChoice(value: string): string { return canonicalChoices.get(value) ?? value; }
function localizedChoice(value: string): string { return localizedChoices.get(value) ?? value; }

export function rankTypes(answers: ChannelAnswers): RankedType[] {
    const chosen = new Set(QUESTION_KEYS.flatMap(key => answers[key] ?? []).map(canonicalChoice));
    const genres = new Set(CHANNEL_QUESTIONS.find(question => question.key === 'genre')!.options.map(canonicalChoice));
    const lengths = new Set(CHANNEL_QUESTIONS.find(question => question.key === 'len')!.options.map(canonicalChoice));
    return CHANNEL_TYPES.map((type, index) => {
        const matched = type.tags.filter(tag => chosen.has(tag));
        const score = matched.reduce((total, tag) => total + (genres.has(tag) ? 3 : lengths.has(tag) ? 2 : 1), 0);
        return { ...type, matched: matched.map(localizedChoice), score, index };
    })
        .filter(type => type.matched.length > 0)
        .sort((a, b) => b.score - a.score || (a.tier === 'free' ? -1 : 1) - (b.tier === 'free' ? -1 : 1) || a.index - b.index)
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
    if (appliedType) parts.push(section('チャンネルの型', `${appliedType}（型・字幕スタイル・スキルの下書きが入る）`));
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
                else if (platforms && CHANNEL_QUESTIONS[3].options.map(canonicalChoice).includes(platforms)) { answers.len = [platforms]; delete answers.plat; }
                break;
            }
            case '雰囲気': answers.tone = body ? [body.split('。')[0]] : []; break;
            case '毎回入れること（決まりごと）': answers.every = body.split('\n').filter(line => line.startsWith('- ')).map(line => line.slice(2)); break;
            case 'チャンネルの型': appliedType = body.replace(/（(?:テンプレ|型)・字幕スタイル・スキルの下書きが入る）$/, ''); break;
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
