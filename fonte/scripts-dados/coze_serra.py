# -*- coding: utf-8 -*-
"""Coze a serra toda em zonas finas, uma a uma, com o mesmo comando de Manteigas.

Grelha ancorada na caixa de Manteigas (-7.62 40.31, 0,13 x 0,11 graus),
recortada a area de construcao (-8.10 40.00 -7.15 40.70). Cada zona chama o
gera_terreno.py; o boletim decide se entra no indice. O titulo e a povoacao
com nome mais perto do centro da caixa (OSM), ou "Zona c-l" se nao houver.

    python3 fonte/scripts-dados/coze_serra.py            # todas as que faltam
    python3 fonte/scripts-dados/coze_serra.py --so c4r3  # uma
"""
import argparse, json, math, os, subprocess, sys, time
AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(os.path.dirname(AQUI))
sys.path.insert(0, AQUI)
from lepmtiles import PM

CONSTR = (-8.10, 40.00, -7.15, 40.70)
ANC = (-7.62, 40.31); DLO, DLA = 0.13, 0.11
TITULOS = {'c4r3': 'Vale Glaciar de Manteigas', 'c3r3': 'Torre e Lagoa Comprida'}
NOMES = {'c4r3': 'manteigas', 'c3r3': 'torre'}


def grelha():
    zs = []
    for c in range(0, 9):
        lo0 = ANC[0] + (c - 4) * DLO; lo1 = lo0 + DLO
        for r in range(0, 8):
            la0 = ANC[1] + (r - 3) * DLA; la1 = la0 + DLA
            cx = (max(lo0, CONSTR[0]), max(la0, CONSTR[1]), min(lo1, CONSTR[2]), min(la1, CONSTR[3]))
            if cx[2] - cx[0] < 0.02 or cx[3] - cx[1] < 0.02: continue
            zs.append(('c%dr%d' % (c, r), cx))
    return zs


def titulo(pm, cod, cx):
    if cod in TITULOS: return TITULOS[cod]
    from gera_terreno import varre
    lo0, la0, lo1, la1 = cx; clo = (lo0 + lo1) / 2; cla = (la0 + la1) / 2
    melhor = None
    for props, gt, gs in varre(pm, cx, 15, 'pontos'):
        if props.get('k') not in ('povoacao', 'aldeia') or not props.get('n'): continue
        for g in gs:
            for lo, la in g:
                if not (lo0 <= lo <= lo1 and la0 <= la <= la1): continue
                d = math.hypot((lo - clo) * 85000, (la - cla) * 111000)
                if melhor is None or d < melhor[0]: melhor = (d, props['n'].strip())
    return (melhor[1] + ' e arredores') if melhor else ('Zona %s' % cod)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--so', default=None)
    ap.add_argument('--versao', type=int, default=1)
    ap.add_argument('--refaz', action='store_true', help='coze mesmo que ja esteja no indice')
    a = ap.parse_args()
    pm = PM(os.path.join(RAIZ, 'dados/topo.pmtiles'))
    ip = os.path.join(RAIZ, 'dados/terreno/index.json')
    feitas = set()
    if os.path.exists(ip):
        feitas = {z['nome'] for z in json.load(open(ip, encoding='utf-8')).get('zonas', [])}
    zs = grelha()
    print('%d zonas na grelha' % len(zs))
    for cod, cx in zs:
        nome = NOMES.get(cod, cod)
        if a.so and cod != a.so and nome != a.so: continue
        if nome in feitas and not a.refaz and nome != 'torre':
            print('  %s (%s): ja no indice' % (cod, nome)); continue
        t = titulo(pm, cod, cx)
        cmd = [sys.executable, os.path.join(AQUI, 'gera_terreno.py'), '--nome', nome, '--titulo', t,
               '--caixa'] + ['%.4f' % v for v in cx] + ['--passo', '8', '--classe', '5',
               '--passo-horizonte', '25', '--versao', str(3 if nome == 'torre' else a.versao)]
        if nome == 'manteigas': cmd += ['--ndvi', 'dados/lidar/ndvi2024.tif']
        t0 = time.time()
        print('  %s  %s  %s' % (cod, t, ' '.join('%.2f' % v for v in cx)), flush=True)
        r = subprocess.run(cmd, cwd=RAIZ, capture_output=True, text=True)
        fim = [l for l in r.stdout.splitlines() if 'FALHOU' in l or 'nenhuma verificacao' in l or 'comprimido' in l]
        print('     %s  (%.0f s)%s' % (' | '.join(fim), time.time() - t0, '' if r.returncode == 0 else '  <-- NAO ENTROU (codigo %d)' % r.returncode), flush=True)
        if r.returncode not in (0, 2):
            print(r.stdout[-1500:]); print(r.stderr[-1500:])


if __name__ == '__main__':
    main()
