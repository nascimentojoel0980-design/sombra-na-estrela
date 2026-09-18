import json,math,os,re,glob,numpy as np,rasterio,pyproj
from collections import defaultdict
from scipy.ndimage import maximum_filter
from shapely.geometry import LineString
g=json.load(open('graph_raw.json')); V=np.array(g['V']); E=g['E']
fwd=pyproj.Transformer.from_crs(4326,3763,always_xy=True)
inv=pyproj.Transformer.from_crs(3763,4326,always_xy=True)
X,Y=fwd.transform(V[:,1],V[:,0]); XY=np.column_stack([X,Y])
STEP=10.0
offs=[0]; SX=[]; SY=[]; meta=[]; geoms=[]
for a,b,path,kind in E:
  P=XY[path]
  if len(P)<2:
    meta.append((a,b,kind,0.0)); geoms.append(''); offs.append(offs[-1]); continue
  d=np.hypot(*np.diff(P,axis=0).T); cum=np.concatenate([[0],np.cumsum(d)]); L=cum[-1]
  n=max(2,int(L/STEP)+1); s=np.linspace(0,L,n)
  xs=np.interp(s,cum,P[:,0]); ys=np.interp(s,cum,P[:,1])
  SX.append(xs); SY.append(ys); offs.append(offs[-1]+n)
  meta.append((a,b,kind,float(L)))
  simp=LineString(P).simplify(6) if len(P)>2 else LineString(P)
  geoms.append(np.array(simp.coords))
SX=np.concatenate(SX); SY=np.concatenate(SY); print('sample pts',len(SX),flush=True)
LO,LA=inv.transform(SX,SY)
dem=rasterio.open('pkg/dados/percursos/relevo/cop30_estrela.tif'); Z=dem.read(1).astype('float32'); di=~dem.transform
c,r=di*(LO,LA); c=np.clip(c.astype(int),0,Z.shape[1]-1); r=np.clip(r.astype(int),0,Z.shape[0]-1)
ZP=Z[r,c]
cos=rasterio.open('pkg/dados/percursos/ocupacao-solo/cosc2025_estrela.tif'); C=cos.read(1); ci=~cos.transform
c2,r2=ci*(SX,SY); ok=(c2>=0)&(c2<C.shape[1])&(r2>=0)&(r2<C.shape[0])
CP=np.full(len(SX),0,dtype='uint16'); CP[ok]=C[r2[ok].astype(int),c2[ok].astype(int)]
print('dem+cos done',flush=True)
SH=np.full(len(SX),-1,dtype='int8')
keys=(SX//1000).astype(int)*1000+(SY//1000).astype(int)
have={}
for p in glob.glob('lidar_all/mdt/*.tif'):
  k=re.search(r'-(\d+)\.tif',p).group(1)
  q=f'lidar_all/mds/MDS-2m-{k}.tif'
  if os.path.exists(q):
    with rasterio.open(p) as s: b=s.bounds
    have[int(b.left//1000)*1000+int(b.bottom//1000)]=(p,q,b)
idx=np.argsort(keys); ks=keys[idx]
uniq,starts=np.unique(ks,return_index=True); ends=np.append(starts[1:],len(ks))
done=0
for u,st,en in zip(uniq,starts,ends):
  h=have.get(int(u))
  if not h: continue
  p,q,b=h
  with rasterio.open(p) as s: mdt=s.read(1); tr=s.transform
  with rasterio.open(q) as s: mds=s.read(1)
  chm=np.where((mdt<-1000)|(mds<-1000),np.nan,mds-mdt)
  m=maximum_filter(np.nan_to_num(chm,nan=-1),size=5)
  ti=~tr; sel=idx[st:en]
  cc,rr=ti*(SX[sel],SY[sel]); cc=np.clip(cc.astype(int),0,chm.shape[1]-1); rr=np.clip(rr.astype(int),0,chm.shape[0]-1)
  v=m[rr,cc]; SH[sel]=np.where(v<0,-1,(v>3).astype('int8'))
  done+=1
  if done%100==0: print('tiles',done,flush=True)
print('shade done',flush=True)
def encode(pts):
  out=[];pl=0;pn=0
  for la,lo in pts:
    for v,prev in ((la,pl),(lo,pn)):
      x=int(round(v*1e5))-int(round(prev*1e5)); x=~(x<<1) if x<0 else x<<1
      while x>=0x20: out.append(chr((0x20|(x&0x1f))+63)); x>>=5
      out.append(chr(x+63))
    pl,pn=la,lo
  return ''.join(out)
KIND={'path':0,'track':1,'steps':2,'rota':3}
edges=[]
for i,(a,b,kind,L) in enumerate(meta):
  s,e=offs[i],offs[i+1]
  if e-s<2 or not len(geoms[i]):
    edges.append(None); continue
  z=ZP[s:e]
  if len(z)>=5:
    zs=np.convolve(np.pad(z,2,mode='edge'),np.ones(5)/5,'valid')
  else: zs=z
  dz=np.diff(zs); up=float(dz[dz>0].sum()); dn=float(-dz[dz<0].sum())
  cl=CP[s:e]; cl=cl[cl>0]
  cov=int(np.bincount(cl).argmax()) if len(cl) else 0
  sh=SH[s:e]; val=sh>=0
  shade=int(round(100*sh[val].mean())) if val.mean()>0.5 else -1
  lo,la=inv.transform(geoms[i][:,0],geoms[i][:,1])
  edges.append([a,b,round(L),round(up),round(dn),cov,shade,KIND[kind],encode(list(zip(la,lo)))])
data={'v':[[round(p[0],5),round(p[1],5)] for p in V.tolist()],'e':[x for x in edges if x]}
# keep only nodes referenced
used=sorted({x[0] for x in data['e']}|{x[1] for x in data['e']})
remap={v:i for i,v in enumerate(used)}
data['v']=[data['v'][i] for i in used]
for x in data['e']: x[0]=remap[x[0]]; x[1]=remap[x[1]]
json.dump(data,open('rede.json','w'),separators=(',',':'))
print('edges',len(data['e']),'nodes',len(data['v']),'MB',os.path.getsize('rede.json')/1e6)
