import { t } from '../common/project-text';
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
    'origin' | 'licenseSpdx' | 'licenseScope' | 'licenseAttributionRequired' | 'price' | 'machineTags' | 'sourceKind' | 'distribution'>;

export function libraryLicenseKind(item: LibraryLicenseKindInput): LibraryLicenseKind {
    const spdx = item.licenseSpdx?.trim();
    const isPro = item.machineTags?.includes('tier:pro')
        || (!item.machineTags?.includes('tier:free') && (item.price ?? 0) > 0);
    if (spdx === LAB_PREMIUM_SPDX || (item.origin === 'resolver' && isPro)) return 'premium';
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

const REDISTRIBUTE_NG = t('project.library.license.doNotResellRedistributeAssetItsMessage');
const TRADEMARK_NG = t('project.library.license.youCannotRegisterDesignContainingAssetMessage');
const CREDIT_WARN = t('project.library.license.includeCreatorSNameLicenseVideoMessage');

/** SPDX を人が読む名前へ。知らない識別子はそのまま出す。 */
export function libraryLicenseDisplayName(spdx: string | undefined): string {
    const id = spdx?.trim();
    if (!id) return t('project.library.license.noLicenseListedError');
    if (id === 'CC0-1.0') return t('project.library.license.cc0PublicDomainLabel');
    if (id === LAB_PREMIUM_SPDX) return t('project.library.license.akariLabAssetLicenseIdLabel', { id: id });
    if (id === 'LicenseRef-user-owned') return t('project.library.license.myAssetLabel');
    const cc = /^CC-BY((?:-(?:NC|SA|ND))*)-(\d\.\d)$/i.exec(id);
    if (cc) {
        const parts = cc[1].toUpperCase();
        const note = parts.includes('NC') ? t('project.library.license.noncommercialLabel') : t('project.library.license.attributionRequiredLabel');
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
            return { kind, name: spdx ? name : t('project.library.license.standardAKARIAssetLabel'), title: t('project.library.license.simpleLicenseLabel'),
                lead: t('project.library.license.freeEveryoneUsingAKARIMessage'), credit: false, moreUrl,
                items: [
                    { mark: 'ok', text: t('project.library.license.standardAssetPersonalCommercialUseMessage') },
                    { mark: 'ok', text: t('project.library.license.useItSocialPostsAdsMonetizedAction') },
                    { mark: 'ng', text: REDISTRIBUTE_NG },
                    { mark: 'ng', text: TRADEMARK_NG }
                ] };
        case 'cc0':
            return { kind, name, title: t('project.library.license.freeUseLabel'), lead: t('project.library.license.rightsHaveBeenWaivedAnyoneCanMessage'),
                credit: false, moreUrl,
                items: [
                    { mark: 'ok', text: t('project.library.license.useItPersonalCommercialVideosNoAction') },
                    { mark: 'ok', text: t('project.library.license.youCanEditCropRecolorItMessage') },
                    { mark: 'warn', text: t('project.library.license.ifPeopleTrademarksAppearCheckTheirMessage') }
                ] };
        case 'premium':
            return { kind, name: libraryLicenseDisplayName(LAB_PREMIUM_SPDX), title: t('project.library.license.premiumLabAssetLabel'),
                lead: t('project.library.license.availablePeopleWhoPurchasedItLabMessage'), credit: false,
                items: [
                    { mark: 'ok', text: t('project.library.license.premiumAssetPersonalCommercialUseMessage') },
                    { mark: 'ok', text: t('project.library.license.useItMonetizedAdvertisingClientVideosAction') },
                    { mark: 'ng', text: t('project.library.license.doNotRedistributeResellIncludeAssetMessage') },
                    { mark: 'ng', text: TRADEMARK_NG }
                ] };
        case 'by':
            return { kind, name, title: t('project.library.license.useCreditAction'),
                lead: t('project.library.license.youCanUseItCommerciallyIfMessage'), credit: true, moreUrl,
                items: [
                    { mark: 'ok', text: t('project.library.license.useItPersonalCommercialVideosAction') },
                    { mark: 'warn', text: CREDIT_WARN },
                    { mark: 'ok', text: t('project.library.license.youCanEditItMentioningChangesMessage') }
                ] };
        case 'nc':
            return { kind, name, title: t('project.library.license.noCommercialUseError'), lead: t('project.library.license.useOnlyNoncommercialVideosAction'),
                credit: true, moreUrl,
                items: [
                    { mark: 'ok', text: t('project.library.license.useHobbySchoolNonprofitVideosCreditAction') },
                    { mark: 'ng', text: t('project.library.license.doNotUseMonetizedVideosAdsMessage') },
                    { mark: 'warn', text: t('project.library.license.youWillSeeWarningWhenExportingMessage') }
                ] };
        case 'own':
            return { kind, name, title: t('project.library.license.myAssetLabel'),
                lead: t('project.library.license.youAddedAssetLibraryItsPermittedMessage'),
                credit: axes.attributionRequired === true, moreUrl,
                items: [
                    { mark: 'ok', text: t('project.library.license.ifYouFilmedMadeItYourselfMessage') },
                    { mark: 'warn', text: t('project.library.license.assetsAssetSiteCheckSiteSMessage') },
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
        title = t('project.library.license.noCommercialUseError');
        lead = t('project.library.license.useOnlyNoncommercialVideosAction');
        items.push({ mark: 'ng', text: t('project.library.license.doNotUseMonetizedVideosAdsMessage') });
    } else if (axes.commercial === 'allowed') {
        title = axes.attributionRequired ? t('project.library.license.useCreditAction') : t('project.library.license.commercialUseAllowedLabel');
        lead = t('project.library.license.youCanUseItPersonalCommercialMessage');
        items.push({ mark: 'ok', text: t('project.library.license.useItPersonalCommercialVideosAction') });
    } else {
        title = t('project.library.license.checkUsageTermsAction');
        lead = t('project.library.license.libraryDoesNotSayWhetherAssetMessage');
        items.push({ mark: 'warn', text: t('project.library.license.checkSourceSTermsBeforeUsingAction') });
    }
    if (axes.attributionRequired === true) items.push({ mark: 'warn', text: CREDIT_WARN });
    else if (axes.attributionRequired === false) items.push({ mark: 'ok', text: t('project.library.license.noCreditIsRequiredError') });
    items.push({ mark: 'ng', text: REDISTRIBUTE_NG });
    return { kind: 'other', name, title, lead, items, credit: axes.attributionRequired === true, moreUrl };
}

/** 帰属表示の 1 行（クレジットをコピー）。CREDIT.txt が無ければ作者名とライセンス名から作る。 */
export function libraryCreditLine(item: Pick<AssetCatalogViewItem, 'title' | 'author' | 'creditText' | 'licenseSpdx'>): string {
    if (item.creditText?.trim()) return item.creditText.trim();
    const license = item.licenseSpdx?.trim() ? ` (${item.licenseSpdx.trim()})` : '';
    return `${item.title}${item.author ? ` / ${item.author}` : ''}${license}`;
}
