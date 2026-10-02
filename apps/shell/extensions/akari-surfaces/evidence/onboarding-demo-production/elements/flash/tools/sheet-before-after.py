# 閃光の段の直し: 書き出し（直す前 = demo-accents / 直した後 = demo-flash）の同じフレームを並べる
import sys
from PIL import Image, ImageDraw, ImageFont
S = sys.argv[1]; out = sys.argv[2]; out_full = sys.argv[3]
FONT = ImageFont.truetype("C:/Windows/Fonts/YuGothB.ttc", 22)
FONT_S = ImageFont.truetype("C:/Windows/Fonts/YuGothB.ttc", 18)
frames = [(590, "19.667 閃光の直前"), (591, "19.700 「パッ」語頭\n閃光 最大 .62"), (592, "19.733"),
          (594, "19.800 閃光 .30"), (598, "19.933")]
CROP = (700, 60, 1280, 520)   # 右の舞台（擬音・放射線・札）
cw, ch = CROP[2] - CROP[0], CROP[3] - CROP[1]
sc = 0.62
w, h = int(cw * sc), int(ch * sc)
lab = 210; head = 62
sheet = Image.new("RGB", (lab + 2 * w + 30, head + len(frames) * (h + 10) + 10), (250, 247, 242))
d = ImageDraw.Draw(sheet)
d.text((lab + 10, 8), "直す前（書き出し 18a2aa3e3）", font=FONT_S, fill=(120, 40, 20))
d.text((lab + 10, 32), "閃光 = demo-accents・擬音より上", font=FONT_S, fill=(120, 40, 20))
d.text((lab + w + 20, 8), "直した後（書き出し）", font=FONT_S, fill=(20, 90, 40))
d.text((lab + w + 20, 32), "閃光 = demo-flash・擬音より下", font=FONT_S, fill=(20, 90, 40))
for i, (n, label) in enumerate(frames):
    y = head + i * (h + 10)
    d.text((10, y + h // 2 - 30), f"f{n}", font=FONT, fill=(23, 19, 15))
    d.multiline_text((10, y + h // 2), label, font=FONT_S, fill=(107, 94, 82), spacing=4)
    for j, sub in enumerate(["before-all", "after"]):
        im = Image.open(f"{S}/{sub}/f{n}.png").convert("RGB").crop(CROP).resize((w, h), Image.LANCZOS)
        sheet.paste(im, (lab + 10 + j * (w + 10), y))
sheet.save(out, quality=90)
full = Image.open(f"{S}/after/f591.png").convert("RGB")
full.save(out_full, quality=92)
print(sheet.size)
