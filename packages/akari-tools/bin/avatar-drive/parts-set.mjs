import { existsSync, readFileSync, realpathSync } from "node:fs";
import { extname, isAbsolute, join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";

import { resolveFfprobe } from "../../../media-bin/src/index.mjs";

function record(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function finitePoint(value) {
  return record(value) && Number.isFinite(value.x) && Number.isFinite(value.y);
}

function inside(root, candidate) {
  const rel = relative(root, candidate);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function probePng(path, ffprobeCommand) {
  const result = spawnSync(ffprobeCommand, [
    "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height",
    "-of", "json", path,
  ], { encoding: "utf8" });
  if (result.error || result.status !== 0) {
    throw new Error(`PNG の寸法を取得できません: ${path}: ${String(result.stderr || result.error?.message).trim()}`);
  }
  const stream = JSON.parse(result.stdout)?.streams?.[0];
  if (!(Number.isInteger(stream?.width) && Number.isInteger(stream?.height))) {
    throw new Error(`PNG の寸法が不正です: ${path}`);
  }
  return { width: stream.width, height: stream.height };
}

function validateStates(states, label, errors) {
  if (states === "always") return;
  if (!record(states)) {
    errors.push(`${label}.states は "always" または object である必要があります`);
    return;
  }
  const known = new Set(["mouth", "eyes", "emotion"]);
  if (Object.keys(states).length === 0) errors.push(`${label}.states は空にできません`);
  for (const [drive, values] of Object.entries(states)) {
    if (!known.has(drive)) errors.push(`${label}.states.${drive} は未対応の駆動列です`);
    if (!Array.isArray(values) || values.length === 0
        || values.some((value) => typeof value !== "string" || value.trim() === "")) {
      errors.push(`${label}.states.${drive} は空でない文字列配列である必要があります`);
    }
  }
}

function validatePhysics(physics, label, errors) {
  if (physics === undefined) return;
  if (!record(physics)) {
    errors.push(`${label}.physics は object である必要があります`);
    return;
  }
  if (physics.wobble !== undefined) {
    if (!record(physics.wobble)) errors.push(`${label}.physics.wobble は object である必要があります`);
    else for (const axis of ["x", "y"]) {
      const wave = physics.wobble[axis];
      if (wave === undefined) continue;
      if (!record(wave) || !Number.isFinite(wave.amplitude) || !Number.isFinite(wave.frequency)
          || wave.frequency < 0 || (wave.phase !== undefined && !Number.isFinite(wave.phase))) {
        errors.push(`${label}.physics.wobble.${axis} は amplitude/frequency/phase の有限数を持つ必要があります`);
      }
    }
  }
  if (physics.follow !== undefined
      && (!record(physics.follow) || !Number.isFinite(physics.follow.drag) || physics.follow.drag < 1)) {
    errors.push(`${label}.physics.follow.drag は 1 以上の有限数である必要があります`);
  }
  if (physics.rotationalDrag !== undefined) {
    const value = physics.rotationalDrag;
    if (!record(value) || !Number.isFinite(value.strength)
        || (value.minDeg !== undefined && !Number.isFinite(value.minDeg))
        || (value.maxDeg !== undefined && !Number.isFinite(value.maxDeg))
        || (value.lerp !== undefined && (!Number.isFinite(value.lerp) || value.lerp <= 0 || value.lerp > 1))) {
      errors.push(`${label}.physics.rotationalDrag の strength/minDeg/maxDeg/lerp が不正です`);
    } else if ((value.minDeg ?? -180) > (value.maxDeg ?? 180)) {
      errors.push(`${label}.physics.rotationalDrag は minDeg <= maxDeg である必要があります`);
    }
  }
  if (physics.talkBounce !== undefined) {
    const value = physics.talkBounce;
    if (!record(value) || !Number.isFinite(value.velocity) || value.velocity < 0
        || !Number.isFinite(value.gravity) || value.gravity < 0) {
      errors.push(`${label}.physics.talkBounce の velocity/gravity は 0 以上の有限数である必要があります`);
    }
  }
}

export function validatePartsManifest(manifest) {
  const errors = [];
  if (!record(manifest)) return { ok: false, errors: ["parts.json のルートは object である必要があります"] };
  if (manifest.version !== 2) errors.push("version は整数 2 である必要があります");
  if (!record(manifest.size) || !Number.isInteger(manifest.size.width) || manifest.size.width < 2
      || !Number.isInteger(manifest.size.height) || manifest.size.height < 2) {
    errors.push("size.width / size.height は 2 以上の整数である必要があります");
  }
  if (!record(manifest.anchor) || !Number.isFinite(manifest.anchor.x) || !Number.isFinite(manifest.anchor.y)
      || manifest.anchor.x < 0 || manifest.anchor.x > 1 || manifest.anchor.y < 0 || manifest.anchor.y > 1) {
    errors.push("anchor.x / anchor.y は 0..1 の有限数である必要があります");
  }
  if (!Array.isArray(manifest.parts) || manifest.parts.length === 0) {
    errors.push("parts は空でない配列である必要があります");
    return { ok: false, errors };
  }

  const ids = new Set();
  for (const [index, part] of manifest.parts.entries()) {
    const label = `parts[${index}]`;
    if (!record(part)) { errors.push(`${label} は object である必要があります`); continue; }
    if (typeof part.id !== "string" || !/^[A-Za-z0-9_.-]+$/.test(part.id)) errors.push(`${label}.id が不正です`);
    else if (ids.has(part.id)) errors.push(`${label}.id ${part.id} が重複しています`);
    else ids.add(part.id);
    if (typeof part.image !== "string" || part.image.trim() === "") errors.push(`${label}.image は空でない文字列です`);
    if (!(part.parent === null || typeof part.parent === "string")) errors.push(`${label}.parent は null または id 文字列です`);
    if (!finitePoint(part.offset)) errors.push(`${label}.offset.x/y は有限数である必要があります`);
    if (!finitePoint(part.origin)) errors.push(`${label}.origin.x/y は有限数である必要があります`);
    if (!Number.isFinite(part.z)) errors.push(`${label}.z は有限数である必要があります`);
    validateStates(part.states, label, errors);
    validatePhysics(part.physics, label, errors);
  }

  const byId = new Map(manifest.parts.filter(record).map((part) => [part.id, part]));
  for (const part of manifest.parts.filter(record)) {
    if (typeof part.parent === "string" && !byId.has(part.parent)) errors.push(`part ${part.id} の parent ${part.parent} が存在しません`);
    if (part.parent === part.id) errors.push(`part ${part.id} は自分自身を parent にできません`);
    const seen = new Set([part.id]);
    let cursor = part;
    while (typeof cursor?.parent === "string") {
      if (seen.has(cursor.parent)) { errors.push(`part ${part.id} の parent 連鎖が循環しています`); break; }
      seen.add(cursor.parent);
      cursor = byId.get(cursor.parent);
    }
  }
  if (!manifest.parts.some((part) => record(part) && part.parent === null)) errors.push("parent:null のルート part が必要です");
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

function topologicalParts(parts) {
  const pending = new Map(parts.map((part, index) => [part.id, { ...part, declarationIndex: index }]));
  const ordered = [];
  while (pending.size > 0) {
    let advanced = false;
    for (const [id, part] of pending) {
      if (part.parent === null || ordered.some((candidate) => candidate.id === part.parent)) {
        ordered.push(part);
        pending.delete(id);
        advanced = true;
      }
    }
    if (!advanced) throw new Error("parts.json の parent 連鎖を解決できません");
  }
  return ordered;
}

export function loadPartsSet(partsDir, { ffprobeCommand } = {}) {
  const root = realpathSync(resolve(partsDir));
  const manifestPath = join(root, "parts.json");
  if (!existsSync(manifestPath)) throw new Error(`parts.json が見つかりません: ${manifestPath}`);
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const structural = validatePartsManifest(manifest);
  if (!structural.ok) throw new Error(structural.errors.join("; "));
  const command = ffprobeCommand ?? resolveFfprobe();
  const assets = {};
  for (const part of manifest.parts) {
    const ref = part.image;
    if (isAbsolute(ref)) throw new Error(`part ${part.id}.image はディレクトリ相対パスである必要があります`);
    const candidate = resolve(root, ref);
    if (!existsSync(candidate)) throw new Error(`part ${part.id} の PNG が見つかりません: ${ref}`);
    const resolved = realpathSync(candidate);
    if (!inside(root, resolved)) throw new Error(`part ${part.id} がパーツディレクトリ外を参照しています: ${ref}`);
    if (extname(resolved).toLowerCase() !== ".png") throw new Error(`part ${part.id} は PNG を参照する必要があります: ${ref}`);
    assets[part.id] = { path: resolved, ...probePng(resolved, command) };
  }
  return { root, manifest, assets, parts: topologicalParts(manifest.parts), kind: "parts-v2" };
}

export function requirePartsVowelAssets(partsSet) {
  const values = new Set();
  for (const part of partsSet.parts) {
    if (part.states !== "always") for (const value of part.states.mouth ?? []) values.add(value);
  }
  const missing = ["closed", "a", "i", "u", "e", "o"].filter((value) => !values.has(value));
  if (missing.length > 0) throw new Error(`vowel モードには parts.json の states.mouth に closed/a/i/u/e/o が必要です（不足: ${missing.join(", ")}）`);
  return partsSet;
}
