# 検証用（ラッパー所掌）: カラオケ区間（30.4〜33.0 秒）の「塗りの先端」を前段 OSR（fill smooth）と統合 GPU で比べる
# 字幕帯の字の画素を「白」（min(RGB)>215）と「オレンジ」（#FB923C 近傍）に分け、列ごとに多数派を取って
# 「オレンジの列の右端」= 塗りの先端 x とする。字の中で白とオレンジが同居する字（途中まで塗られた字）も数える。
import json, sys
import numpy as np
from PIL import Image
K = 'C:/t/oif/k'
Y0, Y1, X0, X1 = 585, 670, 150, 1130
def load(kind, n): return np.asarray(Image.open(f'{K}/{kind}/{n:04d}.png').convert('RGB')).astype(int)[Y0:Y1, X0:X1]
def classify(a):
    white = a.min(2) > 215
    orange = (abs(a[..., 0] - 251) < 45) & (abs(a[..., 1] - 146) < 50) & (abs(a[..., 2] - 60) < 60)
    return white, orange
cap = [c for c in json.load(open('C:/t/oif/demo/captions.json', encoding='utf8'))['captions'] if c.get('style') == 'karaoke'][0]
res = {}
for kind in ('before', 'after'):
    rows = []
    for n in range(912, 991):
        w, o = classify(load(kind, n))
        wc, oc = w.sum(0), o.sum(0)
        textcols = np.where((wc + oc) >= 3)[0]
        ocols = np.where((oc >= 3) & (oc >= wc))[0]
        wcols = np.where((wc >= 3) & (wc > oc))[0]
        front = int(ocols.max()) + X0 if len(ocols) else None
        # 境目の明快さ: 先端より左の字の列のうちオレンジ多数の割合、先端より右のうち白多数の割合
        if front is not None and len(textcols):
            left = textcols[textcols + X0 <= front]; right = textcols[textcols + X0 > front]
            lo = float(np.mean(np.isin(left, ocols))) if len(left) else None
            rw = float(np.mean(np.isin(right, wcols))) if len(right) else None
        else: lo = rw = None
        rows.append({'frame': n, 't': round(n / 30, 3), 'text_cols': int(len(textcols)), 'orange_px': int(o.sum()), 'white_px': int(w.sum()),
                     'front_x': front, 'left_orange_ratio': lo, 'right_white_ratio': rw,
                     'text_x0': int(textcols.min()) + X0 if len(textcols) else None, 'text_x1': int(textcols.max()) + X0 if len(textcols) else None})
    fronts = [r['front_x'] for r in rows if r['front_x'] is not None]
    dec = [(rows[i]['frame'], rows[i - 1]['front_x'], rows[i]['front_x']) for i in range(1, len(rows))
           if rows[i]['front_x'] is not None and rows[i - 1]['front_x'] is not None and rows[i]['front_x'] < rows[i - 1]['front_x'] - 4]
    steps = sorted({b - a for _, a, b in [(0, rows[i-1]['front_x'], rows[i]['front_x']) for i in range(1, len(rows)) if rows[i]['front_x'] and rows[i-1]['front_x']]})
    res[kind] = {'rows': rows, 'first_orange_t': next((r['t'] for r in rows if r['front_x']), None),
                 'front_min': min(fronts) if fronts else None, 'front_max': max(fronts) if fronts else None,
                 'backward_steps_gt4px': dec}
pairs = [(a, b) for a, b in zip(res['before']['rows'], res['after']['rows']) if a['front_x'] is not None and b['front_x'] is not None]
d = [abs(a['front_x'] - b['front_x']) for a, b in pairs]
res['compare'] = {'frames_both_have_front': len(pairs), 'front_abs_diff_px_max': max(d) if d else None,
                  'front_abs_diff_px_median': float(np.median(d)) if d else None,
                  'front_abs_diff_px_p90': float(np.percentile(d, 90)) if d else None,
                  'frames_front_only_before': [a['frame'] for a, b in zip(res['before']['rows'], res['after']['rows']) if a['front_x'] is not None and b['front_x'] is None],
                  'frames_front_only_after': [a['frame'] for a, b in zip(res['before']['rows'], res['after']['rows']) if a['front_x'] is None and b['front_x'] is not None]}
json.dump(res, open('C:/t/oif/k/wipe.json', 'w', encoding='utf8'), ensure_ascii=False, indent=1)
print(json.dumps(res['compare']))
for k in ('before', 'after'): print(k, res[k]['first_orange_t'], res[k]['front_min'], res[k]['front_max'], 'backward', res[k]['backward_steps_gt4px'])
print('t      before_front after_front  b_lo  b_rw  a_lo  a_rw')
for a, b in zip(res['before']['rows'], res['after']['rows']):
    f = lambda v: '  -  ' if v is None else f'{v:5.2f}'
    print(f"{a['t']:6.2f} {str(a['front_x']):>6} {str(b['front_x']):>6}   {f(a['left_orange_ratio'])} {f(a['right_white_ratio'])} {f(b['left_orange_ratio'])} {f(b['right_white_ratio'])}")
