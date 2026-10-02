# 検証用（ラッパー所掌）: カラオケ字幕の字ごとに「白から色が変わり始めた時刻」「オレンジになり切った時刻」をフレームから測る
# 字の明るい画素（max(R,G,B)>200）の平均 (R-B) を見る。白 ≈ 0・#FB923C ≈ 190
import json
import numpy as np
from PIL import Image
cap = [c for c in json.load(open('C:/t/odg-1002/full/captions.json', encoding='utf8'))['captions'] if c.get('style') == 'karaoke'][0]
glyphs, starts, wends = [], [], []
for wd in cap['words']:
    for k, ch in enumerate(wd['text']):
        glyphs.append(ch)
        starts.append(wd['start'] + (wd['end'] - wd['start']) * k / len(wd['text']))
        wends.append(wd['end'])
X0, X1, Y0, Y1 = 180, 1065, 590, 665
adv = (X1 - X0) / len(glyphs)
def load(path):
    return np.asarray(Image.open(path).convert('RGB')).astype(int)[Y0:Y1]
def textmask(kind):
    # 字の画素 = 字幕が白の時点（921 = 30.70s）で白い画素 ∪ 塗り終わり直前（975 = 32.50s）でオレンジの画素（背景を除く）
    w = load(f'C:/t/odg-1002/k/{kind}/0921.png'); o = load(f'C:/t/odg-1002/k/{kind}/0975.png')
    white = (w.min(2) > 225)
    orange = (abs(o[..., 0] - 251) < 40) & (abs(o[..., 1] - 146) < 45) & (abs(o[..., 2] - 60) < 55)
    return white | orange
def chroma(path, mask):
    a = load(path)
    out = []
    for i in range(len(glyphs)):
        sl = slice(int(X0 + i * adv) + 2, int(X0 + (i + 1) * adv) - 2)
        c = a[:, sl][mask[:, sl]]
        out.append(float((c[:, 0] - c[:, 2]).mean()) if len(c) > 30 else None)
    return out
res = {}
for kind in ('before', 'after'):
    mask = textmask(kind)
    series = {n: chroma(f'C:/t/odg-1002/k/{kind}/{n:04d}.png', mask) for n in range(919, 978)}
    rows = []
    for i, ch in enumerate(glyphs):
        # 立ち上がり = それ以降ずっと (R-B)>40 が続く最初のフレーム（字幕のフェードインの 2 フレームで背景が透ける分を除く）
        on = next((n / 30 for n in range(919, 977) if all((series[m][i] or 0) > 40 for m in range(n, 977))), None)
        full = next((n / 30 for n in range(919, 978) if (series[n][i] or 0) > 150), None)
        rows.append({'glyph': ch, 'word_start': round(starts[i], 3), 'onset': None if on is None else round(on, 3),
                     'full': None if full is None else round(full, 3),
                     'delta_onset': None if on is None else round(on - starts[i], 3)})
    res[kind] = {'rows': rows, 'max_abs_delta_onset': max(abs(r['delta_onset']) for r in rows if r['delta_onset'] is not None),
                 'missing': [r['glyph'] for r in rows if r['onset'] is None]}
json.dump(res, open('C:/t/odg-1002/k/onset.json', 'w', encoding='utf8'), ensure_ascii=False, indent=1)
for k, v in res.items():
    print(k, 'max|Δonset|', v['max_abs_delta_onset'], 'missing', len(v['missing']))
    for r in v['rows']: print('  ', r['word_start'], r['onset'], r['full'], r['delta_onset'])
