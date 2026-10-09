import { hasLifetimePass, StorePlanProduct } from './store-plan-badge';

// 商品名は区切りで見て、別の単語に含まれる pro を拾わない。
const PRO_PATTERN = /(?:^|[-_.\s])(?:pro|subscription)(?:[-_.\s]|$)/i;

export function hasProKey(products: readonly StorePlanProduct[]): boolean {
    const valid = Array.isArray(products)
        ? products.filter((product): product is StorePlanProduct => !!product && typeof product === 'object')
        : [];
    return hasLifetimePass(valid) || valid.some(product =>
        PRO_PATTERN.test(product.id ?? '') || PRO_PATTERN.test(product.kind ?? ''));
}

export function proGate(tier: string, hasKey: boolean): boolean {
    return tier !== 'pro' || hasKey;
}
