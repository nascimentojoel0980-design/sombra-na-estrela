import json,glob,os,re,struct,io,sys
from PIL import Image
Image.MAX_IMAGE_PIXELS=None
out='/home/claude/ortofull'; S=10240
def save(x,y,data):
  fn=f'{out}/of_{x}_{y}.webp'
  if os.path.exists(fn): return
  im=Image.open(io.BytesIO(data)).convert('RGB')
  im.save(fn,'WEBP',quality=58,method=4); print(fn,round(os.path.getsize(fn)/1e6,2),flush=True)
for p in glob.glob('/mnt/user-data/uploads/Downloads/*.tmp'):
  if 500000<os.path.getsize(p)<12000000:
    b=open(p,'rb').read(); m=re.search(rb'CELL3857 (-?\d+) (-?\d+) 10240',b[:80])
    if m and b[:2]==b'\xff\xd8': save(int(m.group(1)),int(m.group(2)),b)
packs=glob.glob('/home/claude/done_packs/*.tmp')+glob.glob('/mnt/user-data/uploads/Downloads/ortopack*.bin')
for p in packs:
  f=open(p,'rb')
  if f.read(8)!=b'ORTOPACK': continue
  hl=struct.unpack('>I',f.read(8)[:4])[0]; idx=json.loads(f.read(hl)); base=16+hl
  for e in idx:
    if e.get('T'): continue
    f.seek(base+e['off']); save(e['x'],e['y'],f.read(e['len']))
print(len(glob.glob(out+'/*.webp')))
