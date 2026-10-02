# 検証用（ラッパー所掌）: お手本の字幕 22 件それぞれの中央時刻のフレームで、字幕帯の「字の行」の数を数える（統合 GPU と demo-gpu 前 OSR）
# 字の画素 = 白（min(RGB)>225）または #FB923C 近傍で、4px 以内に黒い縁取り（max(RGB)<70）があるもの。行 = 字の画素が 6px 以上ある行が続く帯（高さ 24px 以上）。範囲は y520〜668・x330〜990。
import json, subprocess, os
import numpy as np
from PIL import Image, ImageDraw, ImageFont
FF = 'C:/Users/kyach/akari-wt/integrate-2026-09-29/packages/media-bin/vendor/win32-x64/ffmpeg.exe'
VIDS = {'after': 'C:/t/oif/demo/exports/demo.mp4', 'before': 'C:/t/odt-1001/full/exports/full.mp4'}
caps = json.load(open('C:/t/oif/demo/captions.json', encoding='utf8'))['captions']
Y0, Y1, X0, X1 = 430, 700, 60, 1220
BY0, BY1, BX0, BX1 = 520, 668, 330, 990  # 行の数え上げ範囲（マグ・シャツの袖・机・スマホのモックを外す。1 行字幕は y 602〜655）
os.makedirs('C:/t/oif/lines', exist_ok=True)
def frame(kind, t):
    p = f'C:/t/oif/lines/{kind}-{t:.3f}.png'
    if not os.path.exists(p):
        subprocess.run([FF, '-v', 'error', '-ss', f'{t:.3f}', '-i', VIDS[kind], '-frames:v', '1', p], check=True)
    return Image.open(p).convert('RGB')
def bands(img):
    a = np.asarray(img).astype(int)[BY0:BY1, BX0:BX1]
    m = (a.min(2) > 225) | ((abs(a[..., 0] - 251) < 45) & (abs(a[..., 1] - 146) < 50) & (abs(a[..., 2] - 60) < 60))
    # 字幕の字は黒い縁取りを持つ: 4px 以内に暗い画素（max(RGB)<70）がある字の画素だけを数える（白いシャツ・マグを外す）
    dark = a.max(2) < 70
    near = np.zeros_like(dark)
    for dy in range(-4, 5):
        for dx in range(-4, 5):
            near |= np.roll(np.roll(dark, dy, 0), dx, 1)
    m = m & near
    rows = m.sum(1) >= 6
    out, s = [], None
    for y, on in enumerate(list(rows) + [False]):
        if on and s is None: s = y
        if not on and s is not None:
            if y - s >= 24: out.append((s + BY0, y + BY0))
            s = None
    # 6px 未満の隙間は同じ行
    merged = []
    for b in out:
        if merged and b[0] - merged[-1][1] < 6: merged[-1] = (merged[-1][0], b[1])
        else: merged.append(b)
    return merged
res = []
for c in caps:
    t = round((c['start'] + c['end']) / 2, 3)
    row = {'id': c['id'], 'text': c.get('display_text') or c['text'], 't': t}
    for kind in VIDS:
        b = bands(frame(kind, t)); row[kind + '_lines'] = len(b); row[kind + '_bands'] = b
    res.append(row)
json.dump(res, open('C:/t/oif/lines/lines.json', 'w', encoding='utf8'), ensure_ascii=False, indent=1)
font = ImageFont.truetype('C:/Windows/Fonts/YuGothB.ttc', 16)
BH = Y1 - Y0; W = 640
s = Image.new('RGB', (W * 2 + 12, 30 + len(res) * (BH // 2 + 26)), (24, 22, 20)); d = ImageDraw.Draw(s)
d.text((8, 6), '字幕帯（y430-700 を半分に縮小）左 = demo-gpu 前（OSR）／右 = 統合（GPU）', font=font, fill=(255, 190, 120))
y = 30
for r in res:
    d.text((8, y + 3), f"{r['id']} {r['t']:.2f}s 「{r['text']}」 行数 前 {r['before_lines']} → 統合 {r['after_lines']}", font=font, fill=(240, 240, 240)); y += 22
    for i, kind in enumerate(('before', 'after')):
        s.paste(frame(kind, r['t']).crop((0, Y0, 1280, Y1)).resize((W, BH // 2)), (i * (W + 12), y))
    y += BH // 2 + 4
s.save('C:/t/oif/ev/caption-lines-sheet.jpg', quality=85)
for r in res: print(r['id'], r['t'], r['before_lines'], r['after_lines'], r['text'])
print('after 2+ lines:', [r['id'] for r in res if r['after_lines'] != 1])
