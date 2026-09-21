const { chromium, devices } = require('playwright');
const { simula, pedidos } = require('./previsao_falsa');
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=swiftshader'] });
  const p = await (await b.newContext({ ...devices['Pixel 7'] })).newPage();
  const erros = []; p.on('pageerror', (e) => erros.push(e.message));
  await simula(p);
  await p.goto('http://localhost:8765/trilho.html?bd=0', { waitUntil: 'load' });
  await p.waitForFunction(() => /Próximos 7 dias|Sem previsão/.test(document.getElementById('met').textContent), null, { timeout: 90000 });
  const r = await p.evaluate(() => ({ nota: document.getElementById('metNota').textContent, linhas: document.querySelectorAll('#met .dia').length, cartas: document.querySelectorAll('#met .hoje .h').length,
    modelos: [...document.querySelectorAll('#met .dia')].map((d) => d.querySelector('.chips').lastElementChild.textContent), aval: [...document.querySelectorAll('#met .dia .aval')].map((e) => e.textContent),
    conf: [], avisos: document.getElementById('met').textContent.includes('Vento') && !document.getElementById('met').textContent.includes('Calor'),
    texto: document.getElementById('met').innerText.slice(0, 500) }));
  console.log(JSON.stringify(r, null, 1)); console.log('pedidos', pedidos.length, 'erros:', erros);
  await p.screenshot({ path: process.argv[2] || '/tmp/prev.png', fullPage: true });
  await b.close(); if (erros.length) process.exit(1);
})().catch(e => { console.log('ERRO', e.message); process.exit(1); });
