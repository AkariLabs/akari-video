export const CHANNEL_DOC_KINDS = ['channel', 'design', 'people', 'notes'] as const;
export type ChannelDocKind = typeof CHANNEL_DOC_KINDS[number];

const FILE_NAMES: Record<ChannelDocKind, string> = {
    channel: 'channel.md', design: 'design.md', people: 'people.md', notes: 'notes.md'
};

export function channelDocFileName(kind: ChannelDocKind): string { return FILE_NAMES[kind]; }

export function resolveChannelDocFileName(kind: ChannelDocKind, exists: (name: string) => boolean): string | undefined {
    const name = channelDocFileName(kind);
    if (exists(name)) return name;
    return kind === 'channel' && exists('design.md') ? 'design.md' : undefined;
}

export function channelDocTemplate(kind: ChannelDocKind, channel: string): string {
    const sections: Record<ChannelDocKind, string[]> = {
        channel: ['誰に', '何を', 'どう見せる', '配信面', 'ファイルの地図'],
        design: ['雰囲気', '色', '文字と字幕', 'ロゴ', '避けること'],
        people: ['人物', 'キャラクター', '会社と製品', '使い分け'],
        notes: ['言い換え', 'よく使う情報', '決まりごと', '更新メモ']
    };
    const titles: Record<ChannelDocKind, string> = {
        channel: 'チャンネル設計', design: 'デザイン', people: '人とモノ', notes: '辞書とメモ'
    };
    return `# ${channel} の${titles[kind]}\n\n${sections[kind].map(section =>
        `## ${section}\n\n${kind === 'people' && section !== '使い分け' ? '- 名前：\n- 読み：\n- 別名：\n- 写真：\n- 使う場面：\n' : ''}`
    ).join('\n')}\n`;
}
