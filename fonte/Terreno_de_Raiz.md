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

Precisa de duas coisas do lado do Joel: o **MDT de 2 m da DGT** para estas
folhas, reprojectado para EPSG:4326 (`gdalwarp -t_srs EPSG:4326`), e a
biblioteca `rasterio` instalada.

O que muda com ele, em números desta caixa:

| passo | nós | triângulos de chão |
|---|---|---|
| 25 m (hoje) | 215 254 | 428 652 |
| 8 m | 2 095 900 | 4 188 402 |
| 4 m | 8 379 202 | 16 754 402 |

A 8 m dá 4,2 M de triângulos de chão sempre desenhados. Junto com os ~3 M das
plantas são 7 M por fotograma — o dobro do que um telemóvel quer. **A 8 m o
chão precisa da mesma ideia que as plantas: níveis cozidos no ficheiro.** Isso
ainda não está feito, e digo-o antes de ele apanhar.

---

## 5. O que este ensaio ainda não tem

- **Níveis de detalhe no chão.** Hoje a malha é uma só resolução. Chega para
  25 m; não chega para LiDAR.
- **Crescer.** O formato aceita qualquer caixa, mas crescer é **cozer outra
  vez, em terra**, não juntar pedaços em andamento. Duas caixas lado a lado
  carregam-se as duas inteiras e ficam as duas residentes — continua a não
  haver construção a andar, mas a memória soma.
- **Nomes, curvas de nível, pontos de interesse, sombra.** Nada disto está no
  ensaio. É um ensaio da estrutura, não um substituto do mapa.
- **Velocidade a sério.** Os fotogramas medidos aqui (≈1,4 s) são do
  SwiftShader, que desenha por software neste contentor. **Não dizem nada**
  sobre o telemóvel. O que se mede daqui com sentido é o número de triângulos
  e o trabalho de CPU — e esses estão acima.
