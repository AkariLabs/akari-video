export interface AkariRenderArgv {
  requested: boolean;
  projectRoot?: string;
  out?: string;
  fps?: number;
  width?: number;
  height?: number;
  duration?: number;
  frames?: number;
  quality?: string;
  encoder?: string;
  soft?: boolean;
  verify?: string;
  queueDepth?: number;
  dumpFrames?: number[];
  error?: string;
}

export function parseRenderArgv(argv: readonly string[]): AkariRenderArgv {
  const marker = argv.indexOf('--render');
  if (marker < 0) return { requested: false };
  const result: AkariRenderArgv = {
    requested: true,
    projectRoot: argv[marker + 1],
    fps: 30,
    width: 1920,
    height: 1080,
    quality: 'high',
    encoder: 'auto',
    verify: 'stamp',
    queueDepth: 3,
    dumpFrames: [],
    soft: false
  };
  if (!result.projectRoot || result.projectRoot.startsWith('--')) return { requested: true, error: '--render requires a project root' };
  try {
    for (let index = marker + 2; index < argv.length; index += 1) {
      const argument = argv[index];
      const next = () => {
        if (index + 1 >= argv.length) throw new Error(`${argument} requires a value`);
        return argv[++index];
      };
      if (argument === '--out') result.out = next();
      else if (argument === '--fps') result.fps = positiveNumber(next(), '--fps');
      else if (argument === '--width') result.width = positiveInteger(next(), '--width');
      else if (argument === '--height') result.height = positiveInteger(next(), '--height');
      else if (argument === '--duration') result.duration = positiveNumber(next(), '--duration');
      else if (argument === '--frames') result.frames = positiveInteger(next(), '--frames');
      else if (argument === '--quality') result.quality = choice(next(), '--quality', ['master', 'high', 'standard', 'light']);
      else if (argument === '--encoder') result.encoder = choice(next(), '--encoder', ['auto', 'videotoolbox', 'nvenc', 'qsv', 'amf', 'mf', 'x264']);
      else if (argument === '--verify') result.verify = choice(next(), '--verify', ['stamp', 'hash', 'off']);
      else if (argument === '--queue-depth') result.queueDepth = positiveInteger(next(), '--queue-depth');
      else if (argument === '--dump-frames') result.dumpFrames = frameList(next());
      else if (argument === '--soft') result.soft = true;
    }
    if (!result.out) throw new Error('--out is required');
    if (result.duration === undefined && result.frames === undefined) throw new Error('--duration or --frames is required');
    if (result.duration === undefined) result.duration = result.frames! / result.fps!;
    if (result.frames === undefined) result.frames = Math.round(result.duration * result.fps!);
    return result;
  } catch (error) {
    return { requested: true, error: error instanceof Error ? error.message : String(error) };
  }
}

function positiveNumber(value: string, label: string): number {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new Error(`${label} requires a positive number`);
  return number;
}

function positiveInteger(value: string, label: string): number {
  const number = positiveNumber(value, label);
  if (!Number.isInteger(number)) throw new Error(`${label} requires an integer`);
  return number;
}

function choice(value: string, label: string, choices: readonly string[]): string {
  if (!choices.includes(value)) throw new Error(`${label} must be one of ${choices.join('|')}`);
  return value;
}

function frameList(value: string): number[] {
  if (value === '') return [];
  return [...new Set(value.split(',').map(entry => {
    const frame = Number(entry);
    if (!Number.isInteger(frame) || frame < 0) throw new Error(`--dump-frames requires non-negative integers, got: ${entry}`);
    return frame;
  }))].sort((left, right) => left - right);
}
