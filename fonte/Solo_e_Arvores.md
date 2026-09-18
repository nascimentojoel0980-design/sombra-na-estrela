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

## 5. O que falta

- **Refazer os azulejos** com o `cos_extrai.py` corrigido. Precisa do gpkg de
  166 MB e do `tippecanoe`. Até lá, as três classes perdidas continuam perdidas
  e `d`/`h` continuam a ser valor por defeito da classe em todo o lado.
- **Ligar isto à aplicação.** Está tudo em `teste-arvores.html`, à parte, com
  botões para ligar e desligar cada peça. Não mexi no `app.js` nem no
  `sombra-na-estrela.html`.
- **Medir `d` e `h` a sério** onde há LiDAR — os dois CHM que existem cobrem
  Manteigas e Fundão e estão no pacote que ainda não entrou em ramo nenhum.

## Como se vê

```bash
python3 fonte/scripts-dados/padroes.py      # -> fonte/padroes.json
# servir a raiz do repositorio num servidor que aceite pedidos Range
# (o topo.pmtiles precisa disso; o python3 -m http.server NAO serve)
# e abrir /teste-arvores.html
```
