import json,sys
d=json.load(open('font/font.json',encoding='utf-8'))
s=open('fragment.template.html',encoding='utf-8').read()
s=s.replace('@@FONT800@@',d['800']['b64']).replace('@@FONT500@@',d['500']['b64']).replace('@@RANGE@@',d['unicode_range'])
assert '@@' not in s
out=sys.argv[1]
open(out,'w',encoding='utf-8',newline='\n').write(s)
print(len(s.encode('utf-8')),'bytes ->',out)
