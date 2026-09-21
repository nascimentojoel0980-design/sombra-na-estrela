# Caminhos da Estrela — instruções para o Claude Code

Mapa de percursos pedestres da Serra da Estrela. Site estático publicado no
GitHub Pages. Funciona sem rede (service worker + Cache API + IndexedDB).

Publicado em: https://nascimentojoel0980-design.github.io/sombra-na-estrela/
Repositório:  https://github.com/nascimentojoel0980-design/sombra-na-estrela

O dono chama-se Joel. Fala com ele em **português de Portugal**, directo e sem
rodeios. Ele testa tudo no telemóvel (Android, Chrome, DPR 2,75) e apanha
depressa quando alguma coisa não bate certo — se ele disser que não vê
diferença, **verifica antes de explicar porquê**. Ver a secção ARMADILHAS.

**Acabar SEMPRE a resposta com o link**, mesmo que ele não peça. Ele lê no
telemóvel e é assim que abre o que acabou de ser publicado:

```
https://nascimentojoel0980-design.github.io/sombra-na-estrela/
```

Quando a mudança for numa página à parte, o link é o dela, com `?v=` a seguir
para a cache do telemóvel não servir a cópia de ontem.

---

## 1. Como está organizado

```
/ (raiz do repositório = raiz do site publicado)
  index.html        o site inteiro, gerado. NÃO editar à mão.
  sw.js             service worker (offline)
  teste.html        medidor de velocidade da DGT (ferramenta de diagnóstico)
  manifest.json     PWA
  .nojekyll         obrigatório, senão o GitHub Pages ignora pastas com _
  dados/            rede.json, osm.json, dem.webp, topo.pmtiles, det/*.webp
  orto/             ortofotos de fundo (63 cm)
  sat/              satélite
  glifos/           tipos de letra do MapLibre (PBF)
  lib/              leaflet.js, pmtiles.js, maplibre-gl-csp.js
  fonte/            ESTA pasta: o que gera tudo o resto
```

### A pasta `fonte/`

```
fonte/
  CLAUDE.md                este ficheiro
  build_site.py            monta o site a partir das fontes
  sombra-na-estrela.html   FONTE PRINCIPAL — 1,4 MB, tudo em linha
  app.js                   cópia só do JavaScript, para leitura
  sw.js                    fonte do service worker
  teste.html               fonte do medidor
  publicar.sh              script de publicação (Git Bash no Windows)
  scripts-dados/           scripts que geraram os dados (raramente precisos)
```

**IMPORTANTE — a duplicação:** `sombra-na-estrela.html` tem TODO o JavaScript
em linha. `app.js` é uma cópia desse mesmo JavaScript, mantida em paralelo
para ser mais fácil de ler e de validar com `node --check`.

**Qualquer alteração ao código tem de ser aplicada aos DOIS ficheiros.**
Se só mexeres num, o site fica com uma versão e a leitura com outra. Foi assim
que o projecto cresceu; podes unificar se quiseres, mas então tens de mudar
também o `build_site.py`.

Forma segura de editar (é assim que se tem feito):

```python
# patch.py
velho = "...trecho exacto..."
novo  = "...substituição..."
for f in ['fonte/sombra-na-estrela.html', 'fonte/app.js']:
    s = open(f, encoding='utf-8').read()
    assert velho in s, f'não encontrado em {f}'
    open(f, 'w', encoding='utf-8').write(s.replace(velho, novo, 1))
```

Depois **valida sempre**:

```bash
node --check fonte/app.js
python3 -c "
import re
s = open('fonte/sombra-na-estrela.html', encoding='utf-8').read()
b = re.findall(r'<script(?![^>]*\ssrc=)[^>]*>(.*?)</script>', s, re.S)
open('/tmp/chk.js','w',encoding='utf-8').write('\n;\n'.join(b))
"
node --check /tmp/chk.js
```

Um literal de template mal fechado numa string já partiu o site inteiro sem
dar erro visível. Nunca publiques sem correr estas duas verificações.

---

## 2. Construir e publicar

```bash
python3 fonte/build_site.py     # gera index.html, sw.js, teste.html na raiz
bash  fonte/publicar.sh         # commit + push para o GitHub
```

### Como o build_site.py resolve os dados

O script nasceu numa sessão na nuvem com pastas de dados intermédios que
**não estão no repositório** (`ortofull/`, `det40/`, `vec/`, `s2/`, `d3/`,
dezenas de GB). Desde 18/09/2026 corre sem elas: quando não existem, tira
as correspondências (blob → `orto/*.webp`, índice `__DET__`) do
**`index.html` já publicado na raiz** e usa os ficheiros que já estão em
`dados/`, `orto/`, `sat/`, `glifos/` e `lib/`. Pára com erro se ficar algum
blob por resolver ou faltar um ficheiro obrigatório.

Consequência: **não apagues o `index.html` da raiz antes de construir** — é
ele que guarda as correspondências. Se um dia houver ortofotos ou detalhe
novos, é preciso voltar a ter `ortofull/assets.json` e `det40/`.

Compara sempre o `index.html` gerado com o que já está no repositório antes de
publicar (`git diff --stat index.html`): devem diferir só na tua alteração e
na versão. Se a diferença for grande, alguma reescrita deixou de correr —
não publiques.


O `build_site.py` insere a versão (`__VERSAO__` → data/hora) que aparece no
fim do painel "Usar sem rede". **Serve para o Joel confirmar que a versão
nova lhe chegou** — pergunta-lhe sempre esse número quando ele disser que uma
alteração não fez efeito.

O GitHub Pages guarda o HTML em cache uns 10 minutos. Para furar, abre com
`?x=<número>` no fim do endereço.

O push é frágil neste repositório (850 MB, ficheiros grandes). O
`publicar.sh` já leva as defesas: `core.compression 0`, `pack.threads 1`, e
envia commit a commit em vez de tudo de uma vez.

---

## 3. Como o mapa funciona

**Leaflet 1.9.4** (vendorizado em `biblioteca/`). Painéis por ordem:

```
satP  380   satélite de fundo
ortoP 390   ortofotos 63 cm
detP  395   ortofotos de detalhe
onlineP 397 DGT 25 cm / Esri  ← camadas online, por cima
poiP  620   pontos de interesse
```

**Camada da DGT** — WMS oficial, ortofoto de 2025 a 25 cm:

```
https://cartografia.dgterritorio.gov.pt/wms/ortos2025
layers=Ortos2025-RGB  crs=EPSG:3857  format=image/jpeg
```

Constantes que controlam tudo (procura por elas no ficheiro):

```js
const PX_DGT   = 2048;  // pixels por pedido
const Z_DGT    = 16;    // nível da grelha usado para guardar
const DGT_CAP  = 900;   // máximo de blocos por descarga (~195 km²)
```

`PX_DGT = 2048` com `zoomOffset: -3` dá **22,8 cm por pixel**, que é o limite
da fonte. Pedir mais pixels não traz mais detalhe — a DGT interpola.

**Mapa topográfico vectorial:** MapLibre GL + PMTiles (`dados/topo.pmtiles`,
91 MB, 8 camadas, Z6–Z15). Vive num contentor `#mapt` em ecrã inteiro
(`position:fixed; inset:0; z-index:1200`). Foi a única forma de compor bem —
não voltes a tentar dimensioná-lo à medida do mapa.

---

## 4. Funcionamento sem rede (`sw.js`)

- Cache API (`ce-v1`) para os quadrados e ficheiros do site
- IndexedDB (`ce-mapa` / `ficheiros`) para o `topo.pmtiles` inteiro, servido
  por Range requests a partir de um Blob
- índice dos quadrados guardados, para desenhar a cobertura no mapa
- `navigator.storage.persist()` para o Android não apagar

**Estratégia de rede — não inverter:**

- `index.html`, `manifest.json`, `sw.js`, `dados/rede.json`, `dados/osm.json`
  → **rede primeiro**, cache só como recurso
- tudo o resto (quadrados, imagens, biblioteca) → **cache primeiro**

O `index.html` esteve em cache-primeiro e as versões novas **nunca chegavam
ao telemóvel**. Custou horas a perceber. Não voltes a pôr.

Descarga: `guardaFotos()`, **3 pedidos em paralelo**, 30 s de limite por
pedido e uma segunda tentativa. Os números vêm de medição real, não de
palpite (ver `teste.html`).

**O Background Fetch do Android foi retirado.** Funcionava com quadrados
pequenos mas ficava em 0% com blocos grandes, sem dar erro. Se o quiseres
trazer de volta, mede primeiro.

---

## 5. Números medidos (18/09/2026, telemóvel do Joel, WiFi)

Da DGT, com `<img>`, zero falhas em todos:

```
256 px,  6 em paralelo →  0,8 km²/min
1024 px, 1 de cada vez →  6,4 km²/min
2048 px, 3 em paralelo → 14,0 km²/min   ← em uso
```

Custo real em disco: **~7 MB/km²** (inclui os níveis de zoom intermédios e as
ortofotos de 63 cm da mesma área).

Áreas:

```
caixa navegável da app    36 000 km²   123 GB a 25 cm
caixa com dados nossos     6 271 km²    21 GB a 25 cm
cabe no telemóvel dele     ~1 400 km²   ~9,3 GB livres
```

`teste.html` volta a medir isto quando quiseres. Corre-o **com o telemóvel
parado**, sem nada a descarregar — senão mede o engarrafamento que ele próprio
criou.

---

## 6. ARMADILHAS — erros já cometidos, não repetir

**1. `L.TileLayer` recebe `(url, opções)`.**
`new CamadaDGT({ tileSize: 2048, ... })` põe as opções no lugar do url e
**nenhuma é aplicada** — a camada fica com `maxZoom: 18` de fábrica e deixa de
desenhar acima do zoom 18. Isto passou despercebido quase um dia inteiro, com
o Joel a dizer "não vejo diferença" e eu a explicar-lhe física em vez de ir
ver o objecto. Escreve sempre `new CamadaDGT('', { ... })`.

**2. Verificar no browser, não na cabeça.** Playwright está disponível
(`/opt/pw-browsers/chromium`). Serve o site e vai ver o objecto por dentro:

```js
map.setView([40.3315, -7.5772], 17);
ligaSat(1);
JSON.stringify(camDGT.options)   // o que lá está mesmo
camDGT.getTileSize()
map.getPane('onlineP').querySelectorAll('img').length
```

Trinta segundos disto valem mais do que uma hora de teoria.

**3. Nunca afirmar sem medir.** Dizer "25 cm é o melhor que existe" estava
errado — o Wikiloc usa Google, que tem cobertura aérea mais fina nas
povoações. Dizer "a DGT recusa pedidos em paralelo" estava errado — vinha de
um teste com coordenadas no meio do Atlântico. O Joel apanhou os dois.

**4. O WMS não avisa quando estás fora de cobertura.** Devolve uma imagem lisa
de ~1 KB. Se os pedidos vierem com 1 KB, as coordenadas estão erradas. Uma
imagem real de 256 px na serra pesa uns 14–26 KB.

**5. Zoom máximo ≠ nitidez.** A fonte tem 25 cm/pixel. No zoom 19 já se vêem
todos os pixels que existem. Acima disso é ampliação. A app avisa (`notaLimite`).

**6. `device_commit_files` guarda em cache por caminho de origem.** Usa sempre
um nome único a cada envio (`index_1250.html`, etc.), senão escreve conteúdo
velho sem dar erro.

**7. Rede bloqueada.** Nem o contentor nem a VM do computador conseguem chegar
à DGT, ao Overpass ou ao dados.gov.pt (403 do proxy). Descargas de dados novos
têm de ser feitas pelo Joel no Git Bash do Windows dele.

**8. Credenciais.** O push tem de ser corrido pelo Joel — as credenciais do
GitHub estão no Credential Manager do Windows. Nunca lhe peças palavras-passe
nem as escrevas em lado nenhum.

**9. O `sw.js` da raiz é GERADO.** A fonte é `fonte/sw.js`; o
`build_site.py` copia-a por cima. Editei o da raiz, publiquei, e o
`build_site.py` seguinte deitou a correcção fora sem dizer nada — o telemóvel
do Joel continuou a servir o ficheiro velho da cache e o erro que ele viu não
tinha nada que ver com o que eu julgava. **Nunca editar nada na raiz**:
`index.html`, `sw.js` e `dados/` saem todos de `fonte/`.

**10. `?v=` serve para código, não para dados.** A regra do service worker
para `dados/` é cache primeiro **com `ignoreSearch`** — a query é ignorada.
Para um ficheiro de dados chegar novo ao telemóvel, muda-se o **caminho**
(`manteigas-v2.terr.gz`), não a query.

E se ele continuar a ver o velho depois disso, **o HTML também está em
cache**: o GitHub Pages manda `max-age=600` e o service worker antigo não
intercepta páginas que não conhece. Com três camadas a guardar (navegador,
service worker antigo, service worker novo por activar) não se adivinha qual
delas é: **muda-se o caminho de tudo de uma vez** — página, código e dados —
e deixa-se o endereço antigo a redireccionar.

**11. `let` de topo NÃO está no `window`.** Num ensaio com o Playwright pus
`window.ARV = ligaArvores(...)` e depois li `ARV.resumo()`. O `ARV` do
`app.js` é um `let` de topo, que **não** cria propriedade no `window`, e o
âmbito léxico ganha: estive a medir a camada da aplicação, não a minha. Deu
exactamente o mesmo número nas duas medições e quase o dei por bom. Uma camada
de ensaio leva `id` próprio (`op.id`) e lê-se por uma variável própria
(`window.__T`).

**12. `map.project()` ignora o relevo.** Com terreno ligado e o ecrã
inclinado, a linha desenhada no chão não está onde o `project()` a põe.
Amostrar píxeis nesses pontos mede ruído. Para comparar duas versões da mesma
vista, conta píxeis da imagem inteira por cor.

---

## 7. Por fazer

- [ ] Guardar só o nível de detalhe máximo em vez de três → poupa ~25% de disco
- [ ] Modo de descarga em fila: partir uma área grande em rectângulos e
      descarregá-los seguidos, com limite de espaço e retoma
- [ ] Levantar `DGT_CAP` (agora 195 km² por descarga) agora que é rápido
- [ ] Trazer de volta a descarga em segundo plano, medindo primeiro
- [ ] Detecção de trilhos por LiDAR nos 684 km² de MDT a 2 m, apresentados
      como "detectado, não confirmado"
- [ ] Procurar cartografia PMDFCI nas câmaras (Manteigas, Seia, Covilhã,
      Gouveia, Guarda) — a do ICNF só cobre 11 concelhos de Aveiro, não serve
- [ ] 47 blocos de ortofoto em falta; 82+82 quadrículas LiDAR que a DGT não serve
- [ ] Unificar `app.js` e `sombra-na-estrela.html` numa fonte só

---

## REGRA: nenhuma zona se publica sem boletim

Pedido dele, 20/09/2026, e vale para tudo o que este cozedor produzir:

> *"Não quero que estejas a corrigir o problema imagem a imagem que envio.
> Quero como deve ser, porque agora é uma área pequena e quando for grande ou
> nova não sei afirmar."*

Está certo. Olhar para o ecrã só funciona enquanto a área é pequena e ele
conhece o terreno. Numa zona nova ninguém consegue afirmar nada a olho, e um
mapa que não sabe dizer onde erra é pior do que não ter mapa.

Por isso `gera_terreno.py` corre `confere.py` no fim de cada cozedura, e **a
zona só entra no `index.json` se nenhuma VERIFICAÇÃO falhar.** O ficheiro
cozido fica sempre no disco para se poder olhar; o que não acontece é passar a
ser publicado sem ninguém saber que falhou. `--sem-boletim` fura a guarda e só
se usa com motivo escrito.

### As três etiquetas, e a diferença é o ponto todo

| etiqueta | o que quer dizer |
|---|---|
| **VERIFICAÇÃO** | confronta o mapa com uma fonte **independente** do que o produziu. Se falha, o mapa está errado. |
| **CONSISTÊNCIA** | confirma que o cozedor fez o que diz que faz. É circular por construção: passar **não** prova que o mapa é verdade, prova que o gerador não se partiu. |
| **NÃO VERIFICADO** | não há maneira de o confrontar. Aparece com o nome da razão. **Uma classe sem verificação possível não é uma classe boa por defeito.** |

Vender uma consistência como garantia seria o mesmo erro que pintar telhados
de cinzento por causa de um ficheiro dessaturado.

### O boletim já pagou o que custou

Na primeira vez que correu apanhou **duas falhas**:

- **as cotas**, com correlação 0,83 — e a falha era **da própria prova**, que
  inventou a caixa do DEM de referência em vez de a ler do cozedor. Passou a
  lê-la, e dá 0,9996. *Uma prova com a referência errada não prova nada, e foi
  a terceira vez neste projecto* (antes: os polígonos `aguaA` como referência
  de água, e os domos do planalto como referência de rocha).
- **a água**, com 24% das células em declive acima de 12°. Essa era real: os
  polígonos `aguaA` do OSM incluem ribeiras desenhadas como área em encostas
  de 17°. Uma superfície de água não fica de pé numa encosta. Passaram a ser
  recusadas — 0,19 km² fora — e a água ficou 100% plana.

- **A grelha de classes esteve espelhada norte–sul até à v10 (20/09/2026).**
  `pinta()` escrevia a linha 0 a sul; cotas, CHM, `abre_corredor`, `confere.py`
  e o motor têm a linha 0 a norte. Tudo o que vinha da carta (COS, água OSM,
  máscara das casas) estava no espelho do relevo; o que a medição decide
  (floresta, matagal, chão nu) saía certo porque o CHM está a norte-primeiro.
  Sintomas que se explicaram mal durante dias: "rocha no fundo do vale" (era o
  planalto espelhado), "casas confundidas com árvores" (a máscara zerava a copa
  no sítio errado), "+13 km² de árvores que a COS não tinha" (eram +0,65).
  Detectou-se por a vila de Manteigas (40,401 N) só ser urbano com a linha 0 a
  sul. Corrigido na v11; a água medida pelo Sentinel passou a coincidir 100 %
  com a da COS (antes "0,50 km² que a COS não tinha"). **Lição:** cada grelha
  nova tem de declarar a orientação no cabeçalho da função, e uma prova de
  posição (um ponto conhecido, a vila) faz parte do boletim a partir daqui.
  As duas provas cegas (`prova_cega*.jpg`) rotulam classes da carta com a
  grelha espelhada — só valem para floresta/matagal/chão nu; têm de ser
  geradas de novo sobre a v11 antes de alguém as pontuar.

### As classes e as casas vêm do `sne-dados-fonte`, não dos azulejos (20/09/2026)

O `gera_terreno.py` lê a COS 2025 Série 2 (GeoPackage, com o nível 3) e os
contornos Microsoft + OSM do repositório privado `sne-dados-fonte`, clonado ao
lado deste (`--fontes PASTA` para outro sítio). Recortados à **área toda** do
mapa, em folhas de 0,3°: qualquer `--caixa` dentro de -8.27 39.89 -7.07 40.80
coze com o mesmo comando. `fonte/scripts-dados/fontes.py` é o único leitor.
O MDT e o CHM também vêm de lá por omissão (`lidar-derivado/mdt8/`, `chm5/`,
folhas de 0,3°, int16/uint8 em decímetros, coladas por `fontes.raster_mosaico`);
`--mdt`/`--chm` a ficheiros soltos continuam a valer e passam à frente. O
`index.json` regista em `fontes` de onde veio cada coisa.

Porquê: os azulejos antigos tinham 7, 8 e 9 da COS num saco só e não traziam o
n3. O "7" da COS **não é rocha**: em Manteigas são 31,3 km², dos quais 30,6 são
713 "Vegetação esparsa" e 0,7 são 712 "Espaços rochosos". Era daí que vinha "a
zona baixa de Manteigas é pedra". Agora: 712 → rocha; 711/713 → chão nu
provisório que a altura medida promove (≥0,5 m mato, ≥1,5 matagal, ≥5 árvore).
Cursos de água (911) em declive ≥ 12° são margem e seguem o mesmo caminho.
`--sem-fontes` ainda coze com os azulejos, mas a zona sai marcada no boletim.

Regras acrescentadas a 20/09/2026 depois da fotografia do Covão da Ametade
(clareiras de erva e uma levada, onde o mapa punha chão nu e nada):
- **linhas de água** do OSM (`aguaL`: rio/ribeira/levada) vão no bloco CAMS
  com tipos 5/6/7 e desenham-se como fita azul. A COS só tem cursos com 20 m
  de largura; o Sentinel não vê 3 m.
- **abaixo de 0,5 m o laser não diz o que é**; o NDVI (`--ndvi`) diz se é
  verde: ≥ 0,5 erva (3), 0,25–0,5 rasteiro (6), < 0,25 chão nu (10). Sem
  `--ndvi`, chão nu não se afirma (fica rasteiro). Urbano da COS sem edifício,
  < 5 m e NDVI ≥ 0,5 é relvado (3) — o parque de campismo é "Turismo".
- **penedos**: pegada só-Microsoft < 60 m², > 1200 m, fora de urbano/agrícola,
  não se desenha (10/11 eram granito no ortofoto). O OSM passa sempre.
- **lagoa do OSM sem água na COS** é zona húmida (12), não espelho de água.
- o boletim tem **prova de posição**: telhados sobre urbano/agrícola ≥ 50 %.

### Serra inteira (21/09/2026)

`fonte/scripts-dados/coze_serra.py` coze a área de construção em 56 zonas finas
(grelha 8 × 7 ancorada em Manteigas, 0,13° × 0,11°, título pela povoação mais
perto do centro) e salta as que já estão no índice; correr até não sobrar
nenhuma. A vista geral (`serra`, 50 m, sem plantas) é cozida à parte com
`--sem-plantas --sem-curvas --so-caminhos nacional,estrada,rio`. As zonas
grossas (≥ 20 m) têm boletim próprio: coerência de floresta com as finas
aprovadas em vez de textura do ortofoto. **Cuidado com `pkill -f`/`pgrep -f`
em comandos que contenham o próprio padrão** — matou a shell duas vezes; usar
padrões ancorados (`^python3 …`).

Vias: quando existe `sne-dados-fonte/osm-vias/`, o construtor lê as ways do
OSM com o `highway` original (`HIGHWAY` → autoestrada, nacional, municipal,
urbana, rural, estradão, trilho); sem elas, os azulejos com 5 tipos. O motor
infere "urbana" para caminhos sem piso em urbano da COS.
