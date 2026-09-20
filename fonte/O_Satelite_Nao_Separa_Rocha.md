# O satélite não separa rocha de ardido nesta serra

**20/09/2026.** Um resultado negativo, medido e não afinado. Fica escrito
porque a tentação de o repetir daqui a três meses é grande.

## O que se tentou

Uma cena Sentinel-2 L2A limpa (`S2B_29TPE_20240722`, 0% nuvem, 0% sombra,
0% neve na caixa) e a camada Copernicus HRL Water and Wetness 2018, sobre a
caixa de Manteigas. A regra foi **fixada por escrito antes de ver os dados**,
precisamente para não ser afinada até dar o que se esperava:

```
copa < 0,5 m, e então:
    WAW = 1 ou 2                      -> água
    WAW = 3 ou 4                      -> turfeira
    NDVI baixo + brilho e SWIR altos  -> rocha nua
    NDVI alto                         -> pasto
    o resto                           -> chão nu
```

## O que falhou, e porquê

**Os três histogramas saíram unimodais.** NDVI uma corcova larga em 0,35–0,55,
brilho uma corcova com pico em 0,04–0,06, SWIR uma corcova em 0,20–0,27.
Nenhum vale onde pôr um limiar. O Otsu cortou um contínuo ao meio, que é o que
o Otsu faz quando não há duas populações para separar.

A razão é física e devia ter sido prevista:

- **O granito do planalto, a 1500–1900 m, está coberto de líquenes e cervum em
  Julho.** Dá NDVI ~0,5 e lê-se como pasto.
- **A cinza e o granito exposto pelo fogo de 2022 são claros e secos no SWIR.**
  Dão exactamente a assinatura que a regra pedia para "rocha".

Ou seja, a regra identificava o **ardido**, não a rocha. Medido:

| origem da "rocha" da regra | |
|---|---|
| COS floresta (o raso ardido) | 44 % |
| COS matos | 48 % |
| COS rocha | **7 %** |

E ao contrário: das células que a COS chama rocha (17 km² sem copa), a regra
classificava 10 % como rocha e **68 % como pasto**.

As manchas saíam agrupadas — mas no sítio errado: 981 ha a 1373 m na encosta
ardida do Zêzere, 412 ha noutra encosta ardida, e só 154 ha nos Cântaros a
1931 m, que é rocha a sério.

## O que o satélite **deu**, e fica

Não foi trabalho perdido. Duas coisas passaram e são para usar:

- **Água.** Sentinel NDWI > 0 dá 0,57 km²; a WAW dá 0,57 km²; a intersecção é
  0,50 km², ou seja **89 % de cada**. Duas fontes independentes uma da outra e
  do nosso mapa. A maior massa (28,4 ha, albufeira do Vale do Rossim) tem NDWI
  +0,19 no Sentinel e 0,6° de declive no MDT do LiDAR — três fontes no mesmo
  sítio. Isto resolve a classe água, que estava perdida no saco do `outro`.
- **Confirmação independente do incêndio.** NDVI médio de +0,80 na floresta que
  o CHM confirma de pé, contra +0,39 no raso que a COS ainda chama floresta.
  O laser e o satélite contam a mesma história por caminhos diferentes.

## Turfeiras: a fonte não as tem

A WAW 2018 dá **0,00 km²** de classes 3 e 4 (húmidas) na caixa — 170 píxeis de
10 m no recorte inteiro. As turfeiras da Nave não estão lá. A classe "turfeira"
fica vazia com esta fonte, e não se inventa.

O sucessor (High Resolution Water Layer 2021/2024) é **só água, sem
"wetness"**, e está anunciado para o Q4 de 2026. Não há por onde ir já.

## Uma prova que estava mal desenhada, e a que a substituiu

A prova de georreferenciação pedia que os 68 polígonos da camada `aguaA` dos
nossos azulejos dessem NDWI alto. Falhou — e a culpa era da prova. Esses
polígonos são **ribeiras desenhadas como área**, com metros de largura, em
encostas de 17° de declive médio; só 3 % estão em terreno plano e só um tem
nome. A 10 m por píxel não existem. Nenhum alinhamento correcto faria a prova
passar.

A prova boa é a que está acima: duas fontes de água independentes a caírem no
mesmo sítio. Guardar a lição: **uma prova que não pode passar não prova nada**,
e quem a escreve tem de olhar para o dado antes de o usar como referência.

## O que separa mesmo ardido de rocha

Não está na reflectância de um dia. Está:

1. **no relevo** — um caos de blocos é rugoso à escala de 2–10 m, uma encosta
   ardida é lisa. O MDT de 2 m mede isso e já está no disco;
2. **na mudança** — NBR de uma cena de 2021 contra a de 2024;
3. **no perímetro oficial do ICNF.**

O primeiro foi tentado a seguir, e também falhou. Fica abaixo.

---

# A rugosidade também não separa — e a razão muda o problema

**20/09/2026.** Segunda tentativa, segundo negativo. Medido no mosaico nativo
em EPSG:3763 (2 m exactos em metros), não no reprojectado em graus — a
reamostragem bilinear alisa precisamente aquilo que se quer medir. Janela de
11 × 11 células (raio 10 m), plano por mínimos quadrados, R = desvio-padrão do
resíduo.

| R | Cântaros 1931 m (rocha) | encosta ardida 1373 m |
|---|---|---|
| MDT média / mediana | 0,41 / 0,24 m | 0,40 / **0,32** m |
| MDS média / mediana | 0,42 / 0,24 m | 0,52 / **0,39** m |

**A encosta ardida é mais rugosa que a rocha na mediana, nos dois modelos.**
`P10(rocha) − P90(ardido)` dá −0,67 m no MDT e −0,95 no MDS, quando teria de
ser positivo. Sobreposição total, histograma unimodal outra vez.

O que R mede é **declive**: correlação R–declive de 0,49 no MDT e 0,47 no MDS.
Uma encosta de 20° com quebras métricas deixa mais resíduo a um plano ajustado
em 20 m do que um planalto de blocos de 1 m.

## A razão pela qual isto nunca ia resultar

A mancha de controlo estava mal escolhida — por quem escreveu a prova, não por
quem a executou. A 1880–1980 m, nos domos do planalto, **a rocha da Estrela é
laje lisa de granito, não caos de blocos.** A prova perguntava "a rocha é mais
rugosa que o ardido?" quando esta rocha é, por natureza, das superfícies mais
lisas da serra.

O MDS não trouxe nada de novo onde não há copa, o que também diz uma coisa: a
DGT **não** removeu os blocos ao classificar o solo. Simplesmente não há
blocos ali para medir.

**Duas provas seguidas mal desenhadas pela mesma razão** — escolher a
referência sem olhar primeiro para o que ela é. Primeiro os polígonos `aguaA`,
que são ribeiras de metros de largura em encosta; depois esta mancha, que é
laje. A lição repete-se: *olhar para o dado antes de o usar como referência.*

## O que sobra, e é o caminho certo

Se a rocha é lisa e clara, e o ardido é liso e claro, nenhuma medida de **um
instante** os separa. O que os separa é o que eram **antes**:

- o granito já era granito em 2021;
- a encosta ardida era floresta e matos em 2021.

Uma cena Sentinel-2 de Verão de **2021**, antes do fogo de Agosto de 2022,
resolve por diferença em vez de por limiar:

```
hoje sem copa, e então:
    NDVI 2021 alto  -> tinha vegetação antes -> ardido, não é rocha
    NDVI 2021 baixo -> já era pelado em 2021 -> rocha
```

Não é um limiar num contínuo: é uma mudança, que é o tipo de medida que estes
dois negativos mostraram ser a única que aqui funciona.
