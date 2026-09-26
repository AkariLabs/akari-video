import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadAiModels } from '../src/ai-models.mjs';
import { loadCatalog } from '../src/cli/catalog.mjs';

const root = fileURLToPath(new URL('../../..', import.meta.url));
const sourcePath = path.join(root, 'packages/schemas/ai-models.json');

async function withCatalog(edit, check) {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'akari-ai-models-'));
  try {
    const folder = path.join(temp, 'packages/schemas');
    await mkdir(folder, { recursive: true });
    const supplements = JSON.parse(await readFile(sourcePath, 'utf8'));
    edit(supplements);
    await writeFile(path.join(folder, 'ai-models.json'), JSON.stringify(supplements));
    await writeFile(path.join(folder, 'gen-models.json'), await readFile(path.join(root, 'packages/schemas/gen-models.json')));
    await check(temp);
  } finally { await rm(temp, { recursive: true, force: true }); }
}

test('normalized inventory resolves source references and has expected kind counts', async () => {
  const rows = await loadAiModels();
  assert.deepEqual(Object.fromEntries(['image', 'video', 'voice', 'transcribe'].map(kind =>
    [kind, rows.filter(row => row.kind === kind).length])), { image: 11, video: 15, voice: 13, transcribe: 4 });
  assert.equal(rows.length, new Set(rows.map(row => row.id)).size);
  assert.ok(rows.every(row => row.maker && row.license.badge && row.verified && typeof row.callable === 'boolean'));
  assert.deepEqual(rows.find(row => row.id === 'fal:seedance-2.5-i2v').price.by_resolution,
    { '480p': 0.2205, '720p': 0.473 });
  assert.equal(rows.find(row => row.id === 'fal:seedance-2.5-i2v').price.as_of, '2026-09-26');
  assert.equal(rows.find(row => row.id === 'tts:elevenlabs-v3').price.value, 0.10);
});

test('entire normalized rows are stable across all kinds and a standalone route', async () => {
  const rows = await loadAiModels();
  const expected = {
    "codex:image": {
      "kind": "image",
      "name": "OpenAI GPT Image",
      "family": "OpenAI GPT Image",
      "via": "subscription",
      "provider": "codex",
      "inputs": {
        "prompt": null,
        "first_frame": "none",
        "last_frame": "none",
        "reference_images": {
          "max": 1
        },
        "reference_videos": {
          "max": 0
        },
        "reference_audios": {
          "max": 0
        },
        "source_video": [],
        "negative_prompt": false,
        "camera": "prose",
        "frames_and_refs_exclusive": false,
        "extra_allowed": []
      },
      "outputs": {
        "aspects": null,
        "aspect_mode": "prompt",
        "resolutions": null,
        "duration": null,
        "audio_out": false,
        "seed": false,
        "measured_dimensions": {
          "16:9": "1672x941",
          "9:16": "941x1672",
          "1:1": "1254x1254",
          "4:3": "1448x1086",
          "3:4": "900x1200",
          "4:5": "1120x1400",
          "3:2": "1536x1024",
          "21:9": "1470x630"
        },
        "measured_aspects": [
          "16:9",
          "9:16",
          "1:1",
          "4:3",
          "3:4",
          "4:5",
          "3:2",
          "21:9"
        ],
        "aspect_caveat": "9:16 は3回中1回が正方形"
      },
      "price": null,
      "as_of": "2026-09-12",
      "id": "codex:image",
      "maker": "openai",
      "group": "chatgpt-image",
      "main": true,
      "released": null,
      "license": {
        "badge": "commercial-ok",
        "note": "出力の権利は利用者に帰属。",
        "source_url": "https://openai.com/policies/terms-of-use/"
      },
      "verified": "measured",
      "measured_ref": "2026-09-23-image-routes-verify",
      "callable": true,
      "speed_s": 67.6
    },
    "fal:h3-i2v": {
      "kind": "video",
      "name": "MiniMax H3",
      "family": "MiniMax H3",
      "via": "api",
      "provider": "fal",
      "inputs": {
        "prompt": null,
        "first_frame": "optional",
        "last_frame": "optional",
        "reference_images": {
          "max": 0
        },
        "reference_videos": {
          "max": 0
        },
        "reference_audios": {
          "max": 0
        },
        "source_video": [],
        "negative_prompt": false,
        "camera": "bracket",
        "frames_and_refs_exclusive": false,
        "extra_allowed": [
          "enable_safety_checker",
          "prompt_expansion_mode",
          "sync_mode"
        ]
      },
      "outputs": {
        "aspects": null,
        "aspect_mode": "source",
        "resolutions": [
          "480P",
          "768P",
          "2K",
          "4K"
        ],
        "duration": {
          "kind": "range",
          "min": 5,
          "max": 15,
          "step": 1,
          "default": 5,
          "format": {
            "type": "integer"
          }
        },
        "audio_out": "always",
        "seed": true
      },
      "price": {
        "unit": "usd_per_second",
        "by_resolution": {
          "480P": 0.05,
          "768P": 0.06,
          "2K": 0.13,
          "4K": 0.16
        },
        "audio_multiplier": null,
        "as_of": "2026-09-12",
        "source_url": "https://fal.ai/models/minimax/h3/image-to-video"
      },
      "as_of": "2026-09-12",
      "id": "fal:h3-i2v",
      "maker": "minimax",
      "group": "h3",
      "main": true,
      "released": null,
      "license": {
        "badge": "conditional",
        "note": "提供経路の表示と利用規約に相違がある。",
        "source_url": "https://hailuoai.video/doc/terms-of-service.html"
      },
      "verified": "documented",
      "measured_ref": null,
      "callable": true,
      "speed_s": null
    },
    "tts:elevenlabs-v3": {
      "kind": "voice",
      "name": "ElevenLabs v3（既製の声）",
      "family": "ElevenLabs v3（既製の声）",
      "via": "api",
      "provider": "fal",
      "inputs": {
        "prompt": null,
        "first_frame": null,
        "last_frame": null,
        "reference_images": null,
        "reference_videos": null,
        "reference_audios": null,
        "source_video": null,
        "negative_prompt": null,
        "camera": null,
        "text": true,
        "style": false,
        "voice_clone": "none",
        "reference_audio": false,
        "speed": false
      },
      "outputs": {
        "aspects": null,
        "aspect_mode": null,
        "resolutions": null,
        "duration": null,
        "audio_out": true,
        "voices": [
          "Rachel",
          "Aria",
          "Sarah",
          "Laura",
          "Charlie",
          "George",
          "River",
          "Liam",
          "Charlotte",
          "Alice"
        ]
      },
      "price": {
        "unit": "usd_per_1000_chars",
        "value": 0.1,
        "as_of": "2026-09-24",
        "source_url": null
      },
      "as_of": "2026-09-24",
      "id": "tts:elevenlabs-v3",
      "maker": "elevenlabs",
      "group": "elevenlabs-v3",
      "main": true,
      "released": null,
      "license": {
        "badge": "conditional",
        "note": "無料プランは非商用。",
        "source_url": "https://elevenlabs.io/terms-of-use"
      },
      "verified": "documented",
      "measured_ref": null,
      "callable": true,
      "speed_s": null
    },
    "transcribe:whisper-cpp": {
      "id": "transcribe:whisper-cpp",
      "kind": "transcribe",
      "maker": "openai",
      "group": "whisper-cpp",
      "main": true,
      "released": null,
      "license": {
        "badge": "unknown",
        "note": "文字起こし用途の商用条件は未確認。",
        "source_url": null
      },
      "verified": "documented",
      "measured_ref": null,
      "callable": true,
      "name": "Whisper large-v3-turbo",
      "family": "Whisper large-v3-turbo",
      "via": "local",
      "provider": "whisper-cpp",
      "inputs": {
        "prompt": null,
        "first_frame": null,
        "last_frame": null,
        "reference_images": null,
        "reference_videos": null,
        "reference_audios": null,
        "source_video": null,
        "negative_prompt": null,
        "camera": null,
        "audio": true,
        "video": true
      },
      "outputs": {
        "aspects": null,
        "aspect_mode": null,
        "resolutions": null,
        "duration": null,
        "audio_out": false,
        "text": true
      },
      "price": {
        "unit": "usd_per_hour",
        "value": 0,
        "as_of": null,
        "source_url": null
      },
      "as_of": null,
      "speed_s": null
    },
    "still:grok": {
      "id": "still:grok",
      "kind": "image",
      "maker": "xai",
      "group": "grok-cli-image",
      "main": true,
      "released": null,
      "license": {
        "badge": "conditional",
        "note": "権利侵害の補償と帰属表示の条件に注意。",
        "source_url": "https://x.ai/legal/terms-of-service"
      },
      "verified": "measured",
      "measured_ref": "2026-09-26-still-aspect-verify",
      "callable": true,
      "name": "Grok CLI",
      "family": "Grok Imagine",
      "via": "subscription",
      "provider": "grok",
      "inputs": {
        "prompt": true,
        "first_frame": null,
        "last_frame": null,
        "reference_images": {
          "max": null
        },
        "reference_videos": null,
        "reference_audios": null,
        "source_video": null,
        "negative_prompt": null,
        "camera": null
      },
      "outputs": {
        "aspects": [
          "16:9",
          "9:16",
          "1:1",
          "4:3",
          "3:4",
          "4:5",
          "3:2",
          "21:9"
        ],
        "aspect_mode": "param",
        "resolutions": [
          "1280x720"
        ],
        "duration": null,
        "audio_out": false,
        "measured_dimensions": {
          "16:9": "1280x720",
          "9:16": "720x1280",
          "1:1": "1024x1024",
          "4:3": "1152x864",
          "3:4": "864x1152",
          "4:5": "864x1080",
          "3:2": "1248x832",
          "21:9": "1568x672"
        }
      },
      "price": null,
      "speed_s": 58.9,
      "as_of": "2026-09-26"
    }
  };
  for (const id of Object.keys(expected)) {
    assert.deepEqual(rows.find(row => row.id === id), expected[id], id);
  }
});

test('duplicate ids, duplicate group mains, missing group mains and missing references fail', async () => {
  await withCatalog(data => data.models.push({ ...data.models[0] }),
    root => assert.rejects(loadAiModels({ repoRoot: root }), /id が重複/));
  await withCatalog(data => { data.models[1].main = true; },
    root => assert.rejects(loadAiModels({ repoRoot: root }), /代表が複数/));
  await withCatalog(data => { data.models[0].main = false; },
    root => assert.rejects(loadAiModels({ repoRoot: root }), /代表が無い/));
  await withCatalog(data => { data.models[0].ref = 'gen-models:absent'; },
    root => assert.rejects(loadAiModels({ repoRoot: root }), /ref の先が無い/));
});

test('unavailable new rows never enter the existing generation catalog', async () => {
  const [rows, catalog] = await Promise.all([loadAiModels(), loadCatalog(root)]);
  const generationIds = new Set(catalog.models.filter(row => row.kind === 'video').map(row => row.id));
  assert.deepEqual(rows.filter(row => row.kind === 'video' && !row.callable && generationIds.has(row.id)), []);
  assert.equal(generationIds.size, 12);
});
