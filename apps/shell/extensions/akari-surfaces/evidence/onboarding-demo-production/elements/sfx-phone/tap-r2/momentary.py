# 使い方（このフォルダで）: python measure_tap.py measure.json seg.npz → python momentary.py → python plot_tap.py ../sfx-phone-tap-r2.png
# 入力の書き出し（リポの外）: 直す前 = C:/t/integ/{full,sfxonly}/exports、直した後 = C:/t/sfxtap-1001/{full,sfxonly}/exports
# （後は前の edit.json から exports/ の自己参照 source を外し、assets/onboarding/sfx-click-mouse-single.m4a だけ差し替えて render-cut で書き出したもの）
import subprocess, numpy as np, json
FF="C:/Users/kyach/akari-wt/onboarding-demo-rich/packages/media-bin/vendor/win32-x64/ffmpeg.exe"; SR=48000
def pcm(p):
    r=subprocess.run([FF,"-v","error","-i",p,"-vn","-ac","2","-ar",str(SR),"-f","f32le","-"],capture_output=True).stdout
    return np.frombuffer(r,dtype=np.float32).reshape(-1,2).astype(np.float64)
def lfilter(b,a,x):
    y=np.zeros_like(x); x1=x2=y1=y2=0.0
    for i,xi in enumerate(x):
        yi=b[0]*xi+b[1]*x1+b[2]*x2-a[1]*y1-a[2]*y2; y[i]=yi; x2,x1=x1,xi; y2,y1=y1,yi
    return y
B1=[1.53512485958697,-2.69169618940638,1.19839281085285]; A1=[1,-1.69065929318241,0.73248077421585]
B2=[1.0,-2.0,1.0]; A2=[1,-1.99004745483398,0.99007225036621]
def mom_max(x,t0,t1):
    seg=x[int(t0*SR):int(t1*SR)]
    k=np.stack([lfilter(B2,A2,lfilter(B1,A1,seg[:,c])) for c in range(2)],1)
    c=np.concatenate([[0],np.cumsum((k**2).sum(1))]); W=int(0.4*SR); best=-200
    for e in range(W,len(seg),480):
        ms=(c[e]-c[e-W])/W; best=max(best,-0.691+10*np.log10(ms+1e-20))
    return round(best,1)
res={}
for tag,p in (("before","C:/t/integ/sfxonly/exports/sfxonly.mp4"),("after","C:/t/sfxtap-1001/sfxonly/exports/sfxonly.mp4")):
    x=pcm(p); res[tag]={"tap_momentary_max_lufs(400ms windows inside 27.52-28.40)":mom_max(x,27.52,28.4),"swoosh_momentary_max_lufs(400ms windows inside 26.60-27.52)":mom_max(x,26.6,27.52)}
print(json.dumps(res,ensure_ascii=False))
json.dump(res,open("momentary.json","w",encoding="utf-8"),ensure_ascii=False)
