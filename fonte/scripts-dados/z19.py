# -*- coding: utf-8 -*-
import io
P = []
P.append((
"""function dgtTiles(vb, zAlvo) {
  const out = [], z = Math.min(19, Math.max(14, Math.round(zAlvo == null ? map.getZoom() : zAlvo)));""",
"""// guarda sempre no detalhe maximo (z19 = 30 cm por pixel), independentemente do zoom a que estas
const Z_DGT = 19;
function dgtTiles(vb, zAlvo) {
  const out = [], z = zAlvo == null ? Z_DGT : zAlvo;"""))
P.append((
"    out.push(dgtUrl(z, x, y, 256));\n    if (out.length > 2500) return out;",
"    out.push(dgtUrl(z, x, y, 256));\n    if (out.length > 12000) return out;"))
# rotulo com o peso estimado
P.append((
"  b.textContent = 'Guardar esta zona' + (satModo === 1 ? ' a 25 cm' : '') + ' (' + fmt(u.length) + ' imagens)';",
"""  const mb = satModo === 1 ? Math.round(u.length * 0.026) : 0;
  b.textContent = 'Guardar esta zona' + (satModo === 1 ? ' a 25 cm' : '') + ' (' + fmt(u.length) + ' imagens' + (mb ? ', ~' + fmt(mb) + ' MB' : '') + ')';"""))
P.append((
"""        const q = satModo === 1 ? ' a 25 cm' : '';
        b.textContent = d.faltam
          ? 'Guardar esta zona' + q + ' (' + fmt(d.faltam) + ' novas de ' + fmt(d.total) + ')'
          : 'Esta zona já está toda guardada' + q;""",
"""        const q = satModo === 1 ? ' a 25 cm' : '';
        const mb = satModo === 1 ? Math.round(d.faltam * 0.026) : 0;
        b.textContent = d.faltam
          ? 'Guardar esta zona' + q + ' (' + fmt(d.faltam) + ' novas de ' + fmt(d.total) + (mb ? ', ~' + fmt(mb) + ' MB' : '') + ')'
          : 'Esta zona já está toda guardada' + q;"""))
# aviso quando a area e grande de mais
P.append((
"  if (b) b.onclick = () => { const u = fotosDaVista(); if (!u.length) { toast('Aproxima o mapa da zona que queres guardar.'); return; } b.textContent = 'A guardar as imagens… 0 de ' + u.length; mandaSW({ tipo: 'guardar-fotos', urls: u }); };",
"""  if (b) b.onclick = () => {
    const u = fotosDaVista();
    if (!u.length) { toast('Aproxima o mapa da zona que queres guardar.'); return; }
    if (satModo === 1 && u.length > 6000 && !confirm('São ' + fmt(u.length) + ' imagens, cerca de ' + fmt(Math.round(u.length * 0.026)) + ' MB, e pode demorar bastante.\\n\\nQueres mesmo guardar esta área toda? Aproximar o mapa reduz o trabalho.')) return;
    b.textContent = 'A guardar as imagens… 0 de ' + u.length;
    mandaSW({ tipo: 'guardar-fotos', urls: u });
  };"""))
def apply(path, pairs, req):
    s = io.open(path, encoding='utf-8').read(); n = 0
    for o, x in pairs:
        if o in s: s = s.replace(o, x, 1); n += 1
        elif req: print('  FALTA:', o[:55].replace('\n','\\n'))
    io.open(path, 'w', encoding='utf-8').write(s); return n
for f in ('page/app.js','page/sombra-na-estrela.html'):
    print(f, '->', apply(f, P, 'sombra' in f))
