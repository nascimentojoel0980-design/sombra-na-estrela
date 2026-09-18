import json, math
TRI={'path','footway','bridleway','steps'}
EST={'track'}
ESD={'service','unclassified','road'}
def enc(pts):
    out=[];plat=0;plng=0
    for la,lo in pts:
        ila=int(round(la*1e5)); ilo=int(round(lo*1e5))
        for d in (ila-plat, ilo-plng):
            d=~(d<<1) if d<0 else (d<<1)
            while d>=0x20: out.append(chr((0x20|(d&0x1f))+63)); d>>=5
            out.append(chr(d+63))
        plat=ila; plng=ilo
    return ''.join(out)
def rdp(pts,eps):
    if len(pts)<3: return pts
    def d(p,a,b):
        (y0,x0),(y1,x1),(y2,x2)=p,a,b
        k=math.cos(math.radians(y0))
        ax=(x1-x0)*k*111320; ay=(y1-y0)*111320
        bx=(x2-x0)*k*111320; by=(y2-y0)*111320
        dx=bx-ax; dy=by-ay; L=math.hypot(dx,dy)
        if L<1e-9: return math.hypot(ax,ay)
        return abs(dx*ay-dy*ax)/L
    st=[(0,len(pts)-1)]; keep=[False]*len(pts); keep[0]=keep[-1]=True
    while st:
        i,jj=st.pop()
        if jj<=i+1: continue
        mi=-1; md=0
        for k in range(i+1,jj):
            dd=d(pts[k],pts[i],pts[jj])
            if dd>md: md=dd; mi=k
        if md>eps: keep[mi]=True; st.append((i,mi)); st.append((mi,jj))
    return [p for p,k in zip(pts,keep) if k]
j=json.load(open('/mnt/user-data/uploads/Downloads/sne-dados/osm_estrela.json'))
out={'trilho':[],'estradao':[],'estrada':[]}
n=0
for e in j['elements']:
    t=(e.get('tags') or {}).get('highway')
    g=e.get('geometry')
    if not g or len(g)<2: continue
    key='trilho' if t in TRI else ('estradao' if t in EST else ('estrada' if t in ESD else None))
    if not key: continue
    pts=[(p['lat'],p['lon']) for p in g if p.get('lat') is not None]
    if len(pts)<2: continue
    pts=rdp(pts,3.0)
    out[key].append(enc(pts)); n+=1
res={k:'\n'.join(v) for k,v in out.items()}
json.dump(res,open('s2/osm_enc_v2.json','w'),separators=(',',':'))
import os
print({k:len(v) for k,v in out.items()})
print('MB',round(os.path.getsize('s2/osm_enc_v2.json')/1e6,2),'(antes', round(os.path.getsize('s2/osm_enc.json')/1e6,2),')')
