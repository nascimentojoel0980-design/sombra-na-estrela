# -*- coding: utf-8 -*-
"""Quatro provas + histogramas para a regra de solo por satelite (Manteigas)."""
import sys, os, math, numpy as np, rasterio
from rasterio.warp import transform as rtransform
from scipy import ndimage
RAIZ = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
# os rasters pesados vivem FORA do repositorio, ao lado dele (ver prepara_lidar.py)
LID = os.environ.get('LIDAR_MANTEIGAS', os.path.join(RAIZ, '..', 'lidar-manteigas')); SAT = os.path.join(LID, 'sat')
sys.path.insert(0, os.path.join(RAIZ, 'fonte/scripts-dados')); import gera_terreno as g

caixa = (-7.62, 40.31, -7.49, 40.42); lo0, la0, lo1, la1 = caixa; classe = 5.0; arvore_min = 5.0
mlat = 110540.0; mlon = 111320.0 * math.cos(math.radians((la0 + la1) / 2))
mx = int(round((lo1 - lo0) * mlon / classe)); my = int(round((la1 - la0) * mlat / classe)); ac = 25 / 1e6; ha = 25 / 1e4
lons = np.linspace(lo0, lo1, mx); lats = np.linspace(la1, la0, my)
LON, LAT = np.meshgrid(lons, lats)

# --- classes e CHM, exactamente como o cozedor
pm = g.PM(os.path.join(RAIZ, 'dados/topo.pmtiles'))
C = np.zeros((my, mx), np.uint8); AG = np.zeros((my, mx), np.uint8); nag = 0
for props, gt, gs in g.varre(pm, caixa, 15, 'solo'):
    if gt != 3: continue
    c = props.get('c'); cod = int(c) if c is not None else g.TAB_G.get(props.get('g'), 0)
    if cod: g.pinta(C, gs, cod, caixa, mx, my)
for props, gt, gs in g.varre(pm, caixa, 15, 'aguaA'):
    if gt != 3: continue
    g.pinta(AG, gs, 1, caixa, mx, my); nag += 1
zc, cc = g.le_mdt(os.path.join(LID, 'chm_wgs84.tif'))
h = np.clip(g.amostra(zc, cc, lons, lats), 0, 25.5)
CASA = np.zeros((my, mx), np.uint8)
for props, gt, gs in g.varre(pm, caixa, 15, 'casas'):
    if gt == 3: g.pinta(CASA, gs, 1, caixa, mx, my)
CASA = g.dilata(CASA, int(math.ceil(12.0 / classe)))
base = C & 127
subiu = (h >= arvore_min) & (CASA == 0) & ~np.isin(base, [1, 2]) & np.isin(base, [0, 3, 6, 7])
arde = np.isin(base, [4, 5]); raso = (h < 0.5) & arde; rege = (h >= 0.5) & (h < arvore_min) & arde
fin = np.where(subiu, 5, base); fin = np.where(rege, 6, fin); fin = np.where(raso, 3, fin)

# --- amostrar Sentinel (UTM 29N) e WAW (LAEA) na grelha de 5 m, vizinho mais proximo
def amostra_raster(caminho, LON, LAT):
    with rasterio.open(caminho) as r:
        xs, ys = rtransform('EPSG:4326', r.crs, LON.ravel(), LAT.ravel())
        rows, cols = rasterio.transform.rowcol(r.transform, xs, ys)
        rows = np.clip(np.asarray(rows), 0, r.height - 1); cols = np.clip(np.asarray(cols), 0, r.width - 1)
        return r.read(1)[rows, cols].reshape(LON.shape)
def refl(nome):
    dn = amostra_raster(os.path.join(SAT, 'S2B_20240722_%s_caixa.tif' % nome), LON, LAT).astype(np.float32)
    # os COG do Element84 ja vem sem o BOA_ADD_OFFSET (medido: com -0,1 o vermelho fica negativo)
    v = dn * 1e-4; v[dn == 0] = np.nan; return v
B2, B3, B4, B8, B11, B12 = (refl(b) for b in ('B02', 'B03', 'B04', 'B08', 'B11', 'B12'))
SCL = amostra_raster(os.path.join(SAT, 'S2B_20240722_SCL_caixa.tif'), LON, LAT)
WAW = amostra_raster(os.path.join(SAT, 'waw2018_caixa_3035.tif'), LON, LAT)
with np.errstate(all='ignore'):
    NDVI = (B8 - B4) / (B8 + B4); NDWI = (B3 - B8) / (B3 + B8)
BRI = (B2 + B3 + B4) / 3; SWIR = B11
ok = np.isfinite(NDVI) & np.isfinite(SWIR)
print('grelha %dx%d a 5 m; nodata Sentinel %.3f%%; SCL nuvem/sombra (3,8,9,10) %.3f%%; neve (11) %.3f%%' % (
    mx, my, 100 * (~ok).mean(), 100 * np.isin(SCL, [3, 8, 9, 10]).mean(), 100 * (SCL == 11).mean()))
print('WAW na grelha: agua(1,2) %.2f km2, humido(3,4) %.2f km2' % (np.isin(WAW, [1, 2]).sum() * ac, np.isin(WAW, [3, 4]).sum() * ac))

def est(m, v): v = v[m & ok]; return 'media %+.3f  mediana %+.3f  P10 %+.3f  P90 %+.3f  n=%d (%.2f km2)' % (v.mean(), np.median(v), np.percentile(v, 10), np.percentile(v, 90), v.size, m.sum() * ac)
print('\nPROVA 1 -- georreferenciacao: %d poligonos aguaA' % nag)
print('   NDWI em aguaA :', est(AG == 1, NDWI)); print('   NDWI no resto :', est(AG == 0, NDWI))
print('   NIR  em aguaA :', est(AG == 1, B8));   print('   NIR  no resto :', est(AG == 0, B8))
print('   aguaA com NDWI > 0: %.1f%%;  resto com NDWI > 0: %.1f%%' % (100 * (NDWI[(AG == 1) & ok] > 0).mean(), 100 * (NDWI[(AG == 0) & ok] > 0).mean()))
print('   WAW=agua dentro de aguaA: %.1f%%;  WAW=agua fora: %.2f%%' % (100 * np.isin(WAW[AG == 1], [1, 2]).mean(), 100 * np.isin(WAW[AG == 0], [1, 2]).mean()))
print('\nPROVA 2 -- NDVI na floresta confirmada pelo CHM (classe final 5):'); print('   ', est(fin == 5, NDVI))
print('PROVA 3 -- NDVI no raso (COS floresta, copa < 0,5 m):');            print('   ', est(raso, NDVI))
print('   controlo NDVI matos final (6):', est(fin == 6, NDVI)); print('   controlo NDVI rocha COS (7), copa<0,5:', est((fin == 7) & (h < 0.5), NDVI))

# --- histogramas so onde copa < 0,5 m (o dominio da regra)
dom = (h < 0.5) & ok & ~np.isin(base, [1, 2])
def hist(v, m, lo, hi, n, rot):
    hh, ed = np.histogram(np.clip(v[m], lo, hi - 1e-6), bins=np.linspace(lo, hi, n + 1)); pk = hh.max()
    print('\n%s  (copa < 0,5 m, %.1f km2)' % (rot, m.sum() * ac))
    for a, c in zip(ed[:-1], hh): print('   %+.2f  %5.1f%%  %s' % (a, 100 * c / hh.sum(), '#' * int(round(40 * c / pk))))
def otsu(v, m, nb=256):
    x = v[m]; hh, ed = np.histogram(x, bins=nb); p = hh / hh.sum(); mid = (ed[:-1] + ed[1:]) / 2
    w0 = np.cumsum(p); w1 = 1 - w0; m0 = np.cumsum(p * mid) / np.maximum(w0, 1e-12)
    m1 = (np.sum(p * mid) - np.cumsum(p * mid)) / np.maximum(w1, 1e-12); s = w0 * w1 * (m0 - m1) ** 2
    return mid[np.argmax(s[:-1])]
hist(NDVI, dom, -0.2, 1.0, 24, 'NDVI'); hist(BRI, dom, 0.0, 0.40, 20, 'BRILHO (B2+B3+B4)/3'); hist(SWIR, dom, 0.0, 0.60, 24, 'SWIR B11')
t_ndvi = otsu(NDVI, dom); t_bri = otsu(BRI, dom); t_swir = otsu(SWIR, dom)
print('\nlimiares por Otsu no dominio: NDVI %.3f   brilho %.3f   SWIR %.3f' % (t_ndvi, t_bri, t_swir))

# --- a regra, na forma fechada
R = np.zeros((my, mx), np.uint8)   # 0 fora do dominio, 1 agua, 2 turfeira, 3 rocha, 4 pasto, 5 chao nu
agua = dom & np.isin(WAW, [1, 2]); turf = dom & np.isin(WAW, [3, 4]) & ~agua
resto = dom & ~agua & ~turf
rocha = resto & (NDVI < t_ndvi) & (BRI > t_bri) & (SWIR > t_swir)
pasto = resto & ~rocha & (NDVI >= t_ndvi)
nu = resto & ~rocha & ~pasto
for k, m in ((1, agua), (2, turf), (3, rocha), (4, pasto), (5, nu)): R[m] = k
print('\nREGRA aplicada (copa < 0,5 m):')
for k, n in ((1, 'agua'), (2, 'turfeira'), (3, 'rocha nua'), (4, 'pasto/erva'), (5, 'chao nu')):
    print('   %-10s %6.2f km2   NDVI medio %+.2f   brilho %.3f   SWIR %.3f' % (n, (R == k).sum() * ac, np.nanmean(NDVI[R == k]), np.nanmean(BRI[R == k]), np.nanmean(SWIR[R == k])))
print('   rocha da regra que a COS chamava: ' + ', '.join('%s %.0f%%' % (g.NOME[q], 100 * ((R == 3) & (base == q)).sum() / max((R == 3).sum(), 1)) for q in (0, 3, 4, 5, 6, 7)))
print('   COS rocha (7, copa<0,5) que a regra classifica como: ' + ', '.join('%s %.0f%%' % (n, 100 * ((R == k) & (base == 7) & dom).sum() / ((base == 7) & dom).sum()) for k, n in ((3, 'rocha'), (4, 'pasto'), (5, 'chao nu'), (1, 'agua'))))

print('\nPROVA 4 -- agrupamento da rocha da regra')
lab, n = ndimage.label(R == 3, structure=np.ones((3, 3))); tam = np.bincount(lab.ravel())[1:]; th = tam * ha
top = list(np.sort(th)[::-1][:3]) + [0.0, 0.0, 0.0]
print('   manchas: %d;  maior %.1f ha, 2a %.1f, 3a %.1f' % (n, top[0], top[1], top[2]))
print('   < 1 ha: %d (%.1f%% das manchas, %.1f%% da area);  1-10 ha: %d;  10-100 ha: %d;  >100 ha: %d' % (
    (th < 1).sum(), 100 * (th < 1).mean(), 100 * tam[th < 1].sum() / tam.sum(), ((th >= 1) & (th < 10)).sum(), ((th >= 10) & (th < 100)).sum(), (th >= 100).sum()))
ordem = np.argsort(tam)[::-1][:3] + 1
for k, (r, c) in zip(ordem, ndimage.center_of_mass(R == 3, lab, ordem)):
    m = lab == k; rr, cc_ = np.where(m); env = (rr.max() - rr.min() + 1) * (cc_.max() - cc_.min() + 1)
    print('   %.1f ha  %.5f, %.5f  forma %.2f  cota media %.0f m' % (m.sum() * ha, la1 - (r + 0.5) / my * (la1 - la0), lo0 + (c + 0.5) / mx * (lo1 - lo0), m.sum() / env, 0))
# comparacao: a mesma medida para o pasto e o chao nu, para se ver se a rocha e MAIS agrupada
for k, nome in ((4, 'pasto'), (5, 'chao nu')):
    lab2, n2 = ndimage.label(R == k, structure=np.ones((3, 3))); t2 = np.bincount(lab2.ravel())[1:] * ha
    print('   (%s: %d manchas, maior %.1f ha, <1 ha = %.1f%% da area)' % (nome, n2, t2.max(), 100 * t2[t2 < 1].sum() / t2.sum()))
np.save(os.path.join(SAT, 'regra_R.npy'), R)
