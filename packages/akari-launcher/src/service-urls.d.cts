export const AKARI_HOST: string;
export const LEGACY_AKARI_HOST: string;
export const DEFAULT_STORE_API: string;
export const DEFAULT_STORE_BASE_URL: string;
export const DEFAULT_STORE_LAB_BASE_URL: string;
export const DEFAULT_ASSETS_BASE_URL: string;
export const DEFAULT_CATALOG_URL: string;
export function normalizeAkariUrl(value: string): string;
export function deriveStoreLabBaseUrl(storeApiUrl: string | undefined): string;
