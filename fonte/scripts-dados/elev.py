import json,math,numpy as np,rasterio
from rasterio.windows import from_bounds
d=json.load(open('s2/data.json'))
src=rasterio.open('pkg/dados/percursos/relevo/cop30_estrela.tif'); Z=src.read(1).astype('float32'); inv=~src.transform
print(src.crs, src.res)
def zat(la,lo):
  c,r=inv*(lo,la); c-=.5; r-=.5; c0=int(math.floor(c)); r0=int(math.floor(r)); fc=c-c0; fr=r-r0
  if r0<0 or c0<0 or r0+1>=Z.shape[0] or c0+1>=Z.shape[1]: return None
  return Z[r0,c0]*(1-fc)*(1-fr)+Z[r0,c0+1]*fc*(1-fr)+Z[r0+1,c0]*(1-fc)*fr+Z[r0+1,c0+1]*fc*fr
def hav(a,b):
  la1,lo1=map(math.radians,a); la2,lo2=map(math.radians,b)
  h=math.sin((la2-la1)/2)**2+math.cos(la1)*math.cos(la2)*math.sin((lo2-lo1)/2)**2
  return 12742000*math.asin(math.sqrt(h))
def chain(parts):
  oi=[i for i,p in enumerate(parts) if len(p)>1]; parts=[parts[i] for i in oi]
  if not parts: return [],[]
  # start with the part whose start is farthest from all other endpoints (a terminal)
  ends=[(tuple(p[0]),tuple(p[-1])) for p in parts]
  def deg(pt): return sum((hav(pt,e[0])<15)+(hav(pt,e[1])<15) for e in ends)
  best=0
  for i,(a,b) in enumerate(ends):
    if deg(a)==1: best=i; break
  path=list(parts[best]); used={best}; order=[[oi[best],0]]
  if deg(tuple(path[0]))>1 and deg(tuple(path[-1]))==1: path=path[::-1]; order[0][1]=1
  while len(used)<len(parts):
    tail=path[-1]; bi=None; bd=1e18; rev=False
    for i,p in enumerate(parts):
      if i in used: continue
      d0=hav(tail,p[0]); d1=hav(tail,p[-1])
      if d0<bd: bd,bi,rev=d0,i,False
      if d1<bd: bd,bi,rev=d1,i,True
    if bd>400: break
    p=parts[bi][::-1] if rev else parts[bi]; path+=p[1:]; used.add(bi); order.append([oi[bi],int(rev)])
  return path,order
def enc(pts):
  out=[];pl=0;pn=0
  for la,lo in pts:
    for v,prev in ((la,pl),(lo,pn)):
      x=int(round(v*1e5))-int(round(prev*1e5)); x=~(x<<1) if x<0 else x<<1
      while x>=0x20: out.append(chr((0x20|(x&0x1f))+63)); x>>=5
      out.append(chr(x+63))
    pl,pn=la,lo
  return ''.join(out)
for r in d['routes']:
  g=r['geo'] if isinstance(r['geo'],list) else json.loads(r['geo'])
  path,order=chain(g)
  cum=[0]
  for i in range(1,len(path)): cum.append(cum[-1]+hav(path[i-1],path[i]))
  L=cum[-1]
  if L<100: r.pop('el',None); continue
  n=min(240,max(30,int(L/50)))
  step=L/(n-1); samp=[]; j=0
  for k in range(n):
    s=k*step
    while j<len(cum)-2 and cum[j+1]<s: j+=1
    t=(s-cum[j])/max(1e-9,cum[j+1]-cum[j]); t=min(1,max(0,t))
    samp.append((path[j][0]+(path[j+1][0]-path[j][0])*t, path[j][1]+(path[j+1][1]-path[j][1])*t))
  z=[zat(*p) for p in samp]
  if any(v is None for v in z): r.pop('el',None); continue
  zs=np.convolve(np.pad(z,2,mode='edge'),np.ones(5)/5,'valid')
  dz=np.diff(zs); up=float(dz[dz>0].sum()); dn=float(-dz[dz<0].sum())
  r['el']={'L':round(L),'z':[int(round(v)) for v in z],'p':enc(samp),'up':round(up),'dn':round(dn),'o':order}
json.dump(d,open('s2/data.json','w'),separators=(',',':'))
el=[r for r in d['routes'] if 'el' in r]; print(len(el),'with profile; bytes', sum(len(json.dumps(r['el'])) for r in el))
for r in el[:3]: print(r['ref'],r['km'],r['el']['L'],r['el']['up'],min(r['el']['z']),max(r['el']['z']))
