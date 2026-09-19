#!/usr/bin/env python3
# Mete fonte/arvores3d.js dentro de fonte/app.js e de fonte/sombra-na-estrela.html.
# A biblioteca e a UNICA fonte; os dois ficheiros gerados nunca se editam a mao.
# Falha alto se nao encontrar as fronteiras exactas.
import io, sys, re

LIB = 'fonte/arvores3d.js'
ALVOS = ['fonte/app.js', 'fonte/sombra-na-estrela.html']
CAB = '// Arvores em 3D, instanciadas -- camada propria do MapLibre (WebGL directo)'
FIM = '// Tecto de arvores que se baixa sozinho.'

lib = io.open(LIB, encoding='utf-8').read()
lib = re.sub(r"\nif \(typeof module !== 'undefined'\) module\.exports = \{ ligaArvores \};\s*$",
             '\n', lib)
if 'module.exports' in lib:
    sys.exit('a cauda do module.exports nao saiu')
lib = lib.rstrip() + '\n\n'

for alvo in ALVOS:
    s = io.open(alvo, encoding='utf-8').read()
    i = s.find(CAB)
    if i < 0:
        sys.exit('%s: nao encontrei o cabecalho das arvores' % alvo)
    # sobe ate a linha de ==== que abre o cabecalho
    j = s.rfind('\n// =====', 0, i)
    if j < 0:
        sys.exit('%s: nao encontrei a abertura ====' % alvo)
    ini = j + 1
    f = s.find(FIM)
    if f < 0:
        sys.exit('%s: nao encontrei o fim (tecto)' % alvo)
    if f < ini:
        sys.exit('%s: fronteiras ao contrario' % alvo)
    novo = s[:ini] + lib + s[f:]
    io.open(alvo, 'w', encoding='utf-8').write(novo)
    print('%s: %d -> %d caracteres' % (alvo, len(s), len(novo)))
