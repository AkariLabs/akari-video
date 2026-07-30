# 3D ベイクレシピ: smartphone-mockup
# 現代的なスマホ実機モデルの画面に画像/動画を差し込んでヒーローショットとして焼く。
# media 型ツマミ（screen_src）の実証レシピ。
# 契約: 3D ベイクレシピ契約 — 非公開の内部リポジトリ akari-video-internal 側で管理（レシピ = SSOT、ベイク = 再生成可能キャッシュ）
#
# 実行例:
#   blender -b -P scene.py -- --out bakes/smartphone-mockup-draft.mp4 \
#     --profile draft --fps 30 --frame-start 1 --frame-end 90 \
#     --set screen_src=/path/to/screen.png
#
# 決定性: 宣言済み param 以外の外部入力を持たない（環境変数・wall-clock・乱数・ネットワーク禁止）。
# カメラの周回はドライバ式（frame の純関数）で表現し、同じ入力からは常に同じ映像が出る。
# 動画を screen_src に渡した場合も、表示フレームは Blender の ImageUser（frame_start/frame_offset）
# 経由でシーンの現在フレーム番号から決定される（wall-clock は使わない）。

import argparse
import math
import os
import sys

import bpy
from mathutils import Vector

RECIPE_DIR = os.path.dirname(os.path.abspath(__file__))
MODEL_FILE = "model.glb"          # Phone.obj (CC0, nisu / opengameart.org) を検品・packして単一 glb 化したもの
HDRI_FILE = "studio-2k.hdr"       # catalog/3d/studio-hdri と同一（CC0, Poly Haven）
PLACEHOLDER_FILE = "placeholder.png"
SCREEN_MATERIAL_NAME = "ScreenMaterial"

IMAGE_EXTS = {".png", ".jpg", ".jpeg"}
VIDEO_EXTS = {".mp4", ".mov"}

# meta.json の knobs と 1:1 対応。ここに無いキーは --set で受け付けない
PARAM_DEFAULTS = {
    "orbit_start_deg": -15.0,      # 周回の開始角（0° = 画面正面のヒーローショット）
    "orbit_sweep_deg": 30.0,       # ベイク全体で回る角度（正 = 反時計回り）
    "camera_elevation_deg": 8.0,   # 見下ろし角
    "camera_distance": 1.0,        # 自動フレーミングに対する寄り引き倍率
    "hdri_rotation_deg": 0.0,      # 環境光（背景）の向き
    "exposure": 1.0,               # 環境光強度
    "screen_brightness": 1.0,      # 画面の自発光強度（screen_src を見やすくする）
    "screen_src": PLACEHOLDER_FILE,  # 画面に映す静止画/動画（media 型ツマミ）
}
STRING_PARAMS = {"screen_src"}

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
    parser.add_argument("--frame-end", type=int, default=90)
    parser.add_argument("--set", action="append", default=[], metavar="KEY=VALUE",
                        dest="overrides", help="param の上書き（宣言済みキーのみ）")
    args = parser.parse_args(argv)

    params = dict(PARAM_DEFAULTS)
    for pair in args.overrides:
        key, sep, value = pair.partition("=")
        if not sep or key not in params:
            parser.error(f"未宣言の param です: {pair}（宣言済み: {', '.join(sorted(params))}）")
        if key in STRING_PARAMS:
            params[key] = value
        else:
            try:
                params[key] = float(value)
            except ValueError:
                parser.error(f"param {key} の値を数値として読めません: {value}")
    return args, params


def resolve_media_path(value):
    """screen_src は文字列パス。絶対パスはそのまま、相対パスはまずレシピ同梱を試す。"""
    if os.path.isabs(value):
        return value
    candidate = os.path.join(RECIPE_DIR, value)
    if os.path.exists(candidate):
        return candidate
    return os.path.abspath(value)


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


def apply_screen_src(params):
    """ScreenMaterial の Image Texture を screen_src で差し替える。
    スクリーンのマテリアルだけを差し替え、モデルのジオメトリ・他マテリアルは改変しない。
    """
    mat = bpy.data.materials.get(SCREEN_MATERIAL_NAME)
    if mat is None or not mat.use_nodes:
        raise RuntimeError(f"{SCREEN_MATERIAL_NAME} が glb に見つかりません（pack 手順の破損の可能性）")

    tex_node = next((n for n in mat.node_tree.nodes if n.type == "TEX_IMAGE"), None)
    if tex_node is None:
        raise RuntimeError(f"{SCREEN_MATERIAL_NAME} に Image Texture ノードがありません")

    path = resolve_media_path(params["screen_src"])
    if not os.path.isfile(path):
        raise RuntimeError(f"screen_src が見つかりません: {path}")
    ext = os.path.splitext(path)[1].lower()
    if ext not in IMAGE_EXTS and ext not in VIDEO_EXTS:
        raise RuntimeError(f"screen_src の拡張子に対応していません: {ext}（対応: {sorted(IMAGE_EXTS | VIDEO_EXTS)}）")

    img = bpy.data.images.load(path, check_existing=True)
    img.colorspace_settings.name = "sRGB"
    tex_node.image = img

    if ext in VIDEO_EXTS:
        # 動画はフレーム番号の純関数として同期する（wall-clock は使わない）。
        # Blender は ImageUser.frame_start / frame_offset を現在のシーンフレームに対して
        # 決定的に解決するため、レンダーの再現性は崩れない。
        tex_node.image_user.frame_duration = max(img.frame_duration, 1)
        tex_node.image_user.frame_start = 1
        tex_node.image_user.frame_offset = 0
        tex_node.image_user.use_auto_refresh = True

    # Emission ノードの強度を screen_brightness で調整
    emission = next((n for n in mat.node_tree.nodes if n.type == "EMISSION"), None)
    if emission is not None:
        emission.inputs["Strength"].default_value = params["screen_brightness"]
    else:
        # gltf 再読込後は Emission が Principled BSDF の Emission 系入力に変換される
        bsdf = next((n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
        if bsdf is not None and "Emission Strength" in bsdf.inputs:
            bsdf.inputs["Emission Strength"].default_value = params["screen_brightness"]


def build_scene(args, params):
    # シーンリセットは main() 側で実施済み（レンダー解像度を先に確定させるため setup_render が先）
    bpy.ops.import_scene.gltf(filepath=os.path.join(RECIPE_DIR, MODEL_FILE))
    center, radius = scene_bounding_box()
    build_world(params)
    apply_screen_src(params)

    # ピボット（モデル中心）にカメラを吊るし、ピボットの Z 回転で周回させる。
    # 梱包済み model.glb はローカル Z が上（スマホの縦方向）、ローカル Y が画面法線（正面）になるよう
    # pack 時に -90° 回転を焼き込み済み（元 OBJ は X=長辺/Y=厚み/Z=幅 だった）。
    pivot = bpy.data.objects.new("orbit-pivot", None)
    pivot.location = center
    bpy.context.scene.collection.objects.link(pivot)

    cam_data = bpy.data.cameras.new("hero-cam")
    cam_data.lens = 60.0
    cam = bpy.data.objects.new("hero-cam", cam_data)
    bpy.context.scene.collection.objects.link(cam)
    cam.parent = pivot

    # 自動フレーミング: バウンディング球が画角に収まる距離 × 寄り引き倍率
    # 縦長の被写体を横長フレームに収める場合は水平画角ではなく垂直画角がボトルネックになるため、
    # angle_x/angle_y の狭い方（= より厳しい制約）を基準にする（cam_data.angle 単体だと
    # センサーフィット次第で片方の軸しか見ておらず、縦長サブジェクトが画角からはみ出す）
    bpy.context.view_layer.update()
    fit_angle = min(cam_data.angle_x, cam_data.angle_y)
    distance = radius / math.tan(fit_angle * 0.5) * 1.2 * params["camera_distance"]
    elevation = math.radians(params["camera_elevation_deg"])
    # オフセットは Y（画面法線）と Z（上下）のみ。X=0 始点からピボットの Z 回転で左右に振れる
    cam.location = Vector((0.0, distance * math.cos(elevation), distance * math.sin(elevation)))

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

    # Blender が動画出力名へフレーム範囲を付けた場合（例: draft0001-0090.mp4）を契約どおりの名前へ正規化
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
    # setup_render() を先に呼び、レンダー解像度（アスペクト比）を確定させてから
    # build_scene() のカメラ自動フレーミング（angle_x/angle_y はアスペクト依存）を計算する
    bpy.ops.wm.read_factory_settings(use_empty=True)
    setup_render(args, params)
    build_scene(args, params)
    produced = render(args.out)
    print(f"BAKED: {produced}")


if __name__ == "__main__":
    main()
