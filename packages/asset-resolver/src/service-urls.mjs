import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

// The resolver is shipped under launcher/vendor/packages/asset-resolver.
// Both layouts point to the launcher's single canonical, browser-safe module;
// no duplicate constants or changes to the vendor manifest are needed.
const checkout = new URL('../../akari-launcher/src/service-urls.cjs', import.meta.url);
const packaged = new URL('../../../../src/service-urls.cjs', import.meta.url);
export const {
  AKARI_HOST, LEGACY_AKARI_HOST, DEFAULT_STORE_API, DEFAULT_STORE_BASE_URL,
  DEFAULT_STORE_LAB_BASE_URL, DEFAULT_ASSETS_BASE_URL, DEFAULT_CATALOG_URL,
  normalizeAkariUrl, deriveStoreLabBaseUrl,
} = createRequire(import.meta.url)(fileURLToPath(existsSync(checkout) ? checkout : packaged));
