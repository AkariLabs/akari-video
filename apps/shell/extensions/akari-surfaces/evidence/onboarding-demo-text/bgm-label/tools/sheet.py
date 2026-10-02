# 撮ったフレームを切り抜いて並べ、見出しを付けた 1 枚のシートにする。
# 使い方: python sheet.py <out.png> <cols> <crop x,y,w,h | full> <zoom> <label=path> ...
import sys

from PIL import Image, ImageDraw, ImageFont

out, cols, crop, zoom = sys.argv[1], int(sys.argv[2]), sys.argv[3], float(sys.argv[4])
items = [a.split("=", 1) for a in sys.argv[5:]]
try:
    font = ImageFont.truetype("C:/Windows/Fonts/YuGothB.ttc", 16)
except OSError:
    font = ImageFont.load_default()
tiles = []
for label, path in items:
    im = Image.open(path).convert("RGB")
    if crop != "full":
        x, y, w, h = map(int, crop.split(","))
        im = im.crop((x, y, x + w, y + h))
    if zoom != 1:
        im = im.resize((round(im.width * zoom), round(im.height * zoom)), Image.LANCZOS if zoom < 1 else Image.NEAREST)
    d = ImageDraw.Draw(im)
    tw = d.textlength(label, font=font)
    d.rectangle((0, 0, tw + 12, 24), fill=(0, 0, 0))
    d.text((6, 3), label, fill=(255, 255, 255), font=font)
    tiles.append(im)
w, h = tiles[0].size
rows = (len(tiles) + cols - 1) // cols
sheet = Image.new("RGB", (w * cols + 4 * (cols - 1), h * rows + 4 * (rows - 1)), (40, 40, 40))
for i, t in enumerate(tiles):
    sheet.paste(t, ((i % cols) * (w + 4), (i // cols) * (h + 4)))
sheet.save(out, quality=90) if out.endswith(".jpg") else sheet.save(out)
print(out, sheet.size)
