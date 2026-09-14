import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { homedir, tmpdir } from "node:os";

import { generateCodexImages } from "./codex-image.mjs";
import { renderTextCard } from "./text-card.mjs";
import { hasGeneratedId, insertGeneratedStills, readEditForPlan, firstVisualTrack, endOfTrack } from "./edit-insert.mjs";
import { doneStillMeta, failedStillMeta, inspectPng, plannedStillMeta, readCodexModelAsOf } from "./meta-still.mjs";
import { validateGenerationMeta } from "./meta-validate.mjs";
import { STILL_USAGE } from "./usage.mjs";

function parseArgs(argv) {
  if (argv.includes("--help") || argv.includes("-h")) return { help: true };
  const parsed = { parallel: 4, placeholder: false, dryRun: false, json: false };
  const positional = [];
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--spec") parsed.spec = argv[++index];
    else if (value === "--parallel") parsed.parallel = Number(argv[++index]);
    else if (value === "--placeholder") parsed.placeholder = true;
    else if (value === "--dry-run") parsed.dryRun = true;
    else if (value === "--json") parsed.json = true;
    else if (value.startsWith("-")) throw new Error(`不明なオプションです: ${value}`);
    else positional.push(value);
  }
  if (positional.length !== 1) throw new Error("projectDir を 1 つ指定してください");
  if (!parsed.spec) throw new Error("--spec <beats.json> が必要です");
  if (!Number.isInteger(parsed.parallel) || parsed.parallel < 1 || parsed.parallel > 32) {
    throw new Error("--parallel は 1〜32 の整数で指定してください");
  }
  parsed.projectDir = resolve(positional[0]);
  parsed.spec = isAbsolute(parsed.spec) ? parsed.spec : resolve(parsed.spec);
  return parsed;
}

async function loadSpec(path) {
  const raw = JSON.parse(await readFile(path, "utf8"));
  if (!Array.isArray(raw) && raw?.style_suffix !== undefined && typeof raw.style_suffix !== "string") {
    throw new Error("style_suffix は文字列で指定してください");
  }
  const styleSuffix = Array.isArray(raw) ? "" : raw?.style_suffix ?? "";
  const beats = Array.isArray(raw) ? raw : raw?.beats;
  if (!Array.isArray(beats) || beats.length === 0) throw new Error("spec は 1 件以上の beats 配列を必要とします");
  const ids = new Set();
  return {
    styleSuffix,
    beats: beats.map((beat, index) => {
      if (!beat || typeof beat !== "object") throw new Error(`beats[${index}] が object ではありません`);
      if (typeof beat.id !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(beat.id)) throw new Error(`beats[${index}].id は kebab-case が必要です`);
      if (ids.has(beat.id)) throw new Error(`beat id が重複しています: ${beat.id}`);
      ids.add(beat.id);
      if (typeof beat.prompt !== "string") throw new Error(`beats[${index}].prompt は文字列が必要です`);
      if (typeof beat.duration_s !== "number" || !Number.isFinite(beat.duration_s) || beat.duration_s <= 0) throw new Error(`beats[${index}].duration_s は正の数が必要です`);
      return { id: beat.id, prompt: beat.prompt, duration_s: beat.duration_s, ...(typeof beat.name === "string" ? { name: beat.name } : {}) };
    }),
  };
}

function sentPrompt(prompt, suffix) {
  return suffix ? `${prompt}\n\n${suffix}` : prompt;
}

function sanitizeEvidenceText(value, projectDir) {
  return String(value)
    .replaceAll(resolve(projectDir), "<WORKTREE>")
    .replaceAll(homedir(), "<HOME>")
    .replaceAll(tmpdir(), "<TMP>");
}

function printPlan(rows, json, log) {
  if (json) {
    log(JSON.stringify({ planned: rows }, null, 2));
    return;
  }
  log("id\t尺(秒)\tat(フレーム)\t出力\t方式");
  for (const row of rows) log(`${row.id}\t${row.duration_s}\t${row.at}\t${row.path}\t${row.mode}`);
}

export async function runStillCommand(argv, options = {}) {
  const log = options.log ?? ((line) => console.log(line));
  const logError = options.logError ?? ((line) => console.error(line));
  let args;
  try {
    args = parseArgs(argv);
    if (args.help) {
      log(STILL_USAGE);
      return { exitCode: 0 };
    }
  } catch (error) {
    logError(error instanceof Error ? error.message : String(error));
    logError(STILL_USAGE);
    return { exitCode: 2 };
  }

  let spec;
  let edit;
  try {
    spec = await loadSpec(args.spec);
    edit = await (options.readEditForPlan ?? readEditForPlan)(args.projectDir);
  } catch (error) {
    logError(`入力を読めません: ${sanitizeEvidenceText(error instanceof Error ? error.message : String(error), args.projectDir)}`);
    return { exitCode: 2 };
  }
  const fps = Number(edit.output?.fps) || 30;
  let at = endOfTrack(firstVisualTrack(edit));
  const rows = [];
  let preSkipped = 0;
  for (const beat of spec.beats) {
    const frames = Math.round(beat.duration_s * fps);
    const path = `assets/generated/${beat.id}.png`;
    if (hasGeneratedId(edit, beat.id)) {
      logError(`WARN: gen-${beat.id} は既にあるため上書きしません`);
      preSkipped += 1;
      continue;
    }
    rows.push({ ...beat, frames, at, path, mode: args.placeholder ? "文字カード" : "Codex" });
    at += frames;
  }
  if (args.dryRun) {
    printPlan(rows, args.json, log);
    return { exitCode: 0, planned: rows };
  }

  if (rows.length === 0) {
    const summary = { generated: 0, failed: 0, skipped: preSkipped };
    if (args.json) log(JSON.stringify(summary));
    else log(`完了: 0 枚、失敗 0 枚、スキップ ${summary.skipped} 枚`);
    return { exitCode: 0, ...summary };
  }

  const now = options.now ?? (() => new Date());
  const asOf = await (options.readCodexModelAsOf ?? readCodexModelAsOf)();
  const writeMetaImpl = options.writeMeta ?? (async (path, value) => {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  });
  const writeMeta = async (path, value) => {
    const checked = validateGenerationMeta(value);
    if (!checked.ok) throw new Error(`generation meta の検証に失敗しました:\n- ${checked.errors.join("\n- ")}`);
    await writeMetaImpl(path, value);
  };
  const successful = [];
  let failed = 0;
  if (args.placeholder) {
    const makeCard = options.renderTextCard ?? renderTextCard;
    for (const row of rows) {
      const absolute = join(args.projectDir, row.path);
      const createdAt = now().toISOString();
      const card = await makeCard({
        outPath: absolute,
        id: row.id,
        name: row.name ?? row.prompt,
        prompt: row.prompt,
        logRenderer: (line) => logError(sanitizeEvidenceText(line, args.projectDir)),
      });
      const meta = plannedStillMeta({
        prompt: row.prompt,
        duration_s: row.duration_s,
        at: createdAt,
        asOf,
      });
      meta.provenance.tool = `akari generate still --placeholder (${card.renderer ?? "solid"})`;
      await writeMeta(`${absolute}.meta.json`, meta);
      successful.push(row);
    }
  } else {
    const generate = options.generateImages ?? generateCodexImages;
    const generated = await generate({
      projectDir: args.projectDir,
      parallel: args.parallel,
      items: rows.map((row) => ({ id: row.id, path: row.path, prompt: sentPrompt(row.prompt, spec.styleSuffix) })),
      log: args.json ? logError : log,
      logError,
    });
    for (const row of rows) {
      const result = generated.find((entry) => entry.id === row.id);
      const absolute = join(args.projectDir, row.path);
      const createdAt = now().toISOString();
      const prompt = sentPrompt(row.prompt, spec.styleSuffix);
      if (!result?.ok) {
        const reason = sanitizeEvidenceText(result?.error ?? "Codex 画像生成から結果が返りませんでした", args.projectDir);
        await writeMeta(`${absolute}.meta.json`, failedStillMeta({ prompt, duration_s: row.duration_s, at: createdAt, asOf, reason }));
        failed += 1;
        continue;
      }
      try {
        const image = await (options.inspectPng ?? inspectPng)(absolute);
        await writeMeta(`${absolute}.meta.json`, doneStillMeta({ prompt, duration_s: row.duration_s, at: createdAt, asOf, path: row.path, image, elapsed_s: result.elapsed_s }));
        successful.push(row);
      } catch (error) {
        const reason = sanitizeEvidenceText(error instanceof Error ? error.message : String(error), args.projectDir);
        await writeMeta(`${absolute}.meta.json`, failedStillMeta({ prompt, duration_s: row.duration_s, at: createdAt, asOf, reason }));
        failed += 1;
      }
    }
  }

  if (successful.length > 0) {
    await (options.insertGeneratedStills ?? insertGeneratedStills)({
      projectDir: args.projectDir,
      beats: successful,
      ...(options.editDependencies ?? {}),
    });
  }
  const summary = { generated: successful.length, failed, skipped: preSkipped + rows.length - successful.length - failed };
  if (args.json) log(JSON.stringify(summary));
  else log(`完了: ${summary.generated} 枚、失敗 ${summary.failed} 枚、スキップ ${summary.skipped} 枚`);
  return { exitCode: failed > 0 ? 1 : 0, ...summary };
}
