import json, os
D = json.load(open('s2/data.json'))
def dec(s):
    r=[];lat=0;lng=0;i=0
    while i<len(s):
        for k in (0,1):
            sh=0;res=0
            while True:
                b=ord(s[i])-63;i+=1;res|=(b&0x1f)<<sh;sh+=5
                if b<0x20:break
            d=~(res>>1) if res&1 else res>>1
            if k==0: lat+=d
            else: lng+=d
        r.append([round(lng/1e5,5),round(lat/1e5,5)])
    return r
feats=[]
for r in D['routes']:
    base={'id':r['id'],'ref':r.get('ref') or '','nome':r.get('nome') or '','f':r.get('fonte'),'km':r.get('km')}
    if r.get('lidar') and r.get('segs'):
        for s in r['segs']:
            co=dec(s[1])
            if len(co)<2: continue
            p=dict(base); p['sombra']=s[0]
            feats.append({'type':'Feature','properties':p,'geometry':{'type':'LineString','coordinates':co}})
    else:
        for part in (r.get('geoe') or []):
            co=dec(part)
            if len(co)<2: continue
            p=dict(base); p['sombra']=-1
            feats.append({'type':'Feature','properties':p,'geometry':{'type':'LineString','coordinates':co}})
with open('vec/rotas.geojson','w') as f:
    f.write('{"type":"FeatureCollection","features":[\n')
    for i,ft in enumerate(feats):
        f.write(json.dumps(ft,separators=(',',':'))); f.write(',\n' if i<len(feats)-1 else '\n')
    f.write(']}')
print('rotas', len(feats), round(os.path.getsize('vec/rotas.geojson')/1e6,1),'MB')
