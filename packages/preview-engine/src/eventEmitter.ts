// 最小のタイプ付きイベントエミッタ（外部依存なし）
export type Listener<T> = (payload: T) => void;

export class TypedEmitter<Events extends object> {
  private listeners: { [K in keyof Events]?: Set<Listener<Events[K]>> } = {};

  on<K extends keyof Events>(event: K, cb: Listener<Events[K]>): () => void {
    if (!this.listeners[event]) this.listeners[event] = new Set();
    this.listeners[event]!.add(cb);
    return () => this.off(event, cb);
  }

  off<K extends keyof Events>(event: K, cb: Listener<Events[K]>): void {
    this.listeners[event]?.delete(cb);
  }

  emit<K extends keyof Events>(event: K, payload: Events[K]): void {
    const set = this.listeners[event];
    if (!set) return;
    // コピーしてから反復（リスナー内での on/off 変更に耐える）
    for (const cb of [...set]) {
      try {
        cb(payload);
      } catch (e) {
        // リスナー例外でエンジン全体を落とさない
        console.error('[preview-engine] listener error', event, e);
      }
    }
  }

  removeAll(): void {
    this.listeners = {};
  }
}
