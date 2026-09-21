// Previsão de montanha para a ficha do trilho.
//
// Não é "o tempo da cidade mais próxima". É construída, por prazo, dos
// modelos físicos dos serviços meteorológicos, pela ordem da resolução:
//   0–48 h   AROME (Météo-France, 1,5 km)          horária
//   até 4 d  ARPEGE Europa (Météo-France, 11 km)
//   até 5 d  ICON-EU (DWD, 7 km)
//   até 7 d  IFS (ECMWF, 25 km) determinista
// e, para TODOS os dias, o conjunto (ensemble) do ECMWF com 51 membros: a
// probabilidade de chuva e a confiança vêm daí, não de um número único. Nos
// dias em que só há o IFS (6.º e 7.º) é o conjunto que manda: mediana e faixa
// P10–P90.
// Tudo é lido pelo Open-Meteo (open-meteo.com), que serve os ficheiros
// abertos destes serviços sem os alterar; sem chave, uso não comercial.
// As grandezas de montanha calculam-se aqui: temperatura no cume e na base
// (níveis de pressão 850/700 hPa interpolados à cota, senão gradiente
// 0,65 °C/100 m), vento ao nível do cume (idem), sensação térmica (índice
// canadiano), cota de neve (isotérmica 0 °C − 300 m), base das nuvens
// (125 m por grau de diferença T − ponto de orvalho), risco de trovoada
// (CAPE), e uma avaliação por dia para andar na serra.
// Avisos oficiais: IPMA (distritos da Guarda, Castelo Branco, Coimbra, Viseu).

(function () {
  const $h = (t) => String(t == null ? '' : t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const MODELOS = [
    { id: 'meteofrance_arome_france_hd', nome: 'AROME 1,5 km (Météo-France)', curto: 'AROME', horas: 48 },
    { id: 'meteofrance_arpege_europe',   nome: 'ARPEGE 11 km (Météo-France)', curto: 'ARPEGE', horas: 96 },
    { id: 'icon_eu',                     nome: 'ICON-EU 7 km (DWD)',          curto: 'ICON-EU', horas: 120 },
    { id: 'ecmwf_ifs025',                nome: 'IFS 25 km (ECMWF)',           curto: 'IFS', horas: 168 },
  ];
  const MIN = 'temperature_2m,precipitation,weather_code,wind_speed_10m,wind_direction_10m,wind_gusts_10m,cloud_cover';
  const BASE = MIN + ',dew_point_2m,snowfall,cloud_cover_low,cape,freezing_level_height';
  const NIV = ',temperature_850hPa,wind_speed_850hPa,wind_direction_850hPa,geopotential_height_850hPa,temperature_700hPa,wind_speed_700hPa,wind_direction_700hPa,geopotential_height_700hPa';
  const WMO = { 0: ['céu limpo', '☀️'], 1: ['quase limpo', '🌤️'], 2: ['parcialmente nublado', '⛅'], 3: ['encoberto', '☁️'],
    45: ['nevoeiro', '🌫️'], 48: ['nevoeiro gelado', '🌫️'], 51: ['chuvisco fraco', '🌦️'], 53: ['chuvisco', '🌦️'], 55: ['chuvisco forte', '🌧️'],
    56: ['chuvisco gelado', '🌧️'], 57: ['chuvisco gelado forte', '🌧️'], 61: ['chuva fraca', '🌦️'], 63: ['chuva', '🌧️'], 65: ['chuva forte', '🌧️'],
    66: ['chuva gelada', '🌧️'], 67: ['chuva gelada forte', '🌧️'], 71: ['neve fraca', '🌨️'], 73: ['neve', '🌨️'], 75: ['neve forte', '❄️'], 77: ['grãos de neve', '🌨️'],
    80: ['aguaceiros fracos', '🌦️'], 81: ['aguaceiros', '🌧️'], 82: ['aguaceiros fortes', '⛈️'], 85: ['aguaceiros de neve', '🌨️'], 86: ['aguaceiros de neve fortes', '❄️'],
    95: ['trovoada', '⛈️'], 96: ['trovoada com granizo', '⛈️'], 99: ['trovoada com granizo forte', '⛈️'] };
  const wmo = (c) => WMO[c] || ['—', '·'];
  const DIAS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
  const RUMOS = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'];
  const rumo = (g) => g == null ? '' : RUMOS[Math.round(g / 45) % 8];
  const num = (v) => (v == null || Number.isNaN(v)) ? null : +v;
  const f1 = (v) => v == null ? '—' : v.toFixed(1).replace('.', ',');
  const r0 = (v) => v == null ? '—' : String(Math.round(v));

  async function pede(url, ms) {
    // o prazo é só para a resposta chegar; a leitura do corpo não se corta
    // (no telemóvel, a página pode estar ocupada a construir a malha e o
    // temporizador disparava a meio da leitura)
    const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), ms || 25000);
    let r;
    try { r = await fetch(url, { signal: ctl.signal }); } finally { clearTimeout(tm); }
    const j = await r.json().catch((e) => { throw new Error('resposta ilegível (' + e.message + ')'); });
    if (!r.ok || !j || j.error) throw new Error((j && j.reason) || ('HTTP ' + r.status));
    return j;
  }

  // um modelo: tenta com níveis de pressão, depois sem, depois o mínimo
  async function modelo(m, la, lo, alt) {
    const base = 'https://api.open-meteo.com/v1/forecast?latitude=' + la.toFixed(4) + '&longitude=' + lo.toFixed(4) + '&elevation=' + alt
      + '&models=' + m.id + '&timezone=Europe%2FLisbon&forecast_days=7&wind_speed_unit=kmh'
      + (m.id === 'ecmwf_ifs025' ? '&daily=sunrise,sunset' : '');
    let ultimo = null;
    for (const vars of [BASE + NIV, BASE, MIN]) {
      try { const j = await pede(base + '&hourly=' + vars); j.modelo = m; return j; }
      catch (e) { ultimo = e; }
    }
    throw ultimo;
  }

  async function conjunto(la, lo, alt) {
    const u = 'https://ensemble-api.open-meteo.com/v1/ensemble?latitude=' + la.toFixed(4) + '&longitude=' + lo.toFixed(4) + '&elevation=' + alt
      + '&models=ecmwf_ifs025&timezone=Europe%2FLisbon&forecast_days=7&wind_speed_unit=kmh&hourly=temperature_2m,precipitation,wind_speed_10m';
    return pede(u, 30000);
  }

  async function avisosIPMA() {
    const j = await pede('https://api.ipma.pt/open-data/forecast/warnings/warnings_www.json', 25000);
    const areas = { GDA: 'Guarda', CBO: 'Castelo Branco', CBR: 'Coimbra', VIS: 'Viseu' };
    const agora = Date.now();
    return (Array.isArray(j) ? j : []).filter((a) => areas[a.idAreaAviso] && a.awarenessLevelID && a.awarenessLevelID !== 'green'
      && (!a.endTime || new Date(a.endTime).getTime() > agora))
      .map((a) => ({ area: areas[a.idAreaAviso], tipo: a.awarenessTypeName, nivel: a.awarenessLevelID, de: a.startTime, ate: a.endTime, texto: a.text }));
  }

  // interpola uma grandeza à cota z entre a superfície do modelo e os níveis
  // 850/700 hPa (se o modelo os deu)
  function aCota(H, i, z, zSup, campo, vSup) {
    const g8 = num(H['geopotential_height_850hPa'] && H['geopotential_height_850hPa'][i]);
    const g7 = num(H['geopotential_height_700hPa'] && H['geopotential_height_700hPa'][i]);
    const v8 = num(H[campo + '_850hPa'] && H[campo + '_850hPa'][i]);
    const v7 = num(H[campo + '_700hPa'] && H[campo + '_700hPa'][i]);
    if (g8 != null && v8 != null) {
      if (z <= g8) { if (vSup == null) return v8; const f = Math.max(0, Math.min(1, (z - zSup) / Math.max(50, g8 - zSup))); return vSup + (v8 - vSup) * f; }
      if (g7 != null && v7 != null) { const f = Math.max(0, Math.min(1, (z - g8) / Math.max(50, g7 - g8))); return v8 + (v7 - v8) * f; }
      return v8;
    }
    return null;
  }

  // sensação térmica (índice de arrefecimento pelo vento, Environment Canada)
  function sensacao(T, V) {
    if (T == null || V == null) return T;
    if (T > 10 || V < 4.8) return T;
    const p = Math.pow(V, 0.16);
    return 13.12 + 0.6215 * T - 11.37 * p + 0.3965 * T * p;
  }

  // por hora: a leitura do melhor modelo que cobre essa hora, já em
  // grandezas de montanha
  function horas(resps, zmin, zmax) {
    const ok = resps.filter(Boolean);
    if (!ok.length) return [];
    const T0 = ok[0].hourly.time; const n = T0.length;
    const out = [];
    for (let i = 0; i < n; i++) {
      let R = null;
      for (const r of ok) { const t = r.hourly.temperature_2m; if (t && t[i] != null && r.hourly.time[i] === T0[i]) { R = r; break; } }
      if (!R) { out.push(null); continue; }
      const H = R.hourly, zSup = num(R.elevation) != null ? R.elevation : (zmin + zmax) / 2;
      const T = num(H.temperature_2m[i]), Td = num(H.dew_point_2m && H.dew_point_2m[i]);
      const grad = (z) => T == null ? null : T - 0.0065 * (z - zSup);
      let tTopo = aCota(H, i, zmax, zSup, 'temperature', T); if (tTopo == null) tTopo = grad(zmax);
      let tBase = zmin < zSup ? grad(zmin) : (aCota(H, i, zmin, zSup, 'temperature', T) ?? grad(zmin));
      const v10 = num(H.wind_speed_10m[i]);
      let vTopo = aCota(H, i, zmax, zSup, 'wind_speed', v10); if (vTopo == null) vTopo = v10;
      if (v10 != null && vTopo != null) vTopo = Math.max(vTopo, v10);   // cristas expostas nunca abaixo do vento à superfície
      let dTopo = aCota(H, i, zmax, zSup, 'wind_direction', null); if (dTopo == null) dTopo = num(H.wind_direction_10m[i]);
      const raj = num(H.wind_gusts_10m && H.wind_gusts_10m[i]);
      const rajTopo = Math.max(raj || 0, (vTopo || 0) * 1.3);
      const ch = num(H.precipitation[i]) || 0, nv = num(H.snowfall && H.snowfall[i]) || 0;
      const iso0 = num(H.freezing_level_height && H.freezing_level_height[i]);
      const cape = num(H.cape && H.cape[i]);
      const nubBaixa = num(H.cloud_cover_low && H.cloud_cover_low[i]); const nub = num(H.cloud_cover[i]);
      const baseNuvens = (T != null && Td != null) ? zSup + 125 * Math.max(0, T - Td) : null;
      const cod = num(H.weather_code[i]);
      out.push({ t: T0[i], modelo: R.modelo, T, tTopo, tBase, vTopo, dTopo, rajTopo, ch, nv, iso0, cape, nub, nubBaixa, baseNuvens, cod,
                 sens: sensacao(tTopo, vTopo), cotaNeve: iso0 != null ? iso0 - 300 : null,
                 nevoeiroCume: baseNuvens != null && baseNuvens < zmax && (nubBaixa != null ? nubBaixa : nub) >= 60 });
    }
    return out;
  }

  const P = (arr, q) => { const a = arr.filter((v) => v != null).sort((x, y) => x - y); if (!a.length) return null; const k = (a.length - 1) * q; const i = Math.floor(k); return a[i] + (a[Math.min(a.length - 1, i + 1)] - a[i]) * (k - i); };

  // o conjunto: por dia, faixas de temperatura, probabilidade e mediana de
  // chuva, vento P90 e a confiança que vem da dispersão dos membros
  function porDiaConjunto(E) {
    if (!E || !E.hourly) return {};
    const H = E.hourly, tm = H.time;
    const mem = (pref) => Object.keys(H).filter((k) => k === pref || k.startsWith(pref + '_member'));
    const kT = mem('temperature_2m'), kP = mem('precipitation'), kV = mem('wind_speed_10m');
    const dias = {};
    tm.forEach((t, i) => { const d = t.slice(0, 10); (dias[d] = dias[d] || []).push(i); });
    const out = {};
    for (const d in dias) {
      const I = dias[d];
      const tmax = kT.map((k) => Math.max(...I.map((i) => num(H[k][i])).filter((v) => v != null)));
      const tmin = kT.map((k) => Math.min(...I.map((i) => num(H[k][i])).filter((v) => v != null)));
      const ch = kP.map((k) => I.reduce((s, i) => s + (num(H[k][i]) || 0), 0));
      const vt = kV.map((k) => Math.max(...I.map((i) => num(H[k][i])).filter((v) => v != null)));
      const prob = ch.length ? ch.filter((v) => v >= 1).length / ch.length : null;
      const esp = (P(tmax, 0.9) != null && P(tmax, 0.1) != null) ? P(tmax, 0.9) - P(tmax, 0.1) : null;
      let conf = 'média';
      if (esp != null && prob != null) {
        if (esp <= 3 && (prob <= 0.2 || prob >= 0.8)) conf = 'alta';
        else if (esp > 6 || (prob > 0.35 && prob < 0.65)) conf = 'baixa';
      }
      out[d] = { n: kT.length, tmax: [P(tmax, 0.1), P(tmax, 0.5), P(tmax, 0.9)], tmin: [P(tmin, 0.1), P(tmin, 0.5), P(tmin, 0.9)],
                 prob, ch: [P(ch, 0.1), P(ch, 0.5), P(ch, 0.9)], vento90: P(vt, 0.9), esp, conf };
    }
    return out;
  }

  // avaliação do dia para andar na serra (0 favorável, 1 cautela, 2 desfavorável, 3 perigoso)
  function avalia(D, zmax) {
    const razoes = []; let n = 0;
    const sobe = (k, r) => { if (k > n) n = k; razoes.push(r); };
    if (D.vmax >= 90 || D.rajmax >= 110) sobe(3, 'vento no cume ' + r0(D.vmax) + ' km/h (rajadas ' + r0(D.rajmax) + '): não se está de pé');
    else if (D.vmax >= 60 || D.rajmax >= 80) sobe(2, 'vento forte no cume, ' + r0(D.vmax) + ' km/h (rajadas ' + r0(D.rajmax) + ')');
    else if (D.vmax >= 40 || D.rajmax >= 60) sobe(1, 'vento no cume ' + r0(D.vmax) + ' km/h (rajadas ' + r0(D.rajmax) + ')');
    if (D.trov || (D.capemax >= 1000 && D.ch > 0)) sobe(2, 'risco de trovoada (CAPE ' + r0(D.capemax) + ' J/kg): sair das cristas a meio da tarde');
    else if (D.capemax >= 500) sobe(1, 'alguma instabilidade (CAPE ' + r0(D.capemax) + ' J/kg)');
    if (D.iso0min != null && D.iso0min - 300 < zmax && D.ch >= 1) sobe(2, 'precipitação com cota de neve a ' + r0(D.iso0min - 300) + ' m: neve ou gelo no alto');
    else if (D.iso0min != null && D.iso0min < zmax) sobe(1, 'isotérmica 0 °C a ' + r0(D.iso0min) + ' m, abaixo do cume: gelo possível');
    if (D.hNev >= 8) sobe(2, 'cume nas nuvens ' + D.hNev + ' h: sem visibilidade (com vento, whiteout)');
    else if (D.hNev >= 4) sobe(1, 'cume nas nuvens ' + D.hNev + ' h: nevoeiro provável');
    if (D.ch >= 15) sobe(2, 'chuva ' + f1(D.ch) + ' mm');
    else if (D.ch >= 5) sobe(1, 'chuva ' + f1(D.ch) + ' mm');
    if (D.sensmin != null && D.sensmin <= -15) sobe(2, 'sensação térmica ' + r0(D.sensmin) + ' °C no cume');
    else if (D.sensmin != null && D.sensmin <= -8) sobe(1, 'sensação térmica ' + r0(D.sensmin) + ' °C no cume');
    if (D.tBaseMax != null && D.tBaseMax >= 32) sobe(1, 'calor na base, ' + r0(D.tBaseMax) + ' °C: água e sombra');
    if (!razoes.length) razoes.push('sem sinais de alarme nos modelos');
    return { n, nome: ['favorável', 'cautela', 'desfavorável', 'perigoso'][n], cor: ['#2a8f4a', '#d8a020', '#d8792b', '#c0302b'][n], razoes };
  }

  function porDia(hs) {
    const dias = {};
    for (const h of hs) { if (!h) continue; const d = h.t.slice(0, 10); (dias[d] = dias[d] || []).push(h); }
    const out = [];
    for (const d in dias) {
      const I = dias[d];
      const mx = (k) => { const a = I.map((h) => h[k]).filter((v) => v != null); return a.length ? Math.max(...a) : null; };
      const mn = (k) => { const a = I.map((h) => h[k]).filter((v) => v != null); return a.length ? Math.min(...a) : null; };
      const cont = {}; for (const h of I) cont[h.modelo.id] = (cont[h.modelo.id] || 0) + 1;
      const idM = Object.keys(cont).sort((a, b) => cont[b] - cont[a])[0];
      const modelo = MODELOS.find((m) => m.id === idM);
      // código do tempo do dia: o pior das horas de dia (8–20), senão o mais frequente
      const dia = I.filter((h) => { const hh = +h.t.slice(11, 13); return hh >= 8 && hh <= 20; });
      const cods = (dia.length ? dia : I).map((h) => h.cod).filter((c) => c != null);
      const cod = cods.length ? Math.max(...cods) : null;
      const D = { d, modelo, horas: I.length, cod, tTopoMin: mn('tTopo'), tTopoMax: mx('tTopo'), tBaseMax: mx('tBase'), tBaseMin: mn('tBase'),
                  vmed: I.reduce((s, h) => s + (h.vTopo || 0), 0) / I.length, vmax: mx('vTopo'), rajmax: mx('rajTopo'),
                  ch: I.reduce((s, h) => s + h.ch, 0), nv: I.reduce((s, h) => s + h.nv, 0), iso0min: mn('iso0'), capemax: mx('cape'),
                  hNev: I.filter((h) => h.nevoeiroCume).length, sensmin: mn('sens'), trov: I.some((h) => h.cod >= 95) };
      const vd = I.filter((h) => h.vTopo != null && h.vTopo === D.vmax)[0]; D.dir = vd ? vd.dTopo : null;
      out.push(D);
    }
    return out;
  }

  const setaVento = (g) => g == null ? '' : '<span style="display:inline-block;transform:rotate(' + ((g + 180) % 360) + 'deg)">↑</span>';

  function pintaHoje(hs, zmax, zmin) {
    const agora = new Date(); const hoje = hs.find(Boolean); if (!hoje) return '';
    const d0 = hoje.t.slice(0, 10); const hIni = Math.max(0, agora.getHours() - 1);
    let s = '<div class=hoje>';
    for (const h of hs) {
      if (!h || !h.t.startsWith(d0)) continue;
      const hh = +h.t.slice(11, 13); if (hh < hIni) continue;
      const [txt, ico] = wmo(h.cod);
      s += '<div class=h title="' + $h(txt + ' · ' + h.modelo.nome) + '"><span>' + String(hh).padStart(2, '0') + 'h</span><span class=ico>' + ico + '</span>'
        + '<b>' + r0(h.tTopo) + '°</b><span class=nota>' + r0(h.tBase) + '° base</span>'
        + '<span>' + setaVento(h.dTopo) + ' ' + r0(h.vTopo) + '<small>/' + r0(h.rajTopo) + '</small></span>'
        + '<span class=ch>' + (h.ch ? f1(h.ch) + ' mm' : (h.nv ? f1(h.nv) + ' cm' : '·')) + '</span>'
        + (h.sens != null && h.sens < h.tTopo - 2 ? '<span class=nota>sente-se ' + r0(h.sens) + '°</span>' : '')
        + (h.nevoeiroCume ? '<span class=nota>🌫 cume</span>' : '') + '</div>';
    }
    return s + '</div><p class=nota style="margin:4px 0 0">Por hora: temperatura no ponto mais alto do trilho (' + zmax + ' m) e na base (' + zmin + ' m), vento ao nível do cume e rajada (km/h), precipitação; "sente-se" é a sensação térmica com o vento.</p>';
  }

  function pintaDias(DD, C, sol, zmax) {
    const chip = (rot, val, tit) => '<span class=chip title="' + $h(tit || '') + '"><small>' + rot + '</small>' + val + '</span>';
    let s = '<div class=dias>';
    for (const D of DD) {
      const dt = new Date(D.d + 'T12:00:00'); const [txt, ico] = wmo(D.cod); const c = C[D.d] || {};
      const conjManda = D.modelo && D.modelo.id === 'ecmwf_ifs025' && c.tmax;
      s += '<div class=dia><div class=cab><b>' + (DD.indexOf(D) === 0 ? 'hoje' : DIAS[dt.getDay()]) + ' ' + dt.getDate() + '/' + (dt.getMonth() + 1) + '</b>'
        + ' <span class=ico>' + ico + '</span> <span class=nota>' + $h(txt) + '</span>'
        + '<span class=aval style="background:' + D.aval.cor + '">' + D.aval.nome + '</span></div><div class=chips>'
        + chip('cume ' + zmax + ' m', r0(D.tTopoMin) + '° / <b>' + r0(D.tTopoMax) + '°</b>' + (c.tmax ? ' <i>conj. ' + r0(c.tmin[1]) + '–' + r0(c.tmax[1]) + '° (' + r0(c.tmax[0]) + '…' + r0(c.tmax[2]) + ')</i>' : ''), 'mínima e máxima no ponto mais alto; conj.: mediana do conjunto do ECMWF e faixa P10–P90 da máxima')
        + chip('base', r0(D.tBaseMax) + '°', 'máxima no ponto mais baixo')
        + chip('vento cume', setaVento(D.dir) + ' ' + rumo(D.dir) + ' <b>' + r0(D.vmax) + '</b> / ' + r0(D.rajmax) + ' km/h' + (c.vento90 != null ? ' <i>conj. P90 ' + r0(c.vento90) + '</i>' : ''), 'máximo ao nível do cume / rajada')
        + chip('chuva', f1(D.ch) + ' mm' + (D.nv ? ' · neve ' + f1(D.nv) + ' cm' : '') + (c.ch ? ' <i>conj. ' + f1(c.ch[1]) + ' (' + f1(c.ch[0]) + '–' + f1(c.ch[2]) + ')</i>' : ''), 'total do dia; conj.: mediana e faixa P10–P90 do conjunto')
        + chip('prob. chuva', c.prob != null ? '<b>' + Math.round(100 * c.prob) + ' %</b> <i>' + c.n + ' membros</i>' : '—', 'fracção dos membros do conjunto do ECMWF com ≥ 1 mm')
        + chip('isotérmica 0°', D.iso0min != null ? r0(D.iso0min) + ' m' + (D.iso0min < zmax ? ' <span style="color:#c0302b">▼ abaixo do cume</span>' : '') : '—', 'altitude mínima da isotérmica 0 °C no dia')
        + chip('cume nas nuvens', D.hNev ? D.hNev + ' h' : '—', 'horas com a base das nuvens abaixo do cume')
        + (sol[D.d] ? chip('sol', sol[D.d].nasce + '–' + sol[D.d].poe) : '')
        + chip('confiança', c.conf ? '<b style="color:' + ({ alta: '#2a8f4a', média: '#d8a020', baixa: '#c0302b' })[c.conf] + '">' + c.conf + '</b>' : '—', 'dispersão do conjunto: alta se a máxima varia ≤ 3 °C e a chuva é consensual')
        + chip('modelo', (D.modelo ? D.modelo.curto : '') + (conjManda ? ' + conjunto' : ''), D.modelo ? D.modelo.nome : '')
        + '</div><div class=nota>' + D.aval.razoes.map($h).join('; ') + '</div></div>';
    }
    return s + '</div>';
  }

  async function previsaoMontanha(el, notaEl, p) {
    const { la, lo, zmin, zmax } = p; const alt = Math.round((zmin + zmax) / 2);
    el.textContent = 'a pedir aos modelos (AROME, ARPEGE, ICON-EU, IFS e o conjunto do ECMWF)…';
    const pedidos = MODELOS.map((m) => modelo(m, la, lo, alt).catch((e) => { m.erro = e.message; return null; }));
    const [resps, E, avisos] = await Promise.all([Promise.all(pedidos), conjunto(la, lo, alt).catch((e) => ({ erro: e.message })), avisosIPMA().catch((e) => ({ erro: e.message }))]);
    const ok = resps.filter(Boolean);
    if (!ok.length) throw new Error('nenhum modelo respondeu: ' + MODELOS.map((m) => m.curto + ' (' + (m.erro || '?') + ')').join(', '));
    const hs = horas(resps, zmin, zmax);
    const DD = porDia(hs).map((D) => { D.aval = avalia(D, zmax); return D; });
    const C = (E && !E.erro) ? porDiaConjunto(E) : {};
    const sol = {};
    const ifs = ok.find((r) => r.daily && r.daily.sunrise);
    if (ifs) ifs.daily.time.forEach((d, i) => { sol[d] = { nasce: ifs.daily.sunrise[i].slice(11, 16), poe: ifs.daily.sunset[i].slice(11, 16) }; });
    let s = '';
    if (avisos && !avisos.erro) {
      if (avisos.length) {
        const cor = { yellow: '#d8a020', orange: '#d8792b', red: '#c0302b' };
        s += '<div style="border:1px solid var(--linha);border-radius:12px;padding:8px 12px;background:#fff;margin-bottom:10px"><b>Avisos IPMA em vigor</b><ul style="margin:4px 0 0;padding-left:18px">'
          + avisos.map((a) => '<li><span style="color:' + (cor[a.nivel] || '#333') + ';font-weight:600">' + $h(a.nivel === 'yellow' ? 'amarelo' : a.nivel === 'orange' ? 'laranja' : a.nivel === 'red' ? 'vermelho' : a.nivel) + '</span> · ' + $h(a.tipo) + ' · ' + $h(a.area)
            + ' <span class=nota>(' + $h((a.de || '').slice(5, 16).replace('T', ' ')) + ' → ' + $h((a.ate || '').slice(5, 16).replace('T', ' ')) + ')</span>' + (a.texto ? '<br><span class=nota>' + $h(a.texto) + '</span>' : '') + '</li>').join('') + '</ul></div>';
      } else s += '<p class=nota style="margin:0 0 8px">Avisos IPMA: nenhum em vigor para Guarda, Castelo Branco, Coimbra e Viseu.</p>';
    } else s += '<p class=nota style="margin:0 0 8px">Avisos IPMA: não deu para ler agora' + (avisos && avisos.erro ? ' (' + $h(avisos.erro) + ')' : '') + '.</p>';
    s += '<p class=nota style="margin:0 0 6px"><b>Hoje, hora a hora</b> (' + $h(hs.find(Boolean) ? hs.find(Boolean).modelo.nome : '') + '):</p>' + pintaHoje(hs, zmax, zmin);
    s += '<p class=nota style="margin:12px 0 6px"><b>Próximos 7 dias</b>, no ponto mais alto do trilho (' + zmax + ' m):</p>' + pintaDias(DD, C, sol, zmax);
    s += '<p class=nota style="margin:10px 0 0">Como é feita: cada hora vem do modelo de malha mais fina que a cobre — '
      + MODELOS.map((m) => m.curto + ' até ' + (m.horas / 24) + ' d' + (m.erro ? ' (falhou: ' + $h(m.erro) + ')' : '')).join(', ')
      + '. A probabilidade de chuva, as faixas "conj." e a confiança vêm do conjunto de ' + ((E && E.hourly && Object.keys(E.hourly).filter((k) => k.startsWith('temperature_2m')).length) || 0) + ' membros do ECMWF'
      + (E && E.erro ? ' (não respondeu: ' + $h(E.erro) + ')' : '') + '; nos dias em que só há o IFS é o conjunto que manda. '
      + 'Temperatura e vento no cume: níveis 850/700 hPa interpolados à cota (senão 0,65 °C por 100 m); cota de neve = isotérmica 0 °C − 300 m; cume nas nuvens quando a base das nuvens (125 m por °C entre a temperatura e o ponto de orvalho) fica abaixo do cume com nuvens baixas. '
      + 'Modelos: Météo-France, DWD e ECMWF, lidos pelo Open-Meteo sem alteração. Hora de Lisboa.</p>';
    el.className = ''; el.innerHTML = s;
    if (notaEl) notaEl.textContent = '(' + la.toFixed(3) + ', ' + lo.toFixed(3) + '; ' + zmin + '–' + zmax + ' m; modelos ' + ok.map((r) => r.modelo.curto).join(', ') + ')';
    return { hs, DD, C };
  }
  window.previsaoMontanha = previsaoMontanha;
})();
