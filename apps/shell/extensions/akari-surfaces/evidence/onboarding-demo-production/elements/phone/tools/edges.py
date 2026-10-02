# 画面の穴の四隅と左右の縁を 6 倍に拡大して並べる
import sys
from PIL import Image
src, out = sys.argv[1], sys.argv[2]
im = Image.open(src).convert("RGB")
boxes = [(882, 80, 922, 120), (1102, 80, 1142, 120), (882, 552, 922, 592), (1102, 552, 1142, 592), (886, 300, 916, 340), (1108, 300, 1138, 340)]
Z = 6
tiles = [im.crop(b).resize(((b[2] - b[0]) * Z, (b[3] - b[1]) * Z), Image.NEAREST) for b in boxes]
W = sum(t.width for t in tiles) + 8 * (len(tiles) + 1)
H = max(t.height for t in tiles) + 16
o = Image.new("RGB", (W, H), (30, 30, 30))
x = 8
for t in tiles:
    o.paste(t, (x, 8)); x += t.width + 8
o.save(out)
