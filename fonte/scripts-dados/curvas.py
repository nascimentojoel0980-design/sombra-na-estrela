import numpy as np, rasterio, json, math
from scipy.ndimage import gaussian_filter
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

src = rasterio.open('pkg/dados/percursos/relevo/cop30_estrela.tif')
Z = src.read(1).astype('float32')
Z = gaussian_filter(Z, 1.2)          # tira o ruido do modelo, senao as curvas ficam dentadas
h, w = Z.shape
b = src.bounds
lons = np.linspace(b.left, b.right, w)
lats = np.linspace(b.top, b.bottom, h)
X, Y = np.meshgrid(lons, lats)

INT = 20
niveis = np.arange(math.floor(Z.min()/INT)*INT, math.ceil(Z.max()/INT)*INT + INT, INT)
cs = plt.contour(X, Y, Z, levels=niveis)
feats = []
for lev, seg in zip(cs.levels, cs.allsegs):
    alt = int(round(lev))
    if alt < 0: continue
    grande = 1 if alt % 100 == 0 else 0
    meio = 1 if (alt % 50 == 0 and not grande) else 0
    for s in seg:
        if len(s) < 4: continue
        # simplificar: 1 ponto a cada ~1.5 do passo do modelo
        pts = [[round(float(x), 5), round(float(y), 5)] for x, y in s[::2]]
        if len(pts) < 3: continue
        feats.append({'type': 'Feature',
                      'properties': {'alt': alt, 'g': grande, 'm': meio},
                      'geometry': {'type': 'LineString', 'coordinates': pts}})
print('curvas:', len(feats), 'niveis:', len(niveis))
with open('vec/curvas.geojson', 'w') as f:
    f.write('{"type":"FeatureCollection","features":[\n')
    for i, ft in enumerate(feats):
        f.write(json.dumps(ft, separators=(',', ':')))
        f.write(',\n' if i < len(feats)-1 else '\n')
    f.write(']}')
import os
print('MB', round(os.path.getsize('vec/curvas.geojson')/1e6, 1))
