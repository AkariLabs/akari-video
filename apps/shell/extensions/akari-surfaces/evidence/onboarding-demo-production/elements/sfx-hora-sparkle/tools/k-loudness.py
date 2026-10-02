# K 特性（BS.1770 の 2 段 biquad を ffmpeg で掛ける）で 50/100/400 ms 窓のラウドネス最大を、パッの whoosh と ほら のキラッで比べる
import subprocess, numpy as np, json
FF="C:/Users/kyach/akari-wt/onboarding-demo-rich/packages/media-bin/vendor/win32-x64/ffmpeg.exe"; SR=48000
KW=("biquad=b0=1.53512485958697:b1=-2.69169618940638:b2=1.19839281085285:a0=1:a1=-1.69065929318241:a2=0.73248077421585,"
    "biquad=b0=1:b1=-2:b2=1:a0=1:a1=-1.99004745483398:a2=0.99007225036621")
def kpcm(p,t0,t1):
    raw=subprocess.run([FF,"-v","error","-ss",str(t0),"-t",str(t1-t0),"-i",p,"-vn","-ac","2","-ar",str(SR),"-af",KW,"-f","f32le","-"],capture_output=True,check=True).stdout
    return np.frombuffer(raw,dtype="<f4").astype(np.float64).reshape(-1,2)
res={}
T0=18.9; T1=22.3
for nm,p in [("r1","C:/t/integ/sfxonly/exports/sfxonly.mp4"),("r2","C:/t/hora-r2/sfxonly/exports/sfxonly-2.mp4")]:
    x=kpcm(p,T0,T1)
    pw=(x**2).sum(axis=1)
    for win in (0.05,0.1,0.4):
        n=int(win*SR); cs=np.concatenate([[0.0],np.cumsum(pw)]); c=(cs[n:]-cs[:-n])/n; L=-0.691+10*np.log10(np.maximum(c,0)+1e-20)
        def mx(s0,s1):
            i0=int((s0-T0)*SR); i1=int((s1-T0)*SR); j=i0+int(L[i0:i1].argmax()); return round(float(L[j]),1), round(T0+j/SR+win/2,3)
        res[f"{nm}_K{int(win*1000)}ms"]={"pa_whoosh(center)":mx(19.2,20.2-win/2) ,"hora_sparkle(center)":mx(20.5-win/2,22.0)}
print(json.dumps(res,indent=1)); 
