# 3D ベイクレシピ: vintage-camera-turntable
# ヴィンテージカメラのターンテーブル・ヒーローショットをヘッドレスで焼く。
# 契約: 3D ベイクレシピ契約 — 非公開の内部リポジトリ akari-video-internal 側で管理（レシピ = SSOT、ベイク = 再生成可能キャッシュ）
#
# 実行例:
#   blender -b -P scene.py -- --out bakes/vintage-camera-turntable-draft.mp4 \
#     --profile draft --fps 30 --frame-start 1 --frame-end 120 --set orbit_sweep_deg=60
#
# 決定性: 宣言済み param 以外の外部入力を持たない（環境変数・wall-clock・乱数・ネットワーク禁止）。
# カメラの周回はドライバ式（frame の純関数）で表現し、同じ入力からは常に同じ映像が出る。

import argparse
import math
import os
import sys

import bpy
from mathutils import Vector

RECIPE_DIR = os.path.dirname(os.path.abspath(__file__))
MODEL_FILE = "camera-01.glb"
HDRI_FILE = "studio-2k.hdr"

# meta.json の knobs と 1:1 対応。ここに無いキーは --set で受け付けない
PARAM_DEFAULTS = {
    "orbit_start_deg": 205.0,      # 周回の開始角（205° = レンズ正面のヒーローショット。実測で決定）
    "orbit_sweep_deg": 45.0,       # ベイク全体で回る角度（正 = 反時計回り）
    "camera_elevation_deg": 12.0,  # 見下ろし角
    "camera_distance": 1.0,        # 自動フレーミングに対する寄り引き倍率
    "hdri_rotation_deg": 0.0,      # 環境光（背景）の向き
    "exposure": 1.0,               # 環境光強度
}

PROFILES = {
    "draft": {"resolution": (1280, 720), "samples": 16, "crf": "MEDIUM"},
    "final": {"resolution": (1920, 1080), "samples": 64, "crf": "HIGH"},
}


def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    parser = argparse.ArgumentParser(prog="scene.py")
    parser.add_argument("--out", required=True, help="出力 mp4 パス")
    parser.add_argument("--profile", choices=sorted(PROFILES), default="draft")
    parser.add_argument("--fps", type=int, default=30)
    parser.add_argument("--frame-start", type=int, default=1)
    parser.add_argument("--frame-end", type=int, default=120)
    parser.add_argument("--set", action="append", default=[], metavar="KEY=VALUE",
                        dest="overrides", help="param の上書き（宣言済みキーのみ）")
    args = parser.parse_args(argv)

    params = dict(PARAM_DEFAULTS)
    for pair in args.overrides:
        key, sep, value = pair.partition("=")
        if not sep or key not in params:
            parser.error(f"未宣言の param です: {pair}（宣言済み: {', '.join(sorted(params))}）")
        try:
            params[key] = float(value)
        except ValueError:
            parser.error(f"param {key} の値を数値として読めません: {value}")
    return args, params


def scene_bounding_box():
    points = [
        obj.matrix_world @ Vector(corner)
        for obj in bpy.context.scene.objects
        if obj.type == "MESH"
        for corner in obj.bound_box
    ]
    if not points:
        raise RuntimeError("メッシュが見つかりません（glb の import に失敗している可能性）")
    lo = Vector((min(p.x for p in points), min(p.y for p in points), min(p.z for p in points)))
    hi = Vector((max(p.x for p in points), max(p.y for p in points), max(p.z for p in points)))
    return (lo + hi) * 0.5, max((hi - lo).length * 0.5, 1e-6)


def build_world(params):
    world = bpy.data.worlds.new("studio-hdri")
    world.use_nodes = True
    nodes = world.node_tree.nodes
    links = world.node_tree.links

    env = nodes.new("ShaderNodeTexEnvironment")
    env.image = bpy.data.images.load(os.path.join(RECIPE_DIR, HDRI_FILE))

    coord = nodes.new("ShaderNodeTexCoord")
    mapping = nodes.new("ShaderNodeMapping")
    mapping.inputs["Rotation"].default_value[2] = math.radians(params["hdri_rotation_deg"])

    background = nodes["Background"]
    background.inputs["Strength"].default_value = params["exposure"]

    links.new(coord.outputs["Generated"], mapping.inputs["Vector"])
    links.new(mapping.outputs["Vector"], env.inputs["Vector"])
    links.new(env.outputs["Color"], background.inputs["Color"])
    bpy.context.scene.world = world


def build_scene(args, params):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=os.path.join(RECIPE_DIR, MODEL_FILE))
    center, radius = scene_bounding_box()
    build_world(params)

    # ピボット（モデル中心）に カメラ を吊るし、ピボットの Z 回転で周回させる
    pivot = bpy.data.objects.new("orbit-pivot", None)
    pivot.location = center
    bpy.context.scene.collection.objects.link(pivot)

    cam_data = bpy.data.cameras.new("hero-cam")
    cam_data.lens = 60.0
    cam = bpy.data.objects.new("hero-cam", cam_data)
    bpy.context.scene.collection.objects.link(cam)
    cam.parent = pivot

    # 自動フレーミング: バウンディング球が画角に収まる距離 × 寄り引き倍率
    distance = radius / math.tan(cam_data.angle * 0.5) * 1.2 * params["camera_distance"]
    elevation = math.radians(params["camera_elevation_deg"])
    cam.location = Vector((distance * math.cos(elevation), 0.0, distance * math.sin(elevation)))

    track = cam.constraints.new("TRACK_TO")
    track.target = pivot
    track.track_axis = "TRACK_NEGATIVE_Z"
    track.up_axis = "UP_Y"
    bpy.context.scene.camera = cam

    # 周回 = frame の純関数（ドライバの安全式サブセットのみ。Python 実行に依存しない）
    frame_span = max(1, args.frame_end - args.frame_start)
    start_rad = math.radians(params["orbit_start_deg"])
    sweep_rad = math.radians(params["orbit_sweep_deg"])
    driver = pivot.driver_add("rotation_euler", 2).driver
    driver.type = "SCRIPTED"
    driver.expression = (
        f"{start_rad:.6f} + {sweep_rad:.6f} * (frame - {args.frame_start}) / {frame_span}"
    )


def setup_render(args, params):
    scene = bpy.context.scene
    profile = PROFILES[args.profile]

    for engine in ("BLENDER_EEVEE", "BLENDER_EEVEE_NEXT"):
        try:
            scene.render.engine = engine
            break
        except TypeError:
            continue

    eevee = getattr(scene, "eevee", None)
    if eevee is not None:
        for attr in ("taa_render_samples", "samples"):
            if hasattr(eevee, attr):
                setattr(eevee, attr, profile["samples"])
                break

    scene.render.resolution_x, scene.render.resolution_y = profile["resolution"]
    scene.render.resolution_percentage = 100
    scene.render.fps = args.fps
    scene.render.fps_base = 1.0
    scene.frame_start = args.frame_start
    scene.frame_end = args.frame_end
    scene.render.film_transparent = False

    # 容量規律: 連番静止画を経由せず mp4 へ直書きする
    # Blender 5.x は media_type="VIDEO" を先に立てないと FFMPEG を選べない（4.x に media_type は無い）
    if hasattr(scene.render.image_settings, "media_type"):
        scene.render.image_settings.media_type = "VIDEO"
    scene.render.image_settings.file_format = "FFMPEG"
    scene.render.ffmpeg.format = "MPEG4"
    scene.render.ffmpeg.codec = "H264"
    try:
        scene.render.ffmpeg.constant_rate_factor = profile["crf"]
    except TypeError:
        pass
    scene.render.ffmpeg.audio_codec = "NONE"


def render(out_path):
    scene = bpy.context.scene
    out_abs = os.path.abspath(out_path)
    os.makedirs(os.path.dirname(out_abs) or ".", exist_ok=True)
    scene.render.filepath = out_abs
    bpy.ops.render.render(animation=True)
    if os.path.isfile(out_abs):
        return out_abs

    # Blender が動画出力名へフレーム範囲を付けた場合（例: draft0001-0120.mp4）を契約どおりの名前へ正規化
    stem, ext = os.path.splitext(out_abs)
    directory = os.path.dirname(out_abs)
    candidates = [
        os.path.join(directory, name)
        for name in os.listdir(directory)
        if name.startswith(os.path.basename(stem)) and name.endswith(ext)
    ]
    if len(candidates) == 1:
        os.replace(candidates[0], out_abs)
        return out_abs
    raise RuntimeError(f"出力を特定できません: {out_abs}（候補: {candidates}）")


def main():
    args, params = parse_args()
    build_scene(args, params)
    setup_render(args, params)
    produced = render(args.out)
    print(f"BAKED: {produced}")


if __name__ == "__main__":
    main()
