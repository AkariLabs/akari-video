// Catalog readers accept old entries until the store publishes tier on every item.
export function assetTier(item) {
  if (Object.prototype.hasOwnProperty.call(item, 'tier')) {
    // Malformed explicit tiers must not silently become free.
    return item.tier === 'free' ? 'free' : 'pro';
  }
  return item.price === 0 ? 'free' : 'pro';
}

export function isAssetEntitled(_item, entitlementIds) {
  return entitlementIds.has('all-access-pass');
}
