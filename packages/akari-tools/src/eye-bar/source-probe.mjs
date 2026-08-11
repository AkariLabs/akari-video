// source-probe.mjs — ソース動画の「表示上の」寸法（回転メタデータ補正後の width/height）を
// ffprobe で取得する。face_landmarks の正規化座標（契約 §2「0〜1 正規化・左上原点」）は
// vision-tracks-helper が回転補正済みのフレームに対して出しているため（skills/analyze-footage/
// bin/vision-tracks/vision-tracks.mjs の probeSource と同じロジック）、contain フィット計算も
// 同じ回転補正後の寸法を使わないと帯の位置がずれる。ロジックを小さく複製している
// （vision-tracks.mjs は skills/ 配下のエージェント起動スクリプトであり、packages/ からの
// import 対象にしない — レイヤー分離を保つため）。
import { spawnSync } from "node:child_process";

import { resolveFfprobe } from "../../../media-bin/src/index.mjs";

export function probeSourceDisplaySize(sourcePath, { ffprobeCommand } = {}) {
  const ffprobe = ffprobeCommand ?? resolveFfprobe();
  const result = spawnSync(
    ffprobe,
    [
      "-v", "error",
      "-select_streams", "v:0",
      "-show_entries", "stream=width,height:stream_side_data=rotation",
      "-of", "json",
      sourcePath,
    ],
    { encoding: "utf8" },
  );
  if (result.error || result.status !== 0) {
    return { ok: false, reason: String(result.stderr ?? result.error?.message ?? "ffprobe failed").slice(0, 2000) };
  }
  let parsed;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    return { ok: false, reason: "ffprobe returned non-JSON output" };
  }
  const stream = parsed?.streams?.[0];
  const width = Number(stream?.width);
  const height = Number(stream?.height);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    return { ok: false, reason: "no usable video stream dimensions" };
  }
  const rotation = Number(
    (Array.isArray(stream?.side_data_list) ? stream.side_data_list : []).find((entry) =>
      Number.isFinite(Number(entry?.rotation)),
    )?.rotation ?? 0,
  );
  const quarterTurns = Math.abs(Math.round(rotation / 90)) % 2;
  return {
    ok: true,
    width: quarterTurns === 1 ? height : width,
    height: quarterTurns === 1 ? width : height,
    rotation,
  };
}
