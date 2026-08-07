#!/usr/bin/env node
// 演出レシピ展開 CLI。presets/direction/index.jsonl の 1 レシピを、既存プロジェクトの
// edit.json / captions.json への追記パッチとして生成し（--project 省略時は stdout へ）、
// --project 指定時はそのプロジェクトへ適用する。
//
// Usage:
//   node bin/expand-direction.mjs <recipe-id> --cut <n> [options]
//
// Options:
//   --cut <n>          展開対象カットの index（必須）
//   --lead-cut <n>      transition_in の展開先カット index（省略時 cut-1）
//   --text <string>     画面に出す文言（省略時は文字レイヤーを展開しない）
//   --project <dir>     適用先プロジェクトルート（省略時は patch を stdout へ出力するだけ）
//   --audio-root <dir>  AKARI Sounds 探索ルート（既定 ~/.akari/assets/audio）
//   --recipes <path>    index.jsonl の場所（既定 presets/direction/index.jsonl をリポルートから解決）
//   --cut-in <sec>      --project 省略時、パッチ内容確認用に source in を明示指定
//   --cut-out <sec>     --project 省略時、パッチ内容確認用に source out を明示指定
//   --cut-speed <n>     --project 省略時、パッチ内容確認用に cuts[].speed を明示指定
//   --source <path>     --project 省略時、マット生成元のソースパスを明示指定
//   --fps <n>           --project 省略時、マット生成 fps を明示指定
//
// 契約: docs/contract-2026-08-06-direction-recipes-v0.md

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

import { parseRecipeIndex, findRecipe } from '../src/recipes.mjs';
import { buildDirectionPatch } from '../src/core.mjs';
import { applyPatchToEdit, applyPatchToCaptions } from '../src/apply.mjs';
import { resolveAndCopySfx } from '../src/sfx-resolve.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..');

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--cut') args.cut = Number(argv[++i]);
    else if (token === '--lead-cut') args.leadCut = Number(argv[++i]);
    else if (token === '--text') args.text = argv[++i];
    else if (token === '--project') args.project = argv[++i];
    else if (token === '--audio-root') args.audioRoot = argv[++i];
    else if (token === '--recipes') args.recipes = argv[++i];
    else if (token === '--cut-in') args.cutIn = Number(argv[++i]);
    else if (token === '--cut-out') args.cutOut = Number(argv[++i]);
    else if (token === '--cut-speed') args.cutSpeed = Number(argv[++i]);
    else if (token === '--source') args.source = argv[++i];
    else if (token === '--fps') args.fps = Number(argv[++i]);
    else args._.push(token);
  }
  return args;
}

async function readJsonIfExists(filePath) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function cutTimelineStart(cuts, cutIndex) {
  let t = 0;
  for (let i = 0; i < cutIndex; i += 1) {
    const cut = cuts[i];
    if (!cut) break;
    const speed = cut.speed ?? 1;
    const base = (cut.out - cut.in) / speed;
    const freezeExtra = cut.freeze?.duration_sec ?? 0;
    t += base + freezeExtra;
  }
  return t;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const recipeId = args._[0];
  if (!recipeId || !Number.isInteger(args.cut) || args.cut < 0) {
    console.error('Usage: expand-direction.mjs <recipe-id> --cut <n> [--text <string>] [--project <dir>] ...');
    process.exitCode = 2;
    return;
  }

  const recipesPath = args.recipes
    ? path.resolve(args.recipes)
    : path.join(repoRoot, 'presets', 'direction', 'index.jsonl');
  const recipes = parseRecipeIndex(await readFile(recipesPath, 'utf8'));
  const recipe = findRecipe(recipes, recipeId);
  if (!recipe) {
    console.error(`recipe "${recipeId}" not found in ${recipesPath}`);
    process.exitCode = 2;
    return;
  }

  let edit = null;
  let captionsRoot = null;
  let cutInSec = args.cutIn;
  let cutOutSec = args.cutOut;
  let cutTimelineStartSec = 0;
  let cutSpeed = args.cutSpeed ?? 1;
  let cutSourcePath = args.source;
  let cutTransform = null;
  let outputFps = args.fps;
  const projectRoot = args.project ? path.resolve(args.project) : null;

  if (projectRoot) {
    edit = await readJsonIfExists(path.join(projectRoot, 'edit.json'));
    if (!edit) {
      console.error(`${path.join(projectRoot, 'edit.json')} not found`);
      process.exitCode = 2;
      return;
    }
    const cut = edit.cuts?.[args.cut];
    if (!cut) {
      console.error(`edit.json cuts[${args.cut}] does not exist`);
      process.exitCode = 2;
      return;
    }
    cutInSec = cut.in;
    cutOutSec = cut.out;
    cutTimelineStartSec = cutTimelineStart(edit.cuts, args.cut);
    cutSpeed = cut.speed ?? 1;
    cutTransform = cut.transform ?? null;
    outputFps = edit.output?.fps;
    cutSourcePath = edit.version === 1
      ? edit.sources?.find((source) => source.id === cut.src)?.path
      : edit.source?.path;
    captionsRoot = await readJsonIfExists(path.join(projectRoot, 'captions.json'));
  }

  let resolvedSfx = null;
  if (recipe.layers?.audio?.se_default && projectRoot) {
    const audioRoot = args.audioRoot
      ? path.resolve(args.audioRoot)
      : path.join(os.homedir(), '.akari', 'assets', 'audio');
    resolvedSfx = await resolveAndCopySfx({
      audioRoot,
      projectRoot,
      seDefaultId: recipe.layers.audio.se_default,
    });
  }

  const patch = buildDirectionPatch({
    recipe,
    cutIndex: args.cut,
    cutInSec,
    cutOutSec,
    cutTimelineStartSec,
    cutSpeed,
    cutSourcePath,
    cutTransform,
    outputFps,
    edit,
    leadCutIndex: Number.isInteger(args.leadCut) ? args.leadCut : undefined,
    text: args.text,
    resolvedSfx,
  });

  if (!projectRoot) {
    process.stdout.write(`${JSON.stringify(patch)}\n`);
    return;
  }

  let nextEdit = applyPatchToEdit(edit, patch);
  if (patch.layers_patch) {
    nextEdit = {
      ...nextEdit,
      layers: [...(Array.isArray(nextEdit.layers) ? nextEdit.layers : []), patch.layers_patch],
    };
  }
  if (patch.timeline_tracks_patch) {
    nextEdit = {
      ...nextEdit,
      timeline: { ...(nextEdit.timeline ?? {}), tracks: patch.timeline_tracks_patch },
    };
  }
  const nextCaptions = patch.caption_patch ? applyPatchToCaptions(captionsRoot, patch) : captionsRoot;

  await writeFile(path.join(projectRoot, 'edit.json'), `${JSON.stringify(nextEdit, null, 2)}\n`, 'utf8');
  if (nextCaptions) {
    await writeFile(path.join(projectRoot, 'captions.json'), `${JSON.stringify(nextCaptions, null, 2)}\n`, 'utf8');
  }
  process.stdout.write(`${JSON.stringify(patch)}\n`);
}

main().catch((error) => {
  console.error(error.message ?? error);
  process.exitCode = 1;
});
