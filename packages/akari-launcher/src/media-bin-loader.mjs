// モノレポと npm 配布物の両方から media-bin を読み、同期の起動箇所へ解決結果を渡す。
let preloadedMediaBin = null;

export async function loadMediaBinModule() {
  const candidates = [
    new URL('../../media-bin/src/index.mjs', import.meta.url),
    new URL('../vendor/packages/media-bin/src/index.mjs', import.meta.url),
  ];
  let lastError;
  for (const candidate of candidates) {
    try {
      return await import(candidate.href);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError ?? new Error('media-bin is unavailable');
}

export async function preloadMediaBin(load = loadMediaBinModule) {
  try {
    preloadedMediaBin = await load();
  } catch {
    preloadedMediaBin = null;
  }
  return preloadedMediaBin;
}

export function resolveMediaCommand(name, { env = process.env, mediaBin = preloadedMediaBin } = {}) {
  const resolver = name === 'ffmpeg' ? mediaBin?.resolveFfmpeg : mediaBin?.resolveFfprobe;
  if (typeof resolver !== 'function') return name;
  try {
    return resolver({ env });
  } catch {
    return name;
  }
}
