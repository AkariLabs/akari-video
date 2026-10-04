// Catalog readers accept old entries until the store publishes tier on every item.
export function assetTier(item) {
  if (Object.prototype.hasOwnProperty.call(item, 'tier')) {
    // Malformed explicit tiers must not silently become free.
    return item.tier === 'free' ? 'free' : 'pro';
  }
  return typeof item.price === 'number' && item.price > 0 ? 'pro' : 'free';
}

export function isAssetEntitled(item, entitlementIds) {
  return entitlementIds.has('all-access-pass')
    || entitlementIds.has(item.id)
    || (typeof item.product_id === 'string' && entitlementIds.has(item.product_id));
}
