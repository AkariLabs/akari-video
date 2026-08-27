import type { StillImageBitmap, StillImageSource } from '../types.js';

/** Lazily decodes an image exactly once and keeps the bitmap alive until destroy(). */
export class CachedStillImageSource implements StillImageSource {
  private pending: Promise<StillImageBitmap> | null = null;
  private value: StillImageBitmap | null = null;

  constructor(readonly url: string) {}

  load(): Promise<StillImageBitmap> {
    if (this.value) return Promise.resolve(this.value);
    if (!this.pending) {
      this.pending = fetch(this.url)
        .then(response => {
          if (!response.ok) throw new Error(`image fetch failed (${response.status}): ${this.url}`);
          return response.blob();
        })
        .then(createImageBitmap)
        .then(bitmap => {
          const value = { bitmap, width: bitmap.width, height: bitmap.height };
          this.value = value;
          return value;
        });
    }
    return this.pending;
  }

  destroy(): void {
    this.value?.bitmap.close();
    this.value = null;
    this.pending = null;
  }
}
