# -*- coding: utf-8 -*-
"""Desenha os padroes do mapa topografico e escreve fonte/padroes.json.

Quatro padroes, 72x72 px, com costura -- cada simbolo e desenhado nove vezes
(a propria celula e as oito a volta) e recortado, por isso encosta sem juncao
visivel seja qual for o azulejo.

    floresta   copas juntas, a cheio
    montado    a mesma copa, esparsa e maior (o sobreiro do montado e assim)
    matos      tufos rasteiros
    rocha      cunhas angulares

Sao simbolos de carta militar, nao tentativa de satelite: legiveis a 2,75 de
DPR num telemovel ao sol, e a custo zero de rede -- viajam dentro do HTML.

    python3 fonte/scripts-dados/padroes.py            # -> fonte/padroes.json
    python3 fonte/scripts-dados/padroes.py --png /tmp # + os PNG soltos, para ver
"""
import json, base64, io, os, math, random, argparse
from PIL import Image, ImageDraw

N = 72          # lado da celula por defeito, px (cada padrao pode pedir outro)
ESC = 2         # desenha a dobrar e reduz: cantos limpos sem anti-aliasing manual

COR = {
    'copa':    (74, 124, 89, 235),      # verde de carta
    'copa2':   (108, 148, 106, 220),
    'tronco':  (110, 88, 62, 235),
    'mato':    (150, 140, 96, 225),
    'rocha':   (138, 130, 118, 225),
}


def volta(d, f, x, y, n, *a):
    """desenha f nove vezes -- a celula e as oito vizinhas -- para costurar."""
    for dx in (-n, 0, n):
        for dy in (-n, 0, n):
            f(d, (x + dx) * ESC, (y + dy) * ESC, *a)


def arvore(d, x, y, r, cor, tronco):
    """copa em tres bolhas + tronco. E a arvore de mapa, vista de cima-lado."""
    if tronco:
        d.line([(x, y + r * 0.2), (x, y + r * 1.5)], fill=COR['tronco'],
               width=max(1, int(r * 0.30)))
    d.ellipse([x - r, y - r * 0.55, x + r * 0.15, y + r * 0.75], fill=cor)
    d.ellipse([x - r * 0.15, y - r, x + r, y + r * 0.35], fill=cor)
    d.ellipse([x - r * 0.55, y - r * 0.15, x + r * 0.6, y + r * 0.95], fill=cor)


def tufo(d, x, y, r, cor):
    """tres tracos a subir: o mato rasteiro da carta."""
    for a in (-0.5, 0.0, 0.5):
        d.line([(x, y + r), (x + math.sin(a) * r, y - r * 0.8)],
               fill=cor, width=max(1, int(r * 0.34)))


def cunha(d, x, y, r, cor):
    """dois tracos em angulo: lajedo."""
    d.line([(x - r, y + r * 0.6), (x, y - r * 0.6)], fill=cor, width=max(1, int(r * 0.34)))
    d.line([(x, y - r * 0.6), (x + r, y + r * 0.5)], fill=cor, width=max(1, int(r * 0.34)))


def cria(desenha, n=N):
    im = Image.new('RGBA', (n * ESC, n * ESC), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    desenha(d)
    return im.resize((n, n), Image.LANCZOS)


def p_floresta():
    def f(d):
        r = random.Random(11)
        for _ in range(13):
            x, y = r.uniform(0, N), r.uniform(0, N)
            raio = r.uniform(7.5, 10.5)
            cor = COR['copa'] if r.random() < 0.6 else COR['copa2']
            volta(d, lambda dd, X, Y: arvore(dd, X, Y, raio * ESC, cor, False), x, y, N)
    return cria(f)


def p_montado():
    # azulejo de 144: com 72 o olho apanhava a repeticao das quatro copas.
    M = 144
    def f(d):
        r = random.Random(23)
        for _ in range(14):
            x, y = r.uniform(0, M), r.uniform(0, M)
            raio = r.uniform(10, 13.5)
            cor = COR['copa2'] if r.random() < 0.7 else COR['copa']
            volta(d, lambda dd, X, Y: arvore(dd, X, Y, raio * ESC, cor, True), x, y, M)
    return cria(f, M)


def p_matos():
    def f(d):
        r = random.Random(37)
        for _ in range(16):
            x, y = r.uniform(0, N), r.uniform(0, N)
            raio = r.uniform(4.0, 6.0)
            volta(d, lambda dd, X, Y: tufo(dd, X, Y, raio * ESC, COR['mato']), x, y, N)
    return cria(f)


def p_rocha():
    def f(d):
        r = random.Random(53)
        for _ in range(14):
            x, y = r.uniform(0, N), r.uniform(0, N)
            raio = r.uniform(4.5, 7.0)
            volta(d, lambda dd, X, Y: cunha(dd, X, Y, raio * ESC, COR['rocha']), x, y, N)
    return cria(f)


PAD = {'floresta': p_floresta, 'montado': p_montado, 'matos': p_matos, 'rocha': p_rocha}

ap = argparse.ArgumentParser()
ap.add_argument('--png', help='pasta onde tambem gravar os PNG soltos')
ap.add_argument('--saida', default=os.path.join(os.path.dirname(__file__), '..', 'padroes.json'))
A = ap.parse_args()

# ---- prova de costura ----------------------------------------------------
# Um padrao com costura nao se prova comparando a coluna 0 com a coluna N-1:
# essas sao vizinhas, nao iguais, e a diferenca entre elas e textura, nao
# defeito. O que denuncia uma juncao e o salto: no sitio onde o azulejo fecha,
# o degrade entre colunas vizinhas fica maior do que em qualquer outro sitio.
# Entao mede-se isso -- o degrade na juncao contra o degrade medio la dentro.
# Razao perto de 1 = a juncao nao se distingue do resto. Acima de 2 = ve-se.
def costura(im):
    px = im.load(); N = im.size[0]
    def grad(a, b, vert):
        t = 0
        for i in range(N):
            p = px[a, i] if not vert else px[i, a]
            q = px[b, i] if not vert else px[i, b]
            t += sum(abs(p[c] - q[c]) for c in range(4))
        return t / N
    juncao = (grad(N - 1, 0, False) + grad(N - 1, 0, True)) / 2
    dentro = sum(grad(x, x + 1, False) + grad(x, x + 1, True)
                 for x in range(N - 1)) / (2 * (N - 1))
    return juncao / dentro if dentro else 0.0

saida = {}
for nome, f in PAD.items():
    im = f()
    b = io.BytesIO(); im.save(b, 'PNG', optimize=True)
    saida[nome] = 'data:image/png;base64,' + base64.b64encode(b.getvalue()).decode()
    if A.png:
        im.save(os.path.join(A.png, 'pat_' + nome + '.png'))
    print('%-9s %3dpx %4d B   juncao/interior (1 = sem costura): %.2f' % (nome, im.size[0], len(b.getvalue()), costura(im)))

A.saida = os.path.abspath(A.saida)
open(A.saida, 'w').write(json.dumps(saida, separators=(',', ':')))
print('\n%s  %.1f KB' % (A.saida, os.path.getsize(A.saida) / 1024))
