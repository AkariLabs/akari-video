# demo-chat の全 73 フレーム（f256〜f328）を測る: 要素ごとの最初に見えるフレーム・外接矩形・かぶり・プレビュー/書き出しの一致
import json, sys, numpy as np
from PIL import Image
R = json.load(open('C:/t/chat-text/dom-rects.json'))
START = 8.5333
frames = list(range(256, 329))
def load(d, pfx, f):
    return np.asarray(Image.open(f"C:/t/chat-text/{d}/{pfx}-t{f/30-START:.3f}.png").convert('RGBA')).astype(np.int16)
def box(a, b):
    x0, y0, x1, y1 = b
    return a[y0:y1, x0:x1]
def orange(px):  # 橙 #F97316 付近（不透明）
    r, g, b, al = px[..., 0], px[..., 1], px[..., 2], px[..., 3]
    return (al > 200) & (r > 225) & (g > 80) & (g < 150) & (b < 70)
def ink(px):     # 墨 #17130F 付近（文字）
    return (px[..., 3] > 200) & (px[..., :3].max(-1) < 60)
def nonwhite(px):  # カードの白より暗い（AI の吹き出しの地・アイコン・点）
    return (px[..., 3] > 200) & (px[..., :3].mean(-1) < 246)
rows = []
ext_all = [9999, 9999, -1, -1]; ext_body = [9999, 9999, -1, -1]
first = {}
def mark(name, f, cond):
    if cond and name not in first: first[name] = f
last_visible = None
for f in frames:
    a = load('seq-prev-a', 'p', f)
    al = a[..., 3]
    ys, xs = np.nonzero(al > 12)
    if len(xs):
        last_visible = f
        ext_all = [min(ext_all[0], xs.min()), min(ext_all[1], ys.min()), max(ext_all[2], xs.max()), max(ext_all[3], ys.max())]
    ys, xs = np.nonzero(al >= 60)
    if len(xs):
        ext_body = [min(ext_body[0], xs.min()), min(ext_body[1], ys.min()), max(ext_body[2], xs.max()), max(ext_body[3], ys.max())]
    mark('カード', f, (box(al, R['card']) > 12).mean() > 0.02)
    yb = box(a, R['you'])
    mark('あなたの吹き出し', f, ((yb[..., 3] > 12) & (yb[..., 0] - yb[..., 2] > 120)).sum() > 200)
    aib = [R['avatar'][0], R['ai'][1], R['typing'][2], R['ai'][3]]
    if f >= 270:  # カードが入り切った後（270）を基準に、AI の行の箱で画素が変わり始めたフレーム
        ref = box(load('seq-prev-a', 'p', 270), aib)
        mark('AI のアイコン＋入力中の点', f, (np.abs(box(a, aib) - ref).max(-1) > 6).sum() > 20)
    mark('返事「できました！」', f, ink(box(a, R['replyText'])).sum() > 150)
    mark('チェック', f, orange(box(a, R['check'])).sum() > 60)
plan = {'カード': ('AI', 8.55, 8.535), 'あなたの吹き出し': ('AI', 8.55, 8.535), 'AI のアイコン＋入力中の点': ('対話', 9.26, 9.245),
        '返事「できました！」': ('だけ', 9.90, 9.91), 'チェック': ('だけ', 9.90, 9.91)}
sync = []
for k, (w, wp, we) in plan.items():
    f = first.get(k)
    s = f / 30 if f is not None else None
    sync.append({'element': k, 'word': w, 'word_onset_plan': wp, 'word_onset_voice_envelope': we, 'first_visible_frame': f,
                 'first_visible_s': round(s, 4), 'diff_vs_plan_s': round(s - wp, 3), 'diff_vs_envelope_s': round(s - we, 3),
                 'within_0.15': abs(s - wp) <= 0.15})
# かぶり: 人物の届く範囲（y<470 で x<690 / y 470〜660 で x<815）と字幕帯（x300〜980・y≥628）に alpha>0 の画素があるか
hits = {'person_upper': 0, 'person_lower': 0, 'caption_band': 0}
for f in frames:
    al = load('seq-prev-a', 'p', f)[..., 3]
    hits['person_upper'] += int((al[:470, :690] > 0).any())
    hits['person_lower'] += int((al[470:660, :815] > 0).any())
    hits['caption_band'] += int((al[628:, 300:980] > 0).any())
# プレビュー（CSS animation をローカル秒で seek）と書き出し（rasterize.mjs と同じ WAAPI クローン・合成秒で seek）の一致
maxdiff = 0
for f in frames:
    d = np.abs(load('seq-prev-a', 'p', f) - load('seq-exp-a', 'e', f)).max()
    maxdiff = max(maxdiff, int(d))
out = {'sync': sync, 'last_visible_frame': last_visible, 'last_visible_s': round(last_visible / 30, 4),
       'extent_all_frames_px': {'with_shadow_alpha_gt_12': [int(v) for v in ext_all], 'card_body_alpha_ge_60': [int(v) for v in ext_body]},
       'keepout_frames_with_any_alpha': hits, 'parity_preview_vs_export': {'max_channel_diff': maxdiff, 'frames': len(frames)}}
print(json.dumps(out, ensure_ascii=False, indent=1))
json.dump(out, open('C:/t/chat-text/measure.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
