import subprocess, sys, io
from PIL import Image, ImageDraw, ImageFont
FF="C:/Users/kyach/akari-wt/onboarding-demo-rich/packages/media-bin/vendor/win32-x64/ffmpeg.exe"
src, out, cols = sys.argv[1], sys.argv[2], int(sys.argv[3]); times=[float(x) for x in sys.argv[4].split(',')]
W,H=426,240
font=ImageFont.truetype("C:/Windows/Fonts/arial.ttf",20)
rows=(len(times)+cols-1)//cols
sheet=Image.new('RGB',(cols*W,rows*H),'black')
for i,t in enumerate(times):
    n=round(t*30)
    raw=subprocess.run([FF,"-v","error","-i",src,"-vf",f"select='eq(n,{n})',scale={W}:{H}","-vsync","0","-frames:v","1","-f","image2pipe","-vcodec","png","-"],capture_output=True).stdout
    im=Image.open(io.BytesIO(raw)).convert('RGB'); d=ImageDraw.Draw(im)
    d.rectangle([0,0,78,26],fill=(0,0,0)); d.text((5,3),f"{t:.2f}",fill=(255,255,255),font=font)
    sheet.paste(im,((i%cols)*W,(i//cols)*H))
sheet.save(out)
print(out, sheet.size)
