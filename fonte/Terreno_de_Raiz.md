# Terreno de raiz: uma malha só, cozida, que nunca se reconstrói

**19/09/2026.** Ensaio no **Vale Glaciar de Manteigas**, 11,0 × 12,2 km.

---

## 1. Porque é que as árvores piscavam

A camada 3D do mapa constrói células **enquanto o mapa se mexe**. O que se vê
depende do que deu tempo de construir, e andar para o lado paga células novas.
Isso não se afina — é o desenho do sistema. Quem anda e volta ao mesmo sítio
vê a coisa a montar-se outra vez.

Aqui o problema não se resolve: **apaga-se**. Não há nada a construir enquanto
se anda, por isso não há nada que possa chegar tarde.

---

## 2. As duas peças

### `fonte/scripts-dados/gera_terreno.py` — o cozedor

Pega numa caixa do mapa e escreve **um ficheiro**:

| o que leva | como |
|---|---|
| cotas | grelha da caixa inteira, quantizada a 16 bits |
| classe do solo | grelha fina, um byte por célula; **bit 7** = corredor do percurso |
| percursos | o traçado, em graus |

O corredor **não apaga a classe**: se apagasse, o chão do trilho ficava pintado
de "nada" e o caminho aparecia como uma risca branca de 18 m de largo. A classe
fica; o bit 7 só diz que ali não nasce nada.

```
python3 fonte/scripts-dados/gera_terreno.py --nome manteigas \
    --caixa -7.62 40.31 -7.49 40.42 --passo 25 --classe 8
```

Medido:

```
caixa   11,0 x 12,2 km
cotas   442 x 487   (passo 25 m)   = 215 254 nós
classe  1378 x 1520 (célula 8 m)   = 2 094 560 células
cotas de 597,1 a 1992,9 m
floresta 31,6 km2 | matos 63,1 | rocha 32,0 | água 0,29
corredor sem vegetação: 4,00 km2
ficheiro: 2,63 MB por comprimir -> 0,53 MB comprimido
```

**O vale inteiro em meio megabyte.**

### `fonte/terreno.js` + `teste-terreno.html` — o visualizador

WebGL2 directo, sem biblioteca de mapa por baixo. Ao abrir faz **duas coisas,
uma única vez**:

```
ler o ficheiro       32 ms
construir a malha    29 ms     215 254 vértices, 428 652 triângulos
semear a caixa toda 1349 ms  2 915 059 plantas, 35 MB
```

E depois **nada**. Andar, rodar, inclinar e aproximar não tocam em buffer
nenhum.

---

## 3. O que muda com a distância, e o que não muda

2,9 milhões de plantas por fotograma são ~105 milhões de triângulos: não cabe
em telemóvel nenhum. Mas o que se corta **não é uma zona do mapa** — é uma
fracção constante de **cada sítio**.

Cada planta traz um **posto** fixo, sorteado na posição. A fracção desenhada à
distância *d* é `(D0/d)²` com D0 = 250 m, ou seja **o mesmo número de plantas
por píxel em todo o ecrã**. Como o posto é fixo e a distância é contínua, quem
sai é sempre a mesma planta e sai **a murchar**, não a apagar-se.

```
plantas cozidas   2 915 059      (árvores 1 308 190 · mato 1 232 574 · rocha 374 295)
a desenhar         ~84 000       2,9%
triângulos         ~3,4 M        (3,0 M de plantas + 0,43 M de chão)
```

Os blocos de 1 km servem só para não mandar ao cartão o que está atrás da
cabeça. **Não são pedaços carregados à parte**: estão todos no mesmo buffer,
cozidos ao mesmo tempo. Um bloco é um intervalo de índices, nada mais. O WebGL2
não tem `baseInstance`, por isso o prefixo de cada bloco faz-se a mover o ponto
de partida do atributo — três chamadas por bloco, buffer intocado.

### A prova

Andar 1,7 km e voltar pelo mesmo caminho, com rotação pelo meio:

```
antes de andar          semear 1348,6 ms
depois de ir e voltar   semear 1348,6 ms
```

**Zero.** Não se construiu nada. É o mesmo número ao décimo de milissegundo
porque é literalmente o mesmo trabalho, feito uma vez, no arranque.

---

## 4. O LiDAR

**Não está cá.** A rede do contentor não chega à DGT (ver ARMADILHAS 7 no
`CLAUDE.md`), por isso estas cotas são o Copernicus de 30 m que já existe no
`dados/dem.webp`. A grelha sai a 25 m porque abaixo disso não há detalhe: pedir
mais era inventar relevo.

O cozedor já aceita o MDT:

```
python3 fonte/scripts-dados/gera_terreno.py --nome manteigas \
    --caixa -7.62 40.31 -7.49 40.42 --passo 8 --classe 4 \
    --mdt mdt2m_manteigas_wgs84.tif
```

Precisa de três coisas do lado do Joel:

1. **MDT de 2 m da DGT** para estas folhas (modelo do terreno, sem vegetação).
2. Opcionalmente o **CHM** — modelo de altura do coberto — que entra com
   `--chm` e faz com que a altura das árvores passe a ser **medida** em vez de
   valor por defeito da classe. Fica no bloco `ALTV`.
3. Os dois reprojectados para graus, e o `rasterio` instalado:

```bash
pip install rasterio
gdalwarp -t_srs EPSG:4326 mdt2m.tif  mdt_wgs84.tif
gdalwarp -t_srs EPSG:4326 chm.tif    chm_wgs84.tif
python3 fonte/scripts-dados/gera_terreno.py --nome manteigas \
    --caixa -7.62 40.31 -7.49 40.42 --passo 8 --classe 4 \
    --mdt mdt_wgs84.tif --chm chm_wgs84.tif
```

O que muda com ele, em números desta caixa:

| passo | nós | triângulos de chão |
|---|---|---|
| 25 m (hoje) | 215 254 | 428 652 |
| 8 m | 2 095 900 | 4 188 402 |
| 4 m | 8 379 202 | 16 754 402 |

A 8 m seriam 4,2 M de triângulos de chão se fossem todos desenhados. **Já não
são** — ver a secção 7: com blocos e passo por distância, essa mesma malha
desenha-se com dezenas de milhar. Era a peça que faltava para o LiDAR entrar, e
está feita.

---

## 5. O que o ficheiro traz, bloco a bloco

O ficheiro deixou de ser um cabeçalho fixo e passou a ser uma lista de blocos
de quatro letras. Um ficheiro velho continua a abrir depois de acrescentar
coisas novas, e um ficheiro novo não parte um visualizador velho: o que ele
não conhecer, salta.

| bloco | o que é |
|---|---|
| `BBOX` | a caixa, em graus |
| `COTA` | grelha de cotas, quantizada a 16 bits |
| `CLAS` | classe do solo; **bit 7** = corredor do percurso, não nasce lá nada |
| `ROTA` | traçado dos percursos |
| `CURV` | curvas de nível, com a cota e a marca de mestra |
| `PONT` | cumes, povoações e serviços, com nome |
| `ALTV` | altura da vegetação medida por LiDAR (só com `--chm`) |
| `HORI` | mapa de horizonte — é daqui que sai a **sombra** |

As curvas de nível não se calculam: já vinham nos azulejos com a cota. São
3 393 linhas, 59 827 pontos, e desenham-se com 1 píxel de espessura, que é o
que uma carta faz — engrossá-las punha-as a competir com o percurso.

---

## 6. A sombra é sombra, não sombreado

Para cada nó da grelha e cada uma de 16 direcções, o cozedor mede **a que
altura o terreno tapa o céu**. Ao desenhar, compara-se a altura do sol com
esse ângulo na direcção do sol: se o sol vier mais baixo, aquele ponto está à
sombra de um monte.

```
mapa de horizonte: 16 direcções, 3,44 MB
horizonte médio 10,6 graus, máximo 75,0
```

A posição do sol é a fórmula NOAA, conferida contra valores conhecidos em
Manteigas (40,40° N):

| | altura | azimute |
|---|---|---|
| 21/06 12:00 UTC | 71,7° | 155,8° |
| 21/12 12:00 UTC | 25,8° | 172,8° |
| 21/03 18:00 UTC | 7,3° | 264,1° |

O máximo teórico no solstício de Verão a esta latitude é 73,0°; às 12:00 UTC
ainda não é meio-dia solar ali (é às 12:30), daí os 71,7°. No de Inverno o
máximo teórico é 26,2° contra 25,8° medidos.

Visto no vale, com a mesma câmara: **às 08:30** a encosta alta está ao sol e o
fundo do vale à sombra; **às 17:30**, com o sol a 11° a oeste, o vale inteiro
já caiu atrás da parede. A luz do sol puxa ao amarelo e a do céu ao azul, por
isso a sombra lê-se como sombra e não como um cinzento morto.

---

## 7. Detalhe do chão, sem fendas

A 25 m o chão são 430 mil triângulos e não custa nada. Com o MDT LiDAR a 8 m
passam a 4,2 milhões. Por isso o chão parte-se em blocos de 64×64 e cada bloco
desenha-se com o passo que a distância pedir.

O problema clássico disto são as **fendas**: dois blocos vizinhos com passos
diferentes não encaixam e vê-se o céu pelo meio. A solução aqui não é
escondê-las com saias — é não as deixar acontecer. **A orla de cada bloco é
sempre de passo 1**, seja qual for o passo do miolo, por isso dois vizinhos
partilham exactamente os mesmos vértices na fronteira. Entre a orla fina e o
miolo grosso há uma faixa de leques que costura os dois. Custa uma tira de
triângulos finos por bloco — cerca de 6% — e em troca não há fenda nenhuma com
nenhuma combinação de passos.

| passo | triângulos do chão inteiro |
|---|---|
| 1 | 428 652 |
| 2 | 113 618 |
| 4 | 36 310 |
| 8 | 17 072 |

Medido em uso, com corte pelo tronco de visão por cima:

```
câmara a 6 km   19 120 triângulos em 25 blocos
câmara a 2,2 km 43 472 triângulos em 18 blocos
```

De 428 652 para 19 120 — vinte e duas vezes menos.

---

## 8. O que este ensaio ainda não tem

- **Crescer.** O formato aceita qualquer caixa, mas crescer é **cozer outra
  vez, em terra**, não juntar pedaços em andamento. Duas caixas lado a lado
  carregam-se as duas inteiras e ficam as duas residentes — continua a não
  haver construção a andar, mas a memória soma.
- ~~Levar isto ao mapa a sério.~~ **Feito** — ver secção 9.
- **Velocidade a sério.** Os fotogramas medidos aqui (≈1,4 s) são do
  SwiftShader, que desenha por software neste contentor. **Não dizem nada**
  sobre o telemóvel. O que se mede daqui com sentido é o número de triângulos
  e o trabalho de CPU — e esses estão acima.


---

## 9. No mapa a sério: cozer no navegador

Cozer as 133 caixas dos percursos em terra dava 133 ficheiros de meio MB. Não é
preciso: o telemóvel **já tem** o `dem.webp` e os azulejos. O botão 3D de cada
percurso passa a cozer a caixa do percurso à entrada, com o mesmo formato e o
mesmo motor, sem descarregar nada de novo.

Para isso o `fonte/terreno.js` ganhou um **leitor de MVT em JavaScript** — o
mesmo que o `lepmtiles.py` faz do lado de lá. E a prova de que é mesmo o
mesmo, na caixa de Manteigas:

```
DIFERENÇA nas classes: 0 células de 2 094 560
```

Zero. Byte a byte, a carta de solo cozida no navegador é a que o Python coze.
As cotas batem até à sétima casa (é só arredondamento de float32).

### Quanto custa

`Rota do Javali` (11,14 km, 61% de copa), caixa de 3,0 × 4,6 km:

```
cozer (relevo + solo + sombra)   209 ms
malha                             11 ms
semear                           201 ms
                                 ---
                                 421 ms
plantas cozidas   367 200
a desenhar         16 871 plantas, 22 756 triângulos de chão
```

O mapa de horizonte é a parte cara. Mas é um campo **liso**: entre dois nós a
25 m um do outro não muda quase nada. Então calcula-se numa grelha duas vezes
mais larga e deixa-se a placa gráfica interpolar, que faz isso de borla.

| salto | grelha | tempo | tamanho | horizonte médio |
|---|---|---|---|---|
| 1 | 442×487 | 289 ms | 3,44 MB | 12,2° |
| 2 | 221×244 | **71 ms** | 0,86 MB | 12,1° |
| 3 | 148×163 | 26 ms | 0,39 MB | 11,8° |

Salto 2: quatro vezes menos trabalho, uma décima de grau de diferença.

### A rede de segurança

Se o terreno de raiz não arrancar — sem WebGL2, azulejo em falta, o que for —
cai-se na vista antiga do MapLibre em vez de ficar sem nada. Isto não é
teórico: apanhou um erro meu à primeira (o `terreno3D` mexia no `maplibregl`,
que nessa via nem chega a ser carregado) e o botão continuou a funcionar.


---

## 10. O nome do ficheiro leva a versão do formato

Publiquei o formato 2 e o telemóvel dele continuou a abrir o formato 1, com um
erro que não dizia nada: `Cannot read properties of undefined (reading 'o')` —
o leitor procurava o bloco `BBOX` num ficheiro que não tem blocos nenhuns.

A causa não era o ficheiro nem o `?v=`: era o **service worker**. A regra dele
para tudo o que está em `dados/` é cache primeiro **e com `ignoreSearch`**, ou
seja, a ignorar a própria query. `?v=7` não muda nada para quem ignora a query.

Duas mudanças, e a primeira é a que conta:

1. O ficheiro passa a chamar-se `manteigas-v2.terr.gz`. **O caminho** ele não
   ignora. Sempre que o formato mudar, muda o nome.
2. O leitor recusa um ficheiro de versão < 2 com uma frase que diz o que é e o
   que fazer, em vez de rebentar três linhas mais à frente.

A regra fica: **`?v=` serve para código, não para dados**. Para dados, muda o
caminho.

### E nem isso chegou à primeira

Mudei o nome do ficheiro e ele continuou a ver o mesmo erro. Faltava a peça de
cima: **o HTML também estava em cache**. O GitHub Pages manda `max-age=600`, o
service worker antigo não intercepta esta página (logo não a renova), e por
isso o telemóvel continuava a correr a página de ontem — que pedia o ficheiro
de ontem, com o `terreno.js` de ontem.

Quando há três camadas a guardar coisas (navegador, service worker antigo,
service worker novo por activar), não vale a pena adivinhar qual delas está a
servir o velho. **Muda-se o caminho de tudo:** a página passou de
`teste-terreno.html` para `terreno.html`, o código para `?v=8`, os dados para
`manteigas-v2.terr.gz`. Um caminho novo não está em cache nenhuma, por
definição. O endereço antigo ficou a redireccionar.


---

## 11. A plataforma, pronta a receber

Pediu para deixar a casa montada antes de o mapa chegar. Está.

### O índice é que manda

O cozedor escreve `dados/terreno/index.json` sempre que coze uma zona:

```json
{"zonas": [{"nome": "manteigas", "titulo": "Vale Glaciar de Manteigas",
            "ficheiro": "manteigas-v3.terr.gz", "km": [11.0, 12.2],
            "cota": [597, 1993], "fonte": "Copernicus 30 m",
            "tem": {"curvas": true, "sombra": true, "altura_medida": false}}]}
```

A página lê-o e monta o menu de zonas a partir dele. **Cozer uma zona nova é
só correr o `gera_terreno.py`** — aparece no menu sozinha, sem tocar em código
nenhum:

```bash
python3 fonte/scripts-dados/gera_terreno.py --nome torre \
    --titulo "Torre e Covão d'Ametade" --caixa -7.66 40.29 -7.55 40.37
```

O nome do ficheiro leva a versão do conteúdo (`VERSAO_DADOS`, hoje 3), pela
razão da secção 10: a query o telemóvel sabe ignorar, o caminho não.

### As secções

| secção | o que tem |
|---|---|
| **O que se vê** | percursos · caminhos e trilhos · árvores, mato e rocha · curvas · nomes |
| **Sol** | sombra dos montes (liga/desliga) · dia · hora (barra em baixo) |
| **Densidade** | até que distância vai densidade cheia (120 a 500 m) |
| **Esta zona** | tamanho, cotas, grelha, fonte, e o que custou a desenhar |

A densidade muda **a quente**: é um uniform e o número de instâncias que se
manda desenhar. O buffer não se toca.

E o aviso de que a altura das árvores é modelada, não medida, aparece sozinho
enquanto a zona não trouxer o bloco `ALTV` — some quando o LiDAR entrar.

---

## 12. Onde há caminho não há árvore

Estava só nos percursos. Passa a estar em tudo o que se anda, cada género com
a sua largura limpa de cada lado do eixo:

| género | limpo | desenhado |
|---|---|---|
| nacional | 11 m | 9,0 m |
| estrada | 9 m | 7,0 m |
| estradão | 6 m | 4,5 m |
| caminho | 5 m | 3,0 m |
| trilho | 4 m | 2,2 m |
| percurso | 9 m | 7,0 m |

Na caixa de Manteigas são **2 326 caminhos** além dos 2 843 traçados de
percurso, e o corredor sem vegetação passou de 4,00 para **7,46 km²**.

Os caminhos desenham-se por baixo dos percursos e com as cores da carta 2D —
nacional cor de tijolo, estrada amarela, estradão castanho, caminho cinzento,
trilho vermelho. Um grupo por género, uma chamada de desenho cada, todos do
mesmo buffer.


---

## 13. O caminho por cima das copas, mas não através dos montes

Ele perguntou se a cor do caminho pode passar por cima de tudo o que esteja em
cima dele. Pode — mas a maneira fácil está errada.

Desligar o teste de profundidade põe mesmo o caminho por cima de tudo. **De
tudo**, incluindo das serras: um trilho que se vê do outro lado do vale não é
um mapa, é um raio-X. Fica bonito num ecrã parado e mente assim que se roda.

O que se faz é separar as duas coisas, porque elas são mesmo duas:

- **as copas** não devem tapar o caminho → desliga-se o teste de profundidade;
- **o relevo** deve tapá-lo → trata-se dele à mão.

As fitas passam a desenhar-se em último, sem `DEPTH_TEST`, e cada vértice anda
do olho até si próprio a perguntar à grelha de cotas se o chão passa por cima
da linha. Se passar, aquele bocado não se desenha (`discard`). Doze amostras
por vértice, e as pontas não contam — senão a própria encosta onde o caminho
assenta tapava-o.

Para isso o *shader* precisa de saber o relevo, por isso a grelha de cotas
sobe também como textura (`R16UI`, `texelFetch`, sem filtragem — é uma pergunta
ao dado, não uma imagem).

### Visto nas duas pontas

Num sítio com **100% de floresta à volta do percurso**, câmara deitada a 330 m:
com o interruptor desligado, a metade de baixo do ecrã não tem uma única linha
— o traçado, o estradão e a estrada estão todos debaixo das copas. Ligado,
atravessam a mancha inteira.

E na parede do vale, a olhar para o cume: **acima da linha do horizonte não
aparece nada**. O que está do outro lado continua do outro lado.

(O contador de píxeis que escrevi para medir isto deu zero nos quatro casos:
lia o `readPixels` fora do fotograma, com o canvas sem `preserveDrawingBuffer`.
A prova são as imagens, não aquele número.)

Fica no menu como **Sempre à vista**, ligado por defeito. Desligado, as fitas
voltam a desenhar-se antes das plantas e o z-buffer trata de tudo, que é o
comportamento honesto de quem quer ver a floresta como ela é.
