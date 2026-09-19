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
- **Levar isto ao mapa a sério.** O botão 3D de cada percurso continua a abrir
  a vista antiga. Cozer uma caixa por percurso dava 133 ficheiros de meio MB;
  o caminho certo é o navegador cozer a caixa do percurso à entrada, a partir
  do `dem.webp` e dos azulejos que já tem — sem descarregar nada de novo.
- **Velocidade a sério.** Os fotogramas medidos aqui (≈1,4 s) são do
  SwiftShader, que desenha por software neste contentor. **Não dizem nada**
  sobre o telemóvel. O que se mede daqui com sentido é o número de triângulos
  e o trabalho de CPU — e esses estão acima.
