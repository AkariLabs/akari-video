import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";

const args = process.argv.slice(2);
let verify = false;
let outputArgument = null;
let minutes = 0.2;
let minutesSpecified = false;
for (let index = 0; index < args.length; index += 1) {
  const argument = args[index];
  if (argument === "--verify") verify = true;
  else if (argument === "--minutes") {
    if (index + 1 >= args.length) throw new Error("--minutes requires a positive number");
    minutes = Number(args[++index]);
    if (!Number.isFinite(minutes) || minutes <= 0) throw new Error("--minutes requires a positive number");
    minutesSpecified = true;
  } else if (argument.startsWith("--")) throw new Error(`unknown option: ${argument}`);
  else if (outputArgument === null) outputArgument = argument;
  else throw new Error("only one output directory may be provided");
}
if (!outputArgument) throw new Error("Usage: build-fixture.mjs <output-directory> [--minutes <n>] [--verify]");
const output = resolve(outputArgument);
const fixtureOptions = { minutes, syncMarkers: minutesSpecified };
await build(output, fixtureOptions);
if (verify) {
  const scratch = await mkdtemp(join(tmpdir(), "akari-osr-fixture-"));
  try {
    await build(scratch, fixtureOptions);
    const left = await hashTree(output);
    const right = await hashTree(scratch);
    if (JSON.stringify(left) !== JSON.stringify(right)) throw new Error("fixture determinism check failed");
    process.stdout.write("fixture determinism check passed\n");
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

async function build(root, { minutes, syncMarkers }) {
  const fps = 30;
  const requestedDuration = syncMarkers ? minutes * 60 : 12;
  const totalFrames = Math.max(1, Math.round(requestedDuration * fps));
  const durationSeconds = totalFrames / fps;
  const sourceDuration = syncMarkers ? durationSeconds : 8;
  const firstCutFrames = Math.floor(totalFrames / 2);
  const secondCutFrames = totalFrames - firstCutFrames;
  const firstCutSeconds = firstCutFrames / fps;
  const secondCutSeconds = secondCutFrames / fps;
  await mkdir(join(root, "assets"), { recursive: true });
  await mkdir(join(root, "overlays"), { recursive: true });
  ffmpeg([
    "-f", "lavfi", "-i", `testsrc2=size=1920x1080:rate=30:duration=${formatNumber(sourceDuration)}`,
    ...(syncMarkers ? ["-vf", flashFilter(0)] : []),
    // B フレーム素材は負の DTS で始まり、デコード経路が並べ替え遅延ぶん手前のコマを返す。
    // fixture は書き出し経路の比較が目的なので -bf 0 でその変数を消す。
    "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p", "-g", "30", "-bf", "0",
    join(root, "assets", "src-a.mp4"),
  ]);
  ffmpeg([
    "-f", "lavfi", "-i", `smptebars=size=1920x1080:rate=30:duration=${formatNumber(sourceDuration)}`,
    ...(syncMarkers ? ["-vf", flashFilter(firstCutFrames)] : []),
    "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p", "-g", "30", "-bf", "0",
    join(root, "assets", "src-b.mp4"),
  ]);
  if (syncMarkers) {
    ffmpeg([
      "-f", "lavfi", "-i", clickSource(durationSeconds),
      "-c:a", "pcm_s16le", join(root, "assets", "bgm.wav"),
    ]);
  } else {
    ffmpeg(["-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=12", "-c:a", "pcm_s16le", join(root, "assets", "bgm.wav")]);
  }
  await rm(join(root, "assets", "empty-scene.glb"), { force: true });
  await writeFile(join(root, "assets", "visible-cube.glb"), visibleCubeGlb());

  const overlays = [
    ["title", "0", "90", "<div><style>.title{font:900 96px system-ui;color:#fff;animation:rise 3s ease both}@keyframes rise{from{transform:translateY(80px);opacity:0}to{transform:none;opacity:1}}</style><div class=\"title\">OSR EXPORT</div></div>"],
    ["badge", "60", "90", "<div><style>.badge{position:absolute;right:80px;top:80px;padding:18px 28px;background:#ff365e;color:white;border-radius:999px;font:700 38px system-ui;animation:pulse 1s ease-in-out infinite alternate}@keyframes pulse{to{transform:scale(1.12)}}</style><div class=\"badge\">LIVE</div></div>"],
    ["bars", "150", "90", "<div><style>.bars{display:flex;gap:12px;align-items:end;height:100%;justify-content:center}.bars i{width:38px;background:#44e0ff;animation:bar .8s ease-in-out infinite alternate}.bars i:nth-child(2){animation-delay:.2s}.bars i:nth-child(3){animation-delay:.4s}@keyframes bar{from{height:80px}to{height:320px}}</style><div class=\"bars\"><i></i><i></i><i></i></div></div>"],
    ["outro", "270", "90", "<div><style>.outro{display:grid;place-items:center;width:100%;height:100%;font:800 82px system-ui;color:#fff;background:radial-gradient(circle,#6050ff88,transparent 60%);animation:spin 3s linear both}@keyframes spin{from{filter:blur(20px);transform:rotate(-4deg)}to{filter:blur(0);transform:none}}</style><div class=\"outro\">ONE PAGE. ONE FRAME.</div></div>"],
  ];
  for (const [id, , , html] of overlays) await writeFile(join(root, "overlays", `${id}.html`), `${html}\n`);
  await writeFile(join(root, "overlays", "scene-3d.html"), `<div style="position:absolute;inset:0"><canvas style="width:100%;height:100%"></canvas><div data-akari-3d-fallback></div><script type="application/json" data-akari-3d-scene>{"model":"assets/visible-cube.glb","camera":{"position":[0,0,4],"lookAt":[0,0,0],"fov":42},"environment":{"intensity":1}}</script></div>\n`);

  const tracks = [
    {
      id: "a-bgm", lane: "audio", items: [{ id: "bgm", at: 0, duration: totalFrames, role: "bgm", source: { kind: "media", src: "bgm", in: 0, out: durationSeconds } }],
    },
    {
      id: "v-main", lane: "visual", items: [
        { id: "clip-a", at: 0, duration: firstCutFrames, source: { kind: "media", src: "a", in: 0, out: firstCutSeconds } },
        { id: "clip-b", at: firstCutFrames, duration: secondCutFrames, source: { kind: "media", src: "b", in: 0, out: secondCutSeconds } },
      ],
    },
    { id: "captions", lane: "visual", content: { from: "captions.json" } },
    ...overlays.map(([id, at, durationFrames]) => ({ id: `v-${id}`, lane: "visual", items: [{ id, at: Number(at), duration: Number(durationFrames), source: { kind: "html", path: `overlays/${id}.html` } }] })),
    { id: "v-three", lane: "visual", items: [{ id: "scene-3d", at: 90, duration: 180, source: { kind: "html", path: "overlays/scene-3d.html" } }] },
  ];
  await writeFile(join(root, "edit.json"), `${JSON.stringify({
    version: 2,
    output: { width: 1920, height: 1080, fps: 30 },
    sources: [
      { id: "a", path: "assets/src-a.mp4", proxy: null },
      { id: "b", path: "assets/src-b.mp4", proxy: null },
      { id: "bgm", path: "assets/bgm.wav", proxy: null },
    ],
    tracks,
  }, null, 2)}\n`);
  await writeFile(join(root, "captions.json"), `${JSON.stringify({ captions: [
    { id: "c-0001", start: 0.5, end: 2.5, text: "ページ全体を", display_text: "ページ全体を", style: "karaoke", time_domain: "output", speaker: null, sourceRef: null, edited: false, words: [{ text: "ページ", start: 0.5, end: 1.1 }, { text: "全体を", start: 1.1, end: 2.5 }] },
    { id: "c-0002", start: 4, end: 6, text: "一枚に合成", style: "karaoke", time_domain: "output", speaker: null, sourceRef: null, edited: false },
    { id: "c-0003", start: 8.5, end: 11, text: "決定論的に書き出す", style: "karaoke", time_domain: "output", speaker: null, sourceRef: null, edited: false },
  ] }, null, 2)}\n`);
}

function ffmpeg(args) {
  const result = spawnSync(process.env.FFMPEG ?? "ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], { encoding: "utf8" });
  if (result.error || result.status !== 0) throw new Error(`ffmpeg fixture generation failed: ${result.error?.message ?? result.stderr}`);
}

function flashFilter(outputOffsetFrames) {
  const outputFrame = outputOffsetFrames === 0 ? "n" : `n+${outputOffsetFrames}`;
  const expression = `gte(${outputFrame}\\,300)*eq(mod(${outputFrame}\\,300)\\,0)`;
  return `drawbox=x=0:y=0:w=iw:h=ih:color=white:t=fill:enable='${expression}'`;
}

function clickSource(durationSeconds) {
  const expression = "if(gte(t\\,10)*lt(mod(t\\,10)\\,0.03)\\,0.8*sin(2*PI*1000*t)\\,0)";
  return `aevalsrc=exprs='${expression}':s=48000:d=${formatNumber(durationSeconds)}`;
}

function formatNumber(value) {
  return Number(value.toFixed(9)).toString();
}

function visibleCubeGlb() {
  const positions = [
    [-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1],
    [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1],
  ];
  const indices = [
    0, 2, 1, 0, 3, 2,
    4, 5, 6, 4, 6, 7,
    0, 1, 5, 0, 5, 4,
    2, 3, 7, 2, 7, 6,
    1, 2, 6, 1, 6, 5,
    3, 0, 4, 3, 4, 7,
  ];
  const positionBytes = Buffer.alloc(positions.length * 3 * 4);
  positions.flat().forEach((value, index) => positionBytes.writeFloatLE(value, index * 4));
  const indexBytes = Buffer.alloc(indices.length * 2);
  indices.forEach((value, index) => indexBytes.writeUInt16LE(value, index * 2));
  const binary = Buffer.concat([positionBytes, indexBytes]);
  const json = Buffer.from(JSON.stringify({
    asset: { version: "2.0", generator: "AKARI OSR deterministic fixture" },
    extensionsUsed: ["KHR_materials_unlit"],
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1, material: 0 }] }],
    materials: [{
      pbrMetallicRoughness: { baseColorFactor: [0.1, 0.85, 1, 1], metallicFactor: 0, roughnessFactor: 1 },
      emissiveFactor: [0.1, 0.85, 1],
      doubleSided: true,
      extensions: { KHR_materials_unlit: {} },
    }],
    buffers: [{ byteLength: binary.length }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: positionBytes.length, target: 34962 },
      { buffer: 0, byteOffset: positionBytes.length, byteLength: indexBytes.length, target: 34963 },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: positions.length, type: "VEC3", min: [-1, -1, -1], max: [1, 1, 1] },
      { bufferView: 1, componentType: 5123, count: indices.length, type: "SCALAR", min: [0], max: [7] },
    ],
  }));
  const paddedLength = Math.ceil(json.length / 4) * 4;
  const jsonChunk = Buffer.alloc(paddedLength, 0x20);
  json.copy(jsonChunk);
  const binaryPaddedLength = Math.ceil(binary.length / 4) * 4;
  const binaryChunk = Buffer.alloc(binaryPaddedLength);
  binary.copy(binaryChunk);
  const output = Buffer.alloc(12 + 8 + paddedLength + 8 + binaryPaddedLength);
  output.writeUInt32LE(0x46546c67, 0);
  output.writeUInt32LE(2, 4);
  output.writeUInt32LE(output.length, 8);
  output.writeUInt32LE(paddedLength, 12);
  output.writeUInt32LE(0x4e4f534a, 16);
  jsonChunk.copy(output, 20);
  const binaryHeader = 20 + paddedLength;
  output.writeUInt32LE(binaryPaddedLength, binaryHeader);
  output.writeUInt32LE(0x004e4942, binaryHeader + 4);
  binaryChunk.copy(output, binaryHeader + 8);
  return output;
}

async function hashTree(root) {
  const files = [];
  async function walk(directory) {
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name === ".akari") continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await walk(path);
      else files.push([relative(root, path), createHash("sha256").update(await readFile(path)).digest("hex")]);
    }
  }
  await walk(root);
  return files;
}
