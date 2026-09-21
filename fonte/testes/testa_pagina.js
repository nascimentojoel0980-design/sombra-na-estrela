// Abre terreno.html num Chromium sem janela e falha se a pagina nao chegar a
// ter o motor (window.V) ou se houver erro de JavaScript. Correr ANTES de
// cada push: NODE_PATH=$(npm root -g) node fonte/testes/testa_pagina.js
// (precisa de "python3 -m http.server 8765" na raiz, ou passa outro URL).
// 21/09/2026: um "$" usado antes de ser definido deixou a pagina em
// "a carregar..." no telemovel dele; isto teria apanhado.
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=swiftshader','--enable-unsafe-swiftshader'] }).catch(async e => { console.log('launch1', e.message.split('\n')[0]); return chromium.launch(); });
  const p = await b.newPage({ viewport: { width: 420, height: 860 } });
  p.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log('CONSOLE', m.type(), m.text().slice(0, 300)); }); p.on('response', (r) => { if (r.status() >= 400) console.log('HTTP', r.status(), r.url()); });
  p.on('pageerror', (e) => console.log('PAGEERROR', e.message.slice(0, 400), '\n', (e.stack || '').split('\n').slice(0, 4).join(' | ')));
  const url = process.argv[2] || 'http://localhost:8765/terreno.html';
  let erros = 0; p.on('pageerror', () => erros++);
  await p.goto(url, { waitUntil: 'load' });
  await p.waitForTimeout(12000);
  const estado = await p.evaluate(() => ({ estado: document.getElementById('estado').textContent, temV: !!window.V, zona: document.getElementById('versao').textContent }));
  console.log(JSON.stringify(estado));
  await b.close();
  if (!estado.temV || erros) { console.log('FALHOU: a pagina nao abriu limpa'); process.exit(1); }
  console.log('OK');
})().catch(e => console.log('ERRO', e.message));
