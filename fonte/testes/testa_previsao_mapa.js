// A previsão de montanha no menu do mapa: abre a secção, tem de pedir para a
// zona à vista; ao mudar de zona com a secção aberta, pede outra vez.
const { chromium, devices } = require('playwright');
const { simula, pedidos } = require('./previsao_falsa');
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=swiftshader'] });
  const p = await (await b.newContext({ ...devices['Pixel 7'] })).newPage();
  const erros = []; p.on('pageerror', (e) => erros.push(e.message));
  await simula(p);
  await p.goto('http://localhost:8765/terreno.html', { waitUntil: 'load' });
  await p.waitForFunction(() => window.V && window.T, null, { timeout: 90000 });
  await p.evaluate(() => { document.getElementById('secPrev').open = true; });
  await p.waitForFunction(() => document.querySelectorAll('#prev .dia').length === 7, null, { timeout: 60000 });
  const r1 = await p.evaluate(() => ({ nota: document.getElementById('prevNota').textContent, dias: document.querySelectorAll('#prev .dia').length, cartas: document.querySelectorAll('#prev .hoje .h').length }));
  const n1 = pedidos.length;
  // muda de zona (fina) com a secção aberta
  await p.evaluate(() => { document.getElementById('autoZona').checked = false; const z = document.getElementById('zona'); z.value = String(ZONAS.findIndex((x) => x.ficheiro.startsWith('manteigas'))); z.dispatchEvent(new Event('change')); });
  await p.waitForFunction(() => /manteigas/.test(document.getElementById('versao').textContent) && document.querySelectorAll('#prev .dia').length === 7, null, { timeout: 120000 });
  await p.waitForFunction((n) => document.getElementById('prevNota').textContent !== n, r1.nota, { timeout: 60000 });
  await p.waitForTimeout(2000);
  const r2 = await p.evaluate(() => ({ nota: document.getElementById('prevNota').textContent, versao: document.getElementById('versao').textContent, avisos: document.getElementById('prev').textContent.includes('Avisos IPMA em vigor') }));
  console.log(JSON.stringify({ r1, r2, pedidos1: n1, pedidos2: pedidos.length }), 'erros:', erros);
  await b.close(); if (erros.length || r1.dias !== 7 || pedidos.length <= n1 || r1.nota === r2.nota || !r2.avisos) process.exit(1);
})().catch(e => { console.log('ERRO', e.message); process.exit(1); });
