// Tocar num trilho no mapa abre o resumo com o atalho para a ficha; tocar
// fora fecha. Usa o trilho 0 da BD (a pagina abre a zona dele com ?trilho=).
const { chromium, devices } = require('playwright');
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=swiftshader'] });
  const p = await (await b.newContext({ ...devices['Pixel 7'] })).newPage();
  const erros = []; p.on('pageerror', (e) => erros.push(e.message));
  await p.goto('http://localhost:8765/terreno.html?trilho=bd:0', { waitUntil: 'load' });
  await p.waitForFunction(() => window.V && window.T && escolhido && V.aoEcra(T.lo0, T.la0), null, { timeout: 120000 });
  await p.waitForTimeout(3000);
  // um ponto do trilho escolhido que esteja no ecra
  const alvo = await p.evaluate(() => {
    const t = trilhoDe(escolhido); const W = innerWidth, H = innerHeight;
    for (let i = 0; i < t.pts.length; i += 3) { const e = V.aoEcra(t.pts[i].lo, t.pts[i].la, 1.5); if (e && !e.atras && e.x > 30 && e.x < W - 70 && e.y > 80 && e.y < H - 90) return { x: e.x, y: e.y, nome: t.nome }; }
    return null;
  });
  if (!alvo) { console.log('sem ponto do trilho no ecra'); await b.close(); process.exit(1); }
  await p.mouse.click(alvo.x, alvo.y);
  await p.waitForTimeout(800);
  const r1 = await p.evaluate(() => ({ aberto: !document.getElementById('trilhoInfo').hidden, texto: document.getElementById('trilhoInfo').innerText.replace(/\s+/g, ' ').slice(0, 120), ficha: (document.querySelector('#trilhoInfo a') || {}).getAttribute && document.querySelector('#trilhoInfo a').getAttribute('href') }));
  // tocar longe de tudo (canto superior esquerdo do mapa, abaixo do cabecalho)
  await p.mouse.click(30, 120);
  await p.waitForTimeout(500);
  const r2 = await p.evaluate(() => !document.getElementById('trilhoInfo').hidden);
  console.log(JSON.stringify({ alvo, r1, aindaAberto: r2 }), 'erros:', erros);
  await b.close(); if (erros.length || !r1.aberto || !r1.texto.includes(alvo.nome.slice(0, 12)) || !/trilho\.html\?bd=/.test(r1.ficha || '') ) process.exit(1);
})().catch(e => { console.log('ERRO', e.message); process.exit(1); });
