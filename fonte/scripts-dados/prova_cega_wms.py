#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Prova cega do mapa de solo pelo WMS da DGT a 25 cm: amostragem ao acaso, sem etiqueta.

E a irma de prova_cega.py (que recorta o ortofoto de 0,62 m ja no repositorio, 6 por
classe, e exige 70% de pureza). Esta pede ao WMS 20 por classe, 25 cm, e NAO filtra por
pureza: a celula e a que saiu, esteja no meio da mancha ou na borda. Precisa de rede.

Quem olha para 134 km2 de mapa sem poder ir la so tem uma maneira honesta de
saber se ele esta certo: tirar celulas AO ACASO de cada classe, ver o que a
fotografia aerea mostra em cada uma SEM saber o que o mapa diz, e so depois
abrir a chave. Se as etiquetas se vissem primeiro, o olho concordava com elas
sem querer -- e o numero nao valia nada.

O que este script faz:
  1. le o ficheiro cozido (bloco CLAS) e tira N celulas ao acaso de cada classe
     pedida, com semente fixa (repetivel, e ao acaso mesmo -- nao ha escolha);
     celulas com o bit 7 (corredor de caminho) ficam de fora, porque la o que
     se ve e a estrada, nao a classe;
  2. pede ao WMS da DGT (ortofoto 2025, 25 cm) um quadrado de 60 m centrado em
     cada celula, 240x240 px, em EPSG:3763 para o quadrado ser quadrado;
  3. baralha os quadrados (mesma semente) e monta uma folha de contacto so com
     numeros, 1..N;
  4. escreve a chave (numero -> classe, coordenadas) num CSV A PARTE.

Quadrados que vierem em branco ou com erro ficam na folha como estao, marcados
so na chave: um servico que falha em 5% dos pedidos e um dado sobre o servico,
e substitui-los era esconder isso.

  python3 fonte/scripts-dados/prova_cega.py \
      --terr dados/terreno/manteigas-v6.terr.gz --por-classe 20
"""
import argparse, csv, gzip, io, os, struct, sys, time, urllib.parse, urllib.request
from concurrent.futures import ThreadPoolExecutor
import numpy as np
from PIL import Image, ImageDraw, ImageFont

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gera_terreno import NOME

RAIZ = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SEMENTE = 20260920          # a data da primeira prova. Nao mudar sem mudar a folha.
WMS = 'https://cartografia.dgterritorio.gov.pt/wms/ortos2025'
LADO_M = 60.0; PX = 240      # 60 m a 25 cm/px
# as classes que se pedem para ver; urbano e agricola nao entram porque nao
# sao o que esta em causa (vem da COS e ninguem duvida delas)
CLASSES = [5, 11, 6, 7, 8, 10, 3, 9]   # floresta, matagal, rasteiro, rocha, parede, chao nu, pastagens, agua
ROTULO = {6: 'mato rasteiro'}          # NOME diz 'matos'; na chave fica o nome de hoje


def le_clas(caminho):
    b = gzip.open(caminho).read()
    assert b[:4] == b'TERR', 'nao e um ficheiro .terr'
    i = 8; caixa = None
    while i < len(b):
        tag, n = struct.unpack('<4sI', b[i:i + 8]); corpo = b[i + 8:i + 8 + n]; i += 8 + n
        if tag == b'BBOX': caixa = struct.unpack('<dddd', corpo)
        elif tag == b'CLAS':
            mx, my, cl = struct.unpack('<HHf', corpo[:8])
            return caixa, np.frombuffer(corpo[8:], np.uint8).reshape(my, mx), cl
    sys.exit('sem bloco CLAS em ' + caminho)


def para_3763(lon, lat):
    from rasterio.warp import transform
    (x,), (y,) = transform('EPSG:4326', 'EPSG:3763', [lon], [lat])
    return x, y


def pede(x, y):
    """um quadrado de 60 m a 25 cm; devolve (imagem, bytes, erro)"""
    q = urllib.parse.urlencode({'SERVICE': 'WMS', 'VERSION': '1.3.0', 'REQUEST': 'GetMap', 'LAYERS': 'Ortos2025-RGB',
                                'STYLES': '', 'CRS': 'EPSG:3763', 'WIDTH': PX, 'HEIGHT': PX, 'FORMAT': 'image/jpeg',
                                'BBOX': '%.2f,%.2f,%.2f,%.2f' % (x - LADO_M / 2, y - LADO_M / 2, x + LADO_M / 2, y + LADO_M / 2)})
    for tentativa in range(3):
        try:
            d = urllib.request.urlopen(WMS + '?' + q, timeout=40).read()
            im = Image.open(io.BytesIO(d)).convert('RGB')
            return im, len(d), ''
        except Exception as e:
            erro = str(e)[:80]; time.sleep(1.5 * (tentativa + 1))
    return Image.new('RGB', (PX, PX), (255, 0, 255)), 0, erro


def em_branco(im):
    """o WMS fora de cobertura nao avisa: devolve uma imagem lisa e CLARA
    (ARMADILHA 4). Lisa e escura e outra coisa -- e um lago. Na primeira prova
    os tres quadrados "em branco" eram a albufeira do Vale do Rossim, azul de
    RGB 17,32,51; por isso a cor conta, nao so o desvio-padrao."""
    a = np.asarray(im.convert('L'), dtype=np.float32)
    return a.std() < 3.0 and a.mean() > 180


def cor_media(im):
    a = np.asarray(im, dtype=np.float32).reshape(-1, 3).mean(0)
    return 'RGB %d,%d,%d' % tuple(int(round(v)) for v in a)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--terr', default=os.path.join(RAIZ, 'dados/terreno/manteigas-v6.terr.gz'))
    ap.add_argument('--por-classe', type=int, default=20)
    ap.add_argument('--saida', default=os.path.join(RAIZ, 'dados/lidar/prova_cega_wms.jpg'))
    ap.add_argument('--chave', default=os.path.join(RAIZ, 'dados/lidar/prova_cega_wms_chave.csv'))
    ap.add_argument('--colunas', type=int, default=16)
    a = ap.parse_args()

    caixa, C, cl = le_clas(a.terr)
    lo0, la0, lo1, la1 = caixa; my, mx = C.shape
    base = C & 127; livre = (C & 128) == 0
    rng = np.random.default_rng(SEMENTE)

    amostra = []   # (classe, lon, lat)
    print('%s: grelha %dx%d a %.0f m, semente %d' % (os.path.basename(a.terr), mx, my, cl, SEMENTE))
    for k in CLASSES:
        idx = np.flatnonzero((base == k) & livre)
        if idx.size == 0:
            print('   %-14s nao aparece na caixa' % NOME[k]); continue
        n = min(a.por_classe, idx.size)
        for j in rng.choice(idx, size=n, replace=False):
            r, c = divmod(int(j), mx)
            lon = lo0 + (c + 0.5) / mx * (lo1 - lo0); lat = la1 - (r + 0.5) / my * (la1 - la0)
            amostra.append((k, lon, lat))
        print('   %-14s %6d celulas livres -> %d tiradas' % (ROTULO.get(k, NOME[k]), idx.size, n))
    N = len(amostra)
    ordem = rng.permutation(N)               # o baralhar, com a mesma semente
    print('%d quadrados, baralhados' % N)

    # --- as imagens, 3 de cada vez (o WMS aguenta; ver CLAUDE.md, seccao 5)
    def tarefa(i):
        k, lon, lat = amostra[i]; x, y = para_3763(lon, lat)
        im, nb, erro = pede(x, y)
        return i, im, nb, erro
    t0 = time.time(); imgs = {}
    with ThreadPoolExecutor(max_workers=3) as ex:
        for n_feitos, (i, im, nb, erro) in enumerate(ex.map(tarefa, range(N)), 1):
            imgs[i] = (im, nb, erro)
            if n_feitos % 20 == 0: print('   %d/%d  (%.0f s)' % (n_feitos, N, time.time() - t0), flush=True)
    brancos = sum(1 for im, nb, e in imgs.values() if not e and em_branco(im))
    lisos = sum(1 for im, nb, e in imgs.values() if not e and not em_branco(im) and np.asarray(im.convert('L'), dtype=np.float32).std() < 3.0)
    erros = sum(1 for im, nb, e in imgs.values() if e)
    print('imagens: %d ok (%d delas lisas mas escuras = agua), %d em branco, %d com erro, %.0f s' % (N - brancos - erros, lisos, brancos, erros, time.time() - t0))

    # --- a folha: numeros 1..N, e mais nada
    cols = a.colunas; linhas = (N + cols - 1) // cols; marg = 6; cab = 22
    folha = Image.new('RGB', (cols * (PX + marg) + marg, linhas * (PX + cab + marg) + marg), (28, 28, 28))
    d = ImageDraw.Draw(folha)
    try: fonte = ImageFont.truetype('arial.ttf', 18)
    except Exception: fonte = ImageFont.load_default()
    for numero, i in enumerate(ordem, 1):
        im, nb, erro = imgs[int(i)]
        col, lin = (numero - 1) % cols, (numero - 1) // cols
        x0 = marg + col * (PX + marg); y0 = marg + lin * (PX + cab + marg)
        d.text((x0 + 4, y0 + 2), str(numero), fill=(240, 240, 240), font=fonte)
        folha.paste(im, (x0, y0 + cab))
    os.makedirs(os.path.dirname(a.saida) or '.', exist_ok=True)
    folha.save(a.saida, quality=88, optimize=True)
    print('%s  %dx%d  %.2f MB' % (a.saida, folha.size[0], folha.size[1], os.path.getsize(a.saida) / 1e6))

    # --- a chave, A PARTE. Nao se abre antes de se ter escrito o que se viu.
    with open(a.chave, 'w', newline='', encoding='utf-8') as f:
        w = csv.writer(f)
        w.writerow(['numero', 'classe', 'codigo', 'lon', 'lat', 'bytes_wms', 'estado'])
        for numero, i in enumerate(ordem, 1):
            k, lon, lat = amostra[int(i)]; im, nb, erro = imgs[int(i)]
            liso = np.asarray(im.convert('L'), dtype=np.float32).std() < 3.0
            estado = ('erro: ' + erro if erro else 'em branco' if em_branco(im)
                      else 'liso (%s)' % cor_media(im) if liso else 'ok')
            w.writerow([numero, ROTULO.get(k, NOME[k]), k, '%.6f' % lon, '%.6f' % lat, nb, estado])
    print('%s  (%d linhas)' % (a.chave, N))


if __name__ == '__main__':
    main()
