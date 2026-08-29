import type { FrameMetricsRecorder, NativeFrameSource } from '../types.js';
import { ClipSession, type ClipSessionOptions } from './clip-session.js';
import { watchDecoderErrors } from './guard.js';

/**
 * Gives each resolved cut an independent stateful decoder lane. A transition can therefore
 * advance outgoing and incoming frames without forcing either MP4Clip to seek backwards.
 */
export class ClipSessionPool implements NativeFrameSource {
  private readonly sessions = new Map<string, Promise<ClipSession>>();
  private base: ClipSession | null = null;
  private acceleration: HardwarePreference | undefined;
  private readonly stopDecoderWatch: () => void;

  constructor(
    readonly id: string,
    private readonly src: string,
    private readonly options: ClipSessionOptions = {}
  ) {
    // av-cliper can emit decoder failures after tick() has already settled. Keep one pool-level
    // guard alive until destroy() so errors between requests are still contained and reported.
    this.stopDecoderWatch = watchDecoderErrors(message => {
      this.options.onWarning?.(`${this.id}: decoder runtime error: ${message}`);
    });
  }

  async decode(
    timeUs: number,
    metrics?: FrameMetricsRecorder,
    request?: { streamId: string }
  ): Promise<VideoFrame> {
    const streamId = request?.streamId ?? 'default';
    return (await this.getSession(streamId)).decode(timeUs, metrics);
  }

  getSession(streamId = 'default'): Promise<ClipSession> {
    let sessionPromise = this.sessions.get(streamId);
    if (!sessionPromise) {
      sessionPromise = this.ensureBase().fork(`${this.id}:${streamId}`);
      this.sessions.set(streamId, sessionPromise);
    }
    return sessionPromise;
  }

  prepareHeader(): Promise<void> {
    return this.ensureBase().prepare();
  }

  releaseSession(streamId: string): boolean {
    const session = this.sessions.get(streamId);
    if (!session) return false;
    this.sessions.delete(streamId);
    void session.then(value => value.destroy(), () => undefined);
    return true;
  }

  liveStreamIds(): readonly string[] {
    return [...this.sessions.keys()];
  }

  get size(): number {
    return this.sessions.size;
  }

  destroy(): void {
    this.stopDecoderWatch();
    const destroyed = new Set<ClipSession>();
    if (this.base) {
      destroyed.add(this.base);
      this.base.destroy();
    }
    for (const session of this.sessions.values()) {
      void session.then(value => {
        if (destroyed.has(value)) return;
        destroyed.add(value);
        value.destroy();
      }, () => undefined);
    }
    this.sessions.clear();
    this.base = null;
  }

  private ensureBase(): ClipSession {
    this.base ??= new ClipSession(`${this.id}:base`, this.src, {
      ...this.options,
      hardwareAcceleration: this.acceleration,
      onDecoderDegraded: () => this.noteDegraded()
    });
    return this.base;
  }

  private noteDegraded(): void {
    if (this.acceleration === 'prefer-software') return;
    this.acceleration = 'prefer-software';
    this.base?.destroy();
    this.base = null;
    this.options.onDecoderDegraded?.();
  }
}
