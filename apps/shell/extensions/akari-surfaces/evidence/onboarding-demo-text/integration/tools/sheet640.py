# 検証用（ラッパー所掌）: 4 要素の見せ場を書き出しから抜き、640x360 に縮めて前段と並べたシートを作る
# python sheet640.py <after.mp4> <before.mp4> <out_dir>
import subprocess, sys, os
from PIL import Image, ImageDraw, ImageFont
FF = "C:/Users/kyach/akari-wt/onboarding-demo-rich/packages/media-bin/vendor/win32-x64/ffmpeg.exe"
after, before, out = sys.argv[1:4]
os.makedirs(os.path.join(out, "frames"), exist_ok=True)
SHOTS = [  # (id, 秒, ラベル)
    ("title-badge", 3.80, "タイトル（名札のポップ直後 3.80）"),
    ("title-hold", 5.40, "タイトル（下線まで出そろう 5.40）"),
    ("chat", 10.10, "AI との対話カード（返事＋チェック 10.10）"),
    ("bgm", 30.00, "BGM 札（30.00）"),
    ("credit", 37.00, "クレジット（全部出そろう 37.00）"),
]
def grab(src, t, path, w):
    n = int(round(t * 30))
    subprocess.run([FF, "-v", "error", "-y", "-i", src, "-vf", f"select='eq(n,{n})',scale={w}:-2:flags=area", "-vsync", "0", "-frames:v", "1", path], check=True)
font = ImageFont.truetype("C:/Windows/Fonts/YuGothB.ttc", 18)
small = ImageFont.truetype("C:/Windows/Fonts/YuGothB.ttc", 15)
LAB = 30
rows = []
for sid, t, label in SHOTS:
    a640 = os.path.join(out, "frames", f"{sid}-after-640.png"); grab(after, t, a640, 640)
    b640 = os.path.join(out, "frames", f"{sid}-before-640.png"); grab(before, t, b640, 640)
    grab(after, t, os.path.join(out, "frames", f"{sid}-after-1280.png"), 1280)
    rows.append((label, Image.open(b640).convert("RGB"), Image.open(a640).convert("RGB")))
W, H = 640, 360
head = 40
sheet = Image.new("RGB", (W * 2 + 12, head + len(rows) * (H + LAB + 8)), (24, 22, 20))
d = ImageDraw.Draw(sheet)
d.text((8, 10), "前段（aa43cb9f4）", font=font, fill=(200, 200, 200))
d.text((W + 20, 10), "今回（onboarding-demo-text）— 640x360 に縮小（アプリのプレビュー枠と同じ幅）", font=small, fill=(255, 190, 120))
y = head
for label, b, a in rows:
    d.text((8, y + 5), label, font=font, fill=(240, 240, 240))
    sheet.paste(b, (0, y + LAB)); sheet.paste(a, (W + 12, y + LAB))
    y += H + LAB + 8
sheet.save(os.path.join(out, "sheet-640-before-after.jpg"), quality=90)
# 今回だけ（640 幅の縦並び）
only = Image.new("RGB", (W, len(rows) * (H + LAB)), (24, 22, 20))
d = ImageDraw.Draw(only); y = 0
for label, b, a in rows:
    d.text((8, y + 5), label, font=font, fill=(240, 240, 240)); only.paste(a, (0, y + LAB)); y += H + LAB
only.save(os.path.join(out, "sheet-640.jpg"), quality=90)
print("ok")
