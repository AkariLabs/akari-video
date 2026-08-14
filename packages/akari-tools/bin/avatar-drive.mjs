#!/usr/bin/env node

import { mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { appendLayersAdditive } from "../src/eye-bar/edit-apply.mjs";
import { resolveFfmpeg, resolveFfprobe } from "../../media-bin/src/index.mjs";
import { extractRmsEnvelope, loadProjectTimeline } from "./avatar-drive/audio.mjs";
import { bakeAvatarClip } from "./avatar-drive/bake.mjs";
import { buildBlinkStates, deriveSeed } from "./avatar-drive/blink.mjs";
import {
  buildExpressionDrive, DEFAULT_HEAD_SMOOTHING, loadExpressionTrack,
} from "./avatar-drive/expression-track.mjs";
import { buildAvatarLayer } from "./avatar-drive/layer.mjs";
import { buildMotionFrames, MOTION_DEFAULTS } from "./avatar-drive/motion.mjs";
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
    mouthMode: "volume", transcript: null, expressionTrack: null,
    headSmoothing: DEFAULT_HEAD_SMOOTHING,
    motionIntensity: MOTION_DEFAULTS.intensity, noMotion: false, motionIntensitySpecified: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--apply") { options.apply = true; continue; }
    if (arg === "--check") { options.check = true; continue; }
    if (arg === "--no-motion") { options.noMotion = true; continue; }
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
    else if (arg === "--expression-track") options.expressionTrack = resolve(value);
    else if (arg === "--head-smoothing") options.headSmoothing = Number(value);
    else if (arg === "--motion-intensity") {
      options.motionIntensity = Number(value);
      options.motionIntensitySpecified = true;
    }
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
  if (!Number.isInteger(options.headSmoothing) || options.headSmoothing < 0) {
    throw new Error("--head-smoothing は 0 以上の整数である必要があります");
  }
  if (!Number.isFinite(options.motionIntensity) || options.motionIntensity < 0 || options.motionIntensity > 1) {
    throw new Error("--motion-intensity は 0 以上 1 以下である必要があります");
  }
  if (options.noMotion && options.motionIntensitySpecified) {
    throw new Error("--no-motion と --motion-intensity は同時に指定できません");
  }
  if (options.noMotion) options.motionIntensity = 0;
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
    let eyeStates;
    let driveExtras;
    let headStates = null;
    if (options.expressionTrack) {
      const expression = buildExpressionDrive({
        track: loadExpressionTrack(options.expressionTrack),
        timeline,
        frameCount: envelope.frameCount,
        headSmoothing: options.headSmoothing,
      });
      eyeStates = expression.eyes;
      headStates = expression.head;
      driveExtras = {
        fps: timeline.fps,
        head: expression.head,
        emotion: expression.emotion,
        blink_events: expression.blinkEvents,
      };
    } else {
      const blinkSeed = deriveSeed({ edit: timeline.edit, sprite: spriteSet.manifest, profile });
      const blink = buildBlinkStates({
        frameCount: envelope.frameCount,
        fps: timeline.fps,
        seed: blinkSeed,
        period: profile.blinkPeriod,
        jitter: profile.blinkJitter,
        duration: profile.blinkDuration,
      });
      eyeStates = blink.states;
      driveExtras = { blink_seed: blinkSeed, blink_events: blink.events };
    }
    const outPath = options.out ?? join(timeline.projectRoot, ".akari", "cache", "avatar-drive", "avatar-drive.mov");
    mkdirSync(join(timeline.projectRoot, ".akari", "cache", "avatar-drive"), { recursive: true });
    const motionSeed = deriveSeed({
      kind: "avatar-drive-motion-v1.1", edit: timeline.edit, sprite: spriteSet.manifest, profile,
    });
    const motionFrames = options.motionIntensity === 0 ? null : buildMotionFrames({
      mouthStates,
      fps: timeline.fps,
      intensity: options.motionIntensity,
      seed: motionSeed,
      width: spriteSet.manifest.size.width,
      height: spriteSet.manifest.size.height,
      headStates,
    });
    const baked = await bakeAvatarClip({
      spriteSet, mouthStates, eyeStates, fps: timeline.fps, outPath, motionFrames,
    }, { ffmpegCommand: available.ffmpeg });
    const bakedSprite = baked.margin === 0 ? spriteSet.manifest : {
      ...spriteSet.manifest,
      size: { width: baked.width, height: baked.height },
      anchor: {
        x: (baked.margin + spriteSet.manifest.anchor.x * spriteSet.manifest.size.width) / baked.width,
        y: (baked.margin + spriteSet.manifest.anchor.y * spriteSet.manifest.size.height) / baked.height,
      },
    };
    const layer = buildAvatarLayer({
      projectRoot: timeline.projectRoot,
      outPath,
      outputWidth: timeline.width,
      outputHeight: timeline.height,
      sprite: bakedSprite,
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
      drive: { mouth: mouthStates, eyes: eyeStates, ...driveExtras },
      stats: {
        frames: baked.frameCount,
        fps: timeline.fps,
        width: baked.width,
        height: baked.height,
        variants: baked.variants,
        mouth_counts: Object.fromEntries(mouthVocabulary.map((state) => [state, mouthStates.filter((value) => value === state).length])),
        blink_frames: eyeStates.filter((value) => value === "closed").length,
        ...(options.motionIntensity === 0 ? {} : {
          motion_intensity: options.motionIntensity,
          motion_seed: motionSeed,
          motion_margin: baked.margin,
        }),
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
