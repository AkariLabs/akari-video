export type MemoryPackPerson = {
    kind: 'person' | 'org' | 'product'; name: string; reading?: string; aliases?: string[]; role?: string;
};

export type MemoryPack = {
    id: string; name: string; genre: string; group: string; description: string;
    counts: { people: number; orgs: number; products: number; words: number };
    status: 'ready' | 'planned'; entries?: MemoryPackPerson[];
    words?: Array<{ surface: string; variants: string[] }>;
};

export const MEMORY_PACK_GENRES: Array<{ genre: string; groups: string[] }> = [
    { genre: 'テック', groups: ['AI 業界', 'テック大手', 'ガジェット', '開発ツール'] },
    { genre: 'エンタメ', groups: ['VTuber', 'アニメと声優', '音楽'] },
    { genre: 'スポーツ', groups: ['プロ野球', '海外サッカー'] },
    { genre: 'ビジネス・経済', groups: ['スタートアップ'] },
    { genre: '暮らし・料理', groups: ['食材と調味料', '調理道具と家電'] },
    { genre: '旅・地域', groups: ['駅と路線', '観光地'] },
    { genre: '学び', groups: ['歴史の人物', '科学者'] },
    { genre: '美容・ファッション', groups: ['コスメ'] }
];

export const MEMORY_PACKS: MemoryPack[] = [
    {
        id: 'ai-industry', name: 'AI 業界', genre: 'テック', group: 'AI 業界',
        description: 'AI 企業の経営者・研究者と、会社・製品の名前。文字起こしの直しとテロップの名前に使います。',
        counts: { people: 6, orgs: 4, products: 6, words: 6 }, status: 'ready',
        entries: [
            { kind: 'person', name: 'ダリオ・アモディ', role: 'Anthropic CEO' },
            { kind: 'person', name: 'サム・アルトマン', role: 'OpenAI CEO' },
            { kind: 'person', name: 'デミス・ハサビス', role: 'Google DeepMind CEO' },
            { kind: 'person', name: 'ジェンスン・フアン', role: 'NVIDIA CEO' },
            { kind: 'person', name: 'ムスタファ・スレイマン', role: 'Microsoft AI CEO' },
            { kind: 'person', name: 'アンドレイ・カルパシー', role: 'AI 研究者' },
            { kind: 'org', name: 'Anthropic' }, { kind: 'org', name: 'OpenAI' },
            { kind: 'org', name: 'Google DeepMind' }, { kind: 'org', name: 'NVIDIA' },
            { kind: 'product', name: 'Claude Code' }, { kind: 'product', name: 'Codex' },
            { kind: 'product', name: 'Gemini' }, { kind: 'product', name: 'ChatGPT' },
            { kind: 'product', name: 'Claude' }, { kind: 'product', name: 'GPT' }
        ],
        words: [
            { surface: 'Claude Code', variants: ['くろーどこーど'] },
            { surface: 'Gemini', variants: ['じぇみに'] },
            { surface: 'OpenAI', variants: ['おーぷんえーあい'] },
            { surface: 'Codex', variants: ['こーでっくす'] },
            { surface: 'Claude', variants: ['くろーど'] },
            { surface: 'NVIDIA', variants: ['えぬびでぃあ'] }
        ]
    },
    { id: 'ai-people', name: 'AI の人物', genre: 'テック', group: 'AI 業界', description: 'AI 分野の研究者や開発者をまとめます。', counts: { people: 30, orgs: 0, products: 0, words: 8 }, status: 'planned' },
    { id: 'ai-generative-media', name: 'AI 動画・画像の生成', genre: 'テック', group: 'AI 業界', description: '動画・画像生成の会社と製品をまとめます。', counts: { people: 8, orgs: 14, products: 24, words: 12 }, status: 'planned' },
    { id: 'gafam', name: 'GAFAM と経営者', genre: 'テック', group: 'テック大手', description: '大手テック企業と経営者をまとめます。', counts: { people: 15, orgs: 5, products: 10, words: 6 }, status: 'planned' },
    { id: 'phones', name: 'スマホ', genre: 'テック', group: 'ガジェット', description: 'スマホのメーカーと製品をまとめます。', counts: { people: 0, orgs: 12, products: 30, words: 8 }, status: 'planned' },
    { id: 'dev-tools', name: '開発ツール', genre: 'テック', group: '開発ツール', description: '開発で使うサービスと道具をまとめます。', counts: { people: 0, orgs: 10, products: 35, words: 10 }, status: 'planned' },
    { id: 'ingredients', name: '食材と調味料', genre: '暮らし・料理', group: '食材と調味料', description: '料理で使う食材と調味料の名前をまとめます。', counts: { people: 0, orgs: 0, products: 50, words: 12 }, status: 'planned' },
    { id: 'tokyo-stations', name: '東京の駅と路線', genre: '旅・地域', group: '駅と路線', description: '東京の主な駅と路線をまとめます。', counts: { people: 0, orgs: 20, products: 60, words: 15 }, status: 'planned' },
    { id: 'sengoku', name: '戦国武将', genre: '学び', group: '歴史の人物', description: '戦国時代の人物をまとめます。', counts: { people: 40, orgs: 0, products: 0, words: 12 }, status: 'planned' },
    { id: 'cosmetics', name: 'コスメブランド', genre: '美容・ファッション', group: 'コスメ', description: 'コスメのブランドと製品をまとめます。', counts: { people: 0, orgs: 25, products: 30, words: 8 }, status: 'planned' },
    { id: 'baseball', name: 'プロ野球 12 球団', genre: 'スポーツ', group: 'プロ野球', description: 'プロ野球の球団と関連する名前をまとめます。', counts: { people: 0, orgs: 12, products: 0, words: 6 }, status: 'planned' }
];

export function packTotal(pack: MemoryPack): number {
    return pack.counts.people + pack.counts.orgs + pack.counts.products;
}
