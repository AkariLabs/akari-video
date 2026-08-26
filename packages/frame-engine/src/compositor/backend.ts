import type { CompositorBackend } from '../types.js';

/** Future backends must implement the same completed-surface contract. WebGPU is intentionally absent. */
export type FrameCompositorBackend = CompositorBackend;
