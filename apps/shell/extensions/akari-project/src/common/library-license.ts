/**
 * ライブラリの素材のライセンスを「2 軸」で読む純関数（読み取りの導出だけ）。
 *
 * - 商用利用: `allowed`（使える）/ `prohibited`（使えない）/ `unknown`（分からない）
 * - 帰属表示: `true`（要る）/ `false`（要らない）/ `null`（分からない）
 *
 * meta.json の `license.scope` は自由文字列のまま（語彙化はスキーマ側の別作業）なので、
 * ここでは既存の値（`commercial-ok` / `paid-license-required` / `private-owned` / `test-only`）と
 * 語彙化後の値（`commercial-ok` / `non-commercial` / `attribution` / `unknown`）の両方を読み、
 * `licenseSpdx` の手掛かりと突き合わせる。**迷ったら厳しい側**（非営利の SPDX は scope より優先）。
 *
 * カードにはライセンスを出さない。ここで導いた値は情報カード・ライセンスの窓・フィルターが使う。
 */
import type { AssetCatalogViewItem } from './akari-project-protocol';

export type LibraryCommercialUse = 'allowed' | 'prohibited' | 'unknown';

export interface LibraryLicenseAxes {
    commercial: LibraryCommercialUse;
    attributionRequired: boolean | null;
}

export interface LibraryLicenseInput {
    spdx?: string;
    scope?: string;
    attributionRequired?: boolean;
}

/** 既存 + 語彙化後の scope。表に無い値は SPDX から読む。 */
const SCOPE_COMMERCIAL: Readonly<Record<string, LibraryCommercialUse>> = {
    'commercial-ok': 'allowed',
    attribution: 'allowed',
    'non-commercial': 'prohibited',
    unknown: 'unknown',
    // 購入する権利の中身は買う先で決まる。ここからは言い切らない。
    'paid-license-required': 'unknown',
    // 利用者が自分で入れた素材。入手元の条件はアプリには分からない。
    'private-owned': 'unknown',
    'test-only': 'unknown'
};

/** 商用利用できることが SPDX だけで言える識別子。 */
const COMMERCIAL_SPDX = /^(CC0-1\.0|MIT|OFL-1\.1|Apache-2\.0|CC-BY(-SA)?-\d\.\d|LicenseRef-AKARI-[A-Za-z0-9.-]+)$/;
/** 帰属表示が要らないと SPDX だけで言える識別子（素材としての扱い）。 */
const NO_ATTRIBUTION_SPDX = /^(CC0-1\.0|LicenseRef-AKARI-[A-Za-z0-9.-]+)$/;

export function isNonCommercialSpdx(spdx: string | undefined): boolean {
    return !!spdx && /(^|-)NC(-|$)/i.test(spdx);
}

export function isAttributionSpdx(spdx: string | undefined): boolean {
    return !!spdx && /^CC-BY(-|$)/i.test(spdx);
}

export function deriveLibraryLicenseAxes(input: LibraryLicenseInput): LibraryLicenseAxes {
    const spdx = input.spdx?.trim() || undefined;
    const scope = input.scope?.trim() || undefined;
    let commercial: LibraryCommercialUse;
    if (isNonCommercialSpdx(spdx)) {
        commercial = 'prohibited';
    } else if (scope && scope in SCOPE_COMMERCIAL) {
        commercial = SCOPE_COMMERCIAL[scope];
    } else {
        commercial = spdx && COMMERCIAL_SPDX.test(spdx) ? 'allowed' : 'unknown';
    }
    let attributionRequired: boolean | null;
    if (isAttributionSpdx(spdx) || scope === 'attribution') {
        attributionRequired = true;
    } else if (typeof input.attributionRequired === 'boolean') {
        attributionRequired = input.attributionRequired;
    } else {
        attributionRequired = spdx && NO_ATTRIBUTION_SPDX.test(spdx) ? false : null;
    }
    return { commercial, attributionRequired };
}

export function libraryItemLicenseAxes(item: Pick<AssetCatalogViewItem, 'licenseSpdx' | 'licenseScope' | 'licenseAttributionRequired'>): LibraryLicenseAxes {
    return deriveLibraryLicenseAxes({ spdx: item.licenseSpdx, scope: item.licenseScope, attributionRequired: item.licenseAttributionRequired });
}

/**
 * ライセンスの窓の種類。基本の 5 つ（標準素材 / CC0 / Lab のプレミアム / CC BY / CC BY-NC）に、
 * 利用者が自分で入れた素材（own）と、どれにも当たらないもの（other = 2 軸から文を組む）を足す。
 */
export type LibraryLicenseKind = 'builtin' | 'cc0' | 'premium' | 'by' | 'nc' | 'own' | 'other';

export const LAB_PREMIUM_SPDX = 'LicenseRef-AKARI-Assets-v0';

export type LibraryLicenseKindInput = Pick<AssetCatalogViewItem,
    'origin' | 'licenseSpdx' | 'licenseScope' | 'licenseAttributionRequired' | 'price' | 'sourceKind' | 'distribution'>;

export function libraryLicenseKind(item: LibraryLicenseKindInput): LibraryLicenseKind {
    const spdx = item.licenseSpdx?.trim();
    if (spdx === LAB_PREMIUM_SPDX || (item.origin === 'resolver' && (item.price ?? 0) > 0)) return 'premium';
    if (isNonCommercialSpdx(spdx)) return 'nc';
    if (isAttributionSpdx(spdx)) return 'by';
    if (spdx === 'CC0-1.0') return 'cc0';
    if (spdx === 'LicenseRef-user-owned' || item.licenseScope === 'private-owned') return 'own';
    const axes = libraryItemLicenseAxes(item);
    if ((item.origin === 'local' && item.distribution === 'bundled') || (item.origin === 'resolver' && item.sourceKind === 'lab'))
        if (axes.commercial === 'allowed' && axes.attributionRequired !== true) return 'builtin';
    return 'other';
}

export type LibraryLicenseMark = 'ok' | 'ng' | 'warn';

export interface LibraryLicenseSheet {
    kind: LibraryLicenseKind;
    /** 窓の見出し。 */
    title: string;
    /** 見出しの下の 1 行。 */
    lead: string;
    /** ライセンスの名前（情報カードの「ライセンス名」と窓の「詳しくはこちら」に出す）。 */
    name: string;
    items: { mark: LibraryLicenseMark; text: string }[];
    /** 帰属表示が要る = 「クレジットをコピー」を出す。 */
    credit: boolean;
    /** 「詳しくはこちら」の行き先。無ければリンクを出さない。 */
    moreUrl?: string;
}

const REDISTRIBUTE_NG = '素材そのものを単体で再販売・再配布したり、自作と名乗ったりはしないでください。';
const TRADEMARK_NG = 'この素材を含むデザインは商標（ロゴ）として登録できません。';
const CREDIT_WARN = '動画の概要欄などに、作者名とライセンスを書いてください（「クレジットをコピー」で出せます）。';

/** SPDX を人が読む名前へ。知らない識別子はそのまま出す。 */
export function libraryLicenseDisplayName(spdx: string | undefined): string {
    const id = spdx?.trim();
    if (!id) return 'ライセンスの記載なし';
    if (id === 'CC0-1.0') return 'CC0（パブリックドメイン）';
    if (id === LAB_PREMIUM_SPDX) return `AKARI Lab 素材ライセンス（${id}）`;
    if (id === 'LicenseRef-user-owned') return '自分で追加した素材';
    const cc = /^CC-BY((?:-(?:NC|SA|ND))*)-(\d\.\d)$/i.exec(id);
    if (cc) {
        const parts = cc[1].toUpperCase();
        const note = parts.includes('NC') ? '（非営利）' : '（帰属表示）';
        return `CC BY${parts} ${cc[2]}${note}`;
    }
    if (id === 'OFL-1.1') return 'SIL Open Font License 1.1';
    return id;
}

/** 「詳しくはこちら」の URL。公開された全文があるものだけ（LicenseRef-* は持たない）。 */
export function libraryLicenseMoreUrl(spdx: string | undefined): string | undefined {
    const id = spdx?.trim();
    if (!id || id.startsWith('LicenseRef-')) return undefined;
    if (id === 'CC0-1.0') return 'https://creativecommons.org/publicdomain/zero/1.0/deed.ja';
    const cc = /^CC-BY((?:-(?:NC|SA|ND))*)-(\d\.\d)$/i.exec(id);
    if (cc) return `https://creativecommons.org/licenses/by${cc[1].toLowerCase()}/${cc[2]}/deed.ja`;
    return `https://spdx.org/licenses/${encodeURIComponent(id)}.html`;
}

export function libraryLicenseSheet(item: LibraryLicenseKindInput): LibraryLicenseSheet {
    const kind = libraryLicenseKind(item);
    const axes = libraryItemLicenseAxes(item);
    const spdx = item.licenseSpdx?.trim();
    const moreUrl = libraryLicenseMoreUrl(spdx);
    const name = libraryLicenseDisplayName(spdx);
    switch (kind) {
        case 'builtin':
            return { kind, name: spdx ? name : 'AKARI Video の標準素材', title: 'ライセンスがシンプルに',
                lead: 'AKARI Video を使うすべての人が、無料で使えます。', credit: false, moreUrl,
                items: [
                    { mark: 'ok', text: 'AKARI Video で作る動画の中で、個人用にも商用にも安心して使えます。' },
                    { mark: 'ok', text: 'SNS・広告・収益化した動画に使えます。' },
                    { mark: 'ng', text: REDISTRIBUTE_NG },
                    { mark: 'ng', text: TRADEMARK_NG }
                ] };
        case 'cc0':
            return { kind, name, title: '自由に使えます', lead: '権利が放棄された素材です。誰でも無料で使えます。',
                credit: false, moreUrl,
                items: [
                    { mark: 'ok', text: '個人・商用どちらの動画にも使えます。クレジットも不要です。' },
                    { mark: 'ok', text: '加工・切り抜き・色の変更も自由です。' },
                    { mark: 'warn', text: '人物や商標が写っている場合は、その権利に注意してください。' }
                ] };
        case 'premium':
            return { kind, name: libraryLicenseDisplayName(LAB_PREMIUM_SPDX), title: 'Lab のプレミアム素材',
                lead: 'Lab で購入した人（またはこの素材を含むパスを持っている人）が使えます。', credit: false,
                items: [
                    { mark: 'ok', text: 'AKARI Video で作る動画の中で、個人用にも商用にも使えます。' },
                    { mark: 'ok', text: '収益化・広告・案件の動画にも使えます。' },
                    { mark: 'ng', text: '素材そのものの単体での再配布・再販売・ほかの素材集への再収録はできません。' },
                    { mark: 'ng', text: TRADEMARK_NG }
                ] };
        case 'by':
            return { kind, name, title: 'クレジットを書けば使えます',
                lead: '作者の名前（帰属表示）を載せれば、商用にも使えます。', credit: true, moreUrl,
                items: [
                    { mark: 'ok', text: '個人・商用どちらの動画にも使えます。' },
                    { mark: 'warn', text: CREDIT_WARN },
                    { mark: 'ok', text: '加工もできます（加工したことも書くと親切です）。' }
                ] };
        case 'nc':
            return { kind, name, title: '商用では使えません', lead: '営利目的でない動画にだけ使えます。',
                credit: true, moreUrl,
                items: [
                    { mark: 'ok', text: '趣味・学校・非営利の動画には使えます（クレジットは必要）。' },
                    { mark: 'ng', text: '収益化した動画・広告・案件・商品の販売には使えません。' },
                    { mark: 'warn', text: '書き出しのとき、この素材が入っていると注意が出ます。' }
                ] };
        case 'own':
            return { kind, name, title: '自分で追加した素材',
                lead: 'ライブラリに自分で入れた素材です。使える範囲は、入手したときの条件に従います。',
                credit: axes.attributionRequired === true, moreUrl,
                items: [
                    { mark: 'ok', text: '自分で撮った・作った素材なら、自由に使えます。' },
                    { mark: 'warn', text: '素材サイトから入れたものは、そのサイトの利用規約を確かめてください。' },
                    ...(axes.attributionRequired === true ? [{ mark: 'warn' as const, text: CREDIT_WARN }] : [])
                ] };
        default:
            return otherLicenseSheet(name, axes, moreUrl);
    }
}

function otherLicenseSheet(name: string, axes: LibraryLicenseAxes, moreUrl: string | undefined): LibraryLicenseSheet {
    const items: LibraryLicenseSheet['items'] = [];
    let title: string;
    let lead: string;
    if (axes.commercial === 'prohibited') {
        title = '商用では使えません';
        lead = '営利目的でない動画にだけ使えます。';
        items.push({ mark: 'ng', text: '収益化した動画・広告・案件・商品の販売には使えません。' });
    } else if (axes.commercial === 'allowed') {
        title = axes.attributionRequired ? 'クレジットを書けば使えます' : '商用でも使えます';
        lead = '配布元の条件の範囲で、個人・商用どちらの動画にも使えます。';
        items.push({ mark: 'ok', text: '個人・商用どちらの動画にも使えます。' });
    } else {
        title = '使い方を確かめてください';
        lead = 'この素材の商用利用の可否は、ライブラリの情報からは分かりません。';
        items.push({ mark: 'warn', text: '収益化する動画に使う前に、配布元の利用規約を確かめてください。' });
    }
    if (axes.attributionRequired === true) items.push({ mark: 'warn', text: CREDIT_WARN });
    else if (axes.attributionRequired === false) items.push({ mark: 'ok', text: 'クレジットの表記は不要です。' });
    items.push({ mark: 'ng', text: REDISTRIBUTE_NG });
    return { kind: 'other', name, title, lead, items, credit: axes.attributionRequired === true, moreUrl };
}

/** 帰属表示の 1 行（クレジットをコピー）。CREDIT.txt が無ければ作者名とライセンス名から作る。 */
export function libraryCreditLine(item: Pick<AssetCatalogViewItem, 'title' | 'author' | 'creditText' | 'licenseSpdx'>): string {
    if (item.creditText?.trim()) return item.creditText.trim();
    const license = item.licenseSpdx?.trim() ? ` (${item.licenseSpdx.trim()})` : '';
    return `${item.title}${item.author ? ` / ${item.author}` : ''}${license}`;
}
