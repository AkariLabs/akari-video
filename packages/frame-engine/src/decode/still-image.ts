import type { StillImageBitmap, StillImageSource } from '../types.js';

/** Lazily decodes once per color-conversion mode and keeps bitmaps until destroy(). */
export class CachedStillImageSource implements StillImageSource {
  private readonly pending = new Map<'default' | 'none', Promise<StillImageBitmap>>();
  private readonly values = new Map<'default' | 'none', StillImageBitmap>();

  constructor(readonly url: string) {}

  load(options?: { colorSpaceConversion?: 'none' }): Promise<StillImageBitmap> {
    const mode = options?.colorSpaceConversion ?? 'default';
    const value = this.values.get(mode);
    if (value) return Promise.resolve(value);
    let pending = this.pending.get(mode);
    if (!pending) {
      pending = fetch(this.url)
        .then(response => {
          if (!response.ok) throw new Error(`image fetch failed (${response.status}): ${this.url}`);
          return response.blob();
        })
        .then(blob => mode === 'none'
          ? createImageBitmap(blob, { colorSpaceConversion: 'none' })
          : createImageBitmap(blob))
        .then(bitmap => {
          const value = { bitmap, width: bitmap.width, height: bitmap.height };
          this.values.set(mode, value);
          return value;
        });
      this.pending.set(mode, pending);
    }
    return pending;
  }

  destroy(): void {
    for (const value of this.values.values()) value.bitmap.close();
    this.values.clear();
    this.pending.clear();
  }
}
