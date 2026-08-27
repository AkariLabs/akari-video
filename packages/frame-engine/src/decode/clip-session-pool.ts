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
  private readonly stopDecoderWatch: () => void;

  constructor(
    private readonly id: string,
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
      if (!this.base) {
        this.base = new ClipSession(`${this.id}:${streamId}`, this.src, this.options);
        sessionPromise = Promise.resolve(this.base);
      } else {
        sessionPromise = this.base.fork(`${this.id}:${streamId}`);
      }
      this.sessions.set(streamId, sessionPromise);
    }
    return sessionPromise;
  }

  get size(): number {
    return this.sessions.size;
  }

  destroy(): void {
    this.stopDecoderWatch();
    for (const session of this.sessions.values()) {
      void session.then(value => value.destroy(), () => undefined);
    }
    this.sessions.clear();
    this.base = null;
  }
}
