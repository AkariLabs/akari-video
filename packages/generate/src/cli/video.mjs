import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin as processInput, stdout as processOutput } from "node:process";

import { openProject } from "../../../edit-store/lib/project.js";
import { snapshot } from "../../../edit-store/lib/history-store.js";
import { resolveFfprobe } from "../../../media-bin/src/index.mjs";

import { validateInputs } from "../validate-inputs.mjs";
import { resolveSendSide } from "../send-side.mjs";
import { getAdapter } from "../adapters/index.mjs";
import { loadCatalog, findModel } from "./catalog.mjs";
import { resolveFalKey } from "./credentials.mjs";
import { submit, pollStatus, fetchResponse, download } from "./fal-queue.mjs";
import { createMediaResolver, makeReference } from "./media-ref.mjs";
import { writeGenerating, writeDone, writeFailed } from "./meta-video.mjs";
import { applyReplacement, findItem, planReplacement } from "./edit-replace.mjs";

export const usage = [
  "使い方: akari generate video <projectDir> --item <itemId> [options]",
  "  --model <id> --prompt <text> --negative-prompt <text>",
  "  --first-frame <path> --last-frame <path> --reference-image <path>",
  "  --reference-audio <path> --camera <text> --duration <s> --resolution <res>",
  "  --aspect <a> --audio-out true|false --seed <n> --extra k=v --inputs <json>",
  "  --stale-after <s> --dry-run --yes --json --help",
  "  --inputs 未指定時は素材 meta の next を使用。--model 等の個別指定は下書きより優先",
].join("\n");

class CliError extends Error {
  constructor(message, exitCode = 2) {
    super(message);
    this.exitCode = exitCode;
  }
}

const VALUES = new Set([
  "--item", "--model", "--prompt", "--negative-prompt", "--first-frame", "--last-frame",
  "--reference-image", "--reference-audio", "--camera", "--duration", "--resolution",
  "--aspect", "--audio-out", "--seed", "--extra", "--inputs", "--stale-after",
]);
const FLAGS = new Set(["--dry-run", "--yes", "--json", "--help", "-h"]);

function parseBoolean(value, option) {
  if (value === "true") return true;
  if (value === "false") return false;
  throw new CliError(`${option} は true または false で指定してください`);
}

function parseScalar(value) {
  try { return JSON.parse(value); } catch { return value; }
}

export function parseVideoArguments(argv) {
  const options = {
    projectDir: null, itemId: null, modelId: null, inputJson: null, prompt: undefined,
    negativePrompt: undefined, firstFrame: undefined, lastFrame: undefined,
    referenceImages: [], referenceAudios: [], camera: undefined, duration: undefined,
    resolution: undefined, aspect: undefined, audioOut: undefined, seed: undefined,
    extra: {}, staleAfterS: 900, dryRun: false, yes: false, json: false, help: false,
  };
  let index = 0;
  if (argv[0] && !argv[0].startsWith("-")) {
    options.projectDir = path.resolve(argv[0]);
    index = 1;
  }
  for (; index < argv.length; index += 1) {
    const argument = argv[index];
    if (VALUES.has(argument)) {
      const value = argv[++index];
      if (value === undefined || VALUES.has(value) || FLAGS.has(value)) throw new CliError(`${argument} の値がありません`);
      switch (argument) {
        case "--item": options.itemId = value; break;
        case "--model": options.modelId = value; break;
        case "--prompt": options.prompt = value; break;
        case "--negative-prompt": options.negativePrompt = value; break;
        case "--first-frame": options.firstFrame = value; break;
        case "--last-frame": options.lastFrame = value; break;
        case "--reference-image": options.referenceImages.push(value); break;
        case "--reference-audio": options.referenceAudios.push(value); break;
        case "--camera": options.camera = value; break;
        case "--duration": options.duration = Number(value); break;
        case "--resolution": options.resolution = value; break;
        case "--aspect": options.aspect = value; break;
        case "--audio-out": options.audioOut = parseBoolean(value, argument); break;
        case "--seed": options.seed = Number(value); break;
        case "--extra": {
          const separator = value.indexOf("=");
          if (separator < 1) throw new CliError("--extra は k=v で指定してください");
          options.extra[value.slice(0, separator)] = parseScalar(value.slice(separator + 1));
          break;
        }
        case "--inputs": options.inputJson = value; break;
        case "--stale-after": options.staleAfterS = Number(value); break;
        default: break;
      }
    } else if (argument === "--dry-run") options.dryRun = true;
    else if (argument === "--yes") options.yes = true;
    else if (argument === "--json") options.json = true;
    else if (argument === "--help" || argument === "-h") options.help = true;
    else throw new CliError(`不明な引数です: ${argument}\n${usage}`);
  }
  if (!options.help && !options.projectDir) throw new CliError(`projectDir が必要です\n${usage}`);
  if (!options.help && !options.itemId) throw new CliError("--item が必要です");
  if (options.duration !== undefined && (!Number.isFinite(options.duration) || options.duration <= 0)) {
    throw new CliError("--duration は 0 より大きい有限数で指定してください");
  }
  if (options.seed !== undefined && !Number.isInteger(options.seed)) throw new CliError("--seed は整数で指定してください");
  if (!Number.isFinite(options.staleAfterS) || options.staleAfterS < 0) throw new CliError("--stale-after は 0 以上で指定してください");
  return options;
}

function readInputJson(projectDir, value) {
  if (value === null) return {};
  let text = value;
  const candidate = path.isAbsolute(value) ? value : path.join(projectDir, value);
  if (!value.trim().startsWith("{") && existsSync(candidate)) text = readFileSync(candidate, "utf8");
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    return parsed;
  } catch { throw new CliError("--inputs は JSON object または JSON ファイルで指定してください"); }
}

function findSource(edit, sourceId) {
  return edit.sources?.find((source) => source.id === sourceId) ?? null;
}

const STILL_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".tif", ".tiff"]);

function modelDefault(projectDir) {
  try {
    const value = JSON.parse(readFileSync(path.join(projectDir, ".akari", "connections.json"), "utf8"));
    return value?.defaults?.generate?.video ?? "fal:h3-i2v";
  } catch { return "fal:h3-i2v"; }
}

function hydrateReference(projectDir, value, defaults = {}) {
  if (value == null) return null;
  const raw = typeof value === "string" ? { path: value } : value;
  if (!raw || typeof raw.path !== "string") throw new CliError("参照には path が必要です");
  return makeReference(projectDir, raw.path, {
    source_id: raw.source_id ?? defaults.source_id ?? null,
    name: raw.name ?? null,
    role: raw.role ?? null,
    range_s: raw.range_s ?? null,
  });
}

function hydrateList(projectDir, values) {
  return (values ?? []).map((value) => hydrateReference(projectDir, value));
}

function stripReferenceNulls(reference) {
  if (!reference) return reference;
  return Object.fromEntries(Object.entries(reference).filter(([, value]) => value !== null));
}

function schemaInputs(inputs) {
  return {
    ...inputs,
    prompt: typeof inputs.prompt === "string" ? inputs.prompt : "",
    first_frame: stripReferenceNulls(inputs.first_frame),
    last_frame: stripReferenceNulls(inputs.last_frame),
    reference_images: inputs.reference_images.map(stripReferenceNulls),
    reference_videos: inputs.reference_videos.map(stripReferenceNulls),
    reference_audios: inputs.reference_audios.map(stripReferenceNulls),
    source_video: stripReferenceNulls(inputs.source_video),
    camera: inputs.camera ? Object.fromEntries(Object.entries(inputs.camera).filter(([, value]) => value !== null)) : null,
  };
}

function summarizeData(value) {
  if (typeof value === "string" && value.startsWith("data:")) {
    const comma = value.indexOf(",");
    const heading = value.slice(0, comma).replace(";base64", ";base64 …");
    const bytes = Math.floor((value.length - comma - 1) * 3 / 4);
    return `<${heading} ${bytes} bytes>`;
  }
  if (Array.isArray(value)) return value.map(summarizeData);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, summarizeData(child)]));
  return value;
}

function estimateLabel(cost, model) {
  return cost.estimate_usd === null
    ? "見積不可（価格の記録がありません）"
    : `見積 $${cost.estimate_usd}・as_of ${cost.as_of ?? model.as_of}`;
}

async function askApproval({ input, output, label }) {
  const prompt = readline.createInterface({ input, output });
  try { return (await prompt.question(`費用承認: ${label}。実行しますか？ [y/N] `)).trim().toLowerCase() === "y"; }
  finally { prompt.close(); }
}

function nextOutput(projectDir, itemId) {
  const directory = path.join(projectDir, "assets", "generated");
  for (let serial = 1; ; serial += 1) {
    const suffix = serial === 1 ? "" : `-${serial}`;
    const relative = `assets/generated/${itemId}${suffix}.mp4`;
    if (!existsSync(path.join(projectDir, relative)) && !existsSync(`${path.join(projectDir, relative)}.meta.json`)) {
      return { directory, relative, absolute: path.join(projectDir, relative), metaPath: `${path.join(projectDir, relative)}.meta.json` };
    }
  }
}

export function probeVideo(filePath, { env = process.env, ffprobe = resolveFfprobe({ env }) } = {}) {
  const raw = execFileSync(ffprobe, [
    "-v", "error", "-show_entries", "format=duration:stream=codec_type,width,height,r_frame_rate", "-of", "json", filePath,
  ], { encoding: "utf8", env });
  const value = JSON.parse(raw);
  const video = value.streams?.find((stream) => stream.codec_type === "video");
  const audio = value.streams?.some((stream) => stream.codec_type === "audio") ?? false;
  const duration = Number(value.format?.duration);
  if (!Number.isFinite(duration)) throw new Error("ffprobe で動画の実尺を取得できませんでした");
  return {
    duration_s_actual: Number(duration.toFixed(3)),
    ...(Number.isInteger(video?.width) ? { width: video.width } : {}),
    ...(Number.isInteger(video?.height) ? { height: video.height } : {}),
    ...(typeof video?.r_frame_rate === "string" ? { fps: video.r_frame_rate } : {}),
    has_audio: audio,
  };
}

export async function finalizeGeneratedVideo({
  projectDir, itemId, metaPath, mp4AbsolutePath, mp4RelativePath, responseUrl, key,
  fetchImpl = globalThis.fetch, now = () => new Date(), startedMs = Date.now(),
  openProjectImpl = openProject, snapshotImpl = snapshot, probeImpl = probeVideo,
}) {
  const response = await fetchResponse({ responseUrl, key, fetchImpl });
  if (typeof response?.video?.url !== "string" || !response.video.url) throw new Error("fal response に video.url がありません");
  const downloaded = await download({ url: response.video.url, dest: mp4AbsolutePath, fetchImpl });
  const probe = probeImpl(mp4AbsolutePath);
  const bytes = readFileSync(mp4AbsolutePath);
  const finishedMs = (typeof now === "function" ? now() : new Date()).getTime();
  const elapsed_s = Number((Math.max(0, finishedMs - startedMs) / 1000).toFixed(3));
  const result = {
    path: mp4RelativePath,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    bytes: downloaded.bytes,
    ...probe,
  };
  const meta = writeDone({ metaPath, result, expanded_prompt: response.expanded_prompt, elapsed_s, now });
  const project = await openProjectImpl(projectDir);
  const item = findItem(project.edit, itemId);
  if (!item || item.source?.kind !== "media") throw new Error(`差し替え対象 item が見つかりません: ${itemId}`);
  const cutsDurationS = item.source.out - item.source.in;
  const plan = planReplacement({ item, sourceEntry: findSource(project.edit, item.source.src), actualDurationS: probe.duration_s_actual, cutsDurationS });
  await snapshotImpl({ projectDir, label: `生成した動画に差し替え: ${itemId}` });
  applyReplacement(project, { itemId, mp4RelativePath, plan });
  await project.save();
  return { probe, elapsed_s, meta, plan };
}

export async function runVideoCommand(argv, dependencies = {}) {
  const log = dependencies.log ?? console.log;
  const errorLog = dependencies.errorLog ?? console.error;
  let metaPath = null;
  try {
    const options = parseVideoArguments(argv);
    if (options.help) { log(usage); return { exitCode: 0 }; }
    const project = await (dependencies.openProjectImpl ?? openProject)(options.projectDir);
    const item = findItem(project.edit, options.itemId);
    if (!item || item.source?.kind !== "media") throw new CliError(`media item が見つかりません: ${options.itemId}`);
    const sourceEntry = findSource(project.edit, item.source.src);
    if (!sourceEntry) throw new CliError(`source が見つかりません: ${item.source.src}`);
    let supplied;
    if (options.inputJson !== null) {
      supplied = readInputJson(options.projectDir, options.inputJson);
    } else {
      const sidecarPath = path.resolve(options.projectDir, `${sourceEntry.path}.meta.json`);
      const sourceMeta = existsSync(sidecarPath) ? JSON.parse(readFileSync(sidecarPath, "utf8")) : null;
      supplied = sourceMeta?.next?.kind === "video" && sourceMeta.next.status === "planned" ? sourceMeta.next : {};
    }
    const suppliedInputs = { ...(supplied.inputs ?? supplied) };
    const framesOrRefs = suppliedInputs.frames_or_refs;
    if (framesOrRefs !== undefined && !["frames", "references"].includes(framesOrRefs)) {
      throw new CliError("frames_or_refs は frames または references で指定してください");
    }
    const suppliedOutput = supplied.output ?? {};
    const catalog = await (dependencies.loadCatalogImpl ?? loadCatalog)();
    const modelId = options.modelId ?? supplied.model?.id ?? modelDefault(options.projectDir);
    const model = findModel(catalog, modelId);
    if (!model) throw new CliError(`生成モデルがカタログにありません: ${modelId}`);
    const hasSuppliedFirst = Object.hasOwn(suppliedInputs, "first_frame");
    // first_frame を受けない行（参照から作る行）には、既定の絵を入れない。
    const usesDefaultFirst = model.inputs.first_frame !== "none"
      && options.firstFrame === undefined && !hasSuppliedFirst;
    // CLI の上書きと既定値も含め、非選択側は hydration 前に除く。
    const { inputs: selectedInputs } = resolveSendSide({
      ...suppliedInputs,
      first_frame: options.firstFrame !== undefined
        ? options.firstFrame : hasSuppliedFirst ? suppliedInputs.first_frame : usesDefaultFirst ? sourceEntry.path : null,
      last_frame: options.lastFrame ?? suppliedInputs.last_frame,
      reference_images: options.referenceImages.length ? options.referenceImages : suppliedInputs.reference_images,
      reference_audios: options.referenceAudios.length ? options.referenceAudios : suppliedInputs.reference_audios,
    });
    if (usesDefaultFirst && selectedInputs.first_frame !== null && !STILL_EXTENSIONS.has(path.extname(sourceEntry.path).toLowerCase())) {
      throw new CliError("既定の first_frame は静止画 source の item だけで使えます");
    }
    const rawInputs = {
      ...selectedInputs,
      prompt: options.prompt ?? suppliedInputs.prompt ?? null,
      negative_prompt: options.negativePrompt ?? suppliedInputs.negative_prompt ?? null,
      first_frame: hydrateReference(options.projectDir, selectedInputs.first_frame, { source_id: sourceEntry.id }),
      last_frame: hydrateReference(options.projectDir, selectedInputs.last_frame),
      reference_images: hydrateList(options.projectDir, selectedInputs.reference_images),
      reference_videos: hydrateList(options.projectDir, selectedInputs.reference_videos),
      reference_audios: hydrateList(options.projectDir, selectedInputs.reference_audios),
      source_video: hydrateReference(options.projectDir, suppliedInputs.source_video),
      camera: options.camera !== undefined
        ? { notation: options.camera.trim().startsWith("[") ? "bracket" : "prose", value: options.camera, from_annotation: null }
        : suppliedInputs.camera ?? null,
      seed: options.seed ?? suppliedInputs.seed ?? null,
      extra: { ...(suppliedInputs.extra ?? {}), ...options.extra },
    };
    const rawOutput = {
      ...suppliedOutput,
      duration_s: options.duration ?? suppliedOutput.duration_s ?? (item.source.out - item.source.in),
      resolution: options.resolution ?? suppliedOutput.resolution ?? null,
      aspect: options.aspect ?? suppliedOutput.aspect ?? null,
      audio_out: options.audioOut ?? suppliedOutput.audio_out ?? null,
    };
    const validation = validateInputs({ inputs: rawInputs, output: rawOutput, model });
    for (const message of validation.messages) (message.level === "error" ? errorLog : log)(`${message.level}: ${message.text}`);
    if (!validation.ok) return { exitCode: 1 };
    const adapter = getAdapter(model.id);
    if (!adapter) throw new CliError(`生成モデルのアダプタがありません: ${model.id}`, 1);
    const resolver = createMediaResolver(options.projectDir);
    const allReferences = [validation.normalized.inputs.first_frame, validation.normalized.inputs.last_frame,
      ...validation.normalized.inputs.reference_images, ...validation.normalized.inputs.reference_videos,
      ...validation.normalized.inputs.reference_audios, validation.normalized.inputs.source_video].filter(Boolean);
    for (const reference of allReferences) resolver(reference);
    const adapterInputs = { ...validation.normalized.inputs };
    delete adapterInputs.mode;
    const adapterOutput = { ...validation.normalized.output };
    if (model.audio_out === "always" || model.audio_out === false) delete adapterOutput.audio_out;
    const mapped = adapter.map(adapterInputs, adapterOutput, { resolveMedia: resolver });
    if (!mapped.ok) {
      for (const rejected of mapped.rejected) errorLog(`error: ${rejected.slot}: ${rejected.reason}`);
      return { exitCode: 1 };
    }
    const estimate = estimateLabel(validation.cost, model);
    if (options.dryRun) {
      const dry = { endpoint: mapped.endpoint, body: summarizeData(mapped.body), estimate_usd: validation.cost.estimate_usd, as_of: validation.cost.as_of ?? model.as_of };
      const hasUnknownPriceMessage = validation.messages.some((message) => message.code === "price.unknown");
      log(options.json
        ? JSON.stringify(dry)
        : `送信予定 endpoint: ${dry.endpoint}\nbody: ${JSON.stringify(dry.body, null, 2)}${hasUnknownPriceMessage ? "" : `\n${estimate}`}`);
      return { exitCode: 0, result: dry };
    }
    if (!validation.messages.some((message) => message.code === "price.unknown")) log(estimate);
    if (!options.yes) {
      const input = dependencies.input ?? processInput;
      const output = dependencies.output ?? processOutput;
      const approved = input.isTTY && output.isTTY
        ? await (dependencies.confirmImpl ?? askApproval)({ input, output, label: estimate })
        : false;
      if (!approved) throw new CliError(`費用承認が必要です（${estimate}）。--yes を付けて再実行`);
    }
    const credentials = (dependencies.resolveFalKeyImpl ?? resolveFalKey)({ env: dependencies.env ?? process.env, credentialsFile: dependencies.credentialsFile });
    const destination = nextOutput(options.projectDir, options.itemId);
    await mkdir(destination.directory, { recursive: true });
    const startedDate = (dependencies.now ?? (() => new Date()))();
    const startedMs = startedDate.getTime();
    const placeholderReference = makeReference(options.projectDir, sourceEntry.path);
    const placeholder = { path: placeholderReference.path, sha256: placeholderReference.sha256, item_id: options.itemId };
    const submitted = await submit({ endpoint: mapped.endpoint, body: mapped.body, key: credentials.key, fetchImpl: dependencies.fetchImpl ?? globalThis.fetch });
    metaPath = destination.metaPath;
    writeGenerating({
      metaPath, model, placeholder, inputs: schemaInputs(validation.normalized.inputs), output: validation.normalized.output,
      cost: validation.cost, key_source: credentials.key_source, request_id: submitted.request_id,
      status_url: submitted.status_url, response_url: submitted.response_url,
      started_at: startedDate.toISOString(), stale_after_s: options.staleAfterS,
    });
    await pollStatus({
      statusUrl: submitted.status_url, key: credentials.key, fetchImpl: dependencies.fetchImpl ?? globalThis.fetch,
      intervalMs: dependencies.pollIntervalMs ?? 5_000, deadlineMs: options.staleAfterS * 1000,
      onTick: dependencies.onTick ?? (() => {}),
    });
    const completed = await finalizeGeneratedVideo({
      projectDir: options.projectDir, itemId: options.itemId, metaPath,
      mp4AbsolutePath: destination.absolute, mp4RelativePath: destination.relative,
      responseUrl: submitted.response_url, key: credentials.key,
      fetchImpl: dependencies.fetchImpl ?? globalThis.fetch, now: dependencies.now,
      startedMs, openProjectImpl: dependencies.openProjectImpl ?? openProject,
      snapshotImpl: dependencies.snapshotImpl ?? snapshot, probeImpl: dependencies.probeImpl ?? probeVideo,
    });
    const result = {
      item: options.itemId, mp4: destination.relative,
      duration_s_actual: completed.probe.duration_s_actual, out: completed.plan.out,
      freeze: completed.plan.freeze, estimate_usd: validation.cost.estimate_usd,
      elapsed_s: completed.elapsed_s, meta: path.relative(options.projectDir, metaPath).split(path.sep).join("/"),
    };
    log(options.json ? JSON.stringify(result) : `生成動画に差し替えました: ${destination.relative}`);
    return { exitCode: 0, result };
  } catch (error) {
    if (metaPath && existsSync(metaPath)) {
      try { writeFailed({ metaPath, reason: error.message, now: dependencies.now }); } catch { /* 元の失敗を優先する。 */ }
    }
    errorLog(error instanceof Error ? error.message : String(error));
    return { exitCode: error?.exitCode ?? 1 };
  }
}

export const run = runVideoCommand;
export default runVideoCommand;
