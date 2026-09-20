# -*- coding: utf-8 -*-
"""Painel de tres imagens da mesma caixa, lado a lado, para se ver o que os
histogramas nao mostram: Sentinel-2 em cor verdadeira | CHM LiDAR | classes
finais do cozedor. Escreve dados/lidar/painel_manteigas.png.

Le as bandas recortadas em <lidar-manteigas>/sat/ (ver provas_satelite.py) e o
chm_wgs84.tif; a grelha e a do Sentinel (10 m).
"""
import sys, os, math, numpy as np, rasterio
from rasterio.warp import transform as rtransform
from PIL import Image, ImageDraw, ImageFont
RAIZ = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
LID = os.environ.get('LIDAR_MANTEIGAS', os.path.join(RAIZ, '..', 'lidar-manteigas')); SAT = os.path.join(LID, 'sat')
sys.path.insert(0, os.path.join(RAIZ, 'fonte/scripts-dados')); import gera_terreno as g

caixa = (-7.62, 40.31, -7.49, 40.42); lo0, la0, lo1, la1 = caixa; classe = 10.0
mlat = 110540.0; mlon = 111320.0 * math.cos(math.radians((la0 + la1) / 2))
mx = int(round((lo1 - lo0) * mlon / classe)); my = int(round((la1 - la0) * mlat / classe))
lons = np.linspace(lo0, lo1, mx); lats = np.linspace(la1, la0, my); LON, LAT = np.meshgrid(lons, lats)

def amostra_raster(caminho):
    with rasterio.open(caminho) as r:
        xs, ys = rtransform('EPSG:4326', r.crs, LON.ravel(), LAT.ravel()); rows, cols = rasterio.transform.rowcol(r.transform, xs, ys)
        rows = np.clip(np.asarray(rows), 0, r.height - 1); cols = np.clip(np.asarray(cols), 0, r.width - 1)
        return r.read(1)[rows, cols].reshape(LON.shape)
def refl(f): return amostra_raster(os.path.join(SAT, f)).astype(np.float32) * 1e-4   # sem BOA_ADD_OFFSET (medido)
def stretch(b, lo, hi): return np.clip((b - lo) / (hi - lo), 0, 1)

B2, B3, B4 = (refl('S2B_20240722_%s_caixa.tif' % b) for b in ('B02', 'B03', 'B04'))
rgb = (np.dstack([stretch(B4, 0.01, 0.22), stretch(B3, 0.02, 0.20), stretch(B2, 0.02, 0.16)]) ** 0.8 * 255).astype(np.uint8)

# classes e CHM como o cozedor (na grelha de 10 m da imagem)
pm = g.PM(os.path.join(RAIZ, 'dados/topo.pmtiles')); C = np.zeros((my, mx), np.uint8)
for props, gt, gs in g.varre(pm, caixa, 15, 'solo'):
    if gt != 3: continue
    c = props.get('c'); cod = int(c) if c is not None else g.TAB_G.get(props.get('g'), 0)
    if cod: g.pinta(C, gs, cod, caixa, mx, my)
for props, gt, gs in g.varre(pm, caixa, 15, 'aguaA'):
    if gt == 3: g.pinta(C, gs, 9, caixa, mx, my)
zc, cc = g.le_mdt(os.path.join(LID, 'chm_wgs84.tif')); h = np.clip(g.amostra(zc, cc, lons, lats), 0, 25.5)
CASA = np.zeros((my, mx), np.uint8)
for props, gt, gs in g.varre(pm, caixa, 15, 'casas'):
    if gt == 3: g.pinta(CASA, gs, 1, caixa, mx, my)
CASA = g.dilata(CASA, 2); base = C & 127
subiu = (h >= 5) & (CASA == 0) & ~np.isin(base, [1, 2]) & np.isin(base, [0, 3, 6, 7])
arde = np.isin(base, [4, 5]); raso = (h < 0.5) & arde; rege = (h >= 0.5) & (h < 5) & arde
fin = np.where(subiu, 5, base); fin = np.where(rege, 6, fin); fin = np.where(raso, 3, fin)
COR = {0: (40, 40, 40), 1: (200, 60, 60), 2: (230, 200, 120), 3: (190, 220, 120), 4: (90, 160, 70),
       5: (20, 100, 30), 6: (170, 140, 80), 7: (150, 150, 150), 9: (60, 110, 200)}
cls = np.zeros((my, mx, 3), np.uint8)
for k, c in COR.items(): cls[fin == k] = c
hn = h / 25.5
chm = np.dstack([np.clip(hn * 2, 0, 1) * 255, np.clip(0.15 + hn * 1.4, 0, 1) * 255, np.clip(0.15 - hn, 0, 1) * 255]).astype(np.uint8)
chm[h < 0.5] = (70, 60, 55)

W, H = mx, my; pad = 26
img = Image.new('RGB', (3 * W + 2 * pad, H + 70), (20, 20, 20)); d = ImageDraw.Draw(img)
try: font = ImageFont.truetype("arial.ttf", 22); small = ImageFont.truetype("arial.ttf", 16)
except Exception: font = small = ImageFont.load_default()
for i, (arr, tit) in enumerate(((rgb, 'Sentinel-2 22/07/2024 cor verdadeira'),
                                (chm, 'CHM LiDAR 2024: castanho <0,5 m, verde >=5 m, amarelo 25 m'),
                                (cls, 'classes finais do cozedor'))):
    x = i * (W + pad); img.paste(Image.fromarray(arr), (x, 40)); d.text((x + 4, 8), tit, fill=(240, 240, 240), font=font)
pts = {'Manteigas': (-7.5385, 40.4015), 'encosta ardida': (-7.538, 40.354), 'domos Cantaros': (-7.611, 40.323),
       'Nave S.Antonio': (-7.5786, 40.3157), 'Vale Rossim': (-7.5849, 40.3985), 'Covao Ametade': (-7.5868, 40.3282)}
for nome, (lo, la) in pts.items():
    px = int((lo - lo0) / (lo1 - lo0) * W); py = int((la1 - la) / (la1 - la0) * H) + 40
    for i in range(3):
        x = i * (W + pad) + px; d.ellipse([x - 6, py - 6, x + 6, py + 6], outline=(255, 40, 40), width=2)
        if i == 0: d.text((x + 8, py - 8), nome, fill=(255, 255, 255), font=small, stroke_width=2, stroke_fill=(0, 0, 0))
d.text((4, H + 46), 'legenda classes: escuro=nada vermelho=urbano bege=agricola verde-claro=raso/chao nu verde=montado '
                    'verde-escuro=floresta castanho=matos cinza=rocha (COS) azul=agua', fill=(220, 220, 220), font=small)
out = os.path.join(RAIZ, 'dados', 'lidar', 'painel_manteigas.png'); os.makedirs(os.path.dirname(out), exist_ok=True)
img.save(out, optimize=True); print(out, img.size, '%.2f MB' % (os.path.getsize(out) / 1e6))
