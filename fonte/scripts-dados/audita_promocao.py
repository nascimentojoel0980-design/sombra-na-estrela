# -*- coding: utf-8 -*-
"""Auditoria da promocao (20/09/2026): refaz SO o calculo da promocao do gera_terreno.py (mesma caixa, grelha de
classes de 5 m, --arvore-min 5) e descreve as celulas promovidas.

  python3 fonte/scripts-dados/audita_promocao.py [caminho/para/chm_wgs84.tif]
"""
import sys, os, math, numpy as np
from scipy import ndimage
RAIZ = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
# o CHM pesado vive FORA do repositorio (ver prepara_lidar.py); passa-se o caminho
CHM = sys.argv[1] if len(sys.argv) > 1 else os.path.join(RAIZ, '..', 'lidar-manteigas', 'chm_wgs84.tif')
sys.path.insert(0, os.path.join(RAIZ, 'fonte/scripts-dados'))
import gera_terreno as g

caixa = (-7.62, 40.31, -7.49, 40.42); lo0, la0, lo1, la1 = caixa
classe = 5.0; arvore_min = 5.0; zsolo = 15
mlat = 110540.0; mlon = 111320.0 * math.cos(math.radians((la0 + la1) / 2))
larg_m = (lo1 - lo0) * mlon; alt_m = (la1 - la0) * mlat
mx = int(round(larg_m / classe)); my = int(round(alt_m / classe))
ac = classe * classe / 1e6                      # km2 por celula
ha = classe * classe / 1e4                      # ha por celula

pm = g.PM(os.path.join(RAIZ, 'dados/topo.pmtiles'))
C = np.zeros((my, mx), dtype=np.uint8)
for props, gt, gs in g.varre(pm, caixa, zsolo, 'solo'):
    if gt != 3: continue
    c = props.get('c'); cod = int(c) if c is not None else g.TAB_G.get(props.get('g'), 0)
    if cod: g.pinta(C, gs, cod, caixa, mx, my)
for props, gt, gs in g.varre(pm, caixa, zsolo, 'aguaA'):
    if gt != 3: continue
    g.pinta(C, gs, 9, caixa, mx, my)

zc, cc = g.le_mdt(CHM)
h = g.amostra(zc, cc, np.linspace(lo0, lo1, mx), np.linspace(la1, la0, my))
h = np.clip(h, 0, 25.5)

CASA = np.zeros((my, mx), dtype=np.uint8); ncasa = 0
for props, gt, gs in g.varre(pm, caixa, zsolo, 'casas'):
    if gt != 3: continue
    g.pinta(CASA, gs, 1, caixa, mx, my); ncasa += 1
CASA = g.dilata(CASA, int(math.ceil(12.0 / classe)))

base = C & 127
livre = (CASA == 0) & ~np.isin(base, [1, 2])
subiu = (h >= arvore_min) & livre & np.isin(base, [0, 3, 6, 7])
print('grelha %dx%d a %.0f m; casas %d poligonos' % (mx, my, classe, ncasa))
print('promovidas: %d celulas = %.2f km2   (cozedor disse +13.09)\n' % (subiu.sum(), subiu.sum() * ac))

# 1. de onde vinham
print('1. classe de origem das celulas promovidas')
for k in (0, 3, 6, 7):
    n = (subiu & (base == k)).sum()
    print('   %-10s %6.2f km2  %5.1f%%' % (g.NOME[k], n * ac, 100.0 * n / subiu.sum()))

# 2. histograma da altura
print('\n2. altura medida nas celulas promovidas')
hp = h[subiu]
for a, b in ((5, 8), (8, 12), (12, 16), (16, 20), (20, 99)):
    m = (hp >= a) & (hp < b)
    print('   %s m  %5.1f%%  %6.2f km2' % (('%2d-%2d' % (a, b)) if b < 99 else '  >20', 100.0 * m.mean(), m.sum() * ac))
print('   media %.1f m, mediana %.1f m, desvio-padrao %.1f m; valor mais frequente (0,5 m): %.1f m'
      % (hp.mean(), np.median(hp), hp.std(), np.bincount(np.round(hp * 2).astype(int)).argmax() / 2))

# 3. agrupamento (8 vizinhos)
lab, n = ndimage.label(subiu, structure=np.ones((3, 3)))
tam = np.bincount(lab.ravel())[1:]              # celulas por mancha
tam_ha = tam * ha
print('\n3. manchas contiguas: %d' % n)
print('   maior: %.1f ha;  2a: %.1f ha;  3a: %.1f ha' % tuple(np.sort(tam_ha)[::-1][:3]))
print('   com menos de 1 ha: %d (%.1f%% das manchas, %.1f%% da area promovida)'
      % ((tam_ha < 1).sum(), 100.0 * (tam_ha < 1).mean(), 100.0 * tam[tam_ha < 1].sum() / tam.sum()))
print('   com 1-10 ha: %d;  10-100 ha: %d;  >100 ha: %d'
      % (((tam_ha >= 1) & (tam_ha < 10)).sum(), ((tam_ha >= 10) & (tam_ha < 100)).sum(), (tam_ha >= 100).sum()))
# forma da maior: razao area / caixa envolvente (1 = rectangulo perfeito)
print('   forma das 3 maiores (area / rectangulo envolvente; ~1 = bordos rectos):')

# 4. centros das tres maiores
ordem = np.argsort(tam)[::-1][:3] + 1
cent = ndimage.center_of_mass(subiu, lab, ordem)
print('\n4. centro das tres maiores manchas')
for k, (r, c) in zip(ordem, cent):
    lon = lo0 + (c + 0.5) / mx * (lo1 - lo0); lat = la1 - (r + 0.5) / my * (la1 - la0)
    m = lab == k
    rr, cc_ = np.where(m); env = (rr.max() - rr.min() + 1) * (cc_.max() - cc_.min() + 1)
    hk = h[m]; orig = np.bincount(base[m], minlength=10)
    print('   %.1f ha  %.5f, %.5f  (lat, lon)  forma %.2f  altura media %.1f m (P10 %.1f, P90 %.1f)  vinha de: %s'
          % (m.sum() * ha, lat, lon, m.sum() / env, hk.mean(), np.percentile(hk, 10), np.percentile(hk, 90),
             ', '.join('%s %.0f%%' % (g.NOME[q], 100.0 * orig[q] / m.sum()) for q in (0, 3, 6, 7) if orig[q])))
