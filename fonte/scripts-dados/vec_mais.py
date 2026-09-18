import json, os
def escreve(path, feats):
    with open(path,'w') as f:
        f.write('{"type":"FeatureCollection","features":[\n')
        for i,ft in enumerate(feats):
            f.write(json.dumps(ft,separators=(',',':'))); f.write(',\n' if i<len(feats)-1 else '\n')
        f.write(']}')
    print(os.path.basename(path), len(feats), round(os.path.getsize(path)/1e6,1),'MB')

# casas
j=json.load(open('/mnt/user-data/uploads/Downloads/sne-dados/casas.json'))
casas=[]
for e in j['elements']:
    g=e.get('geometry')
    if not g or len(g)<3: continue
    co=[[round(p['lon'],5),round(p['lat'],5)] for p in g if p.get('lat') is not None]
    if len(co)<3: continue
    if co[0]!=co[-1]: co.append(co[0])
    if len(co)<4: continue
    casas.append({'type':'Feature','properties':{},'geometry':{'type':'Polygon','coordinates':[co]}})
escreve('vec/casas.geojson',casas)

# pontos
ICO={'peak':'cume','spring':'nascente','shelter':'abrigo','drinking_water':'agua',
     'viewpoint':'miradouro','picnic_site':'piquenique','camp_site':'campismo',
     'parking':'estacionamento','restaurant':'comer','cafe':'comer','toilets':'wc',
     'attraction':'ver','information':'info','museum':'ver','ruins':'ruinas','castle':'castelo',
     'church':'igreja','chapel':'igreja','monument':'monumento','archaeological_site':'arqueologia'}
CLASSE={'city':1,'town':2,'village':3,'hamlet':4,'isolated_dwelling':5,'locality':5,'suburb':4,'farm':5}
jp=json.load(open('/mnt/user-data/uploads/Downloads/sne-dados/pontos.json'))
pts=[]
for e in jp['elements']:
    tg=e.get('tags') or {}
    la,lo=e.get('lat'),e.get('lon')
    if la is None: continue
    nome=(tg.get('name') or '').strip()
    p={}
    if tg.get('place'):
        p['k']='povoacao'; p['c']=CLASSE.get(tg['place'],5)
        if tg.get('population'):
            try: p['pop']=int(''.join(ch for ch in tg['population'] if ch.isdigit()) or 0)
            except Exception: pass
    elif tg.get('natural')=='peak':
        p['k']='cume'
        if tg.get('ele'):
            try: p['ele']=int(float(tg['ele']))
            except Exception: pass
    elif tg.get('natural')=='spring': p['k']='nascente'
    else:
        v=tg.get('tourism') or tg.get('amenity') or tg.get('historic') or ''
        k=ICO.get(v)
        if not k: continue
        p['k']=k
    if nome: p['n']=nome[:60]
    if not p.get('n') and p['k'] in ('povoacao',): continue
    pts.append({'type':'Feature','properties':p,'geometry':{'type':'Point','coordinates':[round(lo,5),round(la,5)]}})
escreve('vec/pontos.geojson',pts)
