import { existsSync, readFileSync, realpathSync } from "node:fs";
import { extname, isAbsolute, join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";

import { resolveFfprobe } from "../../../media-bin/src/index.mjs";

function record(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
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

export function validateSpriteManifest(manifest) {
  const errors = [];
  if (!record(manifest)) return { ok: false, errors: ["sprite.json のルートは object である必要があります"] };
  if (manifest.version !== 0) errors.push("version は整数 0 である必要があります");
  if (!record(manifest.size) || !Number.isInteger(manifest.size.width) || manifest.size.width < 2
      || !Number.isInteger(manifest.size.height) || manifest.size.height < 2) {
    errors.push("size.width / size.height は 2 以上の整数である必要があります");
  }
  if (!record(manifest.anchor) || !Number.isFinite(manifest.anchor.x) || !Number.isFinite(manifest.anchor.y)
      || manifest.anchor.x < 0 || manifest.anchor.x > 1 || manifest.anchor.y < 0 || manifest.anchor.y > 1) {
    errors.push("anchor.x / anchor.y は 0..1 の有限数である必要があります");
  }
  if (typeof manifest.base !== "string" || manifest.base.trim() === "") errors.push("base は空でない文字列です");
  for (const [groupName, keys] of [["mouth", ["closed", "mid", "open"]], ["eyes", ["open", "closed"]]]) {
    const group = manifest[groupName];
    if (!record(group)) {
      errors.push(`${groupName} は object である必要があります`);
      continue;
    }
    for (const key of keys) {
      if (typeof group[key] !== "string" || group[key].trim() === "") {
        errors.push(`${groupName}.${key} は空でない文字列です`);
      }
    }
    for (const [key, value] of Object.entries(group)) {
      if (typeof value !== "string" || value.trim() === "") errors.push(`${groupName}.${key} は空でない文字列です`);
    }
  }
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

export function loadSpriteSet(spriteDir, { ffprobeCommand } = {}) {
  const root = realpathSync(resolve(spriteDir));
  const manifestPath = join(root, "sprite.json");
  if (!existsSync(manifestPath)) throw new Error(`sprite.json が見つかりません: ${manifestPath}`);
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const structural = validateSpriteManifest(manifest);
  if (!structural.ok) throw new Error(structural.errors.join("; "));
  const refs = new Map([["base", manifest.base]]);
  for (const [key, value] of Object.entries(manifest.mouth)) refs.set(`mouth.${key}`, value);
  for (const [key, value] of Object.entries(manifest.eyes)) refs.set(`eyes.${key}`, value);
  const command = ffprobeCommand ?? resolveFfprobe();
  const assets = {};
  for (const [name, ref] of refs) {
    if (isAbsolute(ref)) throw new Error(`${name} はディレクトリ相対パスである必要があります`);
    const candidate = resolve(root, ref);
    if (!existsSync(candidate)) throw new Error(`${name} の PNG が見つかりません: ${ref}`);
    const resolved = realpathSync(candidate);
    if (!inside(root, resolved)) throw new Error(`${name} がスプライトディレクトリ外を参照しています: ${ref}`);
    if (extname(resolved).toLowerCase() !== ".png") throw new Error(`${name} は PNG を参照する必要があります: ${ref}`);
    const dimensions = probePng(resolved, command);
    if (dimensions.width !== manifest.size.width || dimensions.height !== manifest.size.height) {
      throw new Error(`${name} の寸法 ${dimensions.width}x${dimensions.height} が size `
        + `${manifest.size.width}x${manifest.size.height} と一致しません`);
    }
    assets[name] = resolved;
  }
  return { root, manifest, assets };
}

