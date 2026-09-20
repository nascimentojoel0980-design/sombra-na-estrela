# -*- coding: utf-8 -*-
"""Rugosidade R (desvio-padrao da cota apos tirar o plano local, raio 10 m) do
MDT LiDAR nativo a 2 m; medida na grelha de 5 m onde copa < 0,5 m."""
import sys, os, glob, math, numpy as np, rasterio
from rasterio.merge import merge
from rasterio.warp import transform as rtransform
from scipy import ndimage
RAIZ = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
# os rasters pesados vivem FORA do repositorio, ao lado dele (ver prepara_lidar.py)
LID = os.environ.get('LIDAR_MANTEIGAS', os.path.join(RAIZ, '..', 'lidar-manteigas')); SAT = os.path.join(LID, 'sat')
sys.path.insert(0, os.path.join(RAIZ, 'fonte/scripts-dados')); import gera_terreno as g
QUAL = sys.argv[1] if len(sys.argv) > 1 else 'MDT-2m'

caixa = (-7.62, 40.31, -7.49, 40.42); lo0, la0, lo1, la1 = caixa; classe = 5.0
mlat = 110540.0; mlon = 111320.0 * math.cos(math.radians((la0 + la1) / 2))
mx = int(round((lo1 - lo0) * mlon / classe)); my = int(round((la1 - la0) * mlat / classe)); ac = 25 / 1e6; ha = 25 / 1e4
lons = np.linspace(lo0, lo1, mx); lats = np.linspace(la1, la0, my); LON, LAT = np.meshgrid(lons, lats)

# --- mosaico nativo 2 m (EPSG:3763), nodata lido de cada folha
fs = sorted(glob.glob(os.path.join(LID, QUAL, '*.tif')))
srcs = [rasterio.open(f) for f in fs]; nd = srcs[0].nodata if srcs[0].nodata is not None else -999.0
Z, tr = merge(srcs, nodata=nd); crs = srcs[0].crs; [s.close() for s in srcs]
Z = Z[0].astype(np.float64); Z[Z == nd] = np.nan
px = tr.a
print('%s: %d folhas, %dx%d px a %.0f m, nodata %.3f%%' % (QUAL, len(fs), Z.shape[1], Z.shape[0], px, 100 * np.isnan(Z).mean()))

# --- plano local por minimos quadrados numa janela (2n+1)^2, via medias moveis
n = int(round(10.0 / px))                     # raio 10 m -> 5 celulas
w = 2 * n + 1
def med(a): return ndimage.uniform_filter(a, size=w, mode='nearest')
k = np.arange(-n, n + 1, dtype=np.float64) * px           # coordenadas locais em metros
vx = np.mean(k ** 2)                                      # var(x) = var(y) na janela
Zf = np.where(np.isnan(Z), np.nanmean(Z), Z)              # sem nodata na caixa (medido antes); so por seguranca
mz = med(Zf)
# cov(x,z): media de x*z com x = coluna local (soma ao longo das colunas com pesos k, uniforme nas linhas)
cxz = ndimage.convolve1d(ndimage.uniform_filter1d(Zf, w, axis=0, mode='nearest'), k / w, axis=1, mode='nearest')
cyz = ndimage.convolve1d(ndimage.uniform_filter1d(Zf, w, axis=1, mode='nearest'), k / w, axis=0, mode='nearest')
vz = med(Zf * Zf) - mz * mz
res = vz - (cxz ** 2) / vx - (cyz ** 2) / vx
R2 = np.sqrt(np.clip(res, 0, None))
print('R a 2 m: mediana %.3f m, P90 %.3f, P99 %.3f, max %.2f' % (np.median(R2), np.percentile(R2, 90), np.percentile(R2, 99), R2.max()))

# --- para a grelha de 5 m (vizinho mais proximo) + declive/cota
xs, ys = rtransform('EPSG:4326', crs, LON.ravel(), LAT.ravel())
rows, cols = rasterio.transform.rowcol(tr, xs, ys)
rows = np.clip(np.asarray(rows), 0, Z.shape[0] - 1); cols = np.clip(np.asarray(cols), 0, Z.shape[1] - 1)
R = R2[rows, cols].reshape(LON.shape); ZZ = Zf[rows, cols].reshape(LON.shape)
gy, gx = np.gradient(ZZ, classe, classe); slope = np.degrees(np.arctan(np.hypot(gx, gy)))

# --- dominio: copa < 0,5 m, fora do urbano/agricola (como a regra)
pm = g.PM(os.path.join(RAIZ, 'dados/topo.pmtiles')); C = np.zeros((my, mx), np.uint8)
for props, gt, gs in g.varre(pm, caixa, 15, 'solo'):
    if gt != 3: continue
    c = props.get('c'); cod = int(c) if c is not None else g.TAB_G.get(props.get('g'), 0)
    if cod: g.pinta(C, gs, cod, caixa, mx, my)
zc, cc = g.le_mdt(os.path.join(LID, 'chm_wgs84.tif')); h = np.clip(g.amostra(zc, cc, lons, lats), 0, 25.5)
base = C & 127; dom = (h < 0.5) & ~np.isin(base, [1, 2])
print('dominio copa < 0,5 m: %.1f km2' % (dom.sum() * ac))

def est(m): v = R[m]; return 'media %.3f  mediana %.3f  P10 %.3f  P90 %.3f  (n=%d, %.1f ha)' % (v.mean(), np.median(v), np.percentile(v, 10), np.percentile(v, 90), v.size, m.sum() * ha)

# 1. as duas manchas isoladas pela regra do satelite
Rr = np.load(os.path.join(SAT, 'regra_R.npy')); lab, nl = ndimage.label(Rr == 3, structure=np.ones((3, 3)))
def mancha_em(lat, lon):
    r = int((la1 - lat) / (la1 - la0) * my); c = int((lon - lo0) / (lo1 - lo0) * mx)
    ids = np.unique(lab[max(r - 40, 0):r + 40, max(c - 40, 0):c + 40]); ids = ids[ids > 0]
    k = ids[np.argmax([(lab == i).sum() for i in ids])]; return lab == k
cant = mancha_em(40.323, -7.611); ardida = mancha_em(40.354, -7.538)
print('\n1. R nas duas manchas')
print('   Cantaros (rocha)        :', est(cant), ' cota %.0f m' % ZZ[cant].mean())
print('   encosta ardida (nao e)  :', est(ardida), ' cota %.0f m' % ZZ[ardida].mean())
a, b = R[cant], R[ardida]
sep = (np.percentile(a, 10) - np.percentile(b, 90))
print('   P10 rocha - P90 ardida = %+.3f m  (positivo = separadas sem sobreposicao nos 80%% centrais)' % sep)
print('   celulas da ardida acima da mediana da rocha: %.1f%%;  celulas da rocha abaixo da mediana da ardida: %.1f%%' % (100 * (b > np.median(a)).mean(), 100 * (a < np.median(b)).mean()))

# 2. histograma de R no dominio
print('\n2. histograma de R (dominio sem copa)')
v = R[dom]; ed = np.concatenate([np.arange(0, 1.0, 0.05), np.arange(1.0, 2.01, 0.25), [3, 5, 99]])
hh, _ = np.histogram(v, bins=ed); pk = hh.max()
for lo, hi, c in zip(ed[:-1], ed[1:], hh): print('   %4.2f-%-4.2f %5.1f%%  %s' % (lo, min(hi, 9.99), 100 * c / hh.sum(), '#' * int(round(40 * c / pk))))
# procura de vale: minimo local do histograma em log-espaco entre 0,1 e 1,5 m
fino, edf = np.histogram(np.log10(np.clip(v, 0.01, 10)), bins=60); mids = 10 ** ((edf[:-1] + edf[1:]) / 2)
sm = ndimage.uniform_filter1d(fino.astype(float), 5)
picos = [i for i in range(2, len(sm) - 2) if sm[i] > sm[i - 1] and sm[i] > sm[i + 1] and sm[i] > 0.05 * sm.max()]
print('   modos (histograma log, alisado): ' + ', '.join('%.2f m' % mids[i] for i in picos))
if len(picos) >= 2:
    i0, i1 = picos[0], picos[-1]; iv = i0 + int(np.argmin(sm[i0:i1 + 1])); tval = mids[iv]
    print('   vale entre os modos: R = %.2f m  (profundidade: %.0f%% do pico mais baixo)' % (tval, 100 * (1 - sm[iv] / min(sm[i0], sm[i1]))))
else:
    tval = None; print('   uma corcova so: nao ha vale')

# 3./4. se ha separacao entre as duas manchas, usa o ponto medio entre as medianas como limiar
lim = tval if tval is not None else float(np.sqrt(np.median(a) * np.median(b)))
print('\n3. limiar usado: R = %.3f m  (%s)' % (lim, 'vale do histograma' if tval is not None else 'media geometrica das medianas das duas manchas -- NAO e um vale'))
roc = dom & (R >= lim); liso = dom & (R < lim)
print('   rocha (R >= limiar): %.2f km2   liso (R < limiar): %.2f km2' % (roc.sum() * ac, liso.sum() * ac))
print('   COS rocha (7) sem copa classificada rocha: %.0f%%;  raso ardido (COS floresta, copa<0,5) classificado rocha: %.0f%%;  COS matos sem copa: %.0f%%' % (
    100 * roc[(base == 7) & dom].mean(), 100 * roc[np.isin(base, [4, 5]) & dom].mean(), 100 * roc[(base == 6) & dom].mean()))
print('   rocha-R vinha de: ' + ', '.join('%s %.0f%%' % (g.NOME[q], 100 * (roc & (base == q)).sum() / roc.sum()) for q in (0, 3, 4, 5, 6, 7)))
print('   rocha-R: cota media %.0f m (P10 %.0f, P90 %.0f); liso: cota media %.0f m' % (ZZ[roc].mean(), *np.percentile(ZZ[roc], [10, 90]), ZZ[liso].mean()))
print('   declive medio: rocha-R %.1f  liso %.1f  |  correlacao R-declive no dominio: %.2f' % (slope[roc].mean(), slope[liso].mean(), np.corrcoef(R[dom], slope[dom])[0, 1]))

print('\n4. agrupamento da rocha-R')
lab2, n2 = ndimage.label(roc, structure=np.ones((3, 3))); tam = np.bincount(lab2.ravel())[1:]; th = tam * ha
top = list(np.sort(th)[::-1][:3]) + [0, 0, 0]
print('   manchas: %d;  maior %.1f ha, 2a %.1f, 3a %.1f' % (n2, top[0], top[1], top[2]))
print('   < 1 ha: %d (%.1f%% das manchas, %.1f%% da area);  1-10 ha: %d;  10-100 ha: %d;  >100 ha: %d' % (
    (th < 1).sum(), 100 * (th < 1).mean(), 100 * tam[th < 1].sum() / tam.sum(), ((th >= 1) & (th < 10)).sum(), ((th >= 10) & (th < 100)).sum(), (th >= 100).sum()))
for k, (r, c) in zip(np.argsort(tam)[::-1][:3] + 1, ndimage.center_of_mass(roc, lab2, np.argsort(tam)[::-1][:3] + 1)):
    m = lab2 == k; rr, cc_ = np.where(m); env = (rr.max() - rr.min() + 1) * (cc_.max() - cc_.min() + 1)
    print('   %.1f ha  %.5f N %.5f W  forma %.2f  cota media %.0f m (P10 %.0f, P90 %.0f)  declive %.1f  R medio %.2f' % (
        m.sum() * ha, la1 - (r + 0.5) / my * (la1 - la0), -(lo0 + (c + 0.5) / mx * (lo1 - lo0)), m.sum() / env, ZZ[m].mean(), *np.percentile(ZZ[m], [10, 90]), slope[m].mean(), R[m].mean()))
np.save(os.path.join(SAT, 'R_%s.npy' % QUAL), R.astype(np.float32))
