export interface TypeField { id: string; name: string; sampleCount: number; baseIds: readonly string[] }
export interface TypeBase {
    id: string; name: string; platforms: readonly string[]; orientation: 'port' | 'land' | 'both' | 'none';
    length: 'short' | 'mid' | 'long' | 'none'; tone: string; templates: readonly string[];
}
export interface TypeVariant { id: string; suffix: string; note: string; author: string }

export const TYPE_FIELDS: readonly TypeField[] = [
    { id: 'life', name: '暮らし・料理', sampleCount: 1240, baseIds: ['cook', 'restaurant', 'family', 'pet', 'daily', 'diy'] },
    { id: 'travel', name: '旅・アウトドア', sampleCount: 860, baseIds: ['travel', 'outdoor', 'local', 'car'] },
    { id: 'ent', name: 'エンタメ', sampleCount: 1530, baseIds: ['game', 'music', 'comedy', 'talkch'] },
    { id: 'learn', name: '学び・解説', sampleCount: 1120, baseIds: ['edu', 'lang', 'news', 'money', 'tech', 'school'] },
    { id: 'biz', name: '仕事・ビジネス', sampleCount: 980, baseIds: ['biz', 'ec', 'estate', 'personal'] },
    { id: 'style', name: '美容・スポーツ', sampleCount: 740, baseIds: ['beauty', 'fashion', 'fitness'] },
    { id: 'event', name: '行事・思い出', sampleCount: 310, baseIds: ['event'] },
    { id: 'other', name: '決めない', sampleCount: 1, baseIds: ['free'] }
];

export const TYPE_BASES: readonly TypeBase[] = [
    { id: 'cook', name: '料理・レシピ', platforms: ['TikTok', 'Instagram リール', 'YouTube ショート'], orientation: 'port', length: 'short', tone: '家にあるもので作れる一品を、手元のアップで。最初の 1 秒は完成の絵。', templates: ['料理の手順', 'レシピ動画（俯瞰）'] },
    { id: 'restaurant', name: '飲食店の発信', platforms: ['Instagram リール', 'TikTok'], orientation: 'port', length: 'short', tone: 'お店の看板メニューと、作る人の顔を見せる。', templates: ['料理の手順', '商品紹介 30 秒'] },
    { id: 'travel', name: '旅・Vlog', platforms: ['YouTube', 'Instagram リール'], orientation: 'both', length: 'mid', tone: '落ち着いた雰囲気。場所と時間だけを短く出す。', templates: ['Vlog', 'シネマ風'] },
    { id: 'outdoor', name: 'アウトドア・キャンプ', platforms: ['YouTube'], orientation: 'land', length: 'mid', tone: '道具と景色。手順は字幕で、会話は少なめ。', templates: ['Vlog', 'シネマ風'] },
    { id: 'family', name: '家族・子育て', platforms: ['YouTube', 'Instagram リール'], orientation: 'both', length: 'mid', tone: '家族で見返す記録。日付と名前のテロップ。', templates: ['家族の思い出', '運動会ダイジェスト'] },
    { id: 'event', name: '行事・思い出', platforms: ['YouTube'], orientation: 'land', length: 'mid', tone: '名場面を短く。音楽で気持ちを運ぶ。', templates: ['運動会ダイジェスト', '家族の思い出'] },
    { id: 'pet', name: 'ペット', platforms: ['TikTok', 'Instagram リール'], orientation: 'port', length: 'short', tone: 'かわいい瞬間を 15 秒で。字幕はひとことだけ。', templates: ['ペットのショート'] },
    { id: 'game', name: 'ゲーム実況', platforms: ['YouTube', 'YouTube ショート'], orientation: 'both', length: 'long', tone: '盛り上がった所を中心に。字幕は聞き取りにくい所だけ。', templates: ['ゲーム実況の切り抜き', '面白い系ショート'] },
    { id: 'music', name: '音楽・弾いてみた', platforms: ['YouTube', 'TikTok'], orientation: 'both', length: 'short', tone: '音を主役に。字幕は曲名と一言だけ。', templates: ['ミュージックビデオ'] },
    { id: 'beauty', name: '美容・メイク', platforms: ['Instagram リール', 'TikTok', 'YouTube'], orientation: 'both', length: 'short', tone: '使った物と手順を番号で。肌の色は触らない。', templates: ['テンポ重視のショート', '商品紹介 30 秒'] },
    { id: 'fashion', name: 'ファッション', platforms: ['Instagram リール', 'TikTok'], orientation: 'port', length: 'short', tone: '着回しを 3 パターン。値段とサイズを出す。', templates: ['テンポ重視のショート'] },
    { id: 'fitness', name: 'フィットネス・スポーツ', platforms: ['YouTube', 'Instagram リール'], orientation: 'both', length: 'short', tone: '回数と秒数を大きく。注意点は 1 つに絞る。', templates: ['テンポ重視のショート', '解説・講義'] },
    { id: 'edu', name: '解説・教育', platforms: ['YouTube'], orientation: 'land', length: 'mid', tone: '1 本 1 テーマ。結論から話し、図で補う。', templates: ['解説・講義', '解説ショート（図解 3 面）'] },
    { id: 'lang', name: '語学・勉強', platforms: ['YouTube', 'TikTok'], orientation: 'both', length: 'short', tone: 'フレーズを大きく出し、繰り返して覚えてもらう。', templates: ['授業の要点', '解説ショート（図解 3 面）'] },
    { id: 'tech', name: 'テック・ガジェット', platforms: ['YouTube', 'X'], orientation: 'land', length: 'mid', tone: '結論から。使ってみた数字で比べる。', templates: ['商品レビュー 3 分', '解説・講義'] },
    { id: 'money', name: 'お金・投資', platforms: ['YouTube', 'X'], orientation: 'land', length: 'mid', tone: '数字と図で説明し、断定は避ける。', templates: ['解説ショート（図解 3 面）', '解説・講義'] },
    { id: 'biz', name: '会社の発信・採用', platforms: ['YouTube', 'X', 'Instagram リール'], orientation: 'land', length: 'mid', tone: '数字と事実で話す。最後はロゴで締める。', templates: ['会社紹介 90 秒', 'インタビュー'] },
    { id: 'ec', name: '商品紹介・EC', platforms: ['Instagram リール', 'TikTok'], orientation: 'port', length: 'short', tone: '使う場面 → 特長 3 つ → 価格。', templates: ['商品紹介 30 秒', '商品レビュー 3 分'] },
    { id: 'estate', name: '不動産', platforms: ['YouTube', 'Instagram リール'], orientation: 'both', length: 'mid', tone: '間取り図と部屋ごとの見出し。広さは数字で。', templates: ['物件の内見'] },
    { id: 'local', name: '地域・観光', platforms: ['Instagram リール', 'YouTube'], orientation: 'both', length: 'short', tone: '行き方と営業時間を必ず出す。', templates: ['Vlog', 'テンポ重視のショート'] },
    { id: 'news', name: 'ニュース・時事解説', platforms: ['YouTube', 'X'], orientation: 'both', length: 'short', tone: '出典を必ず出す。意見と事実を分ける。', templates: ['解説ショート（図解 3 面）', '横のトーク'] },
    { id: 'comedy', name: 'お笑い・ネタ', platforms: ['TikTok', 'YouTube ショート'], orientation: 'port', length: 'short', tone: 'オチの前に間をつくる。', templates: ['面白い系ショート'] },
    { id: 'talkch', name: '雑談・ラジオ', platforms: ['YouTube'], orientation: 'land', length: 'long', tone: 'テーマを冒頭で言う。脱線は残す。', templates: ['横のトーク', 'インタビュー'] },
    { id: 'diy', name: 'ものづくり・DIY', platforms: ['YouTube', 'Instagram リール'], orientation: 'both', length: 'mid', tone: '材料と寸法をテロップで。完成を最初に。', templates: ['レシピ動画（俯瞰）', '解説・講義'] },
    { id: 'car', name: '車・バイク', platforms: ['YouTube'], orientation: 'land', length: 'mid', tone: '走りの音を残す。数字は表で。', templates: ['商品レビュー 3 分', 'Vlog'] },
    { id: 'school', name: '学校・部活', platforms: ['Instagram リール', 'YouTube'], orientation: 'both', length: 'short', tone: '名前と学年を出す。音楽は明るく。', templates: ['運動会ダイジェスト', 'テンポ重視のショート'] },
    { id: 'personal', name: '自己紹介・個人の発信', platforms: ['Instagram リール', 'X', 'TikTok'], orientation: 'port', length: 'short', tone: '誰で、何をしていて、何を届けるかを 15 秒で。', templates: ['テンポ重視のショート', '横のトーク'] },
    { id: 'daily', name: '日常・なんでも', platforms: ['YouTube', 'Instagram リール', 'TikTok'], orientation: 'both', length: 'short', tone: 'その日あったことを、気取らずに。', templates: ['Vlog', '横のトーク'] },
    { id: 'free', name: '決めない', platforms: [], orientation: 'none', length: 'none', tone: '中身を自分で決める', templates: [] }
];

export const TYPE_VARIANTS: readonly TypeVariant[] = [
    { id: 'basic', suffix: '', note: '基本', author: 'Akari' },
    { id: 'shorts', suffix: 'ショート特化', note: '縦 60 秒を週 3 本', author: '@hiro_edits' },
    { id: 'deep', suffix: 'じっくり解説', note: '横 10〜20 分、図解多め', author: 'Akari' },
    { id: 'faceless', suffix: '顔出しなし', note: '手元と画面収録だけ', author: '@kao_nashi_lab' },
    { id: 'narration', suffix: 'ナレーション', note: '声は合成、台本から', author: '@voice_works' },
    { id: 'beginner', suffix: '初心者向け', note: 'ゆっくり、用語に字幕で注釈', author: 'Akari' },
    { id: 'vlog', suffix: 'Vlog 寄り', note: '日常の流れで見せる', author: '@daily_cut' },
    { id: 'global', suffix: '海外向け', note: '英語字幕つき', author: '@global_jp' }
];

export const FREE_BASE_IDS = ['daily', 'talkch', 'free'] as const;

export const TYPE_WORDS: Readonly<Record<string, readonly (readonly [string, string])[]>> = {
    cook: [['おおさじ', '大さじ'], ['こさじ', '小さじ'], ['みじんぎり', 'みじん切り']],
    restaurant: [['おもちかえり', 'お持ち帰り'], ['ひがわり', '日替わり']],
    travel: [['びゅーぽいんと', 'ビューポイント'], ['いんばうんど', 'インバウンド']],
    outdoor: [['たきび', '焚き火'], ['しぇらかっぷ', 'シェラカップ']],
    family: [['はつもうで', '初詣'], ['たんじょうび', '誕生日']],
    event: [['そつぎょうしき', '卒業式'], ['うんどうかい', '運動会']],
    pet: [['おやつたいむ', 'おやつタイム'], ['さんぽ', '散歩']],
    game: [['えふぴーえす', 'FPS'], ['らすぼす', 'ラスボス']],
    music: [['さび', 'サビ'], ['びーぴーえむ', 'BPM']],
    beauty: [['ふぁんで', 'ファンデーション'], ['ちーく', 'チーク']],
    fashion: [['こーで', 'コーデ'], ['あうたー', 'アウター']],
    fitness: [['すくわっと', 'スクワット'], ['ぷらんく', 'プランク']],
    edu: [['ずかい', '図解'], ['ようてん', '要点']],
    lang: [['りすにんぐ', 'リスニング'], ['しゃどういんぐ', 'シャドーイング']],
    tech: [['じーぴーゆー', 'GPU'], ['えーぴーあい', 'API'], ['ゆーえすびー', 'USB']],
    money: [['えぬあいえすえー', 'NISA'], ['いんでっくす', 'インデックス']],
    biz: [['さいよう', '採用'], ['じぎょう', '事業']],
    ec: [['いーしー', 'EC'], ['しょうひん', '商品']],
    estate: [['まどり', '間取り'], ['へいべい', '平米']],
    local: [['めいしょ', '名所'], ['とくさん', '特産']],
    news: [['しゅってん', '出典'], ['そくほう', '速報']],
    comedy: [['おち', 'オチ'], ['ぼけ', 'ボケ']],
    talkch: [['おたより', 'お便り'], ['ざつだん', '雑談']],
    diy: [['でぃーあいわい', 'DIY'], ['すんぽう', '寸法']],
    car: [['ねんぴ', '燃費'], ['しじょう', '試乗']],
    school: [['ぶかつ', '部活'], ['がくねん', '学年']],
    personal: [['じこしょうかい', '自己紹介'], ['ぷろふぃーる', 'プロフィール']],
    daily: [['るーてぃん', 'ルーティン'], ['にちじょう', '日常']],
    free: []
};
