export function hasCutVisualTransform(cuts) {
  return Array.isArray(cuts) && cuts.some((cut) =>
    cut && typeof cut === "object"
    && (Object.prototype.hasOwnProperty.call(cut, "transform")
      || Object.prototype.hasOwnProperty.call(cut, "opacity")),
  );
}

export function appendCutVisualTransform({
  filters,
  inputLabel,
  outputLabel,
  cut,
  id,
  width,
  height,
  fps,
  duration,
}) {
  const transform = cut?.transform ?? {};
  const x = finiteOr(transform.x, 0);
  const y = finiteOr(transform.y, 0);
  const scale = positiveOr(transform.scale, 1);
  const rotate = finiteOr(transform.rotate, 0);
  const opacity = boundedOr(cut?.opacity, 1, 0, 1);
  const fitted = `[ct_${id}_fit]`;
  const prepared = `[ct_${id}_prepared]`;
  const background = `[ct_${id}_background]`;
  const steps = [
    `scale=${width}:${height}:force_original_aspect_ratio=decrease`,
    `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2`,
    `fps=${formatNumber(fps)}`,
    "setsar=1",
    "format=yuva420p",
  ];
  filters.push(`${inputLabel}${steps.join(",")}${fitted}`);

  const transformSteps = [];
  if (scale !== 1) {
    transformSteps.push(
      `scale=max(2\\,trunc(iw*${formatNumber(scale)}/2)*2):max(2\\,trunc(ih*${formatNumber(scale)}/2)*2)`,
    );
  }
  if (rotate !== 0) {
    const radians = `(${formatNumber(rotate)}*PI/180)`;
    transformSteps.push(
      `rotate=${radians}:fillcolor=black@0:ow=rotw(${radians}):oh=roth(${radians})`,
    );
  }
  if (opacity !== 1) {
    transformSteps.push(`colorchannelmixer=aa=${formatNumber(opacity)}`);
  }
  filters.push(`${fitted}${transformSteps.length > 0 ? transformSteps.join(",") : "null"}${prepared}`);
  filters.push(
    `color=c=black:s=${width}x${height}:r=${formatNumber(fps)}:d=${formatNumber(duration)}${background}`,
  );
  filters.push(
    `${background}${prepared}overlay=x=(main_w-overlay_w)/2+${formatNumber(x)}`
      + `:y=(main_h-overlay_h)/2+${formatNumber(y)}:format=auto:shortest=1${outputLabel}`,
  );
}

function finiteOr(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function positiveOr(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

function boundedOr(value, fallback, minimum, maximum) {
  return typeof value === "number" && Number.isFinite(value)
    && value >= minimum && value <= maximum ? value : fallback;
}

function formatNumber(value) {
  return Number(Number(value).toFixed(6)).toString();
}
