import json,math,os,re,glob,numpy as np,rasterio,pyproj
from scipy.ndimage import maximum_filter
from collections import defaultdict
d=json.load(open('s2/data.pre_shade_all.json'))
fwd=pyproj.Transformer.from_crs(4326,3763,always_xy=True)
STEP=2.0
recs=[]  # (route_idx, part_order_idx, start_offset, n, L)
SX=[];SY=[];off=0
def dec(s):
  i=0;la=lo=0;out=[]
  while i<len(s):
    for k in range(2):
      sh=r_=0
      while True:
        b=ord(s[i])-63;i+=1;r_|=(b&0x1f)<<sh;sh+=5
        if b<0x20:break
      v=~(r_>>1) if r_&1 else r_>>1
      if k==0: la+=v
      else: lo+=v
    out.append((la/1e5,lo/1e5))
  return out
for ri,r in enumerate(d['routes']):
  order=[i for i,_ in r['el']['o']] if r.get('el') else []
  order+=[i for i in range(len(r['geo'])) if i not in order]
  for oi,pi in enumerate(order):
    part=r['geo'][pi]
    if len(part)<2: continue
    x,y=fwd.transform([p[1] for p in part],[p[0] for p in part])
    P=np.column_stack([x,y]); dd=np.hypot(*np.diff(P,axis=0).T); cum=np.concatenate([[0],np.cumsum(dd)]); L=cum[-1]
    if L<4: continue
    n=max(2,int(L/STEP)+1); s=np.linspace(0,L,n)
    SX.append(np.interp(s,cum,P[:,0])); SY.append(np.interp(s,cum,P[:,1]))
    recs.append((ri,oi,off,n,L)); off+=n
SX=np.concatenate(SX); SY=np.concatenate(SY); N=len(SX); print('pts',N,flush=True)
H0=np.full(N,np.nan,dtype='float32'); H4=np.full(N,np.nan,dtype='float32')
have={}
for p in glob.glob('lidar_all/mdt/*.tif'):
  k=re.search(r'-(\d+)\.tif',p).group(1); q=f'lidar_all/mds/MDS-2m-{k}.tif'
  if os.path.exists(q):
    with rasterio.open(p) as s: b=s.bounds
    have[int(b.left//1000)*1000+int(b.bottom//1000)]=(p,q)
keys=(SX//1000).astype(int)*1000+(SY//1000).astype(int)
idx=np.argsort(keys); ks=keys[idx]; uniq,starts=np.unique(ks,return_index=True); ends=np.append(starts[1:],N)
done=0
for u,st,en in zip(uniq,starts,ends):
  h=have.get(int(u))
  if not h: continue
  p,q=h
  with rasterio.open(p) as s: mdt=s.read(1); tr=s.transform
  with rasterio.open(q) as s: mds=s.read(1)
  chm=np.where((mdt<-1000)|(mds<-1000),np.nan,mds-mdt).astype('float32'); chm[chm<0]=0
  mx=maximum_filter(np.nan_to_num(chm,nan=-1),size=5)
  ti=~tr; sel=idx[st:en]
  cc,rr=ti*(SX[sel],SY[sel]); cc=np.clip(cc.astype(int),0,chm.shape[1]-1); rr=np.clip(rr.astype(int),0,chm.shape[0]-1)
  v0=chm[rr,cc]; v4=mx[rr,cc]
  H0[sel]=v0; H4[sel]=np.where(v4<0,np.nan,v4)
  done+=1
  if done%150==0: print('tiles',done,flush=True)
print('sampled',flush=True)
def enc5(pts):
  out=[];pl=0;pn=0
  for la,lo in pts:
    for v,prev in ((la,pl),(lo,pn)):
      x=int(round(v*1e5))-int(round(prev*1e5)); x=~(x<<1) if x<0 else x<<1
      while x>=0x20: out.append(chr((0x20|(x&0x1f))+63)); x>>=5
      out.append(chr(x+63))
    pl,pn=la,lo
  return ''.join(out)
inv=pyproj.Transformer.from_crs(3763,4326,always_xy=True)
byroute=defaultdict(list)
for rec in recs: byroute[rec[0]].append(rec)
rep=[]
for ri,r in enumerate(d['routes']):
  rs=byroute.get(ri)
  if not rs: continue
  allsh=[];allh0=[];allh4=[];best=0;tot=0;val=0;segs=[]
  for (_,oi,s0,n,L) in rs:
    h4=H4[s0:s0+n]; h0=H0[s0:s0+n]; ok=np.isfinite(h4); sh=(h4>3)&ok
    tot+=n; val+=int(ok.sum())
    allsh+=list(sh[ok]); allh0+=list(h0[ok&np.isfinite(h0)]); allh4+=list(h4[sh])
    step=L/(n-1); run=0
    for s_,v in zip(sh,ok):
      if not v: run=0; continue
      run=0 if s_ else run+step; best=max(best,run)
    k=max(1,int(round(100/step)))
    for i in range(0,n-1,k):
      j=min(n,i+k+1); o=ok[i:j]
      if o.mean()<0.5: continue
      pct=int(round(100*sh[i:j][o].mean()))
      xs=SX[s0+i:s0+j]; ys=SY[s0+i:s0+j]
      stp=max(1,len(xs)//8); lo_,la_=inv.transform(xs[::stp],ys[::stp])
      pts=[[round(a,5),round(b,5)] for a,b in zip(la_,lo_)]
      lo2,la2=inv.transform([xs[-1]],[ys[-1]]); pts.append([round(la2[0],5),round(lo2[0],5)])
      if len(pts)>1: segs.append([pct,pts])
  cov=val/max(tot,1)
  if not allsh or cov<0.6:
    rep.append((r['ref'],'cob %d%%'%round(100*cov))); continue
  if r.get('el'):
    samp=dec(r['el']['p'])
    segs.sort(key=lambda s:min(range(len(samp)),key=lambda j:(samp[j][0]-s[1][len(s[1])//2][0])**2+(samp[j][1]-s[1][len(s[1])//2][1])**2))
  r['lidar']={'sombra':round(float(100*np.mean(allsh)),1),'copa':round(float(100*np.mean(np.array(allh0)>3)),1),'alt':round(float(np.median(allh4)),1) if allh4 else 0,'sol':int(round(best)),'cob':int(round(100*cov))}
  r['segs']=segs
  rep.append((r['ref'],r['lidar']['sombra'],int(round(100*cov))))
json.dump(d,open('s2/data.json','w'),separators=(',',':'))
print('com lidar',sum(1 for r in d['routes'] if r.get('lidar')),'de',len(d['routes']))
for x in rep: print(x)
