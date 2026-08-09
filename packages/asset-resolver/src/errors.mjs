// resolve() が投げるエラーの型。code で分岐できるようにする
// （'locked' | 'not_found' | 'invalid_catalog_item' | 'integrity' | 'validation' | 'download_failed'）。

export class AssetResolverError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'AssetResolverError';
    this.code = code;
  }
}
