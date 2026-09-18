import glob,struct,json,io,os,sys
from multiprocessing import Pool
from PIL import Image
OUT='/home/claude/det40'; os.makedirs(OUT,exist_ok=True)
Q=40
jobs=[]
for p in sorted(glob.glob('/mnt/user-data/uploads/Downloads/*.bin')):
    f=open(p,'rb')
    if f.read(8)!=b'ORTOPACK': continue
    hl=struct.unpack('>I',f.read(8)[:4])[0]; idx=json.loads(f.read(hl)); base=16+hl
    for e in idx:
        if e.get('T'): jobs.append((p,base+e['off'],e['len'],e['x'],e['y'],e['T']))
print('jobs',len(jobs),flush=True)
def work(j):
    p,off,ln,x,y,T=j
    out=f'{OUT}/d_{x}_{y}.webp'
    if os.path.exists(out) and os.path.getsize(out)>1000: return (x,y,T,os.path.getsize(out))
    with open(p,'rb') as f:
        f.seek(off); b=f.read(ln)
    im=Image.open(io.BytesIO(b)).convert('RGB')
    im.save(out,'WEBP',quality=Q,method=4)
    return (x,y,T,os.path.getsize(out))
if __name__=='__main__':
    with Pool(8) as pool:
        res=[]
        for i,r in enumerate(pool.imap_unordered(work,jobs,chunksize=4)):
            res.append(r)
            if i%100==0: print(i,flush=True)
    json.dump(res,open('/home/claude/det40_index.json','w'))
    print('feito',len(res), round(sum(r[3] for r in res)/1e6,1),'MB')
