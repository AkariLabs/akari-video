// Shared by the launcher, resolver and shell. Keep this module browser-safe;
// CommonJS also lets the shell's compiled CommonJS modules load it in Node.
const AKARI_HOST = 'akari.video';
const LEGACY_AKARI_HOST = 'akari-oss.app';
const DEFAULT_STORE_API = `https://${AKARI_HOST}`;
const DEFAULT_STORE_BASE_URL = `${DEFAULT_STORE_API}/api/store`;
const DEFAULT_STORE_LAB_BASE_URL = `${DEFAULT_STORE_API}/lab`;
const DEFAULT_ASSETS_BASE_URL = `${DEFAULT_STORE_API}/assets/`;
const DEFAULT_CATALOG_URL = `${DEFAULT_ASSETS_BASE_URL}catalog.json`;

/** Migrate only the former official origin; preserve custom servers and paths. */
function normalizeAkariUrl(value) {
  try {
    const url = new URL(value);
    if ((url.protocol === 'https:' || url.protocol === 'http:') && url.hostname === LEGACY_AKARI_HOST) {
      url.protocol = 'https:';
      url.hostname = AKARI_HOST;
      return url.href;
    }
  } catch { /* Local paths and malformed values keep their existing handling. */ }
  return value;
}

/** Store credentials contain .../api/store; purchase pages live under .../lab. */
function deriveStoreLabBaseUrl(storeApiUrl) {
  if (!storeApiUrl) return DEFAULT_STORE_LAB_BASE_URL;
  return normalizeAkariUrl(storeApiUrl).replace(/\/api\/store\/?$/, '/lab');
}

exports.AKARI_HOST = AKARI_HOST;
exports.LEGACY_AKARI_HOST = LEGACY_AKARI_HOST;
exports.DEFAULT_STORE_API = DEFAULT_STORE_API;
exports.DEFAULT_STORE_BASE_URL = DEFAULT_STORE_BASE_URL;
exports.DEFAULT_STORE_LAB_BASE_URL = DEFAULT_STORE_LAB_BASE_URL;
exports.DEFAULT_ASSETS_BASE_URL = DEFAULT_ASSETS_BASE_URL;
exports.DEFAULT_CATALOG_URL = DEFAULT_CATALOG_URL;
exports.normalizeAkariUrl = normalizeAkariUrl;
exports.deriveStoreLabBaseUrl = deriveStoreLabBaseUrl;
