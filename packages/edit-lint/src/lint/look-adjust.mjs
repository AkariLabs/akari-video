import { addFinding, isFiniteNumber, isNonEmptyString, isRecord } from "./shared.mjs";

// docs/contract-2026-07-22-render-basics.md #4/#2。output.look / source.chroma_key の構造検証は
// validate-edit.mjs の validateLook/validateChromaKey と同じ手書きの流儀（edit-lint は依存ゼロの
// ため他パッケージの検証ロジックを import しない）。
export function validateLook(value, findings, path) {
  if (value === undefined || value === null) return;
  if (!isRecord(value)) {
    addFinding(findings, { severity: "error", check: "output.look.structure", message: "look must be an object", path });
    return;
  }
  if (!isNonEmptyString(value.lut)) {
    addFinding(findings, { severity: "error", check: "output.look.lut", message: "lut must be a non-empty string", path });
  }
  if (
    Object.hasOwn(value, "intensity") &&
    (!isFiniteNumber(value.intensity) || value.intensity < 0 || value.intensity > 1)
  ) {
    addFinding(findings, { severity: "error", check: "output.look.intensity", message: "intensity must be a finite number within [0, 1]", path });
  }
}

// docs/contract-2026-09-03-clip-adjust-v0.md。edit-lint は依存ゼロを保つため、schema と
// validate-edit.mjs の閉じた adjust 語彙をここでも独立に検証する。
export function validateAdjust(value, findings, path) {
  validateAdjustV1Sections(value, findings, path);
  if (!isRecord(value)) {
    addFinding(findings, {
      severity: "error", check: "adjust.structure", message: "adjust must be an object", path,
    });
    return;
  }
  const reportUnknownKeys = (record, allowed, ownerPath) => {
    for (const key of Object.keys(record)) {
      if (allowed.has(key)) continue;
      addFinding(findings, {
        severity: "error",
        check: "adjust.unknown-key",
        message: `${key} is not defined by clip adjust v1`,
        path: `${ownerPath}.${key}`,
      });
    }
  };
  reportUnknownKeys(value, new Set(["basic", "lut", "sections", "curves", "wheels", "hue", "fx"]), path);

  if (Object.hasOwn(value, "basic")) {
    const basicPath = `${path}.basic`;
    if (!isRecord(value.basic)) {
      addFinding(findings, {
        severity: "error", check: "adjust.basic.structure", message: "basic must be an object", path: basicPath,
      });
    } else {
      const basicKeys = new Set([
        "exposure", "contrast", "highlights", "shadows", "blacks", "whites",
        "temperature", "tint", "vibrance", "saturation",
      ]);
      reportUnknownKeys(value.basic, basicKeys, basicPath);
      for (const key of basicKeys) {
        if (!Object.hasOwn(value.basic, key)) continue;
        const minimum = key === "exposure" ? -3 : -1;
        const maximum = key === "exposure" ? 3 : 1;
        if (!isFiniteNumber(value.basic[key]) || value.basic[key] < minimum || value.basic[key] > maximum) {
          addFinding(findings, {
            severity: "error",
            check: `adjust.basic.${key}`,
            message: `${key} must be a finite number within [${minimum}, ${maximum}]`,
            path: `${basicPath}.${key}`,
          });
        }
      }
    }
  }

  if (Object.hasOwn(value, "lut") && value.lut !== null) {
    const lutPath = `${path}.lut`;
    if (!isRecord(value.lut)) {
      addFinding(findings, {
        severity: "error", check: "adjust.lut.structure", message: "lut must be null or an object", path: lutPath,
      });
    } else {
      reportUnknownKeys(value.lut, new Set(["lut", "intensity"]), lutPath);
      if (!isNonEmptyString(value.lut.lut)) {
        addFinding(findings, {
          severity: "error", check: "adjust.lut.lut", message: "lut must be a non-empty string", path: `${lutPath}.lut`,
        });
      }
      if (Object.hasOwn(value.lut, "intensity")
        && (!isFiniteNumber(value.lut.intensity) || value.lut.intensity < 0 || value.lut.intensity > 1)) {
        addFinding(findings, {
          severity: "error",
          check: "adjust.lut.intensity",
          message: "intensity must be a finite number within [0, 1]",
          path: `${lutPath}.intensity`,
        });
      }
    }
  }

  if (Object.hasOwn(value, "sections")) {
    const sectionsPath = `${path}.sections`;
    if (!isRecord(value.sections)) {
      addFinding(findings, {
        severity: "error", check: "adjust.sections.structure", message: "sections must be an object", path: sectionsPath,
      });
    } else {
      const sectionKeys = new Set(["basic", "lut", "curves", "wheels", "hue", "fx"]);
      reportUnknownKeys(value.sections, sectionKeys, sectionsPath);
      for (const key of sectionKeys) {
        if (Object.hasOwn(value.sections, key) && typeof value.sections[key] !== "boolean") {
          addFinding(findings, {
            severity: "error",
            check: `adjust.sections.${key}`,
            message: `${key} must be a boolean`,
            path: `${sectionsPath}.${key}`,
          });
        }
      }
    }
  }
}

export function validateChromaKey(value, findings, path) {
  if (value === undefined || value === null) return;
  if (!isRecord(value)) {
    addFinding(findings, { severity: "error", check: "chroma-key.structure", message: "chroma_key must be an object", path });
    return;
  }
  if (!isNonEmptyString(value.color)) {
    addFinding(findings, { severity: "error", check: "chroma-key.color", message: "color must be a non-empty string", path });
  }
  for (const field of ["similarity", "blend"]) {
    if (
      Object.hasOwn(value, field) &&
      (!isFiniteNumber(value[field]) || value[field] < 0 || value[field] > 1)
    ) {
      addFinding(findings, { severity: "error", check: `chroma-key.${field}`, message: `${field} must be a finite number within [0, 1]`, path });
    }
  }
  if (Object.hasOwn(value, "background") && !isNonEmptyString(value.background)) {
    addFinding(findings, { severity: "error", check: "chroma-key.background", message: "background must be a non-empty string", path });
  }
}

// Intentional dependency-free duplicate of the closed adjustV1 structure.
function validateAdjustV1Sections(value, findings, path) {
  if (!isRecord(value)) return;
  const report = (section, check, at, message) => addFinding(findings, { severity: "error", check: "adjust." + section + "." + check, path: at, message });
  const object = (v, keys, section, at) => {
    if (!isRecord(v)) { report(section, 'structure', at, 'は object である必要があります'); return false; }
    for (const key of Object.keys(v)) if (!keys.includes(key)) report(section, 'unknown-key', at + '.' + key, 'は未知のキーです');
    return true;
  };
  const number = (v, min, max, section, at) => {
    if (!isFiniteNumber(v) || v < min || v > max) report(section, 'range', at, 'は ' + min + ' から ' + max + ' の範囲の有限数である必要があります');
  };
  if (Object.hasOwn(value, 'fx')) {
    const at = path + '.fx';
    if (!Array.isArray(value.fx)) {
      report('fx', 'structure', at, 'must be an array');
    } else {
      if (value.fx.length > 8) report('fx', 'max-items', at, 'must contain at most 8 effects');
      const ranges = {
        vignette: { amount: [-1, 1], midpoint: [0, 1], roundness: [-1, 1], feather: [0, 1] },
        blur: { px: [0, 50] },
        grain: { amount: [0, 1], size: [0.5, 4] },
        sharpen: { amount: [0, 1] },
        glow: { intensity: [0, 1], radius: [0, 100], threshold: [0, 1], warmth: [-1, 1] },
        clarity: { amount: [-1, 1], radius: [1, 50] },
        dehaze: { amount: [-1, 1] },
        denoise: { amount: [0, 1] },
        motion_blur: { px: [0, 100], angle: [-180, 180] },
      };
      const seen = new Set();
      for (const [index, fx] of value.fx.entries()) {
        const fxPath = at + '[' + index + ']';
        if (!isRecord(fx)) { report('fx', 'structure', fxPath, 'must be an object'); continue; }
        if (typeof fx.id !== 'string' || !Object.hasOwn(ranges, fx.id)) {
          report('fx', 'id', fxPath + '.id', 'unknown effect id'); continue;
        }
        if (seen.has(fx.id)) report('fx', 'duplicate-id', fxPath + '.id', 'duplicate effect id: ' + fx.id);
        seen.add(fx.id);
        const params = ranges[fx.id];
        for (const key of Object.keys(fx)) {
          if (key !== 'id' && !Object.hasOwn(params, key)) addFinding(findings, { severity: 'error', check: 'adjust.unknown-key', path: fxPath + '.' + key, message: key + ' is not defined for ' + fx.id });
        }
        for (const [key, [min, max]] of Object.entries(params)) {
          if (Object.hasOwn(fx, key)) number(fx[key], min, max, 'fx', fxPath + '.' + key);
        }
      }
    }
  }
  for (const section of ['curves', 'hue']) {
    if (!Object.hasOwn(value, section)) continue;
    const channels = value[section], at = path + '.' + section;
    const axis = section === 'curves' ? 'in' : 'hue';
    const output = section === 'curves' ? 'out' : 'value';
    const minimum = section === 'curves' ? 2 : 1;
    const keys = section === 'curves' ? ['master', 'r', 'g', 'b'] : ['hue', 'sat', 'luma'];
    if (!object(channels, keys, section, at)) continue;
    for (const channel of keys) {
      if (!Object.hasOwn(channels, channel)) continue;
      const points = channels[channel], channelPath = at + '.' + channel;
      if (!Array.isArray(points) || points.length < minimum || points.length > 16) {
        report(section, 'points', channelPath, 'は ' + minimum + ' から 16 点の配列である必要があります'); continue;
      }
      let previous = -Infinity;
      for (const [index, point] of points.entries()) {
        const pointPath = channelPath + '[' + index + ']';
        if (!object(point, [axis, output], section, pointPath)) continue;
        number(point[axis], 0, 1, section, pointPath + '.' + axis);
        number(point[output], 0, 1, section, pointPath + '.' + output);
        if (isFiniteNumber(point[axis])) {
          if (point[axis] <= previous) report(section, 'order', pointPath + '.' + axis, 'は狭義単調増加である必要があります');
          previous = point[axis];
        }
      }
    }
  }
  if (Object.hasOwn(value, 'wheels')) {
    const ranges = { lift: 0.25, gamma: 0.5, gain: 0.5, offset: 0.1 };
    if (!object(value.wheels, Object.keys(ranges), 'wheels', path + '.wheels')) return;
    for (const [wheel, range] of Object.entries(ranges)) {
      if (!Object.hasOwn(value.wheels, wheel)) continue;
      const channels = value.wheels[wheel], at = path + '.wheels.' + wheel;
      if (!object(channels, ['r', 'g', 'b'], 'wheels', at)) continue;
      for (const channel of ['r', 'g', 'b']) if (Object.hasOwn(channels, channel)) number(channels[channel], -range, range, 'wheels', at + '.' + channel);
    }
  }
}
