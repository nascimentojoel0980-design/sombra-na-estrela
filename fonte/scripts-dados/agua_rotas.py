#!/usr/bin/env python3
# Agua legivel em 3D e rotas que nao se perdem debaixo das arvores.
# Falha alto: cada troca tem de aparecer o numero exacto de vezes.
import io, sys

ALVOS = ['fonte/app.js', 'fonte/sombra-na-estrela.html']

TROCAS = [
 # 1. albufeiras e lagoas: mancha mais viva e uma margem com espessura propria,
 #    porque em 3D o fill-outline-color de 1 px desaparece entre a vegetacao.
 ("""      { id: 'agua-a', type: 'fill', source: 'topo', 'source-layer': 'aguaA',
        paint: { 'fill-color': '#9CC3DD', 'fill-outline-color': '#5E93B8' } },""",
  """      { id: 'agua-a', type: 'fill', source: 'topo', 'source-layer': 'aguaA',
        paint: { 'fill-color': '#8CBFE0', 'fill-opacity': 0.96 } },
      { id: 'agua-a-c', type: 'line', source: 'topo', 'source-layer': 'aguaA',
        paint: { 'line-color': '#35709B',
                 'line-width': ['interpolate', ['linear'], ['zoom'], 11, 0.8, 16, 2.8] },
        layout: { 'line-join': 'round' } },"""),

 # 2. linhas de agua: a mesma largura em 10 e em 16 sumia-se ao perto, onde o
 #    mato e a rocha ja estao desenhados por cima do chao.
 ("""      { id: 'agua-l', type: 'line', source: 'topo', 'source-layer': 'aguaL', minzoom: 10,
        paint: { 'line-color': '#5E93B8', 'line-width': ['match', ['get', 'w'], 'river', 2.2, 'stream', 1.1, 0.8] } },""",
  """      { id: 'agua-l', type: 'line', source: 'topo', 'source-layer': 'aguaL', minzoom: 10,
        paint: { 'line-color': '#4A86B2',
                 'line-width': ['interpolate', ['linear'], ['zoom'],
                   10, ['match', ['get', 'w'], 'river', 1.8, 'stream', 0.9, 0.7],
                   16, ['match', ['get', 'w'], 'river', 5.0, 'stream', 2.6, 1.8]] },
        layout: { 'line-join': 'round', 'line-cap': 'round' } },"""),

 # 3. percurso mais grosso ao perto. O corredor limpo de vegetacao (CORREDOR,
 #    na camada das arvores) e que o poe a vista; isto e so para ele ganhar a
 #    mancha verde ao lado.
 ("""      { id: 'rota-c', type: 'line', source: 'topo', 'source-layer': 'rotas', minzoom: 8,
        paint: { 'line-color': '#FFFFFF', 'line-width': ['interpolate', ['linear'], ['zoom'], 9, 2.6, 16, 7], 'line-opacity': 0.85 }, layout: { 'line-join': 'round', 'line-cap': 'round' } },""",
  """      { id: 'rota-c', type: 'line', source: 'topo', 'source-layer': 'rotas', minzoom: 8,
        paint: { 'line-color': '#FFFFFF', 'line-width': ['interpolate', ['linear'], ['zoom'], 9, 2.6, 16, 9], 'line-opacity': 0.92 }, layout: { 'line-join': 'round', 'line-cap': 'round' } },"""),
 ("""                 'line-width': ['interpolate', ['linear'], ['zoom'], 9, 1.4, 16, 4] }, layout: { 'line-join': 'round', 'line-cap': 'round' } },""",
  """                 'line-width': ['interpolate', ['linear'], ['zoom'], 9, 1.4, 16, 5.4] }, layout: { 'line-join': 'round', 'line-cap': 'round' } },"""),
]

for alvo in ALVOS:
    s = io.open(alvo, encoding='utf-8').read()
    for i, (a, b) in enumerate(TROCAS, 1):
        if s.count(a) != 1:
            sys.exit('%s: troca %d aparece %d vezes' % (alvo, i, s.count(a)))
        s = s.replace(a, b)
    io.open(alvo, 'w', encoding='utf-8').write(s)
    print('%s: %d trocas' % (alvo, len(TROCAS)))
