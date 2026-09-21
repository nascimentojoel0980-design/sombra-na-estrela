const { chromium, devices } = require('playwright');
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=swiftshader'] });
  const p = await (await b.newContext({ ...devices['Pixel 7'] })).newPage();
  const erros = []; p.on('pageerror', (e) => erros.push(e.message));
  await p.goto('http://localhost:8765/trilho.html?bd=' + encodeURIComponent(process.argv[2] || ''), { waitUntil: 'load' });
  await p.waitForTimeout(45000);
  console.log(JSON.stringify(await p.evaluate(() => ({ estado: document.getElementById("estado").textContent, zonas: document.getElementById("zonas").textContent.slice(0,120) }))));
  const r = await p.evaluate(() => ({ estado: document.getElementById('estado').textContent, cartoes: document.querySelectorAll('#cartoes .c').length, perfil: !!document.querySelector('#perfil svg'), mapa: document.getElementById('mapa2d').width, nota: document.getElementById('mapaNota').textContent }));
  // arrastar no perfil
  const svg = await p.$('#perfil svg'); const bb = await svg.boundingBox();
  await p.mouse.move(bb.x + bb.width * 0.3, bb.y + bb.height / 2); await p.mouse.down(); await p.mouse.move(bb.x + bb.width * 0.6, bb.y + bb.height / 2, { steps: 5 }); await p.mouse.up();
  const r2 = await p.evaluate(() => document.getElementById('perfilNota').textContent);
  console.log(JSON.stringify(r), 'cursor:', r2, 'erros:', erros);
  await b.close(); if (erros.length || !r.perfil) process.exit(1);
})().catch(e => { console.log('ERRO', e.message); process.exit(1); });
