import {
  SlotInputError,
  normalizeInputs,
  normalizeOutput,
  referenceSeconds,
} from './slots.mjs';

const EPSILON = 1e-9;

function fmt(value) {
  return Number(value.toFixed(3)).toString();
}

function addReferenceMessages(messages, references, capability, slot, label, unit) {
  const count = references.length;
  if (Number.isFinite(capability?.max) && count > capability.max) {
    messages.push({
      level: 'error',
      code: `${slot}.max`,
      text: `${label}は ${fmt(capability.max)} ${unit}までです（${fmt(count)} ${unit}）`,
    });
  }

  const seconds = references.map(referenceSeconds).filter((value) => value !== null);
  if (Number.isFinite(capability?.max_seconds_each) && seconds.length > 0) {
    const maximum = Math.max(...seconds);
    if (maximum > capability.max_seconds_each) {
      messages.push({
        level: 'error',
        code: `${slot}.max_seconds_each`,
        text: `${label}は 1 ${unit}あたり ${fmt(capability.max_seconds_each)} 秒までです（${fmt(maximum)} 秒）`,
      });
    }
  }

  if (Number.isFinite(capability?.max_seconds_total)) {
    const total = seconds.reduce((sum, value) => sum + value, 0);
    if (total > capability.max_seconds_total) {
      messages.push({
        level: 'error',
        code: `${slot}.max_seconds_total`,
        text: `${label}は合計 ${fmt(capability.max_seconds_total)} 秒までです（${fmt(total)} 秒）`,
      });
    }
  }
}

function coveringEnum(value, values) {
  const ordered = [...values].sort((a, b) => a - b);
  return ordered.find(candidate => candidate >= value) ?? ordered.at(-1);
}

function roundHalfDown(value) {
  const floor = Math.floor(value);
  return Math.abs(value - floor - 0.5) <= EPSILON ? floor : Math.round(value);
}

function roundedDuration(value, duration) {
  if (duration.kind === 'enum') {
    return { value: coveringEnum(value, duration.values), reason: 'enum' };
  }

  if (duration.kind === 'range') {
    const clamped = Math.min(duration.max, Math.max(duration.min, value));
    const wasClamped = Math.abs(clamped - value) > EPSILON;
    let result = clamped;
    if (typeof duration.step === 'number' && duration.step > 0) {
      const steps = roundHalfDown((clamped - duration.min) / duration.step);
      result = duration.min + steps * duration.step;
    }
    result = Math.min(duration.max, Math.max(duration.min, result));
    return { value: result, reason: wasClamped ? 'clamp' : 'step' };
  }

  return { value, reason: null };
}

function durationMessage(model, from, to) {
  const duration = model.duration;
  const family = model.family ?? model.id;
  const allowed = duration.kind === 'enum'
    ? `${duration.values.map(fmt).join(' / ')} 秒のみ`
    : `${fmt(duration.min)}〜${fmt(duration.max)} 秒`;
  const difference = Math.abs(from - to);
  const suffix = difference > 0.5 ? `。差 ${fmt(difference)} 秒` : '';
  return `尺 ${fmt(from)} 秒 → ${fmt(to)} 秒に丸めました（${family} は ${allowed}）${suffix}`;
}

export function validateInputs({ inputs, output, model }) {
  if (model == null) {
    throw new SlotInputError('model.required', 'model（カタログ行）が必要です');
  }

  const selectedInputs = { ...inputs };
  const selection = selectedInputs.frames_or_refs;
  delete selectedInputs.frames_or_refs;
  if (selection === 'references') {
    selectedInputs.first_frame = null;
    selectedInputs.last_frame = null;
  } else if (selection === 'frames') {
    selectedInputs.reference_images = [];
    selectedInputs.reference_videos = [];
    selectedInputs.reference_audios = [];
  }
  const normalizedInputs = normalizeInputs(selectedInputs);
  const requestedOutput = normalizeOutput(output);
  const usedDefaultDuration = requestedOutput.duration_s === null;
  const normalizedOutput = {
    ...requestedOutput,
    duration_s: usedDefaultDuration ? model.duration.default : requestedOutput.duration_s,
  };

  if (model.audio_out === 'always') normalizedOutput.audio_out = true;
  else if (model.audio_out === false) normalizedOutput.audio_out = false;
  else normalizedOutput.audio_out = requestedOutput.audio_out ?? true;

  const messages = [];
  const modelInputs = model.inputs;

  if (modelInputs.first_frame === 'required' && !normalizedInputs.first_frame) {
    messages.push({ level: 'error', code: 'first_frame.required', text: 'このモデルは最初のフレームが必要です' });
  } else if (modelInputs.first_frame === 'none' && normalizedInputs.first_frame) {
    messages.push({
      level: 'error',
      code: 'first_frame.unsupported',
      text: 'このモデルは最初のフレームを使えません。外して続けるか、対応モデルに切り替えてください',
    });
  }

  if (modelInputs.last_frame === 'required' && !normalizedInputs.last_frame) {
    messages.push({ level: 'error', code: 'last_frame.required', text: 'このモデルは最後のフレームが必要です' });
  } else if (modelInputs.last_frame === 'none' && normalizedInputs.last_frame) {
    messages.push({
      level: 'error',
      code: 'last_frame.unsupported',
      text: 'このモデルは最後のフレームを使えません。外して続けるか、対応モデルに切り替えてください',
    });
  }

  const hasFrames = normalizedInputs.first_frame !== null || normalizedInputs.last_frame !== null;
  const hasReferences = normalizedInputs.reference_images.length > 0
    || normalizedInputs.reference_videos.length > 0
    || normalizedInputs.reference_audios.length > 0;
  if (!hasFrames && !hasReferences && !normalizedInputs.prompt?.trim()) {
    messages.push({ level: 'error', code: 'prompt.required', text: '指示文か絵のどちらかが必要です' });
  }
  if (modelInputs.frames_and_refs_exclusive === true && hasFrames && hasReferences) {
    messages.push({
      level: 'error',
      code: 'frames_refs.exclusive',
      text: 'このモデルはフレーム指定と参照を同時に使えません。どちらかにしてください',
    });
  }

  addReferenceMessages(messages, normalizedInputs.reference_images, modelInputs.reference_images, 'reference_images', '参照画像', '枚');
  addReferenceMessages(messages, normalizedInputs.reference_videos, modelInputs.reference_videos, 'reference_videos', '参照動画', '本');
  addReferenceMessages(messages, normalizedInputs.reference_audios, modelInputs.reference_audios, 'reference_audios', '参照音声', '本');

  if (modelInputs.negative_prompt === false && normalizedInputs.negative_prompt) {
    messages.push({
      level: 'error',
      code: 'negative_prompt.unsupported',
      text: 'このモデルはネガティブプロンプトを受けません',
    });
  }

  if (normalizedInputs.camera) {
    const notation = normalizedInputs.camera.notation;
    const accepted = modelInputs.camera;
    if (notation !== 'prose' && notation !== accepted) {
      messages.push({
        level: 'info',
        code: 'camera.notation_fallback',
        text: `このモデルはカメラ記法 ${notation} を受けません。prose（文章）に落として prompt に合成します`,
      });
      normalizedInputs.camera.notation = 'prose';
    }
  }

  const allowedExtra = new Set(modelInputs.extra_allowed ?? []);
  for (const key of Object.keys(normalizedInputs.extra)) {
    if (!allowedExtra.has(key)) {
      messages.push({
        level: 'error',
        code: 'extra.not_allowed',
        text: `このモデルは extra.${key} を受けません`,
      });
      delete normalizedInputs.extra[key];
    }
  }

  if (model.seed === false && normalizedInputs.seed !== null) {
    messages.push({
      level: 'info',
      code: 'seed.unsupported',
      text: 'このモデルは seed を受けません。seed は送りません',
    });
    normalizedInputs.seed = null;
  }

  if (normalizedOutput.resolution !== null) {
    if (!Array.isArray(model.resolutions) || model.resolutions.length === 0) {
      messages.push({
        level: 'error',
        code: 'resolution.invalid',
        text: `解像度 ${normalizedOutput.resolution} はこのモデルにありません（このモデルは解像度を選べません）`,
      });
    } else if (!model.resolutions.includes(normalizedOutput.resolution)) {
      messages.push({
        level: 'error',
        code: 'resolution.invalid',
        text: `解像度 ${normalizedOutput.resolution} はこのモデルにありません（${model.resolutions.join(' / ')}）`,
      });
    }
  }

  if (normalizedOutput.aspect !== null) {
    if (!Array.isArray(model.aspects) || model.aspects.length === 0) {
      messages.push({
        level: 'error',
        code: 'aspect.invalid',
        text: `アスペクト比 ${normalizedOutput.aspect} はこのモデルにありません（このモデルはアスペクト比を選べません）`,
      });
    } else if (!model.aspects.includes(normalizedOutput.aspect)) {
      messages.push({
        level: 'error',
        code: 'aspect.invalid',
        text: `アスペクト比 ${normalizedOutput.aspect} はこのモデルにありません（${model.aspects.join(' / ')}）`,
      });
    }
  }

  let rounded = null;
  if (!usedDefaultDuration) {
    const result = roundedDuration(requestedOutput.duration_s, model.duration);
    if (Math.abs(result.value - requestedOutput.duration_s) > EPSILON) {
      rounded = {
        duration_s: {
          from: requestedOutput.duration_s,
          to: result.value,
          reason: result.reason,
        },
      };
      normalizedOutput.duration_s = result.value;
      messages.push({
        level: 'warn',
        code: 'duration.rounded',
        text: durationMessage(model, requestedOutput.duration_s, result.value),
      });
    }
  }

  const unit = model.price?.by_resolution?.[normalizedOutput.resolution ?? ''];
  let cost;
  if (Number.isFinite(unit)) {
    const audioMultiplier = normalizedOutput.audio_out
      ? (model.price.audio_multiplier ?? 1)
      : 1;
    cost = {
      estimate_usd: Number((unit * normalizedOutput.duration_s * audioMultiplier).toFixed(4)),
      as_of: model.as_of ?? null,
      source: 'estimate',
    };
  } else {
    cost = { estimate_usd: null, needs_explicit_confirm: true };
    messages.push({
      level: 'warn',
      code: 'price.unknown',
      text: '見積不可（価格の記録がありません）。実行には明示の確認が必要です',
    });
  }

  return {
    ok: !messages.some((message) => message.level === 'error'),
    normalized: { inputs: normalizedInputs, output: normalizedOutput },
    rounded,
    messages,
    cost,
  };
}
