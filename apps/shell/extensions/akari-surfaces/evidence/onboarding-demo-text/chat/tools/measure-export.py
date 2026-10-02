# 書き出した mp4（8.0〜11.5 秒の切り出し・f240 起点）を、本編の同じフレームとの差で測る
import json, sys, numpy as np
from PIL import Image
R = json.load(open('C:/t/chat-text/dom-rects.json'))
eng = sys.argv[1]
def img(p): return np.asarray(Image.open(p).convert('RGB')).astype(np.int16)
def ex(f): return img(f'C:/t/chat-text/rc/fr-{eng}/f{f}.png')
def src(f): return img(f'C:/t/chat-text/bg/f{f}.png')
def harness(f): return img(f'C:/t/chat-text/seq-prev-bg/p-t{f/30-8.5333:.3f}.png')
def crop(a, b): return a[b[1]:b[3], b[0]:b[2]]
boxes = {
  'カード': R['card'],
  'あなたの吹き出し': R['you'],
  'AI のアイコン＋入力中の点': [R['avatar'][0], R['ai'][1], R['typing'][2], R['ai'][3]],
  '返事「できました！」': R['replyText'],
  'チェック': R['check'],
}
plan = {'カード': ('AI', 8.55, 8.535), 'あなたの吹き出し': ('AI', 8.55, 8.535), 'AI のアイコン＋入力中の点': ('対話', 9.26, 9.245),
        '返事「できました！」': ('だけ', 9.90, 9.91), 'チェック': ('だけ', 9.90, 9.91)}
# 要素が見え始めた = 箱の中で「前の状態」から画素が動いた最初のフレーム（圧縮ノイズより十分大きい差の画素が 30 個以上）
refs = {'カード': None, 'あなたの吹き出し': None, 'AI のアイコン＋入力中の点': 272, '返事「できました！」': 294, 'チェック': 296}
first = {}
for k, b in boxes.items():
    for f in range(250, 336):
        base = src(f) if refs[k] is None else ex(refs[k])
        if refs[k] is not None and f <= refs[k]: continue
        d = np.abs(crop(ex(f), b) - crop(base, b)).max(-1)
        if k == '返事「できました！」':  # 入力中の点が消える変化と分けるため、墨（暗い画素）の出現で見る
            hit = (crop(ex(f), b).max(-1) < 70).sum() > 60
        elif k == 'チェック':
            e = crop(ex(f), b); hit = ((e[..., 0] > 220) & (e[..., 1] > 80) & (e[..., 1] < 150) & (e[..., 2] < 80)).sum() > 40
        else:
            hit = (d > 24).sum() > 30
        if hit: first[k] = f; break
sync = []
for k, (w, wp, we) in plan.items():
    f = first[k]; s = f / 30
    sync.append({'element': k, 'word': w, 'word_onset_plan': wp, 'first_visible_frame': f, 'first_visible_s': round(s, 4),
                 'diff_vs_plan_s': round(s - wp, 3), 'diff_vs_envelope_s': round(s - we, 3), 'within_0.15': abs(s - wp) <= 0.15})
# 最後に見えるフレーム（カードの箱で本編との差が残る最後）
last = None
for f in range(300, 336):
    if (np.abs(crop(ex(f), R['card']) - crop(src(f), R['card'])).max(-1) > 24).sum() > 30: last = f
# かぶり: 人物の届く範囲と字幕帯で、本編との平均差（区間の前 = オーバーレイ無しのノイズ水準と比べる）
regions = {'person': (0, 0, 690, 470), 'person_low': (0, 470, 815, 660), 'caption_band': (300, 628, 980, 720)}
def mad(f, r): return float(np.abs(crop(ex(f), r) - crop(src(f), r)).mean())
keep = {n: round(max(mad(f, r) for f in range(256, 329)), 2) for n, r in regions.items()}
noise = {n: round(max(mad(f, r) for f in range(250, 256)), 2) for n, r in regions.items()}
keep_px = {n: int(max((np.abs(crop(ex(f), r) - crop(src(f), r)).max(-1) > 40).sum() for f in range(256, 329))) for n, r in regions.items()}
noise_px = {n: int(max((np.abs(crop(ex(f), r) - crop(src(f), r)).max(-1) > 40).sum() for f in range(250, 256))) for n, r in regions.items()}
# 描画確認用レンダラ（プレビュー経路・本編フレーム背景）との一致: カードの箱の平均差
par = max(float(np.abs(crop(ex(f), [720, 110, 1280, 420]) - crop(harness(f), [720, 110, 1280, 420])).mean()) for f in range(256, 329))
out = {'engine': eng, 'sync': sync, 'last_visible_frame': last, 'last_visible_s': round(last / 30, 4) if last else None,
       'keepout_mean_abs_diff_vs_source_max_in_item': keep, 'noise_before_item_max': noise,
       'keepout_pixels_diff_gt_40_max_in_item': keep_px, 'noise_pixels_diff_gt_40_before_item': noise_px,
       'parity_vs_harness_card_region_max_mean_abs_diff': round(par, 2)}
print(json.dumps(out, ensure_ascii=False, indent=1))
json.dump(out, open(f'C:/t/chat-text/rc/measure-export-{eng}.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
