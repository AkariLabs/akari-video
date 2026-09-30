# 連番・シークの PNG を並べて 1 枚にする（確認用）。
#   python sheet.py <out.png> <cols> <crop x0,y0,x1,y1|full> <label-offset-s> <png>...
# 各コマの左上に「ローカル秒 / 実時刻」を焼く（ファイル名の -t<秒> または -f<フレーム> から読む）。
import re
import sys
from PIL import Image, ImageDraw, ImageFont

out, cols, crop, offset = sys.argv[1], int(sys.argv[2]), sys.argv[3], float(sys.argv[4])
files = sys.argv[5:]
try:
    font = ImageFont.truetype("C:/Windows/Fonts/consola.ttf", 15)
except OSError:
    font = ImageFont.load_default()
tiles = []
for f in files:
    im = Image.open(f).convert("RGB")
    if crop != "full":
        im = im.crop(tuple(int(v) for v in crop.split(",")))
    m = re.search(r"-t([\d.]+)\.png$", f)
    if m:
        label = f"local {float(m.group(1)):.3f} / {offset + float(m.group(1)):.3f}s"
    else:
        m = re.search(r"(?:-f|[/\\]e)(\d+)\.png$", f)
        label = f"f{m.group(1)} / {int(m.group(1)) / 30:.3f}s" if m else f
    d = ImageDraw.Draw(im)
    tw = d.textlength(label, font=font)
    d.rectangle((0, 0, tw + 10, 22), fill=(0, 0, 0))
    d.text((5, 3), label, fill=(255, 230, 0), font=font)
    tiles.append(im)
w, h = tiles[0].size
rows = (len(tiles) + cols - 1) // cols
sheet = Image.new("RGB", (w * cols, h * rows), (24, 24, 24))
for i, t in enumerate(tiles):
    sheet.paste(t, ((i % cols) * w, (i // cols) * h))
sheet.save(out, quality=88) if out.endswith(".jpg") else sheet.save(out)
print(out, sheet.size)
