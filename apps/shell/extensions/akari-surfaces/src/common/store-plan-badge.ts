import type { AssetEntitlementsStatus } from 'akari-project/lib/common/akari-project-protocol';
import { storeReconnectRequired } from './store-entitlements-visibility';

// ホーム面の右上に常設する AKARI Store の在席表示（2026-09-26 オーナー指摘）。
//
// 旧: ホームの下に「AKARI Store · 接続中」ボタン。
// 新: ホーム面の右上に置き、**製品名ではなく今の状態**を出す — 接続していれば
//     そのアカウントのメールアドレス。Lifetime パスを持っていれば金色 + プラン名を添える。
//
// 判定はエンタイトルメント（購入済み商品）だけを根拠にする。ホーム独自の
// トークン検証は足さない（判定元はカタログ面と同じ RPC のまま）。

export interface StorePlanProduct {
    id: string;
    kind: string | null;
}

export interface StorePlanBadgeInput {
    /** `store-credentials.json` から読めたメールアドレス。未接続なら null。 */
    email: string | null;
    entitlementsStatus: AssetEntitlementsStatus;
    entitledProducts: StorePlanProduct[];
}

export type StorePlanBadgeTone = 'gold' | 'neutral' | 'warn';

export interface StorePlanBadgeModel {
    /** `data-akari-store-connection` に載せる値（既存の L1 / evidence と同じ語彙）。 */
    state: 'connected' | 'disconnected' | 'reconnect-required';
    /** バッジの主文字列。接続済みならメールアドレスそのもの。 */
    label: string;
    /** 主文字列の前に添える短いプラン名（Lifetime のときだけ）。 */
    plan?: string;
    tone: StorePlanBadgeTone;
    icon: string;
    tooltip: string;
    lifetime: boolean;
}

// 商品 id / kind のどちらかに lifetime（買い切りパス）が現れたら Lifetime とみなす。
// `lifetimes-pack` のような別語に誤反応しないよう、区切り込みで見る。
const LIFETIME_PATTERN = /(?:^|[-_.\s])lifetime(?:[-_.\s]|$)/i;

export function hasLifetimePass(products: readonly StorePlanProduct[]): boolean {
    return products.some(product =>
        LIFETIME_PATTERN.test(product.id ?? '') || LIFETIME_PATTERN.test(product.kind ?? ''));
}

/**
 * 資格情報はあるのに entitlements が弾かれた（unauthorized）ときだけ再接続を促す。
 * オフライン等の `error` は無料のみへ倒す既存方針に合わせ、接続中の表示のままにする
 * （判定は {@link storeReconnectRequired} を共有する）。
 */
export function resolveStorePlanBadge(input: StorePlanBadgeInput): StorePlanBadgeModel {
    const connected = input.email !== null;
    if (!connected) {
        return {
            state: 'disconnected', label: '未接続', tone: 'neutral', icon: 'codicon-account',
            tooltip: 'AKARI Store に接続していません。クリックすると接続設定を開きます。', lifetime: false
        };
    }
    if (storeReconnectRequired(connected, input.entitlementsStatus)) {
        return {
            state: 'reconnect-required', label: '再接続が必要', tone: 'warn', icon: 'codicon-warning',
            tooltip: '別の端末で接続されたため解除された可能性があります。クリックすると接続設定を開きます。',
            lifetime: false
        };
    }
    const email = input.email as string;
    const lifetime = hasLifetimePass(input.entitledProducts);
    return lifetime
        ? {
            state: 'connected', label: email, plan: 'Lifetime', tone: 'gold', icon: 'codicon-star-full',
            tooltip: `AKARI Video Lab — Lifetime プラン\n${email}`, lifetime: true
        }
        : {
            state: 'connected', label: email, tone: 'neutral', icon: 'codicon-account',
            tooltip: `AKARI Store に接続しています\n${email}`, lifetime: false
        };
}
