import { ChannelAnswers } from './channel-design-model';
import { PRESET_CHANNEL_SKILLS } from './channel-skills-model';
import { FREE_BASE_IDS, TYPE_BASES, TYPE_FIELDS, TYPE_VARIANTS, TYPE_WORDS } from './channel-types-data';

export interface ChannelTypeEntry {
    id: string; baseId: string; variantId: string; fieldId: string; name: string; note: string; author: string;
    baseName: string; derivedFrom?: string; tier: 'free' | 'pro'; uses: number; createdOrder: number;
}

const entries: readonly ChannelTypeEntry[] = TYPE_BASES.flatMap(base => {
    const fieldId = TYPE_FIELDS.find(field => field.baseIds.includes(base.id))?.id ?? 'other';
    return TYPE_VARIANTS.filter(variant => base.id !== 'free' || variant.id === 'basic').map((variant, variantIndex) => ({
        id: `${base.id}-${variant.id}`, baseId: base.id, variantId: variant.id, fieldId,
        name: variant.id === 'basic' ? base.name : `${base.name}・${variant.suffix}`,
        note: variant.id === 'basic' ? base.tone : variant.note, author: variant.author, baseName: base.name,
        ...(variant.id === 'basic' ? {} : { derivedFrom: `${base.name}（Akari）` }),
        tier: FREE_BASE_IDS.some(id => id === base.id) && variant.id === 'basic' ? 'free' as const : 'pro' as const,
        uses: ((base.id.length * 997 + variantIndex * 131) % 9000) + 120,
        createdOrder: TYPE_BASES.indexOf(base) * TYPE_VARIANTS.length + variantIndex
    }));
});

export function allChannelTypes(): readonly ChannelTypeEntry[] { return entries; }
export function findChannelType(id: string): ChannelTypeEntry | undefined { return entries.find(type => type.id === id); }
export function findChannelTypeByName(name: string): ChannelTypeEntry | undefined { return entries.find(type => type.name === name); }

export function filterChannelTypes(options: {
    fieldId: string; query: string; author: 'all' | 'akari' | 'community' | 'free'; sort: 'uses' | 'new';
}): readonly ChannelTypeEntry[] {
    const query = options.query.trim().toLowerCase();
    return entries.filter(type => (query ? `${type.name} ${type.note} ${type.author}`.toLowerCase().includes(query) : type.fieldId === options.fieldId)
        && (options.author === 'all' || options.author === 'akari' && type.author === 'Akari'
            || options.author === 'community' && type.author !== 'Akari' || options.author === 'free' && type.tier === 'free'))
        .sort((left, right) => options.sort === 'uses' ? right.uses - left.uses || left.createdOrder - right.createdOrder
            : right.createdOrder - left.createdOrder);
}

export function nearChannelTypes(type: ChannelTypeEntry, limit = 4): readonly ChannelTypeEntry[] {
    return entries.filter(candidate => candidate.id !== type.id
        && (candidate.baseId === type.baseId || type.variantId !== 'basic' && candidate.variantId === type.variantId)).slice(0, limit);
}

export interface TypeContents {
    channelMd: string; answers: ChannelAnswers; genreLine: string; designSentence: string;
    words: readonly (readonly [string, string])[]; rules: readonly { area: string; text: string }[];
    skillSlugs: readonly string[]; templates: readonly string[];
}

export function typeContents(type: ChannelTypeEntry): TypeContents {
    const base = TYPE_BASES.find(item => item.id === type.baseId);
    const variant = TYPE_VARIANTS.find(item => item.id === type.variantId);
    if (!base || !variant) throw new Error('型が見つかりません');
    const isFree = base.id === 'free';
    const isShort = base.length === 'short' || variant.id === 'shorts';
    const isLong = base.length === 'long' || variant.id === 'deep';
    const genreLine = `ジャンル: ${base.name}${variant.id === 'basic' ? '' : `（${variant.suffix}）`}`;
    const answers: ChannelAnswers = {
        genre: isFree ? [] : [base.name],
        who: variant.id === 'beginner' ? ['はじめての人'] : variant.id === 'global' ? ['日本の文化に興味がある海外の人'] : [],
        plat: isFree ? [] : isShort ? ['YouTube ショート', 'TikTok'] : [...base.platforms],
        len: isFree ? [] : isShort ? ['縦ショート 60 秒まで'] : isLong ? ['横 20 分以上'] : base.length === 'mid' ? ['横 5〜10 分'] : [],
        tone: isFree ? [] : variant.id === 'basic' ? [base.tone.split('。')[0]] : [variant.note],
        every: variant.id === 'faceless' ? ['顔は出さない'] : []
    };
    const channelMd = [
        '# （チャンネル名）', '', genreLine, '', '## 誰に', answers.who?.join('、') || '（ここに書きます）', '',
        '## 見せ方', variant.id === 'basic' ? base.tone : `${variant.note}\n${base.tone}`, '',
        '## 配信面', answers.plat?.length ? answers.plat.map(platform => `- ${platform}`).join('\n') : '（あとで決める）'
    ].join('\n');
    const designSentence = `${isShort ? '縦 9:16。字幕は大きめで下から 25% の位置' : '横 16:9。字幕は下に 1〜2 行'}。${variant.id === 'faceless' ? '手元のアップが主役。顔は映さない' : '人物を中央に'}。`;
    const wanted = ['write-description', ...(isShort ? ['cut-shorts'] : []), ...(isLong ? ['add-chapters'] : []), ...(variant.id === 'beginner' ? ['final-check'] : [])];
    return {
        channelMd, answers, genreLine, designSentence, words: TYPE_WORDS[base.id] ?? [],
        rules: [isShort ? { area: '字幕', text: '下から 20% と右端 15% には字幕を置かない' } : { area: '字幕', text: '1 行 14 字まで' },
            { area: '音', text: '声は −14 LUFS にそろえる' }],
        skillSlugs: wanted.filter(slug => PRESET_CHANNEL_SKILLS.some(skill => skill.slug === slug)), templates: base.templates
    };
}

export function channelTypeSummary(type: ChannelTypeEntry): string { return type.note; }
export function tierLabel(type: ChannelTypeEntry): '無料' | '☆Pro' { return type.tier === 'free' ? '無料' : '☆Pro'; }

export function buildMyTypeJson(input: { channelName: string; channelMd?: string; designMd?: string; skillSlugs: string[]; now: string }): string {
    return JSON.stringify({ version: 0, name: input.channelName, saved_at: input.now, channel_md: input.channelMd ?? '',
        design_md: input.designMd ?? '', skills: input.skillSlugs }, null, 2);
}
