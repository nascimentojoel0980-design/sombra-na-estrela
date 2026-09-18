# -*- coding: utf-8 -*-
"""Desenha dados/relevo.jpg -- o fundo do mapa principal, a partir do DEM.

Substitui a fotografia de satelite. O satelite custava 700 MB em disco, era
recomposto azulejo a azulejo em JavaScript na vista 3D e enchia a memoria do
telemovel com imagens descomprimidas. Isto e um so ficheiro, feito uma vez.

Nao e um mapa de cores bonito por bonito: e sombreado de encosta (a mesma luz
de noroeste do resto da aplicacao) sobre uma rampa de altitude discreta. Tem de
ficar CALADO -- os percursos sao linhas brancas por cima, e um fundo aos berros
apagava-os. Foi por isso que se escolheu pouco contraste e pouca saturacao.

    python3 fonte/scripts-dados/relevo_fundo.py
"""
import os, sys, math
import numpy as np
from PIL import Image

RAIZ = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.chdir(RAIZ)

DEM = 'dados/dem.webp'
SAIDA = 'dados/relevo.jpg'
# a mesma caixa que a aplicacao usa para o DEM
S, W, N, E = 40.00, -8.10, 40.70, -7.15

if not os.path.exists(DEM):
    sys.exit('ERRO: nao encontrei ' + DEM)

im = Image.open(DEM).convert('RGB')
a = np.asarray(im).astype(np.float32)
# terrain-RGB, como a aplicacao descodifica: R*256 + G - 32768
z = a[:, :, 0] * 256.0 + a[:, :, 1] - 32768.0
h, w = z.shape
print('DEM', w, 'x', h, ' cotas de', round(float(z.min())), 'a', round(float(z.max())), 'm')

# tamanho do pixel em metros (aproximado, chega para o sombreado)
mlat = (N - S) * 111320.0 / h
mlon = (E - W) * 111320.0 * math.cos(math.radians((N + S) / 2)) / w

gy, gx = np.gradient(z, mlat, mlon)
gy = -gy                      # a linha 0 e o norte: y cresce para sul

EXAG = 2.2                    # so para o sombreado; nao mexe em cotas
declive = np.arctan(EXAG * np.hypot(gx, gy))
aspecto = np.arctan2(gy, -gx)

AZ = math.radians(315.0)      # noroeste, como o hillshade do mapa topografico
ALT = math.radians(45.0)
luz = (np.sin(ALT) * np.cos(declive)
       + np.cos(ALT) * np.sin(declive) * np.cos(AZ - math.radians(90.0) - aspecto))
luz = np.clip(luz, 0.0, 1.0)
luz = 0.55 + 0.45 * luz       # nunca preto: o fundo tem de ficar calado

# rampa de altitude, discreta, na paleta de papel da aplicacao
paradas = [
    (200,  (222, 226, 205)),
    (600,  (214, 216, 191)),
    (900,  (214, 208, 184)),
    (1200, (211, 203, 184)),
    (1500, (214, 210, 202)),
    (2000, (226, 224, 220)),
]
zc = np.clip(z, paradas[0][0], paradas[-1][0])
cor = np.zeros((h, w, 3), np.float32)
for i in range(len(paradas) - 1):
    z0, c0 = paradas[i]; z1, c1 = paradas[i + 1]
    m = (zc >= z0) & (zc <= z1)
    t = (zc - z0) / float(z1 - z0)
    for k in range(3):
        cor[:, :, k] = np.where(m, c0[k] + (c1[k] - c0[k]) * t, cor[:, :, k])

out = np.clip(cor * luz[:, :, None], 0, 255).astype(np.uint8)
Image.fromarray(out).save(SAIDA, quality=86, optimize=True, progressive=True)
print(SAIDA, round(os.path.getsize(SAIDA) / 1e6, 2), 'MB')
