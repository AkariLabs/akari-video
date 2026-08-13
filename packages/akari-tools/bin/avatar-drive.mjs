#!/usr/bin/env node

import { mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { appendLayersAdditive } from "../src/eye-bar/edit-apply.mjs";
import { resolveFfmpeg, resolveFfprobe } from "../../media-bin/src/index.mjs";
import { extractRmsEnvelope, loadProjectTimeline } from "./avatar-drive/audio.mjs";
import { bakeAvatarClip } from "./avatar-drive/bake.mjs";
import { buildBlinkStates, deriveSeed } from "./avatar-drive/blink.mjs";
import { buildAvatarLayer } from "./avatar-drive/layer.mjs";
import { envelopeToMouthStates, normalizeProfile } from "./avatar-drive/profile.mjs";
import { loadSpriteSet, requireVowelMouthAssets } from "./avatar-drive/sprite-set.mjs";
import { buildVowelTimeline, parseTranscript, resolveMouthStates } from "./avatar-drive/vowel.mjs";

function printJson(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function summary(value, fallback) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text ? text.slice(0, 4000) : fallback;
}

function parseArguments(argv) {
  const options = {
    project: null, sprites: null, apply: false, check: false, out: null,
    position: "right-bottom", scale: 1, margin: 48, layerId: "avatar-drive-0", profile: {},
    mouthMode: "volume", transcript: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--apply") { options.apply = true; continue; }
    if (arg === "--check") { options.check = true; continue; }
    if (!arg.startsWith("--") && options.project === null) { options.project = resolve(arg); continue; }
    const value = argv[++index];
    if (value === undefined || value.startsWith("--")) throw new Error(`${arg} の値がありません`);
    if (arg === "--project") options.project = resolve(value);
    else if (arg === "--sprites") options.sprites = resolve(value);
    else if (arg === "--out") options.out = resolve(value);
    else if (arg === "--position") options.position = value;
    else if (arg === "--scale") options.scale = Number(value);
    else if (arg === "--margin") options.margin = Number(value);
    else if (arg === "--layer-id") options.layerId = value;
    else if (arg === "--mouth-mode") options.mouthMode = value;
    else if (arg === "--transcript") options.transcript = resolve(value);
    else if (arg === "--mid-threshold") options.profile.midThreshold = Number(value);
    else if (arg === "--open-threshold") options.profile.openThreshold = Number(value);
    else if (arg === "--hysteresis") options.profile.hysteresis = Number(value);
    else if (arg === "--attack-ms") options.profile.attackMs = Number(value);
    else if (arg === "--release-ms") options.profile.releaseMs = Number(value);
    else if (arg === "--blink-period") options.profile.blinkPeriod = Number(value);
    else if (arg === "--blink-jitter") options.profile.blinkJitter = Number(value);
    else if (arg === "--blink-duration") options.profile.blinkDuration = Number(value);
    else throw new Error(`不明な引数です: ${arg}`);
  }
  if (!(options.scale > 0)) throw new Error("--scale は正数である必要があります");
  if (!(options.margin >= 0)) throw new Error("--margin は 0 以上である必要があります");
  if (!["volume", "vowel"].includes(options.mouthMode)) throw new Error("--mouth-mode は volume または vowel である必要があります");
  if (!/^[-A-Za-z0-9_.]+$/.test(options.layerId)) throw new Error("--layer-id に使用できない文字があります");
  return options;
}

function availability() {
  const result = { available: true };
  try { result.ffmpeg = resolveFfmpeg(); } catch (error) { return { available: false, reason: summary(error.message, "ffmpeg not found") }; }
  try { result.ffprobe = resolveFfprobe(); } catch (error) { return { available: false, reason: summary(error.message, "ffprobe not found") }; }
  return result;
}

async function main() {
  let options;
  try { options = parseArguments(process.argv.slice(2)); }
  catch (error) { printJson({ ok: false, reason: summary(error.message, "引数が不正です") }); process.exitCode = 2; return; }
  if (options.check) { printJson(availability()); return; }
  if (!options.project || !options.sprites) {
    printJson({ ok: false, reason: "project と --sprites <dir> が必要です" });
    process.exitCode = 2;
    return;
  }
  if (options.mouthMode === "vowel" && !options.transcript) {
    printJson({ ok: false, reason: "--mouth-mode vowel には --transcript <path> が必要です" });
    process.exitCode = 1;
    return;
  }
  const available = availability();
  if (!available.available) { printJson({ ok: false, reason: available.reason }); process.exitCode = 1; return; }

  try {
    const profile = normalizeProfile(options.profile);
    const timeline = loadProjectTimeline(options.project, { ffprobeCommand: available.ffprobe });
    const spriteSet = loadSpriteSet(options.sprites, { ffprobeCommand: available.ffprobe });
    const envelope = extractRmsEnvelope(timeline, profile.sampleRate, { ffmpegCommand: available.ffmpeg });
    const mouth = envelopeToMouthStates(envelope.rms, timeline.fps, profile);
    let mouthStates = mouth.states;
    let mouthVocabulary = ["closed", "mid", "open"];
    if (options.mouthMode === "vowel") {
      requireVowelMouthAssets(spriteSet);
      const transcript = JSON.parse(readFileSync(options.transcript, "utf8"));
      const words = parseTranscript(transcript);
      const vowelTimeline = buildVowelTimeline({ words, frameCount: envelope.frameCount, fps: timeline.fps });
      mouthStates = resolveMouthStates({ vowelTimeline, volumeStates: mouth.states });
      mouthVocabulary = ["closed", "a", "i", "u", "e", "o"];
    }
    const blinkSeed = deriveSeed({ edit: timeline.edit, sprite: spriteSet.manifest, profile });
    const blink = buildBlinkStates({
      frameCount: envelope.frameCount,
      fps: timeline.fps,
      seed: blinkSeed,
      period: profile.blinkPeriod,
      jitter: profile.blinkJitter,
      duration: profile.blinkDuration,
    });
    const outPath = options.out ?? join(timeline.projectRoot, ".akari", "cache", "avatar-drive", "avatar-drive.mov");
    mkdirSync(join(timeline.projectRoot, ".akari", "cache", "avatar-drive"), { recursive: true });
    const baked = await bakeAvatarClip({
      spriteSet, mouthStates, eyeStates: blink.states, fps: timeline.fps, outPath,
    }, { ffmpegCommand: available.ffmpeg });
    const layer = buildAvatarLayer({
      projectRoot: timeline.projectRoot,
      outPath,
      outputWidth: timeline.width,
      outputHeight: timeline.height,
      sprite: spriteSet.manifest,
      duration: envelope.frameCount / timeline.fps,
      position: options.position,
      scale: options.scale,
      margin: options.margin,
      id: options.layerId,
      profile,
    });
    const output = {
      ok: true,
      layers: [layer],
      drive: { mouth: mouthStates, eyes: blink.states, blink_seed: blinkSeed, blink_events: blink.events },
      stats: {
        frames: baked.frameCount,
        fps: timeline.fps,
        width: baked.width,
        height: baked.height,
        variants: baked.variants,
        mouth_counts: Object.fromEntries(mouthVocabulary.map((state) => [state, mouthStates.filter((value) => value === state).length])),
        blink_frames: blink.states.filter((value) => value === "closed").length,
      },
    };
    if (options.apply) {
      const applied = appendLayersAdditive(timeline.editPath, [layer]);
      if (!applied.ok) throw new Error(applied.reason);
      output.applied = { addedIds: applied.addedIds };
    }
    printJson(output);
  } catch (error) {
    printJson({ ok: false, reason: summary(error.message, "avatar-drive 生成に失敗しました") });
    process.exitCode = 1;
  }
}

await main();
