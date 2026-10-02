# 検証用（ラッパー所掌）: カラオケ区間の demo-gpu 前（OSR・fill smooth）と統合（GPU・fill smooth）を 1280 幅と 640 幅で並べたシート
import os
from PIL import Image, ImageDraw, ImageFont
E = 'C:/t/oif/ev'
TS = [30.50, 30.80, 31.00, 31.20, 31.40, 31.60, 31.80, 32.00, 32.20, 32.40, 32.53, 32.80]
font = ImageFont.truetype('C:/Windows/Fonts/YuGothB.ttc', 20); small = ImageFont.truetype('C:/Windows/Fonts/YuGothB.ttc', 15)
def fr(kind, t): return Image.open(f'C:/t/oif/k/{kind}/{int(round(t * 30)):04d}.png').convert('RGB')
# 1280: 字幕帯（y 560-690）を原寸で、前段 / 今回を縦に
BH = 130; LAB = 28
s = Image.new('RGB', (1280, 44 + len(TS) * (2 * BH + LAB + 10)), (24, 22, 20)); d = ImageDraw.Draw(s)
d.text((10, 10), 'カラオケ区間（字幕帯・原寸 1280）　各組 上 = demo-gpu 前（OSR・fill smooth・C:/t/odt-1001/full）／下 = 統合（GPU・fill smooth）', font=small, fill=(255, 190, 120))
y = 44
for t in TS:
    d.text((10, y + 3), f'{t:.2f} 秒', font=font, fill=(240, 240, 240)); y += LAB
    s.paste(fr('before', t).crop((0, 560, 1280, 560 + BH)), (0, y)); y += BH
    s.paste(fr('after', t).crop((0, 560, 1280, 560 + BH)), (0, y)); y += BH + 10
s.save(f'{E}/karaoke-sheet-1280.jpg', quality=90)
# 640: 全画面を 640x360 に縮めて左右に（アプリのプレビュー枠と同じ幅）
W, H = 640, 360
s = Image.new('RGB', (W * 2 + 12, 44 + len(TS) * (H + LAB + 8)), (24, 22, 20)); d = ImageDraw.Draw(s)
d.text((8, 12), 'demo-gpu 前（OSR・fill smooth）', font=font, fill=(200, 200, 200)); d.text((W + 20, 12), '統合（GPU・fill smooth）640x360', font=font, fill=(255, 190, 120))
y = 44
for t in TS:
    d.text((8, y + 3), f'{t:.2f} 秒', font=font, fill=(240, 240, 240))
    s.paste(fr('before', t).resize((W, H), Image.LANCZOS), (0, y + LAB)); s.paste(fr('after', t).resize((W, H), Image.LANCZOS), (W + 12, y + LAB))
    y += H + LAB + 8
s.save(f'{E}/karaoke-sheet-640.jpg', quality=90)
for t in (31.10, 31.90, 32.30):
    fr('after', t).save(f'{E}/frames/karaoke-int-gpu-{t:.2f}-1280.png')
    fr('after', t).resize((W, H), Image.LANCZOS).save(f'{E}/frames/karaoke-int-gpu-{t:.2f}-640.png')
print('ok')
