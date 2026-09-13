export class SlotInputError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'SlotInputError';
    this.code = code;
  }
}

export const SLOT_KEYS = [
  'prompt',
  'negative_prompt',
  'first_frame',
  'last_frame',
  'reference_images',
  'reference_videos',
  'reference_audios',
  'source_video',
  'camera',
  'seed',
  'extra',
];

export function normalizeReference(raw, where) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new SlotInputError(
      'reference.invalid',
      `${where}: 参照要素はオブジェクトである必要があります`,
    );
  }
  if (typeof raw.path !== 'string' || raw.path.length === 0) {
    throw new SlotInputError(
      'reference.path_required',
      `${where}: 参照要素には path が必要です`,
    );
  }

  let range = null;
  if (raw.range_s != null) {
    if (
      !Array.isArray(raw.range_s)
      || raw.range_s.length !== 2
      || !Number.isFinite(raw.range_s[0])
      || !Number.isFinite(raw.range_s[1])
      || raw.range_s[0] >= raw.range_s[1]
    ) {
      throw new SlotInputError(
        'reference.range_invalid',
        `${where}: range_s は [in, out]（in < out）である必要があります`,
      );
    }
    range = [raw.range_s[0], raw.range_s[1]];
  }

  return {
    path: raw.path,
    sha256: raw.sha256 ?? null,
    source_id: raw.source_id ?? null,
    name: raw.name ?? null,
    role: raw.role ?? null,
    range_s: range,
  };
}

function normalizeReferenceList(raw, slot) {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    throw new SlotInputError(
      'reference.invalid',
      `${slot}: 参照一覧は配列である必要があります`,
    );
  }
  return raw.map((reference, index) => normalizeReference(reference, `${slot}[${index}]`));
}

export function normalizeInputs(raw = {}) {
  const extra = raw.extra ?? {};
  if (extra === null || typeof extra !== 'object' || Array.isArray(extra)) {
    throw new SlotInputError('extra.invalid', 'extra はオブジェクトである必要があります');
  }
  if (raw.seed != null && !Number.isInteger(raw.seed)) {
    throw new SlotInputError('seed.invalid', 'seed は整数である必要があります');
  }

  return {
    prompt: raw.prompt ?? null,
    negative_prompt: raw.negative_prompt ?? null,
    first_frame: raw.first_frame == null
      ? null
      : normalizeReference(raw.first_frame, 'first_frame'),
    last_frame: raw.last_frame == null
      ? null
      : normalizeReference(raw.last_frame, 'last_frame'),
    reference_images: normalizeReferenceList(raw.reference_images, 'reference_images'),
    reference_videos: normalizeReferenceList(raw.reference_videos, 'reference_videos'),
    reference_audios: normalizeReferenceList(raw.reference_audios, 'reference_audios'),
    source_video: raw.source_video == null
      ? null
      : normalizeReference(raw.source_video, 'source_video'),
    mode: raw.mode ?? null,
    camera: raw.camera
      ? {
          notation: raw.camera.notation ?? 'prose',
          value: raw.camera.value ?? null,
          from_annotation: raw.camera.from_annotation ?? null,
        }
      : null,
    seed: raw.seed ?? null,
    extra: { ...extra },
  };
}

export function normalizeOutput(raw = {}) {
  return {
    duration_s: Number.isFinite(raw.duration_s) ? raw.duration_s : null,
    resolution: raw.resolution ?? null,
    aspect: raw.aspect ?? null,
    audio_out: raw.audio_out ?? null,
  };
}

export function referenceSeconds(ref) {
  return ref.range_s ? ref.range_s[1] - ref.range_s[0] : null;
}
