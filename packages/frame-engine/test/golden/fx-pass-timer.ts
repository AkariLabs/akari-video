interface GpuTimer {
  TIME_ELAPSED_EXT: number;
  GPU_DISJOINT_EXT: number;
}

export const FX_COST_STAGES = [
  'base-prepare', 'prep', 'blur-h', 'blur-v', 'vignette', 'grain', 'snapshot-copy', 'base-draw',
] as const;

export function median(values: readonly number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

// A full 1080p FX batch can leave roughly 45s of SwiftShader work queued on CI;
// 120s allows more than twice that backlog before reporting a stuck GPU.
export async function drainGpu(gl: WebGL2RenderingContext, deadlineMs = 120_000): Promise<void> {
  const start = performance.now();
  const fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
  if (!fence) throw new Error('GPU drain fence allocation failed (status=null, elapsed=0ms)');
  try {
    gl.flush();
    for (;;) {
      const status = gl.clientWaitSync(fence, 0, 0);
      if (status === gl.ALREADY_SIGNALED || status === gl.CONDITION_SATISFIED) return;
      const elapsed = Math.round(performance.now() - start);
      if (status === gl.WAIT_FAILED || elapsed >= deadlineMs) {
        throw new Error(`GPU drain failed (status=${status}, elapsed=${elapsed}ms, deadline=${deadlineMs}ms)`);
      }
      await new Promise<void>(resolve => setTimeout(resolve, 0));
    }
  } finally {
    gl.deleteSync(fence);
  }
}

/** A separate batch: never nest stage queries inside the whole-compose query. */
export async function measureFxPasses(
  gl: WebGL2RenderingContext,
  timer: GpuTimer | null,
  frames: number,
  compose: (index: number, passTimer: (stage: string | null) => void) => Promise<void>,
) {
  const samples = new Map<string, number[]>(FX_COST_STAGES.map(stage => [stage, []]));
  const frameTotals: number[] = [];
  let failureReason: string | null = timer ? null : 'GPU timer extension unavailable';
  if (timer) for (let index = 0; index < frames; index++) {
    const queries: Array<{ stage: string; query: WebGLQuery }> = [];
    let active = false;
    const passTimer = (stage: string | null) => {
      if (active) {
        gl.endQuery(timer.TIME_ELAPSED_EXT);
        active = false;
      }
      if (stage === null) return;
      const query = gl.createQuery();
      if (!query) throw new Error('FX pass query allocation failed');
      queries.push({ stage, query });
      gl.beginQuery(timer.TIME_ELAPSED_EXT, query);
      active = true;
    };
    try {
      // Chromium's WebGL finish() acts like a flush, so wait on a fence instead.
      await drainGpu(gl); // Drain earlier work outside every measured interval.
      gl.getParameter(timer.GPU_DISJOINT_EXT);
      try {
        await compose(index, passTimer);
      } finally {
        passTimer(null);
      }
      gl.flush();
      const deadline = performance.now() + 2_000;
      for (;;) {
        // WebGL updates availability only after yielding to the browser.
        await new Promise<void>(resolve => setTimeout(resolve, 1));
        if (gl.getParameter(timer.GPU_DISJOINT_EXT)) throw new Error('FX pass GPU query disjoint');
        if (queries.every(({ query }) => gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE))) break;
        if (performance.now() >= deadline) throw new Error('FX pass GPU query timed out');
      }
      const values = new Map<string, number>();
      for (const { stage, query } of queries) {
        const ms = Number(gl.getQueryParameter(query, gl.QUERY_RESULT)) / 1e6;
        if (!Number.isFinite(ms) || ms < 0) throw new Error('Invalid FX pass GPU duration');
        if (values.has(stage)) throw new Error(`FX cost stage ran twice in one frame: ${stage}`);
        values.set(stage, ms);
      }
      if (FX_COST_STAGES.some(stage => !values.has(stage))) throw new Error('Missing FX cost stage');
      for (const [stage, value] of values) {
        if (!samples.has(stage)) samples.set(stage, []);
        samples.get(stage)!.push(value);
      }
      frameTotals.push([...values.values()].reduce((sum, value) => sum + value, 0));
    } catch (error) {
      failureReason = String(error);
      break;
    } finally {
      passTimer(null);
      for (const { query } of queries) gl.deleteQuery(query);
    }
  }
  const passes = [...samples].map(([stage, values]) => ({ stage, medianMs: median(values), samples: values.length }));
  return {
    passes, passFrames: frameTotals.length, passMethod: timer ? 'EXT_disjoint_timer_query_webgl2' : 'unavailable',
    passFailureReason: failureReason, passFrameMedianMs: median(frameTotals),
    passMedianSumMs: frameTotals.length ? passes.reduce((sum, pass) => sum + (pass.medianMs ?? 0), 0) : null,
  };
}
