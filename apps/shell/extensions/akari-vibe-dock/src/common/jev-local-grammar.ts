/** 画面操作に限る固定文法。各 pattern は発話全体にだけ当てる。 */
export interface JevPlan { actionId: string; value: Record<string, unknown>; label: string; surface: 'left' | 'main' | 'settings' | 'paper' | 'browser'; replace?: boolean }
export interface JevGrammarRule {
    id: string; pattern: RegExp; actionId: string; label: string; surface: JevPlan['surface'];
    examples: readonly string[]; counterExamples: readonly string[];
    value: (match: RegExpMatchArray) => Record<string, unknown>;
    paperOnly?: boolean;
    replace?: boolean;
}
const rule = (id: string, pattern: RegExp, actionId: string, label: string, surface: JevPlan['surface'],
    examples: string[], counterExamples: string[], value: JevGrammarRule['value'], paperOnly = false, replace = false): JevGrammarRule =>
    ({ id, pattern, actionId, label, surface, examples, counterExamples, value, paperOnly, replace });
const empty = (): Record<string, unknown> => ({});
const kind = (value: string): JevGrammarRule['value'] => () => ({ kind: [value] });
const sort = (by: string, order: string): JevGrammarRule['value'] => () => ({ by, order });
const price = (value: string): JevGrammarRule['value'] => () => ({ price: [value] });
const tool = (value: string): JevGrammarRule['value'] => () => ({ tool: value });
const mode = (value: string): JevGrammarRule['value'] => () => ({ mode: value });
const on = (value: boolean): JevGrammarRule['value'] => () => ({ on: value });
const hasControl = (value: string): boolean => Array.from(value).some(char => {
    const code = char.codePointAt(0) ?? 0;
    return code <= 31 || code >= 127 && code <= 159;
});
const searchWord = (value: string): string | undefined => value.length > 0 && value.length <= 40 && value !== 'を'
    && !hasControl(value) && !/[\u200b-\u200f\u202a-\u202e\u2060\u2066-\u2069\ufeff\p{Extended_Pictographic}]/u.test(value) ? value : undefined;

export const JEV_GRAMMAR_RULES: readonly JevGrammarRule[] = [
    rule('material-video', /^(?:プロジェクトの)?(?:動画|映像)(?:だけ|だけ見せて|だけに絞って|で|に絞って)$/, 'A1', '動画だけ', 'left', ['プロジェクトの動画で', '動画だけ見せて'], ['動画で絞らないで'], kind('video')),
    rule('material-audio', /^(?:プロジェクトの)?(?:音|音声|オーディオ)(?:だけ|だけ見せて|だけに絞って|で|に絞って)$/, 'A1', '音だけ', 'left', ['音だけ', '音声だけ見せて'], ['音を消して'], kind('audio')),
    rule('replace-audio', /^(?:動画じゃなくて音|やっぱり音で)$/, 'A1', '音だけ', 'left', ['動画じゃなくて音', 'やっぱり音で'], ['音じゃなくて動画'], kind('audio'), false, true),
    rule('material-image', /^(?:プロジェクトの)?(?:画像|写真)(?:だけ|だけ見せて|だけに絞って|で|に絞って)$/, 'A1', '画像だけ', 'left', ['画像だけ', '写真だけ見せて'], ['画像がほしい'], kind('image')),
    rule('material-3d', /^(?:プロジェクトの)?3D(?:だけ|だけ見せて|だけに絞って|で|に絞って)$/, 'A1', '3D だけ', 'left', ['3Dだけ', '3Dだけ見せて'], ['3Dを作って'], kind('3d')),
    rule('clear', /^(?:絞り込みを解除|フィルターを外して|全部出して)$/, 'A7', '絞り込みを解除', 'left', ['絞り込みを解除', '全部出して'], ['フィルターを外さないで'], empty),
    rule('short', /^短い順(?:に並べて)?$/, 'A2', '短い順', 'left', ['短い順', '短い順に並べて'], ['短い順にしないで'], sort('duration', 'asc')),
    rule('long', /^長い順(?:に並べて)?$/, 'A2', '長い順', 'left', ['長い順', '長い順に並べて'], ['長い順にしないで'], sort('duration', 'desc')),
    rule('new', /^新しい順(?:に並べて)?$/, 'A2', '新しい順', 'left', ['新しい順', '新しい順に並べて'], ['新しい順にしないで'], sort('created', 'desc')),
    rule('old', /^古い順(?:に並べて)?$/, 'A2', '古い順', 'left', ['古い順', '古い順に並べて'], ['古い順にしないで'], sort('created', 'asc')),
    rule('name', /^名前順(?:に並べて)?$/, 'A2', '名前順', 'left', ['名前順', '名前順に並べて'], ['名前順にしないで'], sort('name', 'asc')),
    rule('project-query', /^プロジェクトで(.{1,40})を(?:探して|検索して)$/, 'A3', 'プロジェクトの検索', 'left', ['プロジェクトでpourを探して', 'プロジェクトでロゴを検索して'], ['プロジェクトでを探して'], m => ({ query: m[1] })),
    rule('library-query', /^ライブラリで(.{1,40}?)を?(?:探して|さがして|検索して)$/, 'A4', 'ライブラリの検索', 'left', ['ライブラリで朝食を探して', 'ライブラリで朝食っぽい画像さがして'], ['ライブラリでを探して'], m => {
        const image = m[1].endsWith('画像') || m[1].endsWith('写真');
        // カテゴリの開閉キーは image。still は素材分類の chipKey で、open の引数には使えない。
        return { tab: 'library', query: image ? m[1].slice(0, -2) : m[1], ...(image ? { category: 'image' } : {}) };
    }),
    rule('free', /^無料(?:のやつ|だけ)$/, 'A5', '無料だけ', 'left', ['無料のやつ', '無料だけ'], ['無料にしないで'], price('free')),
    rule('premium', /^(?:Pro|プロ)だけ$/, 'A5', 'Pro だけ', 'left', ['Proだけ', 'プロだけ'], ['Proにしないで'], price('premium')),
    rule('open-library', /^ライブラリを(?:開いて|見せて)$/, 'A8', 'ライブラリを開く', 'left', ['ライブラリを開いて', 'ライブラリを見せて'], ['ライブラリを開かないで'], () => ({ tab: 'library' })),
    rule('open-project', /^プロジェクトの素材を(?:見せて|開いて)$/, 'A8', 'プロジェクトの素材を開く', 'left', ['プロジェクトの素材を見せて', 'プロジェクトの素材を開いて'], ['素材を見せないで'], () => ({ tab: 'project' })),
    rule('settings', /^設定を(?:開いて|見せて)$/, 'C3', '設定を開く', 'settings', ['設定を開いて', '設定を見せて'], ['設定を開かないで'], () => ({ section: 'listening' })),
    rule('settings-appearance', /^外観の設定を(?:開いて|見せて)$/, 'C3', '外観の設定を開く', 'settings', ['外観の設定を開いて', '外観の設定を見せて'], ['外観の設定を開かないで'], () => ({ section: 'appearance' })),
    rule('settings-export', /^書き出しの設定(?:を開いて)?$/, 'C3', '書き出しの設定を開く', 'settings', ['書き出しの設定', '書き出しの設定を開いて'], ['書き出しを実行して'], () => ({ section: 'export' })),
    rule('play', /^(?:再生|再生して)$/, 'B4', '再生', 'main', ['再生', '再生して'], ['再生しないで'], empty),
    rule('pause', /^(?:止めて|一時停止)$/, 'B4.pause', '一時停止', 'main', ['止めて', '一時停止'], ['止めないで'], empty),
    rule('seek-second', /^([0-9一二三四五六七八九十]+)秒(?:に飛んで|へ)$/, 'B3', '再生位置を移動', 'main', ['12秒に飛んで', '十二秒へ'], ['12秒に飛ばないで'], m => ({ seconds: parseNumber(m[1]) })),
    rule('seek-minute', /^([0-9一二三四五六七八九十]+)分([0-9一二三四五六七八九十]+)秒(?:に飛んで|へ)$/, 'B3', '再生位置を移動', 'main', ['1分20秒へ', '一分二十秒に飛んで'], ['1分20秒に飛ばないで'], m => ({ seconds: parseNumber(m[1]) * 60 + parseNumber(m[2]) })),
    rule('paper-open', /^(?:キャンバス開いて|紙を出して|ざっくりキャンバスを開いて)$/, 'roughCanvas.open', 'キャンバスを開く', 'paper', ['キャンバス開いて', '紙を出して'], ['紙を出さないで'], empty),
    rule('paper-close', /^閉じて$/, 'roughCanvas.close', 'キャンバスを閉じる', 'paper', ['閉じて', '閉じてください'], ['閉じないで'], empty, true),
    rule('paper-next', /^もう(?:1|一)枚$/, 'roughCanvas.next', '次の紙', 'paper', ['もう1枚', 'もう一枚'], ['もう一枚作らないで'], empty, true),
    rule('paper-backdrop', /^(?:敷いて|今の画面を敷いて)$/, 'roughCanvas.backdrop', '画面を敷く', 'paper', ['敷いて', '今の画面を敷いて'], ['画面を敷かないで'], empty, true),
    rule('paper-select', /^選ぶ(?:にして)?$/, 'roughCanvas.tool', '選ぶ道具', 'paper', ['選ぶ', '選ぶにして'], ['選ばないで'], tool('select'), true),
    rule('paper-pen', /^ペン(?:にして)?$/, 'roughCanvas.tool', 'ペン', 'paper', ['ペン', 'ペンにして'], ['ペンを使わないで'], tool('pen'), true),
    rule('paper-arrow', /^矢印(?:にして)?$/, 'roughCanvas.tool', '矢印', 'paper', ['矢印', '矢印にして'], ['矢印を消して'], tool('arrow'), true),
    rule('paper-text', /^文字(?:にして)?$/, 'roughCanvas.tool', '文字', 'paper', ['文字', '文字にして'], ['文字を消さないで'], tool('text'), true),
    rule('paper-delete', /^選んだものを消して$/, 'roughCanvas.deleteSelected', '選んだものを消す', 'paper', ['選んだものを消して', '選んだものを消してください'], ['選んだものを消さないで'], empty, true),
    rule('paper-task', /^タスクにして$/, 'roughCanvas.submit', 'タスクにする', 'paper', ['タスクにして', 'タスクにしてください'], ['タスクにしないで'], mode('task'), true),
    rule('paper-send', /^(?:送って|AIに送って)$/, 'roughCanvas.submit', '送る', 'paper', ['送って', 'AIに送って'], ['送らないで'], mode('send'), true),
    rule('browser-search', /^(?:ブラウザで|ネットで|ウェブで|ウェブ上で)(?:(Google|Pinterest|Yahoo|Bing)で)?(.{1,40})を(?:調べて|探して|検索して)$/, 'browser.search', 'ウェブで検索', 'browser', ['ブラウザで朝食の画像を調べて', 'ネットでロゴを探して'], ['朝食の画像がほしい'], m => ({ engine: ({ Google: 'google-images', Pinterest: 'pinterest', Yahoo: 'yahoo-jp-images', Bing: 'bing-images' } as Record<string, string>)[m[1]] ?? 'google-images', query: m[2] })),
    rule('browser-close', /^ブラウザを閉じて$/, 'browser.close', 'ブラウザを閉じる', 'browser', ['ブラウザを閉じて', 'ブラウザを閉じてください'], ['ブラウザを閉じないで'], empty),
    rule('browser-pick-on', /^選ぶモードにして$/, 'browser.pickMode', '選ぶモード', 'browser', ['選ぶモードにして', '選ぶモードにしてください'], ['選ぶモードにしないで'], on(true)),
    rule('browser-pick-off', /^選ぶモード(?:を)?やめて$/, 'browser.pickMode', '選ぶモードをやめる', 'browser', ['選ぶモードやめて', '選ぶモードをやめて'], ['選ぶモードをやめないで'], on(false))
];

export function parseNumber(value: string): number {
    if (/^\d+$/.test(value)) return Number(value);
    const digit: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
    if (value === '十') return 10;
    const [tens, ones] = value.split('十');
    if (ones !== undefined) return (tens ? digit[tens] ?? NaN : 1) * 10 + (ones ? digit[ones] ?? NaN : 0);
    return digit[value] ?? NaN;
}
export function normalizeJev(text: string): string {
    let value = text.normalize('NFKC').replace(/[\s\u3000]+/gu, '').replace(/[。.!！?？、，]+$/gu, '');
    value = value.replace(/^(?:(?:えっと|あの|じゃあ|その|えーと)[、，…]*)+/u, '');
    return value.replace(/(?:ください|お願いします|ね|よ)$/u, '');
}
export type JevMatch = { kind: 'plan'; plan: JevPlan } | { kind: 'negated' } |
    { kind: 'undo' | 'redo' | 'wrong' | 'yes' | 'no' } | { kind: 'task-seed'; reason: 'export' | 'generation' | 'external' | 'import' };
export function matchJev(text: string, context: { paperOpen: boolean; confirming: boolean }): JevMatch | null {
    if (text.normalize('NFKC').length > 40) return null;
    const value = normalizeJev(text);
    if (!value || hasControl(value)) return null;
    if (context.confirming) {
        if (/^(?:はい|お願い|やって)$/.test(value)) return { kind: 'yes' };
        if (/^(?:いいえ|やめて|だめ)$/.test(value)) return { kind: 'no' };
    }
    if (context.paperOpen && value.length > 12) return null;
    if (!context.paperOpen) {
        if (/^(?:戻して|元に戻して|今のなし|やっぱりやめて|キャンセル|取り消して)$/.test(value)) return { kind: 'undo' };
        if (/^(?:違う|ちがう|そうじゃない)$/.test(value)) return { kind: 'wrong' };
        if (/^(?:やっぱり戻さないで|さっきの)$/.test(value)) return { kind: 'redo' };
    }
    if (/(?:ないで|なくていい|しないで|やめて)$/.test(value)
        && !/^(?:やめて|やっぱりやめて|選ぶモード(?:を)?やめて)$/.test(value)) return { kind: 'negated' };
    if (!context.paperOpen) {
        if (/(?:書き出して|エクスポートして)$/.test(value)) return { kind: 'task-seed', reason: 'export' };
        if (/(?:画像|動画|音声)(?:を)?(?:生成して|作って)$/.test(value)) return { kind: 'task-seed', reason: 'generation' };
        if (/(?:投稿して|公開して|共有して|アップロードして)$/.test(value)) return { kind: 'task-seed', reason: 'external' };
        if (/(?:素材として取り込んで|プロジェクトに入れて)$/.test(value)) return { kind: 'task-seed', reason: 'import' };
    }
    for (const item of JEV_GRAMMAR_RULES) {
        if (context.paperOpen !== Boolean(item.paperOnly)) continue;
        const matched = value.match(item.pattern);
        if (!matched) continue;
        const result = item.value(matched);
        if (Object.values(result).some(part => typeof part === 'string' && !searchWord(part) && ('query' in result))) return null;
        if (Object.values(result).some(part => typeof part === 'number' && (!Number.isFinite(part) || part < 0 || part > 5999))) return null;
        return { kind: 'plan', plan: { actionId: item.actionId, value: result, label: item.label,
            surface: item.surface, ...(item.replace ? { replace: true } : {}) } };
    }
    return null;
}
