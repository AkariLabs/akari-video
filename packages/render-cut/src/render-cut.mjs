import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { constants as fsConstants, createReadStream, existsSync } from "node:fs";
import {
  access,
  copyFile,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { generateCaptionOverlays } from "./captions.mjs";
import { buildPlan, selectDefaultOutput } from "./plan.mjs";
import {
  captureStaticOverlays,
  captureWithPuppeteer,
  compositeAnimatedOverlay,
  compositeStaticOverlays,
  probeHasAlpha,
  renderOverlaySheet,
  runChecked,
} from "./rasterize.mjs";
import { renderReport } from "./report.mjs";

const VERSION = 1;
const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageRequire = createRequire(import.meta.url);
// A stale run directory belongs to a process that crashed/was killed without cleaning up after
// itself. 24h gives ample time for a same-day retry/inspection before we reclaim the space, while
// never touching a directory an active concurrent run still owns (see createRunTemporaryDirectory).
const STALE_RUN_DIRECTORY_MS = 24 * 60 * 60 * 1000;
const USAGE = `Usage: render-cut <project-root> [--plan-only] [--out <path>] [--force]

Exit codes: 0 verified pass (or plan complete), 1 refusal/verify fail, 2 execution error`;

export class RefusalError extends Error {}
export class ExecutionError extends Error {}

export async function runCli(argv, io = console) {
  let options;
  try {
    options = parseArguments(argv);
  } catch (error) {
    io.error(error.message);
    io.error(USAGE);
    return 2;
  }
  if (options.help) {
    io.log(USAGE);
    return 0;
  }

  try {
    const state = await renderProject(options.projectRoot, options);
    for (const warning of state.warnings ?? []) {
      io.error(`render-cut warning: ${warning}`);
    }
    if (options.planOnly) {
      io.log(`PLAN: ${state.plan.output} (${state.plan.predicted_duration_seconds}s)`);
      return 0;
    }
    io.log(`${state.verify.verdict.toUpperCase()}: ${state.plan.output}`);
    return state.verify.verdict === "pass" ? 0 : 1;
  } catch (error) {
    if (error instanceof RefusalError) {
      io.error(`render-cut refused: ${error.message}`);
      return 1;
    }
    io.error(`render-cut execution error: ${messageOf(error)}`);
    return 2;
  }
}

export async function renderProject(input, options = {}) {
  const projectRoot = resolve(input);
  const editPath = join(projectRoot, "edit.json");
  const editText = await readRequired(editPath, "edit.json");
  const edit = parseJson(editText, "edit.json");
  validateEditShape(edit);

  const lint = await validateLint(projectRoot, options.force === true);
  const capabilities = await measureCapabilities(projectRoot, edit);
  const inputs = await collectInputReceipts(projectRoot, edit, editText);
  const plannedCaptions = await loadCaptions(projectRoot, edit);
  const loadedOverlays = await loadOverlays(projectRoot, edit);
  const hasThreeDimensionalOverlay = loadedOverlays.some((overlay) =>
    overlay.html.includes("data-akari-3d-scene"),
  );
  const explicitOutput = options.out ? resolveOutput(projectRoot, options.out) : null;
  const outputPath = explicitOutput ?? selectDefaultOutput(projectRoot, edit, existsSync);
  ensureOutputDoesNotReplaceInput(projectRoot, edit, outputPath);

  // Concurrency isolation (render-tmp-isolation の設計に基づく): a plan-only
  // preview never touches disk, so it keeps using the flat, deterministic render-tmp path (stable
  // across repeated --plan-only calls). An actual render claims its own uniquely-named
  // subdirectory so two processes racing on the same project never clobber each other's
  // intermediates; only the owning process ever writes into it.
  const renderTmpRoot = join(projectRoot, ".akari", "render-tmp");
  const temporaryDirectory = options.planOnly
    ? renderTmpRoot
    : await createRunTemporaryDirectory(renderTmpRoot);

  const plan = buildPlan({
    edit,
    projectRoot,
    outputPath,
    capabilities,
    hasSourceAudio: capabilities.sourceHasAudio,
    renderOverlays: [...edit.overlays, ...plannedCaptions],
    hasThreeDimensionalOverlay,
    temporaryDirectory,
  });
  const state = {
    version: VERSION,
    phase: "planned",
    inputs,
    warnings: plan.commands.audio_mix.warnings ?? [],
    validation: {
      lint,
      environment: {
        node: capabilities.nodeVersion,
        ffmpeg: capabilities.ffmpegVersion,
        ffprobe: capabilities.ffprobeVersion,
        chrome: capabilities.chromeVersion,
        hyperframes: capabilities.hyperframesVersion,
        puppeteer_core: capabilities.puppeteerVersion,
      },
    },
    plan,
    provenance: {
      source: relativeOrAbsolute(projectRoot, resolve(projectRoot, edit.source.path)),
      proxy_used: false,
      render_tmp_dir: relativeOrAbsolute(projectRoot, temporaryDirectory),
      rasterizer: { planned: plan.rasterizer.selected, adopted: null, attempts: [] },
      environment: {
        node: capabilities.nodeVersion,
        ffmpeg: capabilities.ffmpegVersion,
        ffprobe: capabilities.ffprobeVersion,
        chrome: capabilities.chromeVersion,
        hyperframes: capabilities.hyperframesVersion,
        puppeteer_core: capabilities.puppeteerVersion,
      },
    },
    artifacts: [],
    verify: null,
  };

  const statePath = join(projectRoot, ".akari", "render.json");
  const reportPath = join(projectRoot, ".akari", "reports", "render-report.html");
  await writeState(state, statePath, reportPath, projectRoot);
  if (options.planOnly) return state;

  try {
    const cutPath = join(temporaryDirectory, "cut.mp4");
    const cutCommand = plan.commands.cut;
    runChecked(capabilities.ffmpegCommand, cutCommand.args, { cwd: projectRoot });

    // layers[] (contract-2026-07-22-prerender-rail-and-assets.md §1.2) composites onto the
    // cuts-joined base before overlays/captions are rasterized on top. plan.commands.layers is
    // null whenever edit.layers is absent/empty, so a layers-less edit.json never runs this
    // command and always feeds the original cut.mp4 onward unchanged (byte-identical output).
    const layersCommand = plan.commands.layers;
    const layeredPath = join(temporaryDirectory, "layered.mp4");
    if (layersCommand) {
      runChecked(layersCommand.command, layersCommand.args, { cwd: projectRoot });
    }
    const baseVideoPath = layersCommand ? layeredPath : cutPath;

    const overlays = loadedOverlays;
    const captions = plannedCaptions;
    const allOverlays = [...overlays, ...captions];
    const compositePath = join(temporaryDirectory, "composite.mp4");
    if (allOverlays.length === 0) {
      await copyFile(baseVideoPath, compositePath);
      state.provenance.rasterizer.adopted = "skip";
      state.provenance.rasterizer.attempts.push({
        method: "skip",
        status: "adopted",
        reason: "no overlay HTML or captions.json",
      });
    } else {
      await rasterizeAndComposite({
        state,
        allOverlays,
        edit,
        projectRoot,
        temporaryDirectory,
        cutPath: baseVideoPath,
        compositePath,
        capabilities,
        duration: plan.predicted_duration_seconds,
        hasThreeDimensionalOverlay,
      });
    }

    const finalPath = join(temporaryDirectory, "final.mp4");
    await executeAudioPlan(plan.commands.audio_mix);

    await mkdir(dirname(outputPath), { recursive: true });
    if (explicitOutput) {
      await rm(outputPath, { force: true });
      await rename(finalPath, outputPath);
    } else {
      await copyFile(finalPath, outputPath, fsConstants.COPYFILE_EXCL);
      await rm(finalPath, { force: true });
    }
    state.phase = "rendered";
    const verification = verifyArtifact({
      outputPath,
      plan,
      ffprobeCommand: capabilities.ffprobeCommand,
    });
    state.verify = verification;
    state.artifacts = [
      {
        path: relativeOrAbsolute(projectRoot, outputPath),
        sha256: await sha256File(outputPath),
        ffprobe: verification.measured,
      },
    ];
    state.phase = "verified";
    await writeState(state, statePath, reportPath, projectRoot);
    if (verification.verdict === "pass") {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
    return state;
  } catch (error) {
    state.phase = "error";
    state.verify = {
      verdict: "fail",
      findings: [{ severity: "error", check: "render.execution", message: messageOf(error) }],
      measured: null,
    };
    await writeState(state, statePath, reportPath, projectRoot);
    throw error;
  }
}

export function parseArguments(argv) {
  const options = { projectRoot: null, planOnly: false, out: null, force: false, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") options.help = true;
    else if (argument === "--plan-only") options.planOnly = true;
    else if (argument === "--force") options.force = true;
    else if (argument === "--out") {
      if (index + 1 >= argv.length) throw new Error("--out requires a path");
      options.out = argv[++index];
    } else if (argument.startsWith("--out=")) options.out = argument.slice(6);
    else if (argument.startsWith("-")) throw new Error(`Unknown option: ${argument}`);
    else if (options.projectRoot === null) options.projectRoot = argument;
    else throw new Error("Only one project root may be provided");
  }
  if (!options.help && options.projectRoot === null) throw new Error("A project root is required");
  return options;
}

async function validateLint(projectRoot, force) {
  const lintPath = join(projectRoot, ".akari", "lint.json");
  let lint = null;
  try {
    lint = parseJson(await readFile(lintPath, "utf8"), ".akari/lint.json");
  } catch (error) {
    if (error?.code !== "ENOENT") throw new ExecutionError(messageOf(error));
  }
  const verdict = lint?.verdict ?? "missing";
  if (verdict !== "pass" && !force) {
    throw new RefusalError(".akari/lint.json is missing or not PASS; run edit-lint first (or use --force with explicit approval)");
  }
  return {
    verdict,
    sha256: lint ? sha256(JSON.stringify(lint)) : null,
    override: verdict === "pass" ? null : { used: true, option: "--force", original_verdict: verdict },
  };
}

async function measureCapabilities(projectRoot, edit) {
  const ffmpegCommand = process.env.FFMPEG ?? "ffmpeg";
  const ffprobeCommand = process.env.FFPROBE ?? "ffprobe";
  const ffmpegVersion = commandVersion(ffmpegCommand, ["-version"], "ffmpeg", ffmpegInstallHint());
  const ffprobeVersion = commandVersion(ffprobeCommand, ["-version"], "ffprobe");
  const chromePath = await findChromePath();
  const chromeVersion = chromePath ? commandVersion(chromePath, ["--version"], "Chrome") : null;
  if (!chromePath) throw new ExecutionError("system Chrome was not found");
  const sourcePath = resolve(projectRoot, edit.source.path);
  const sourceProbe = probeMedia(ffprobeCommand, sourcePath);
  const sourceDuration = Number(sourceProbe.format?.duration);
  if (!Number.isFinite(sourceDuration) || sourceDuration <= 0) {
    throw new ExecutionError("ffprobe did not report a positive source duration");
  }
  const hyperframesPath = join(PACKAGE_ROOT, "node_modules", ".bin", "hyperframes");
  const hyperframesPackagePath = join(PACKAGE_ROOT, "node_modules", "hyperframes", "package.json");
  const puppeteerPath = resolvePuppeteerPackagePath();
  return {
    ffmpegCommand,
    ffprobeCommand,
    ffmpegVersion,
    ffprobeVersion,
    nodeVersion: process.version,
    chromePath,
    chromeVersion,
    hyperframesPath,
    hyperframesAvailable: await isExecutable(hyperframesPath),
    hyperframesVersion: await readPackageVersion(hyperframesPackagePath),
    puppeteerAvailable: puppeteerPath !== null,
    puppeteerVersion: puppeteerPath ? await readPackageVersion(puppeteerPath) : null,
    sourceDuration,
    sourceHasAudio: sourceProbe.streams.some((stream) => stream.codec_type === "audio"),
  };
}

async function collectInputReceipts(projectRoot, edit, editText) {
  const files = new Map([["edit.json", { path: join(projectRoot, "edit.json"), text: editText }]]);
  addReference(files, projectRoot, "source", edit.source.path);
  for (const [index, overlay] of edit.overlays.entries()) {
    addReference(files, projectRoot, `overlay:${index}`, overlay.html);
  }
  const captionsPath = join(projectRoot, "captions.json");
  if (await isRegularFile(captionsPath)) files.set("captions.json", { path: captionsPath });
  const bgm = audioPath(edit.audio?.bgm);
  if (bgm) addReference(files, projectRoot, "audio:bgm", bgm);
  for (const [index, sfx] of (edit.audio?.sfx ?? []).entries()) {
    const path = audioPath(sfx);
    if (path) addReference(files, projectRoot, `audio:sfx:${index}`, path);
  }
  for (const [index, layer] of (edit.layers ?? []).entries()) {
    addReference(files, projectRoot, `layer:${index}`, layer.src);
  }
  if (edit.thumbnail?.path) addReference(files, projectRoot, "thumbnail", edit.thumbnail.path);

  const receipts = {};
  for (const [label, file] of files) {
    if (!(await isRegularFile(file.path))) throw new ExecutionError(`${label} does not resolve to a regular file`);
    receipts[relative(projectRoot, file.path)] = {
      sha256: file.text === undefined ? await sha256File(file.path) : sha256(file.text),
      bytes: (await stat(file.path)).size,
    };
  }
  return receipts;
}

async function loadOverlays(projectRoot, edit) {
  return Promise.all(
    edit.overlays.map(async (overlay) => ({
      ...overlay,
      html: await readRequired(resolve(projectRoot, overlay.html), overlay.html),
    })),
  );
}

async function loadCaptions(projectRoot, edit) {
  const captionsPath = join(projectRoot, "captions.json");
  if (!(await isRegularFile(captionsPath))) return [];
  const captions = parseJson(await readFile(captionsPath, "utf8"), "captions.json");
  if (!Array.isArray(captions)) throw new ExecutionError("captions.json root must be an array");
  return generateCaptionOverlays(captions, edit.cuts, { emphasisWords: edit.emphasis_words });
}

export async function rasterizeAndComposite(context) {
  const {
    state,
    allOverlays,
    edit,
    projectRoot,
    temporaryDirectory,
    cutPath,
    compositePath,
    capabilities,
    duration,
    hasThreeDimensionalOverlay,
    captureTimeoutMs,
  } = context;
  const sheetPath = join(temporaryDirectory, "overlay-sheet.html");
  await writeFile(
    sheetPath,
    renderOverlaySheet({ overlays: allOverlays, edit, projectRoot, duration }),
    "utf8",
  );

  if (hasThreeDimensionalOverlay) {
    rejectRasterizer(
      state,
      "hyperframes",
      "3D overlay requires the puppeteer-core path",
    );
  } else if (capabilities.hyperframesAvailable) {
    const overlayPath = join(temporaryDirectory, "overlay.webm");
    try {
      runChecked(
        capabilities.hyperframesPath,
        [
          "render",
          projectRoot,
          "--composition",
          relative(projectRoot, sheetPath),
          "--format",
          "webm",
          "--fps",
          String(edit.output.fps),
          "--workers",
          "1",
          "--no-browser-gpu",
          "--no-best-effort",
          "-o",
          overlayPath,
        ],
        {
          cwd: projectRoot,
          env: {
            ...process.env,
            CHROME_PATH: capabilities.chromePath,
            PUPPETEER_EXECUTABLE_PATH: capabilities.chromePath,
            HYPERFRAMES_BROWSER_PATH: capabilities.chromePath,
            DO_NOT_TRACK: "1",
          },
        },
      );
      if (!probeHasAlpha(capabilities.ffprobeCommand, overlayPath)) {
        throw new Error("rendered video has no detectable alpha channel");
      }
      compositeAnimatedOverlay({
        ffmpegCommand: capabilities.ffmpegCommand,
        cutPath,
        overlayPath,
        outputPath: compositePath,
        hasAudio: true,
      });
      adoptRasterizer(state, "hyperframes");
      return;
    } catch (error) {
      rejectRasterizer(state, "hyperframes", messageOf(error));
    }
  } else {
    rejectRasterizer(state, "hyperframes", "package-local HyperFrames executable is not installed");
  }

  if (capabilities.puppeteerAvailable) {
    try {
      const overlayPath = join(temporaryDirectory, "overlay.mov");
      await captureWithPuppeteer({
        sheetPath,
        chromePath: capabilities.chromePath,
        framesDirectory: join(temporaryDirectory, "frames"),
        overlayMovPath: overlayPath,
        width: edit.output.width,
        height: edit.output.height,
        fps: edit.output.fps,
        duration,
        ffmpegCommand: capabilities.ffmpegCommand,
        timeoutMs: captureTimeoutMs,
      });
      if (!probeHasAlpha(capabilities.ffprobeCommand, overlayPath)) {
        throw new Error("captured video has no detectable alpha channel");
      }
      compositeAnimatedOverlay({
        ffmpegCommand: capabilities.ffmpegCommand,
        cutPath,
        overlayPath,
        outputPath: compositePath,
        hasAudio: true,
      });
      adoptRasterizer(state, "puppeteer-core");
      return;
    } catch (error) {
      rejectRasterizer(state, "puppeteer-core", messageOf(error));
    }
  } else {
    rejectRasterizer(state, "puppeteer-core", "puppeteer-core is not installed or resolvable");
  }

  if (hasThreeDimensionalOverlay) {
    throw new ExecutionError("3D overlay requires puppeteer-core; static screenshot fallback is not permitted");
  }

  try {
    const captures = await captureStaticOverlays({
      overlays: allOverlays,
      edit,
      projectRoot,
      temporaryDirectory,
      chromePath: capabilities.chromePath,
      timeoutMs: captureTimeoutMs,
    });
    compositeStaticOverlays({
      ffmpegCommand: capabilities.ffmpegCommand,
      cutPath,
      captures,
      outputPath: compositePath,
      hasAudio: true,
      duration,
    });
    adoptRasterizer(state, "static-screenshot");
  } catch (error) {
    rejectRasterizer(state, "static-screenshot", messageOf(error));
    throw new ExecutionError("all overlay rasterizers failed");
  }
}

async function executeAudioPlan(audioPlan) {
  if (audioPlan.operation === "copy") {
    await copyFile(audioPlan.input, audioPlan.output);
    return;
  }
  runChecked(audioPlan.command, audioPlan.args);
}

// Allocates this run's own render-tmp subdirectory (fs.mkdtemp-equivalent uniqueness: an
// ISO8601-ish timestamp + pid prefix, plus mkdtemp's own random suffix, so even two processes
// starting in the same millisecond never collide). Runs a best-effort sweep for stale directories
// first so crashed runs don't leak disk space forever, without ever touching a directory an active
// concurrent run still owns (see cleanupStaleRunDirectories).
async function createRunTemporaryDirectory(renderTmpRoot) {
  await mkdir(renderTmpRoot, { recursive: true });
  await cleanupStaleRunDirectories(renderTmpRoot);
  const isoStamp = new Date().toISOString().replace(/[:.]/gu, "-");
  return mkdtemp(join(renderTmpRoot, `${isoStamp}-${process.pid}-`));
}

async function cleanupStaleRunDirectories(renderTmpRoot) {
  let entries;
  try {
    entries = await readdir(renderTmpRoot, { withFileTypes: true });
  } catch {
    return;
  }
  const now = Date.now();
  await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => {
        const entryPath = join(renderTmpRoot, entry.name);
        try {
          const info = await stat(entryPath);
          if (now - info.mtimeMs > STALE_RUN_DIRECTORY_MS) {
            await rm(entryPath, { recursive: true, force: true });
          }
        } catch {
          // Best-effort: another process may be concurrently using or removing this directory.
        }
      }),
  );
}

export function verifyArtifact({ outputPath, plan, ffprobeCommand = "ffprobe" }) {
  const measured = probeMedia(ffprobeCommand, outputPath);
  const video = measured.streams.find((stream) => stream.codec_type === "video");
  const audio = measured.streams.find((stream) => stream.codec_type === "audio");
  const actualDuration = Number(measured.format?.duration ?? video?.duration);
  const actualFps = parseRate(video?.avg_frame_rate ?? video?.r_frame_rate);
  const expected = plan.preset;
  const findings = [];
  compare(findings, "verify.duration", Number.isFinite(actualDuration) && Math.abs(actualDuration - plan.predicted_duration_seconds) <= plan.duration_tolerance_seconds, `duration ${actualDuration}s; expected ${plan.predicted_duration_seconds}s ±${plan.duration_tolerance_seconds}s`);
  compare(findings, "verify.resolution", video?.width === expected.width && video?.height === expected.height, `resolution ${video?.width ?? "missing"}x${video?.height ?? "missing"}; expected ${expected.width}x${expected.height}`);
  compare(findings, "verify.fps", Number.isFinite(actualFps) && Math.abs(actualFps - expected.fps) < 0.001, `fps ${actualFps}; expected ${expected.fps}`);
  compare(findings, "verify.video-codec", video?.codec_name === "h264", `video codec ${video?.codec_name ?? "missing"}; expected h264`);
  compare(findings, "verify.video-profile", String(video?.profile ?? "").toLowerCase() === "high", `video profile ${video?.profile ?? "missing"}; expected High`);
  compare(findings, "verify.pixel-format", video?.pix_fmt === "yuv420p", `pixel format ${video?.pix_fmt ?? "missing"}; expected yuv420p`);
  compare(findings, "verify.audio", audio?.codec_name === "aac", `audio codec ${audio?.codec_name ?? "missing"}; expected aac`);
  if (plan.commands.audio_mix?.hasNarration) {
    compare(findings, "verify.narration-audio", Boolean(audio), `narration audio stream present: ${Boolean(audio)}; expected an audio stream because edit.json has audio.narration`);
  }
  return {
    verdict: findings.some((finding) => finding.severity === "error") ? "fail" : "pass",
    findings,
    measured: {
      duration_seconds: actualDuration,
      width: video?.width ?? null,
      height: video?.height ?? null,
      fps: actualFps,
      video_codec: video?.codec_name ?? null,
      video_profile: video?.profile ?? null,
      pixel_format: video?.pix_fmt ?? null,
      audio_codec: audio?.codec_name ?? null,
    },
  };
}

async function writeState(state, statePath, reportPath, projectRoot) {
  await mkdir(dirname(statePath), { recursive: true });
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  await writeFile(reportPath, renderReport(state, reportPath, projectRoot), "utf8");
}

function validateEditShape(edit) {
  if (!edit || typeof edit !== "object" || Array.isArray(edit)) throw new ExecutionError("edit.json must be an object");
  if (!Number.isInteger(edit.version)) throw new ExecutionError("edit.json version must be an integer");
  if (!edit.output || !positive(edit.output.width) || !positive(edit.output.height) || !positive(edit.output.fps)) throw new ExecutionError("edit.json output width, height, and fps must be positive numbers");
  if (!edit.source || typeof edit.source.path !== "string" || edit.source.path === "") throw new ExecutionError("edit.json source.path is required");
  if (!Array.isArray(edit.cuts) || !Array.isArray(edit.overlays)) throw new ExecutionError("edit.json cuts and overlays must be arrays");
}

function probeMedia(command, path) {
  const result = spawnSync(command, ["-v", "error", "-show_streams", "-show_format", "-of", "json", path], { encoding: "utf8" });
  if (result.error) throw new ExecutionError(messageOf(result.error));
  if (result.status !== 0) throw new ExecutionError(`ffprobe failed for ${basename(path)}: ${result.stderr.trim()}`);
  return parseJson(result.stdout, `ffprobe ${basename(path)}`);
}

function commandVersion(command, args, label, hint = null) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.error || result.status !== 0) {
    throw new ExecutionError(hint ? `${label} is not available; ${hint}` : `${label} is not available`);
  }
  return (result.stdout || result.stderr).split(/\r?\n/u)[0].trim();
}

// Only used for the ffmpeg not-found message (task scope: detection logic itself stays unchanged).
export function ffmpegInstallHint(platform = process.platform) {
  const install = platform === "win32"
    ? "winget install ffmpeg"
    : platform === "darwin"
      ? "brew install ffmpeg"
      : "install ffmpeg via your package manager";
  return `set the FFMPEG environment variable to its path, or install it (${install})`;
}

// darwin/linux candidates are unchanged from before win32 support was added, so behavior on those
// platforms stays byte-identical (win32 gets its own list instead of being merged into this one).
function defaultChromeSystemCandidates({ env, platform }) {
  if (platform === "win32") {
    const programFiles = env.ProgramFiles || "C:\\Program Files";
    const programFilesX86 = env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";
    const localAppData = env.LOCALAPPDATA;
    const candidates = [
      join(programFiles, "Google", "Chrome", "Application", "chrome.exe"),
      join(programFilesX86, "Google", "Chrome", "Application", "chrome.exe"),
    ];
    if (localAppData) candidates.push(join(localAppData, "Google", "Chrome", "Application", "chrome.exe"));
    return candidates;
  }
  return [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
  ];
}

export async function findChromePath({
  env = process.env,
  homeDirectory = homedir(),
  platform = process.platform,
  systemCandidates = defaultChromeSystemCandidates({ env, platform }),
  executable = isExecutable,
} = {}) {
  const candidates = await chromePathCandidates({
    env,
    homeDirectory,
    platform,
    systemCandidates,
  });
  for (const candidate of candidates) {
    if (await executable(candidate)) return candidate;
  }
  return null;
}

export async function chromePathCandidates({
  env = process.env,
  homeDirectory = homedir(),
  platform = process.platform,
  systemCandidates = defaultChromeSystemCandidates({ env, platform }),
} = {}) {
  const playwrightRoot = platform === "win32"
    ? join(env.LOCALAPPDATA || join(homeDirectory, "AppData", "Local"), "ms-playwright")
    : platform === "darwin"
      ? join(homeDirectory, "Library", "Caches", "ms-playwright")
      : join(homeDirectory, ".cache", "ms-playwright");
  const playwright = await versionedNestedCandidates({
    roots: [playwrightRoot],
    versionPrefix: "chromium_headless_shell-",
    binaryPaths: platform === "win32"
      ? [[/^chrome-headless-shell-win/u, "chrome-headless-shell.exe"]]
      : platform === "darwin"
        ? [[/^chrome-headless-shell-mac-/u, "chrome-headless-shell"]]
        : [[/^chrome-headless-shell-linux/u, "chrome-headless-shell"]],
  });
  const puppeteerRoots = [join(homeDirectory, ".cache", "puppeteer", "chrome")];
  if (platform === "darwin") {
    puppeteerRoots.push(join(homeDirectory, "Library", "Caches", "puppeteer", "chrome"));
  }
  const puppeteer = await versionedNestedCandidates({
    roots: puppeteerRoots,
    binaryPaths: platform === "darwin"
      ? [[/^chrome-mac-/u, "Google Chrome for Testing.app", "Contents", "MacOS", "Google Chrome for Testing"]]
      : [[/^chrome-linux/u, "chrome"]],
  });
  return [
    env.CHROME_PATH,
    env.PUPPETEER_EXECUTABLE_PATH,
    ...playwright,
    ...puppeteer,
    ...systemCandidates,
  ].filter(Boolean);
}

async function versionedNestedCandidates({ roots, versionPrefix = "", binaryPaths }) {
  const versions = [];
  for (const root of roots) {
    for (const name of await directoryNames(root, (entry) => entry.startsWith(versionPrefix))) {
      versions.push({ root, name });
    }
  }
  const candidates = [];
  for (const version of versions.sort((left, right) => right.name.localeCompare(left.name))) {
    const versionPath = join(version.root, version.name);
    for (const [directoryPattern, ...binaryPath] of binaryPaths) {
      const directories = await directoryNames(versionPath, (entry) => directoryPattern.test(entry));
      for (const directory of directories.sort((left, right) => right.localeCompare(left))) {
        candidates.push(join(versionPath, directory, ...binaryPath));
      }
    }
  }
  return candidates;
}

async function directoryNames(path, matches) {
  try {
    return (await readdir(path, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && matches(entry.name))
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

export function resolvePuppeteerPackagePath(
  resolvePackage = (specifier) => packageRequire.resolve(specifier),
) {
  try {
    return resolvePackage("puppeteer-core/package.json");
  } catch {
    return null;
  }
}

function adoptRasterizer(state, method) {
  state.provenance.rasterizer.adopted = method;
  state.provenance.rasterizer.attempts.push({ method, status: "adopted", reason: null });
  addRasterizerDowngradeWarning(state);
}

export function addRasterizerDowngradeWarning(state) {
  const rasterizer = state.provenance?.rasterizer;
  const planned = rasterizer?.planned;
  const adopted = rasterizer?.adopted;
  const order = state.plan?.rasterizer?.order ?? [];
  if (!planned || !adopted || order.indexOf(adopted) <= order.indexOf(planned)) return;
  const reason = rasterizer.attempts.find(
    (attempt) => attempt.method === planned && attempt.status === "rejected",
  )?.reason ?? "higher-priority rasterizer failed";
  const warning = `rasterizer downgraded: ${planned} -> ${adopted} (${reason})`;
  state.warnings ??= [];
  if (!state.warnings.includes(warning)) state.warnings.push(warning);
}

function rejectRasterizer(state, method, reason) {
  state.provenance.rasterizer.attempts.push({ method, status: "rejected", reason });
}

function addReference(map, root, label, path) {
  if (typeof path !== "string" || path === "") throw new ExecutionError(`${label} path is required`);
  map.set(label, { path: resolve(root, path) });
}

function audioPath(value) {
  return typeof value === "string" ? value : value?.path;
}

function resolveOutput(projectRoot, value) {
  return isAbsolute(value) ? value : resolve(projectRoot, value);
}

function ensureOutputDoesNotReplaceInput(projectRoot, edit, outputPath) {
  const inputs = [
    resolve(projectRoot, "edit.json"),
    resolve(projectRoot, edit.source.path),
    ...edit.overlays.map((overlay) => resolve(projectRoot, overlay.html)),
  ];
  const captions = resolve(projectRoot, "captions.json");
  if (existsSync(captions)) inputs.push(captions);
  const bgm = audioPath(edit.audio?.bgm);
  if (bgm) inputs.push(resolve(projectRoot, bgm));
  for (const value of edit.audio?.sfx ?? []) {
    const path = audioPath(value);
    if (path) inputs.push(resolve(projectRoot, path));
  }
  for (const value of edit.audio?.narration ?? []) {
    const path = audioPath(value);
    if (path) inputs.push(resolve(projectRoot, path));
  }
  for (const layer of edit.layers ?? []) {
    if (typeof layer?.src === "string" && layer.src !== "") inputs.push(resolve(projectRoot, layer.src));
  }
  if (inputs.includes(outputPath)) {
    throw new RefusalError("--out must not replace an input file");
  }
}

function compare(findings, check, passed, message) {
  findings.push({ severity: passed ? "info" : "error", check, message });
}

function parseRate(value) {
  if (typeof value !== "string") return Number.NaN;
  const [top, bottom = "1"] = value.split("/");
  return Number(top) / Number(bottom);
}

async function readRequired(path, label) {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    throw new ExecutionError(`${label} could not be read: ${messageOf(error)}`);
  }
}

function parseJson(text, label) {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new ExecutionError(`${label} is not valid JSON: ${messageOf(error)}`);
  }
}

async function isRegularFile(path) {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

async function isExecutable(path) {
  try {
    await access(path, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function readPackageVersion(path) {
  if (!(await isRegularFile(path))) return null;
  try {
    return JSON.parse(await readFile(path, "utf8")).version ?? null;
  } catch {
    return null;
  }
}

async function sha256File(path) {
  const hash = createHash("sha256");
  await new Promise((resolvePromise, rejectPromise) => {
    const stream = createReadStream(path);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", rejectPromise);
    stream.on("end", resolvePromise);
  });
  return hash.digest("hex");
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function relativeOrAbsolute(root, value) {
  const result = relative(root, value);
  return result.startsWith("..") ? value : result;
}

function positive(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}
