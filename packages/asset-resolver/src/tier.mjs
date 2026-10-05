// Catalog readers accept old entries until the store publishes tier on every item.
export function assetTier(item) {
  if (Object.prototype.hasOwnProperty.call(item, 'tier')) {
    // Malformed explicit tiers must not silently become free.
    return item.tier === 'free' ? 'free' : 'pro';
  }
  return item.price === 0 ? 'free' : 'pro';
}

export function isAssetEntitled(item, entitlements) {
  const { ids, pass } = entitlements instanceof Set
    ? { ids: entitlements, pass: null } : entitlements;
  return pass !== null && pass !== undefined
    || ids.has('all-access-pass')
    || (typeof item?.product_id === 'string' && ids.has(item.product_id));
}
