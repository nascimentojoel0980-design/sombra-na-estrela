# A ocupação do solo, os padrões e as árvores em 3D

**18/09/2026.** Três coisas que andam juntas porque dependem do mesmo dado:
a Carta de Ocupação do Solo. Duas estão prontas a usar hoje; a terceira
depende de refazer os azulejos.

---

## 1. O erro que estava lá dentro

O `fonte/scripts-dados/cos_extrai.py` traduzia os códigos da COS 2025 pela
nomenclatura do **CORINE**. Não é a mesma carta. No CORINE o nível 1 vai até 5;
na COS vai até 9, e a partir do código 3 tudo desliza uma casa:

| código | COS 2025 | o que o script dizia |
|---|---|---|
| 1 | Territórios artificializados | urbano ✔ |
| 2 | Agricultura | agrícola ✔ |
| 3 | Pastagens | **floresta** ✘ |
| 4 | Sistemas agro-florestais | **matos** ✘ |
| 5 | Florestas | **rocha** ✘ |
| 6 | Matos | **água** ✘ |
| 7 | Espaços descobertos | outro (perdido) |
| 8 | Zonas húmidas | outro (perdido) |
| 9 | Corpos de água | outro (perdido) |

Em casa do Joel isso dava **17 manchas de "rocha" que são pinhal** e zero de
floresta. No planalto dava **12 manchas de "água" que são matos** — e é por
isso que uma encosta inteira aparece pintada de azul no mapa topográfico.

### A defesa que passou a existir

O script corrigido não confia só no número. Lê também o **rótulo de texto** da
COS (`cos25v1_n3_l`) e, se o texto contradisser o grupo que o número atribuiu,
**aborta com código 2** e escreve quais foram as combinações em choque.

Medido contra os rótulos reais da COS 2025, um por cada nível 1:

```
erros do mapa velho apanhados pela contraprova: 15 de 15
falsos alarmes contra o mapa novo:               0
```

"Florestas de pinheiro bravo" com o grupo `rocha` já não passa.

### O que o script passou a escrever

Por polígono, em vez de só `g`:

| campo | o que é |
|---|---|
| `c` | dígito de nível 1 da COS (1..9) — **o dado cru, sem interpretação** |
| `g` | grupo legível derivado de `c` |
| `d` | cobertura de copa em % |
| `h` | altura média de copa em m |
| `m` | **1 se `d` e `h` são medidos**, 0 se são valor por defeito da classe |

O `c` existe precisamente porque foi a sua falta que deixou o engano passar:
quem lê `c` decide o agrupamento no estilo e nunca herda uma tradução feita na
construção. O `m` existe pela mesma regra das cotas — *modelado não se disfarça
de medido*.

`d` e `h` só são medidos com `--chm` (modelos de altura de copa LiDAR, que
existem para Manteigas e Fundão). Fora daí são valores por defeito da classe.

```bash
python3 fonte/scripts-dados/cos_extrai.py --gpkg cos/cos2025v1.gpkg \
        --chm lidar/chm_2m_Manteigas.tif lidar/chm_2m_Fundao.tif
```

---

## 2. Seis das nove classes recuperam-se **sem refazer nada**

Isto foi o que apareceu ao preparar a correcção, e muda o calendário.

O `g` errado que está nos azulejos actuais é uma **função** do `c` verdadeiro.
Logo dá-se a volta ao contrário:

```js
const COD = ['coalesce', ['get', 'c'],
  ['match', ['get', 'g'],
    'urbano', 1, 'agricola', 2, 'floresta', 3, 'matos', 4, 'rocha', 5, 'agua', 6, 0]];
```

- Azulejos novos trazem `c` → usa-se `c`.
- Azulejos actuais não trazem → recupera-se do `g` errado.

**Seis classes voltam ao sítio hoje**, com uma alteração só de estilo: urbano,
agrícola, pastagens, agro-florestal, floresta e matos. As três que caíram todas
em `outro` — rocha (7), zonas húmidas (8) e água (9) — não se distinguem umas
das outras e **só voltam com os azulejos refeitos**. A água em área já vem do
OSM por outra camada, por isso a perda visível é sobretudo rocha contra turfeira.

Refazer os azulejos precisa do `cos2025v1_estrela.gpkg` (166 MB) e do
`tippecanoe`. Nenhum dos dois está aqui.

---

## 3. Os padrões

`fonte/scripts-dados/padroes.py` desenha quatro padrões e escreve
`fonte/padroes.json` (**33 KB**, em base64, viajam dentro do HTML — zero rede):

| padrão | azulejo | bytes |
|---|---|---|
| floresta | 72 px | 5 549 |
| montado | 144 px | 11 117 |
| matos | 72 px | 4 018 |
| rocha | 72 px | 4 482 |

Cada símbolo é desenhado nove vezes — a célula e as oito à volta — por isso
encosta sem junção. A prova de costura não compara a coluna 0 com a coluna
N−1 (essas são vizinhas, não iguais, e a diferença entre elas é textura): mede
o **degradé na junção contra o degradé médio lá dentro**. 1,00 = a junção não
se distingue do resto.

```
floresta 0,38   montado 1,02   matos 0,23   rocha 0,93
```

O montado leva azulejo de 144 px porque a 72 o olho apanhava a repetição.

---

## 4. As árvores em 3D

`fonte/arvores3d.js`, **16 KB**, sem three.js. É uma *custom layer* do MapLibre
em WebGL directo: um modelo de árvore de **40 triângulos**, desenhado N vezes
numa **única chamada de desenho** (instancing). 45 000 árvores custam uma
chamada; o que cresce é só o buffer de instâncias, 40 bytes cada.

### O que vem do dado, e o que não vem

| | |
|---|---|
| **onde** | dentro dos polígonos de floresta (`c`=5) e montado (`c`=4), e só lá. Buracos do polígono contam: uma clareira não leva árvores |
| **quantas** | densidade de Poisson `λ = −ln(1 − d/100) / (π r²)` — quantas copas de raio *r* são precisas para tapar *d*% do chão. Montado a 30% dá ~45 árvores/ha, pinhal a 70% dá ~430. São os números reais destes povoamentos |
| **que altura** | `h` da mancha, com variação por árvore. Cada uma tem a sua |
| **a que cota** | a cota do **seu** ponto, perguntada ao mapa. A copa acompanha a encosta |
| **qual espécie** | **NÃO vem do dado.** A COS ao nível 1 não distingue pinhal de carvalhal. A forma (cone ou copa redonda) é decorativa e sorteada por posição |

Medido numa encosta de Manteigas: 31 301 árvores, cotas de **1001,6 a 1698,2 m**
(697 m de desnível), alturas de **10,1 a 17,9 m**, média 14,0.

### A escala, verificada

Vista a pique, onde não há perspectiva a enganar, contando a largura das copas
em píxeis e convertendo pela escala do mapa:

| | esperado (corda média = 0,785 × diâmetro) | medido |
|---|---|---|
| pinhal (14 m × 0,21 × 2 = 5,9 m) | 4,6 m | **4,46 m** |
| montado (8 m × 0,70 × 2 = 11,2 m) | 8,8 m | **9,35 m** |

Dentro de 5%.

### A armadilha da altitude

Nesta versão do MapLibre o `z` que uma *custom layer* recebe **não é altitude
absoluta**: é altitude relativa à cota do centro do mapa, já multiplicada pelo
exagero do relevo. Medido: com o centro a 565 m e exagero 1,3, o transform diz
`elevation = 732,5`; `queryTerrainElevation` devolve 0 no centro, +103,6 num
ponto 84 m mais alto (84 × 1,3 = 109) e −106,9 num ponto 83 m mais baixo.

Calcular a cota por fora punha as árvores **734 m acima do chão**, fora do ecrã
— foi exactamente o que aconteceu à primeira. Por isso a cota não se calcula:
**pergunta-se ao mapa**, que é quem manda no referencial. Guarda-se a cota
absoluta por árvore e tira-se a referência no *shader*, com um uniform lido a
cada fotograma — senão as árvores flutuavam durante o arrasto, quando o centro
muda e o buffer ainda é o de antes.

### Onde se corta

Abaixo do zoom 15 não há árvores: há o padrão 2D. Acima, árvores num raio de
900 m à volta do centro, com desmaio de distância e tecto de 45 000. É divisão
de desenho de mapa, não limitação: ao longe o símbolo lê-se melhor do que a
árvore.

---

## 5. Rocha, mato e água

**19/09/2026.** A mesma camada 3D deixou de ser só árvores. O `tipo` viaja com
cada instância (ranhura 10 do buffer) e é o *shader* que decide a forma:

| tipo | o que é | forma no shader | onde nasce |
|---|---|---|---|
| 0 | árvore | copa entre cone e bola + **tronco**, base da copa a 30–34% da altura | COS 5 (floresta) e 4 (montado) |
| 1 | mato | meia-bola achatada **assente no chão**, sem tronco | COS 6 |
| 2 | rocha | bloco de lado a pique e topo quebrado, sem tronco | COS 7, acima dos 1200 m |

O tronco não desaparece com um `if` à volta do desenho — isso obrigaria a duas
chamadas. Os vértices de tronco colapsam num ponto (`p = vec3(0.0)`) e os
triângulos degenerados não chegam a rasterizar. Continua a ser **uma única
chamada de desenho** para tudo.

### Quantos, e porque não são mais

A relação de Poisson das árvores não serve para mato: para tapar 55% do chão
com moitas de 0,7 m de raio seriam ~4 900 por hectare, e a grelha de 3 m só dá
1 111 pontos por hectare. Em vez de fingir densidade que não cabe, o mato e a
rocha nascem em **tufos maiores numa sub-grelha duas vezes mais larga** (6 m):

| | altura | raio | λ (por m²) | sub-grelha |
|---|---|---|---|---|
| mato | 1,4 m | ~2,2 m | 0,020 | 6 m |
| rocha | 2,2 m | ~2,9 m | 0,012 | 6 m |

A sub-grelha é fixa na posição, como a das árvores: aproximar **acrescenta**,
nunca troca de sítio.

E crescem do chão **mais tarde** do que as árvores — rampa própria, de 15,3 a
16,4 (`uRast`). Um tufo de 1,4 m visto de 800 m é um ponto de um píxel, e mil
pontos de um píxel não são relevo, são sujidade no ecrã: a essa escala quem
diz o que lá está é o padrão 2D, que foi desenhado para se ler assim. Medido numa encosta de Manteigas, o que a sub-grelha
poupa não é pouco:

```
                     mato     rocha
grelha de 3 m       44 394    65 087
sub-grelha de 6 m   10 267    36 386
```

E a rocha nunca nasce dentro de uma albufeira ou lagoa. Enquanto os azulejos
não forem refeitos, o código 7 vem no mesmo saco que as zonas húmidas e a água
(ver secção 1), por isso cada candidato a pedregulho é testado contra os
polígonos da camada `aguaA` antes de entrar — senão apareciam pedras em cima da
Lagoa Comprida.

### A tabela que estava mal na camada das árvores

O `g` dos azulejos velhos traduzia-se com `{rocha:5, matos:4, agua:6, outro:7}`
e **defeito 7**. O defeito apanhava o urbano, o agrícola e as pastagens e
mandava-os todos para rocha. Passou a ser a mesma tabela do `COD` do `app.js`,
com **defeito 0** — o que não se conhece não semeia nada.

### A água

A água não precisa da COS: tem camadas próprias nos azulejos (`aguaA` para
albufeiras e lagoas, `aguaL` para os cursos). O que faltava era ela ler-se com
o relevo ligado e vegetação por cima: o `fill-outline-color` de 1 px
desaparecia. Agora a mancha leva margem com espessura própria (`agua-a-c`) e os
cursos de água engrossam com o zoom em vez de terem a mesma largura em 10 e em
16.

---

## 6. Os percursos por baixo das copas

Com as árvores ligadas, o traçado deixava de se ver. Desenhá-lo por cima de
tudo dava uma linha a flutuar sobre as copas — falso e feio. A solução é a que
existe no terreno: **um trilho é uma faixa sem vegetação**. Nada nasce a menos
de **9 m** do traçado (`CORREDOR`), e o caminho lê-se de qualquer ângulo sem
nenhum truque de desenho.

O corredor não pode depender do azulejo das rotas ter chegado. Se a célula for
construída antes disso fica guardada **com árvores em cima do caminho, para
sempre** — e foi o que aconteceu à primeira. Por isso o traçado vem da lista
que a aplicação já tem toda em memória (`tracadosTodos()`, sobre `D.routes`),
que nunca muda; os azulejos ficam só como recurso, e se alguma célula chegou a
ser construída sem traçados, a cache é deitada fora uma vez.

### Medido

Mesma vista, mesma semente, só o corredor a mudar. Contam-se os píxeis quase
brancos (o realce do percurso — dentro de um bosque não há mais nada quase
branco no ecrã):

| vista | sem corredor | com 9 m | |
|---|---|---|---|
| Alvoco (68% de copa), z16,4 **a pique** | 1 972 px | **2 492 px** | ×1,26 |
| Alvoco, z16,4 **inclinado a 40°** | 1 426 px | **1 925 px** | ×1,35 |
| Margaraça (97,6% de copa), z16 inclinado a 45° | 65 px | **106 px** | ×1,63 |

A pique o traçado deixa de vir aos bocados: a linha atravessa a mancha inteira
sem copas em cima. Custa 956 árvores de 20 481 — **menos de 5%**.

Fica dito o que isto **não** resolve: com a câmara muito deitada, um troço
distante continua a desaparecer atrás de copas que estão à frente dele — em
Margaraça, com 97,6% de copa, o caminho lê-se como um rasgo e não como uma
linha. Isso não é defeito de desenho, é o que se veria no sítio.

---

## 7. O que falta

- **Refazer os azulejos** com o `cos_extrai.py` corrigido. Precisa do gpkg de
  166 MB e do `tippecanoe`. Até lá, as três classes perdidas continuam perdidas
  e `d`/`h` continuam a ser valor por defeito da classe em todo o lado.
- ~~Ligar isto à aplicação.~~ **Feito.** A biblioteca é
  `fonte/arvores3d.js` e é a **única fonte**: o
  `fonte/scripts-dados/inline_arvores.py` mete-a dentro do `fonte/app.js` e do
  `fonte/sombra-na-estrela.html` entre as mesmas duas fronteiras, e falha alto
  se não as encontrar. Nunca editar a cópia à mão.
- **Medir `d` e `h` a sério** onde há LiDAR — os dois CHM que existem cobrem
  Manteigas e Fundão e estão no pacote que ainda não entrou em ramo nenhum.

## Como se vê

```bash
python3 fonte/scripts-dados/padroes.py        # -> fonte/padroes.json
python3 fonte/scripts-dados/inline_arvores.py # arvores3d.js -> app.js e ao HTML
python3 fonte/build_site.py                   # monta o site na raiz
# servir a raiz do repositorio num servidor que aceite pedidos Range
# (o topo.pmtiles precisa disso; o python3 -m http.server NAO serve)
# e abrir /teste-arvores.html
```
