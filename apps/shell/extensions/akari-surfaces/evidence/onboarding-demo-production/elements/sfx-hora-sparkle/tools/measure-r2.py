# r2 の音の書き出し（render-cut）を r1 と比べて測る。使い方: python measure-r2.py <out.json>
# 入力: C:/t/integ/{sfxonly,full}（組み込み時の書き出し = r1）と C:/t/hora-r2/{sfxonly,mix}（同じ edit.json で音源だけ r2 に差し替えて render-cut = tools/render-variants.sh）
# 書き出し（render-cut）の音で r1 / r2 を測る
import subprocess, json, re, sys, importlib.util
import numpy as np
FF = "<WORKTREE>/packages/media-bin/vendor/win32-x64/ffmpeg.exe"
SR = 48000
P = {
 "r1_sfx": "C:/t/integ/sfxonly/exports/sfxonly.mp4",
 "r1_full": "C:/t/integ/full/exports/full.mp4",
 "r2_sfx": "C:/t/hora-r2/sfxonly/exports/sfxonly-2.mp4",
 "r2_mix": "C:/t/hora-r2/mix/exports/mix-2.mp4",
 "clip": "<WORKTREE>/apps/shell/resources/onboarding-sample/talkinghead-desk-ja-01/clip.mp4",
}
def pcm(path, ch=2):
    raw = subprocess.run([FF,"-v","error","-i",path,"-vn","-ac",str(ch),"-ar",str(SR),"-f","f32le","-"],capture_output=True,check=True).stdout
    x = np.frombuffer(raw,dtype="<f4").astype(np.float64)
    return x.reshape(-1,ch) if ch>1 else x
A = {k: pcm(v) for k,v in P.items()}
def mono(x): return x.mean(axis=1)
def env(x, w, hop=48):
    m = (x**2).mean(axis=1) if x.ndim>1 else x**2
    n=int(SR*w); c=np.convolve(m,np.ones(n)/n,'same')
    return 10*np.log10(c[::hop]+1e-20)   # 1 ms 刻み、窓の中心
def db(v): return float(20*np.log10(max(v,1e-12)))
AT = 617/30; WORD = 20.552
res = {}
for k in ("r1_sfx","r2_sfx"):
    x = A[k]
    # 統合担当の measure_audio.py と同じ定義: 5 ms 窓・1 ms 刻み、[at-0.02, at+0.9] で peak-30 dB を最初に超えた点
    e5 = env(x,0.005)   # 注意: 'same' 畳み込みなので中心時刻
    i0=int((AT-0.02)*1000); i1=int((AT+0.9)*1000); seg=e5[i0:i1]; pk=seg.max()
    on=(i0+int(np.where(seg>pk-30)[0][0]))/1000
    e10=env(x,0.010); e50=env(x,0.050)
    w0=int(20.50*1000); w1=int(22.10*1000)
    a=np.abs(x).max(axis=1); s0=int(20.50*SR); s1=int(22.10*SR)
    j=s0+int(a[s0:s1].argmax())
    r = {"onset_5ms_s": round(on,3), "onset_minus_word_s": round(on-WORD,3),
         "peak_5ms_dbfs": round(float(pk),1),
         "env10_peak_s": round((w0+int(e10[w0:w1].argmax()))/1000,3), "env10_peak_dbfs": round(float(e10[w0:w1].max()),1),
         "env50_peak_s": round((w0+int(e50[w0:w1].argmax()))/1000,3), "env50_peak_dbfs": round(float(e50[w0:w1].max()),1),
         "sample_peak_s": round(j/SR,4), "sample_peak_dbfs": round(db(a[j]),2),
         "first_60ms_sample_peak_dbfs": round(db(a[int(on*SR):int((on+0.06)*SR)].max()),2)}
    # 「ほら」の発話中 20.55-20.74 と 間 20.74-21.10 の rms
    for nm,(t0,t1) in {"hora_20.55-20.74":(20.55,20.74),"gap_20.74-21.10":(20.74,21.10),"konna_21.10-21.67":(21.10,21.67)}.items():
        r["rms_"+nm] = round(db(np.sqrt((x[int(t0*SR):int(t1*SR)]**2).mean())),1)
    res[k]=r
# momentary loudness（400 ms）の最大: 20.2-22.2 と pa-whoosh 19.2-20.2
def mom_max(path, t0, t1):
    r=subprocess.run([FF,"-hide_banner","-v","verbose","-ss",str(t0-0.5),"-t",str(t1-t0+0.5),"-i",path,"-vn","-af","ebur128=framelog=verbose","-f","null","-"],capture_output=True,text=True,encoding="utf-8",errors="replace").stderr
    M=[float(v) for v in re.findall(r"M:\s*(-?[0-9.]+)",r)]
    return round(max(M),1)
for k in ("r1_sfx","r2_sfx"):
    res[k]["momentary_max_lufs_20.2-22.2"]=mom_max(P[k],20.2,22.2)
    res[k]["pa_whoosh_momentary_max_lufs_19.2-20.2"]=mom_max(P[k],19.2,20.2)
# 声 + BGM（= r1 full − r1 sfx）に対する効果音の帯域別の差（r2 mix の文脈）
vb = A["r1_full"][:len(A["r1_sfx"])] - A["r1_sfx"][:len(A["r1_full"])]
def band_db(x, lo, hi):
    X=np.fft.rfft(mono(x)*np.hanning(len(x))); f=np.fft.rfftfreq(len(x),1/SR)
    return 10*np.log10((np.abs(X[(f>=lo)&(f<hi)])**2).sum()+1e-20)
bands=[(500,2000),(2000,4000),(4000,12000)]
for k in ("r1_sfx","r2_sfx"):
    out={}
    for nm,(t0,t1) in {"hora_20.55-20.74":(20.55,20.74),"gap_20.74-21.10":(20.74,21.10)}.items():
        s=A[k][int(t0*SR):int(t1*SR)]; o=vb[int(t0*SR):int(t1*SR)]
        out[nm]={f"{lo}-{hi}Hz":round(band_db(s,lo,hi)-band_db(o,lo,hi),1) for lo,hi in bands}
    res[k]["sfx_minus_voice_bgm_db"]=out
# ミックスのピーク
m=A["r2_mix"]; a=np.abs(m).max(axis=1)
res["r2_mix"]={"sample_peak_20.5-21.2_dbfs":round(db(a[int(20.5*SR):int(21.2*SR)].max()),2),
               "sample_peak_all_dbfs":round(db(a.max()),2)}
m=A["r1_full"]; a=np.abs(m).max(axis=1)
res["r1_full"]={"sample_peak_20.5-21.2_dbfs":round(db(a[int(20.5*SR):int(21.2*SR)].max()),2),"sample_peak_all_dbfs":round(db(a.max()),2)}
# r2 mix と (r1 full − r1 sfx + r2 sfx) の一致（ミックスが線形に足されていることの確認）
pred = vb[:len(A["r2_sfx"])] + A["r2_sfx"][:len(vb)]
n=min(len(pred),len(A["r2_mix"])); s0=int(19.0*SR); s1=int(23.0*SR)
err=A["r2_mix"][s0:s1]-pred[s0:s1]
res["r2_mix"]["linear_model_snr_19-23_db"]=round(10*np.log10((A["r2_mix"][s0:s1]**2).sum()/(err**2).sum()),1)
# 他の効果音が r1 と同一（r2 で変わったのは sparkle だけ）
d=A["r2_sfx"][:len(A["r1_sfx"])]-A["r1_sfx"][:len(A["r2_sfx"])]
outside=np.concatenate([d[:int(20.5*SR)], d[int(22.1*SR):]])
res["r2_sfx_vs_r1_sfx_outside_20.5-22.1_max_abs_dbfs"]=round(db(np.abs(outside).max()),1)

# r2 の中身の成分（build の浮動小数）を at 617 に置いたときの時刻と、書き出しとのずれ
E="<WORKTREE>/apps/shell/extensions/akari-surfaces/evidence/onboarding-demo-production/elements/sfx-hora-sparkle/make-sfx-hora-sparkle.py"
spec=importlib.util.spec_from_file_location("mk",E); mk=importlib.util.module_from_spec(spec); spec.loader.exec_module(mk)
LIB="<HOME>/Akari/library/audio/akari-sounds-sfx/"
dsrc=mk.decode(FF,LIB+"sfx-pop-ding.mp3"); ssrc=mk.decode(FF,LIB+"sfx-shimmer-sparkle.mp3")
full,ding_only,sh_only=[p*10**(2/20) for p in mk.build(dsrc,ssrc,parts=True)]
at_s=int(round(617/30*SR))
seg=A["r2_sfx"][at_s-2400:at_s+len(full)+2400]
best=(0,-1)
for lag in range(-2400,2401):
    b=seg[2400+lag:2400+lag+len(full)]
    c=(b*full).sum()/np.sqrt((b*b).sum()*(full*full).sum())
    if c>best[1]: best=(lag,c)
lag=best[0]
def env50_peak(x):
    m=(x**2).mean(axis=1); n=int(SR*0.05); c=np.convolve(m,np.ones(n)/n,'same'); i=int(c.argmax()); return i, 10*np.log10(c[i])
i,v=env50_peak(sh_only)
res["r2_shimmer_component"]={"render_lag_samples_vs_at617":lag,"render_corr":round(float(best[1]),4),
  "env50_peak_tau_s":round(i/SR,4),"env50_peak_abs_s":round((at_s+lag+i)/SR,4),"env50_peak_dbfs":round(float(v),1),
  "sample_peak_dbfs":round(db(np.abs(sh_only).max()),2)}
m=(full**2).mean(axis=1); c=np.convolve(m,np.ones(2400)/2400,'same')
res["r2_file_env50"]={"main_peak_tau_s":round(int(c.argmax())/SR,4),"main_peak_abs_s":round((at_s+lag+int(c.argmax()))/SR,4),"main_peak_dbfs":round(10*np.log10(c.max()),1),
  "max_after_tau_0.2_dbfs":round(10*np.log10(c[int(0.2*SR):].max()),1)}
a=np.abs(ding_only).max(axis=1); on=int(np.argmax(a>a.max()*10**(-30/20)))
res["r2_ding_component"]={"onset_tau_s":round(on/SR,4),"onset_abs_s":round((at_s+lag+on)/SR,4),"onset_minus_word_s":round((at_s+lag+on)/SR-WORD,4),
  "sample_peak_dbfs":round(db(a.max()),2),"sample_peak_abs_s":round((at_s+lag+int(a.argmax()))/SR,4)}
# 書き出しのキラッの頭（build のキラッが占める 0〜0.06 s）の標本ピーク
r0=at_s+lag+on
res["r2_ding_component"]["render_sample_peak_first_60ms_dbfs"]=round(db(np.abs(A["r2_sfx"][r0:r0+int(0.06*SR)]).max()),2)

json.dump(res, open(sys.argv[1],"w",encoding="utf-8"), ensure_ascii=False, indent=1)
print(json.dumps(res, ensure_ascii=False, indent=1))
