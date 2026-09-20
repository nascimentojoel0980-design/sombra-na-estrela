# Pedido: cozer Manteigas com o MDT LiDAR de 2 m

**Para uma sessão do Claude Code a correr no PC do Joel**, porque o ambiente na
nuvem tem a rede bloqueada à DGT. Medido, não suposto:

```
cartografia.dgterritorio.gov.pt:443   403 ao CONNECT (recusa de política)
geo2.dgterritorio.gov.pt:443          403
snig.dgterritorio.gov.pt:443          403
dados.gov.pt:443                      403
```

Fala com ele em **português de Portugal**, directo e sem rodeios.

---

## O que está feito, e o que falta

A vista 3D (`terreno.html`) já funciona: relevo, floresta, mato, rocha, água,
curvas de nível, nomes, sombra dos montes, percursos e caminhos, localização ao
vivo e estatísticas de trilhos. Tudo isso está publicado e medido.

**Falta uma coisa só:** as cotas são do **Copernicus a 30 m**. Faltam as do
**MDT LiDAR de 2 m da DGT**. Enquanto não entrarem, o menu mostra um aviso a
dizer que a altura das árvores é modelada e não medida — e está certo que o
mostre.

---

## 1. Descarregar

Da DGT, as folhas do **MDT de 2 m** que cobrem esta caixa (Vale Glaciar de
Manteigas / Zêzere):

```
longitude  -7.62 a -7.49
latitude    40.31 a 40.42
```

Se houver **CHM** (modelo de altura do coberto) para as mesmas folhas, traz
também: é o que faz a altura das árvores passar de modelada a **medida**.

Não sei de cor o endereço nem o formato em que a DGT os serve hoje. **Procura,
e diz-lhe o que encontraste antes de descarregar centenas de MB.**

## 2. Preparar

O cozedor exige EPSG:4326. Se vierem várias folhas, mosaico virtual primeiro
(não copia dados, só aponta):

```bash
pip install rasterio
gdalbuildvrt mdt.vrt <pasta-das-folhas>/*.tif
gdalwarp -t_srs EPSG:4326 -r bilinear mdt.vrt mdt_wgs84.tif
gdalwarp -t_srs EPSG:4326 -r bilinear chm.tif chm_wgs84.tif
```

## 3. Cozer

```bash
python3 fonte/scripts-dados/gera_terreno.py --nome manteigas \
    --titulo "Vale Glaciar de Manteigas" \
    --caixa -7.62 40.31 -7.49 40.42 \
    --passo 8 --classe 4 --versao 4 \
    --mdt mdt_wgs84.tif --chm chm_wgs84.tif
```

**Confere o que ele imprime. Não te fies em ele não rebentar:**

- a linha das cotas tem de dizer `MDT <ficheiro>` e **não** `Copernicus 30 m`;
- com `--chm`, tem de aparecer `altura medida onde ha arvores: media X m, maximo Y m`;
- o intervalo de cotas tem de ser plausível para a serra (~590 a ~2000 m).

O `--versao 4` vai no **nome** do ficheiro (`manteigas-v4.terr.gz`), de
propósito: a cache do telemóvel ignora a query `?v=` mas não ignora o caminho
(ver ARMADILHA 10 no `CLAUDE.md`). Sempre que o conteúdo mudar, sobe a versão.

O cozedor actualiza `dados/terreno/index.json` sozinho — é de lá que a
aplicação tira o menu de zonas.

## 4. Publicar só o resultado

O raster pesado **não entra no git**. Só o ficheiro cozido e o índice:

```bash
git add dados/terreno/ && git commit -m "Manteigas com o MDT LiDAR de 2 m" && git push
```

**Esta parte esta ultrapassada: a publicacao passou a ser o
`fonte/PUBLICA_TERRENO.md`.** Em especial, NAO apagues o
`manteigas-v3.terr.gz`: e o recuo se o v4 der problema no telemovel.

## 5. Medir se aguenta

Abre https://nascimentojoel0980-design.github.io/sombra-na-estrela/terreno.html
e olha para a linha **chão** em ☰ → Esta zona.

A `--passo 8` a malha do chão passa de ~430 mil para ~4,2 milhões de
triângulos. Os blocos com passo por distância existem para isso (ver secção 7
do `Terreno_de_Raiz.md`), mas **nunca foram medidos com LiDAR a sério**. Se o
telemóvel se queixar, sobe para `--passo 12` e volta a medir. Não adivinhes.

---

## Regras deste projecto

- **Nunca editar nada na raiz.** `index.html`, `sw.js` e `dados/` são gerados;
  as fontes estão em `fonte/`. O `build_site.py` reescreve a raiz e já deitou
  fora uma correcção por se ter editado o ficheiro errado (ARMADILHA 9).
- Não alterar nem simplificar os ficheiros originais de dados; derivados vão
  sempre em ficheiros à parte.
- Ler `fonte/CLAUDE.md` (ARMADILHAS) e `fonte/Terreno_de_Raiz.md` antes de mexer.
- **Medir antes de afirmar.** Se disseres que funciona, mostra o número.
