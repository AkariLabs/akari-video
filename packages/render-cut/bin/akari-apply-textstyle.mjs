#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isMainModule } from "./is-main-module.mjs";

const USAGE = "使い方: akari-apply-textstyle <project-dir> <preset-id> [--caption <index|id>...] [--dry-run]";
const DEEP_MERGE_KEYS = ["stroke", "background", "shadow", "glow", "position", "animation"];

export function resolvePresetStyleFields(preset) {
  const style = preset.style ?? {};
  const position = style.position ?? preset.position;
  const animation = style.animation ?? preset.animation;
  return {
    ...style,
    ...(position ? { position } : {}),
    ...(animation ? { animation } : {}),
  };
}

export function mergeTextStyle(existing, incoming) {
  const base = existing ?? {};
  const override = incoming ?? {};
  const merged = { ...base, ...override };
  for (const key of DEEP_MERGE_KEYS) {
    if (base[key] != null || override[key] != null) {
      merged[key] = {
        ...(base[key] ?? {}),
        ...(override[key] ?? {}),
      };
    }
  }
  return merged;
}

export async function runCli(args, io = console) {
  try {
    const options = parseArguments(args);
    const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
    const preset = await loadPreset(repoRoot, options.presetId);
    const presetFields = resolvePresetStyleFields(preset);
    const captionsPath = resolve(options.projectDir, "captions.json");
    const captionsRoot = await loadCaptions(captionsPath);
    const changes = [];
    let updatedRoot = captionsRoot.root;

    if (options.captionSelectors.length === 0) {
      const before = captionsRoot.defaultTextStyle ?? null;
      const after = mergeTextStyle(captionsRoot.defaultTextStyle, presetFields);
      changes.push({ target: "default_text_style", before, after });
      updatedRoot = captionsRoot.isArrayRoot
        ? { default_text_style: after, captions: captionsRoot.captionsArray }
        : { ...captionsRoot.root, default_text_style: after };
    } else {
      const targets = options.captionSelectors.map((selector) =>
        resolveCaptionTarget(captionsRoot.captionsArray, selector));
      for (const index of targets) {
        const caption = captionsRoot.captionsArray[index];
        if (caption === null || typeof caption !== "object" || Array.isArray(caption)) {
          throw new Error(`captions[${index}] はオブジェクトである必要があります。`);
        }
        const before = caption.text_style ?? null;
        const after = mergeTextStyle(caption.text_style, presetFields);
        caption.text_style = after;
        changes.push({ target: `captions[${index}].text_style`, before, after });
      }
    }

    const result = {
      preset_id: options.presetId,
      captions_path: captionsPath,
      dry_run: options.dryRun,
      changes,
    };
    if (!options.dryRun) {
      await writeFile(captionsPath, `${JSON.stringify(updatedRoot, null, 2)}\n`, "utf8");
    }
    io.log(JSON.stringify(result, null, 2));
    return 0;
  } catch (error) {
    io.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

function parseArguments(args) {
  const positionals = [];
  const options = { captionSelectors: [], dryRun: false };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--caption") {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error(`--caption に index または id を指定してください。\n${USAGE}`);
      }
      options.captionSelectors.push(value);
      index += 1;
    } else if (argument === "--dry-run") {
      options.dryRun = true;
    } else if (argument.startsWith("--")) {
      throw new Error(`不明なフラグです: ${argument}\n${USAGE}`);
    } else {
      positionals.push(argument);
    }
  }
  if (positionals.length !== 2) {
    throw new Error(USAGE);
  }
  return {
    ...options,
    projectDir: resolve(positionals[0]),
    presetId: positionals[1],
  };
}

async function loadPreset(repoRoot, presetId) {
  const presetPath = resolve(repoRoot, "presets", "textstyle", `${presetId}.json`);
  try {
    return JSON.parse(await readFile(presetPath, "utf8"));
  } catch {
    const candidates = await loadPresetCandidates(repoRoot);
    throw new Error(
      `textstyle preset を読み込めません: ${presetId}\n候補:\n`
      + candidates.map(({ id, name }) => `  ${id} — ${name}`).join("\n"),
    );
  }
}

async function loadPresetCandidates(repoRoot) {
  const indexPath = resolve(repoRoot, "presets", "textstyle", "index.jsonl");
  try {
    const source = await readFile(indexPath, "utf8");
    return source
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line))
      .filter((entry) => typeof entry.id === "string" && typeof entry.name === "string")
      .map(({ id, name }) => ({ id, name }));
  } catch (error) {
    throw new Error(`${indexPath} から preset 候補を読み取れません: ${error.message}`);
  }
}

async function loadCaptions(captionsPath) {
  let source;
  try {
    source = await readFile(captionsPath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new Error(`captions.json が見つかりません: ${captionsPath}`);
    }
    throw new Error(`captions.json を読み取れません: ${captionsPath}（${error.message}）`);
  }

  let root;
  try {
    root = JSON.parse(source);
  } catch (error) {
    throw new Error(`captions.json を JSON として読み取れません: ${captionsPath}（${error.message}）`);
  }

  if (Array.isArray(root)) {
    return {
      root,
      captionsArray: root,
      defaultTextStyle: undefined,
      isArrayRoot: true,
    };
  }
  if (root !== null && typeof root === "object" && !Array.isArray(root)) {
    if (!Array.isArray(root.captions)) {
      throw new Error(`captions.json の captions は配列である必要があります: ${captionsPath}`);
    }
    return {
      root,
      captionsArray: root.captions,
      defaultTextStyle: root.default_text_style,
      isArrayRoot: false,
    };
  }
  throw new Error(`captions.json のルートは配列またはオブジェクトである必要があります: ${captionsPath}`);
}

function resolveCaptionTarget(captions, selector) {
  if (/^\d+$/u.test(selector)) {
    const index = Number(selector);
    if (!Number.isSafeInteger(index) || index >= captions.length) {
      throw new Error(`caption index が範囲外です: ${selector}（0-${Math.max(captions.length - 1, 0)}）`);
    }
    return index;
  }
  const index = captions.findIndex((caption) => caption?.id === selector);
  if (index === -1) {
    throw new Error(`caption id が見つかりません: ${selector}`);
  }
  return index;
}

if (isMainModule(import.meta.url, process.argv[1])) {
  process.exitCode = await runCli(process.argv.slice(2));
}
