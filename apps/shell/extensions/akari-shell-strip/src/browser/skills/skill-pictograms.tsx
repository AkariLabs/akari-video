import * as React from '@theia/core/shared/react';
import { SkillCategory } from './skills-panel-model';

const accent = 'var(--akari-accent, #f97316)';
const shade = 'var(--theia-descriptionForeground)';

// 1 パーツ = 役割 + path + 任意の transform。
//   line   : 線（currentColor）
//   body   : 主役の面（薄い面 + 線）
//   accent : 橙の線（強調は 1 枚につき 1 か所）
//   dot    : 橙の塗り（点）
type Role = 'line' | 'body' | 'accent' | 'dot';
type Part = readonly [Role, string, string?];

const n = (value: number): string => String(Math.round(value * 100) / 100);

// 角丸の四角
const rr = (x: number, y: number, w: number, h: number, r = 2): string =>
    `M${n(x + r)} ${n(y)}h${n(w - 2 * r)}a${r} ${r} 0 0 1 ${r} ${r}v${n(h - 2 * r)}a${r} ${r} 0 0 1-${r} ${r}` +
    `h-${n(w - 2 * r)}a${r} ${r} 0 0 1-${r}-${r}v-${n(h - 2 * r)}a${r} ${r} 0 0 1 ${r}-${r}z`;

// 円
const circ = (cx: number, cy: number, r: number): string =>
    `M${n(cx - r)} ${n(cy)}a${r} ${r} 0 1 0 ${n(2 * r)} 0a${r} ${r} 0 1 0-${n(2 * r)} 0z`;

// 折り返しのある書類（輪郭 + 折り目）
const doc = (x: number, y: number, w: number, h: number, f: number): readonly [string, string] => [
    `M${x} ${y}h${w - f}l${f} ${f}v${h - f}H${x}z`,
    `M${x + w - f} ${y}v${f}h${f}`
];

// 歯車（歯 teeth 枚・中心 cx,cy・歯先 ro・歯元 ri）。歯は台形、歯と歯の間は歯元の円弧
const gear = (cx: number, cy: number, ro: number, ri: number, teeth: number): string => {
    const step = (2 * Math.PI) / teeth;
    const at = (angle: number, radius: number): string =>
        `${n(cx + radius * Math.cos(angle))} ${n(cy + radius * Math.sin(angle))}`;
    let d = '';
    for (let i = 0; i < teeth; i++) {
        const a = i * step - Math.PI / 2;
        d += `${i === 0 ? 'M' : 'A' + ri + ' ' + ri + ' 0 0 1 '}${at(a - step * 0.29, ri)}`;
        d += `L${at(a - step * 0.15, ro)}L${at(a + step * 0.15, ro)}L${at(a + step * 0.29, ri)}`;
    }
    return `${d}A${ri} ${ri} 0 0 1 ${at(-Math.PI / 2 - step * 0.29, ri)}z`;
};

// 波形の縦棒（中心線 y・半分の高さの並び）
const bars = (xs: readonly number[], cy: number, halves: readonly number[]): string =>
    xs.map((x, i) => `M${x} ${n(cy - halves[i])}v${n(halves[i] * 2)}`).join('');

const L = (d: string, t?: string): Part => ['line', d, t];
const B = (d: string, t?: string): Part => ['body', d, t];
const A = (d: string, t?: string): Part => ['accent', d, t];
const D = (d: string, t?: string): Part => ['dot', d, t];

const addressDoc = doc(9, 7, 24, 30, 8);
const planDoc = doc(8, 6, 22, 32, 7);
const compileDoc = doc(35, 7, 20, 30, 6);
const catPlanDoc = doc(17, 6, 30, 32, 8);
const catReviewDoc = doc(17, 6, 30, 32, 8);

const SKILL_PARTS: Record<string, readonly Part[]> = {
    // レビューの指摘に応える: 書類 + 鉛筆
    'address-review': [
        B(addressDoc[0]), L(addressDoc[1]), L('M14 21h13M14 26h13M14 31h7'),
        L('M-2.5-11h5v15l-2.5 5-2.5-5z', 'translate(46 23) rotate(45)'),
        A('M-2.5-7h5', 'translate(46 23) rotate(45)')
    ],
    // 入口: モニターと再生
    akari: [
        B(rr(10, 7, 44, 26, 4)), L('M24 38h16M32 33v5'), A('M28 14l11 6-11 6z')
    ],
    // 素材（フィルム）を虫眼鏡で観察
    'analyze-footage': [
        B(rr(6, 8, 28, 28, 3)), L(rr(11, 17, 18, 10, 1.5)),
        L('M11 12.5h.1M17 12.5h.1M23 12.5h.1M29 12.5h.1M11 31.5h.1M17 31.5h.1M23 31.5h.1M29 31.5h.1'),
        B(circ(46, 18, 7.5)), A('M51.5 23.5L57 29')
    ],
    // プロジェクト全体の読み: グラフ + 虫眼鏡
    'analyze-project': [
        B(circ(18, 16, 7.5)), L('M12.7 21.3L7 27'),
        L(rr(31, 24, 6, 13, 1)), A(rr(40, 8, 6, 29, 1)), L(rr(49, 17, 6, 20, 1))
    ],
    // 3D を焼く: 立方体 + 炎
    'bake-3d': [
        B('M22 7.5l12.5 7.25v14.5L22 36.5 9.5 29.25v-14.5z'),
        L('M9.5 14.75L22 22l12.5-7.25M22 22v14.5'),
        L('M48 36c-5.5 0-8.5-3.5-8.5-8 0-4 3-6 4.5-10 .8 2 2 3 3 3.5-.5-5 .5-9.5 3-14 4 3 6.5 8 6.5 15 0 8-3.5 13.5-8.5 13.5z'),
        A('M48 33.5c-2 0-3.2-1.4-3.2-3 0-1.8 1.4-2.6 2.2-4.6 2.6 1.4 4.2 3.2 4.2 5.2 0 1.4-1.2 2.4-3.2 2.4z')
    ],
    // 音のビートに編集を合わせる: 音符 + 拍
    'beat-sync-edit': [
        B(rr(6, 6, 28, 32, 4)),
        B(circ(13.5, 29, 2.8)), B(circ(25, 26, 2.8)), L('M16.3 29V17.5M27.8 26V14.5'),
        B('M16.3 13l11.5-3v4.5l-11.5 3z'),
        L('M41 15v14M53 15v14'), A('M47 10v24')
    ],
    // 録音 → 文字 → 命令: 波形 → 書類
    'compile-review-session': [
        L('M9 18v8M15 14v16M21 17v10'), A('M26 22h5m-2.5-2.5L31 22l-2.5 2.5'),
        B(compileDoc[0]), L(compileDoc[1]), L('M40 21h10M40 26h10M40 31h6')
    ],
    // 新規プロジェクト: フォルダ + プラス
    'create-project': [
        B('M8 8h14l4 5h30v24H8z'), A('M32 19.5v11M26.5 25h11')
    ],
    // カットの批評: はさみ
    'critique-cut': [
        B(circ(16, 12, 4.5)), B(circ(16, 32, 4.5)),
        B('M18.8 15.3L52 29 20.4 12.1z'), B('M20.4 31.9L52 15 18.8 28.7z'), D(circ(37.2, 22, 1.8))
    ],
    // 音に宣言をつける: 波形 + 区間のかっこ
    'declare-audio': [
        B(rr(6, 6, 52, 32, 4)),
        L(bars([11, 18, 25, 32, 39, 46, 53], 19, [3, 7, 5, 10, 7, 4, 3])),
        A('M25 29.5v4h14v-4')
    ],
    // 世界を作る: 地球
    'design-world': [
        B(circ(32, 22, 14.5)), L('M32 7.5c-6.5 4.5-6.5 24.5 0 29 6.5-4.5 6.5-24.5 0-29M17.5 22h29'), D(circ(41, 15, 1.7))
    ],
    // 編集の検査: チェックリスト
    'edit-lint': [
        B(rr(10, 6, 44, 32, 4)),
        L('M16 14l2.5 2.5 4.5-5M16 22l2.5 2.5 4.5-5M28 14h18M28 22h14M28 30h10'), A(circ(19.5, 30, 2.6))
    ],
    // 企画と段取り: 企画書 + 工程
    'edit-plan': [
        B(planDoc[0]), L(planDoc[1]), L('M13 20h12M13 26h12M13 32h7'),
        A(rr(35, 9, 12, 7, 1.5)), L(rr(49, 9, 7, 7, 1.5)),
        L(rr(35, 20, 7, 7, 1.5)), L(rr(44, 20, 12, 7, 1.5)), L(rr(35, 31, 16, 7, 1.5))
    ],
    // 他社 NLE へ書き出す: 枠から矢印が出る
    'export-nle': [
        L('M28 8H14a3 3 0 0 0-3 3v22a3 3 0 0 0 3 3h26a3 3 0 0 0 3-3V24'),
        L('M21 16l11 6-11 6z'), A('M38 22L52 8M44 8h8v8')
    ],
    // 生成素材: 画像 + きらめき
    'generate-media': [
        B(rr(6, 9, 34, 28, 3)), L(circ(15, 18, 3)), L('M8 31l8.5-8.5 6.5 6.5 5-5 10 10'),
        A('M51 9q.8 5.2 6 6-5.2.8-6 6-.8-5.2-6-6 5.2-.8 6-6z')
    ],
    // ナレーション: マイク + 声
    'generate-narration': [
        B('M26 12a6 6 0 0 1 12 0v8a6 6 0 0 1-12 0z'), L('M21 19v1a11 11 0 0 0 22 0v-1M32 31v6M26 37h12'),
        A('M30 13h4M30 18h4'),
        L('M17 16c-2 3-2 7 0 10M12 12c-4 6-4 14 0 20M47 16c2 3 2 7 0 10M52 12c4 6 4 14 0 20')
    ],
    // 素材化: かご + 素材カード
    'harvest-asset': [
        L('M19 20V9a2 2 0 0 1 2-2h22a2 2 0 0 1 2 2v11'), L('M23 17l5-5 4 4 3-3 5 5'), D(circ(26.5, 11.5, 1.4)),
        B(rr(9, 21, 46, 6, 2)), B('M12 27v9a2 2 0 0 0 2 2h36a2 2 0 0 0 2-2v-9'), A('M27 32h10')
    ],
    // 接続・設定: 歯車
    'manage-connections': [
        B(gear(32, 22, 14.5, 11.5, 8)), A(circ(32, 22, 4.5))
    ],
    // オーバーレイ: 重なる 2 枚 + 文字
    'overlay-authoring': [
        L('M42 14V9a3 3 0 0 0-3-3H11a3 3 0 0 0-3 3v19a3 3 0 0 0 3 3h9'),
        B(rr(20, 14, 34, 22, 3)), A('M31 21h12M37 21v10')
    ],
    // 書き出し: カチンコ + 再生
    'render-cut': [
        B('M9 21h46v16H9z'), B('M9 15h46v6H9z', 'rotate(-8 9 21)'),
        L('M19 15l-3 6M29 15l-3 6M39 15l-3 6M49 15l-3 6', 'rotate(-8 9 21)'), A('M28 25l9 4.5-9 4.5z')
    ],
    // 企画・調査: 地図 + ピン
    'research-plan': [
        B('M8 11l14-4 20 5 14-4v26l-14 4-20-5-14 4z'), L('M22 7v26M42 12v26'),
        A('M32 31c-5-5-6-8-6-11a6 6 0 0 1 12 0c0 3-1 6-6 11zM32 18a2 2 0 1 0 0 4a2 2 0 1 0 0-4z')
    ],
    // 音源ライブラリを揃える: ヘッドホン + ダウンロード
    'setup-audio-library': [
        L('M12 28v-2a20 20 0 0 1 40 0v2'), B(rr(8, 28, 8, 11, 3)), B(rr(48, 28, 8, 11, 3)),
        A('M32 17v14m-5-5l5 5 5-5'), L('M26 36h12')
    ],
    // チャットで承認: 吹き出し + チェック
    'setup-chat-approval': [
        B('M10 8h44a3 3 0 0 1 3 3v17a3 3 0 0 1-3 3H31l-9 7v-7H10a3 3 0 0 1-3-3V11a3 3 0 0 1 3-3z'),
        A('M25 20l5 5 10-11')
    ],
    // 初期セットアップ: 道具箱
    'setup-library': [
        B(rr(8, 16, 48, 21, 3)), L('M23 16v-4.5a2.5 2.5 0 0 1 2.5-2.5h13a2.5 2.5 0 0 1 2.5 2.5V16'),
        L('M8 26h20M36 26h20'), A(rr(28, 23, 8, 6, 1.5))
    ],
    // 遠隔: スマホ + 電波
    'setup-remote': [
        B(rr(13, 5, 22, 34, 4)), L('M21 9.5h6M21 34h6'), A('M40 17a8 8 0 0 1 0 10M46 12a14 14 0 0 1 0 20')
    ],
    // 検証: 盾 + チェック
    verify: [
        B(circ(28, 18, 12)), L('M36.5 26.5L46 36'), A('M22 18.5l4.5 4.5 8-9')
    ]
};

// 描画範囲の中心を枠の中心（32,22）へ寄せる平行移動（getBBox の実測から。0.5 刻み）
const SKILL_SHIFT: Record<string, readonly [number, number]> = {
    akari: [0, -0.5], 'analyze-footage': [0.5, 0], 'analyze-project': [1, -0.5], 'bake-3d': [-1, 0],
    'beat-sync-edit': [2.5, 0], 'create-project': [0, -0.5], verify: [1, 1],
    'export-nle': [0.5, 0],
    'generate-media': [0.5, -1], 'generate-narration': [0, 0.5], 'harvest-asset': [0, -0.5],
    'overlay-authoring': [1, 1], 'render-cut': [0.5, -0.5], 'research-plan': [0, -0.5],
    'setup-audio-library': [0, -0.5], 'setup-chat-approval': [0, -1], 'setup-library': [0, -1],
    'setup-remote': [0.5, 0]
};

export const DEDICATED_PICTOGRAM_NAMES: readonly string[] = Object.keys(SKILL_PARTS);

function renderParts(parts: readonly Part[]): React.ReactNode {
    return <>
        {parts.map(([role, d, transform], index) => {
            const common = { d, transform };
            switch (role) {
                case 'body':
                    return <path key={index} {...common} fill={shade} fillOpacity={0.16} />;
                case 'accent':
                    return <path key={index} {...common} stroke={accent} />;
                case 'dot':
                    return <path key={index} {...common} stroke={accent} fill={accent} />;
                default:
                    return <path key={index} {...common} />;
            }
        })}
    </>;
}

const SKILL_ART: Record<string, React.ReactNode> = Object.fromEntries(
    Object.entries(SKILL_PARTS).map(([name, parts]) => {
        const shift = SKILL_SHIFT[name];
        return [name, shift ? <g transform={`translate(${shift[0]} ${shift[1]})`}>{renderParts(parts)}</g> : renderParts(parts)];
    })
);

const CATEGORY_PARTS: Record<SkillCategory, readonly Part[]> = {
    plan: [B(catPlanDoc[0]), L(catPlanDoc[1]), L('M30 20h10M30 26h10M30 32h6'), A('M24 20h.1'), L('M24 26h.1M24 32h.1')],
    analysis: [B(circ(25, 20, 11)), L('M33 28l10 10'), A('M20 24v-4M25 24v-8M30 24v-5')],
    material: [B(rr(10, 6, 12, 28, 2)), A(rr(26, 10, 12, 24, 2)), B(rr(42, 6, 12, 28, 2)), L('M10 38h44')],
    edit: [B(rr(8, 10, 11, 9, 2)), L(rr(22, 10, 10, 9, 2)), B(rr(40, 10, 16, 9, 2)), L(rr(8, 25, 24, 9, 2)), B(rr(40, 25, 16, 9, 2)), A('M36 5v34')],
    review: [B(catReviewDoc[0]), L(catReviewDoc[1]), L('M24 19h10'), A('M26 29l4 4 9-10')],
    export: [B(rr(10, 24, 44, 14, 3)), L('M32 8v18'), A('M24 15l8-8 8 8')],
    setup: [L('M10 14h10M28 14h26M10 30h22M40 30h14'), B(circ(24, 14, 4)), A(circ(36, 30, 4))],
    other: [B(rr(10, 8, 20, 12, 3)), L(rr(34, 8, 20, 12, 3)), L(rr(10, 24, 20, 12, 3)), A(rr(34, 24, 20, 12, 3))]
};

const CATEGORY_ART: Record<SkillCategory, React.ReactNode> = Object.fromEntries(
    Object.entries(CATEGORY_PARTS).map(([category, parts]) => [category, renderParts(parts)])
) as Record<SkillCategory, React.ReactNode>;

export function skillPictogramFor(name: string, category: SkillCategory): { dedicated: boolean; art: React.ReactNode } {
    if (Object.prototype.hasOwnProperty.call(SKILL_ART, name)) {
        return { dedicated: true, art: SKILL_ART[name] };
    }
    return { dedicated: false, art: CATEGORY_ART[category] };
}

export function SkillPictogram({ name, category }: { name: string; category: SkillCategory }): React.ReactElement {
    return <svg width='64' height='44' viewBox='0 0 64 44' aria-hidden='true' xmlns='http://www.w3.org/2000/svg'
        fill='none' stroke='currentColor' strokeWidth={1.6} strokeLinecap='round' strokeLinejoin='round'>
        {skillPictogramFor(name, category).art}
    </svg>;
}
