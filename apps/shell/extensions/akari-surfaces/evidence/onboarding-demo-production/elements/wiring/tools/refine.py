import subprocess, numpy as np, json, sys
FF="<WORKTREE>/packages/media-bin/vendor/win32-x64/ffmpeg.exe"
SRC="<WORKTREE>/apps/shell/resources/onboarding-sample/talkinghead-desk-ja-01/clip.mp4"
V=sys.argv[1]
def rgb(path, start, count, box):
    x0,y0,x1,y1=box
    raw=subprocess.run([FF,"-v","error","-i",path,"-vf",f"select='between(n,{start},{start+count-1})',crop={x1-x0}:{y1-y0}:{x0}:{y0},format=rgb24","-vsync","0","-f","rawvideo","-"],capture_output=True).stdout
    return np.frombuffer(raw,dtype=np.uint8).reshape(-1,y1-y0,x1-x0,3).astype(np.int32)
out={}
# done 1 行目（chat の抜け 10.97 のあとから探す）: 元フレームとの差
b=(840,170,1190,210); e=rgb(V,333,12,b); s=rgb(SRC,333,12,b)
d=[float(np.mean(np.abs(e[i]-s[i]))) for i in range(12)]
out['done_l1']={'frames':list(range(333,345)),'diff':[round(x,1) for x in d]}
# diagram ② のオレンジの円
b=(938,254,1032,346); e=rgb(V,700,14,b)
orange=[int(((f[...,0]>220)&(f[...,1]>80)&(f[...,1]<160)&(f[...,2]<80)).sum()) for f in e]
out['diagram_node2_orange']={'frames':list(range(700,714)),'px':orange}
# diagram ③ の墨の円
b=(1098,254,1190,346); e=rgb(V,714,14,b)
dark=[int(((f[...,0]<60)&(f[...,1]<60)&(f[...,2]<60)).sum()) for f in e]
out['diagram_node3_dark']={'frames':list(range(714,728)),'px':dark}
# phone 画面点灯（起動画面 → 映像）
b=(930,200,1090,480); e=rgb(V,826,14,b)
lum=[round(float(f.mean()),1) for f in e]
out['phone_screen_lum']={'frames':list(range(826,840)),'lum':lum}
print(json.dumps(out))
