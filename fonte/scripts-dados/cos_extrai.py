import sqlite3, struct, json, os
from shapely import wkb
from shapely.geometry import box, mapping
from shapely.ops import transform
import pyproj

t = pyproj.Transformer.from_crs(4326, 3763, always_xy=True)
ti = pyproj.Transformer.from_crs(3763, 4326, always_xy=True)
x0, y0 = t.transform(-8.10, 40.00); x1, y1 = t.transform(-7.15, 40.70)
x0b, y0b = t.transform(-8.10, 40.70); x1b, y1b = t.transform(-7.15, 40.00)
X0, X1 = min(x0, x0b), max(x1, x1b); Y0, Y1 = min(y0, y1b), max(y1, y0b)
print('bbox 3763', round(X0), round(Y0), round(X1), round(Y1))

def gpkg_wkb(blob):
    # cabecalho GeoPackage: magic(2) ver(1) flags(1) srs(4) + envelope
    flags = blob[3]; env = (flags >> 1) & 0x07
    n = {0:0, 1:32, 2:48, 3:48, 4:64}[env]
    return wkb.loads(blob[8+n:])

# agrupar as classes da COS em familias uteis para um mapa de montanha
def grupo(n3, n2, n1):
    c = (n3 or n2 or n1 or '')
    if c.startswith('1'): return 'urbano'
    if c.startswith('2'): return 'agricola'
    if c.startswith('3'):
        if c.startswith('31') or c.startswith('32'): return 'floresta'
        return 'floresta'
    if c.startswith('4'): return 'matos'
    if c.startswith('5'):
        if c.startswith('51'): return 'rocha'
        return 'rocha'
    if c.startswith('6'): return 'agua'
    return 'outro'

con = sqlite3.connect('cos/cos2025v1.gpkg'); cur = con.cursor()
cur.execute("""SELECT c.geom, c.cos25v1_n3_c, c.cos25v1_n2_c, c.cos25v1_n1_c, c.cos25v1_n3_l
               FROM cos2025v1 c JOIN rtree_cos2025v1_geom r ON c.fid = r.id
               WHERE r.minx < ? AND r.maxx > ? AND r.miny < ? AND r.maxy > ?""",
            (X1, X0, Y1, Y0))
recorte = box(X0, Y0, X1, Y1)
n = 0; saltos = 0
out = open('vec/solo_cos.geojson', 'w')
out.write('{"type":"FeatureCollection","features":[\n')
primeiro = True
for blob, n3, n2, n1, rot in cur:
    try: g = gpkg_wkb(blob)
    except Exception: saltos += 1; continue
    if not g.intersects(recorte): continue
    g = g.intersection(recorte)
    if g.is_empty: continue
    if g.area < 4000: continue          # abaixo de 0,4 ha nao se ve
    g = g.simplify(8)                    # 8 m: suaviza sem dar pela diferenca
    if g.is_empty: continue
    g = transform(ti.transform, g)
    ft = {'type': 'Feature', 'properties': {'g': grupo(n3, n2, n1)},
          'geometry': mapping(g)}
    if not primeiro: out.write(',\n')
    out.write(json.dumps(ft, separators=(',', ':')))
    primeiro = False; n += 1
    if n % 20000 == 0: print(n, flush=True)
out.write('\n]}')
out.close()
print('poligonos', n, 'saltados', saltos, 'MB', round(os.path.getsize('vec/solo_cos.geojson')/1e6, 1))
