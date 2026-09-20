# Publicar o terreno de Manteigas com o LiDAR

Para a sessão que corre no PC do Joel, em `C:\Users\Joel Nascimento\sne`.
Faz isto de uma ponta à outra e responde **uma vez só**, no fim.

O terreno já está cozido (`dados/terreno/manteigas-v4.terr.gz`, 8,31 MB) e a
auditoria da promoção já passou. Falta publicá-lo e confirmar que chegou.

---

## 1. Publicar

```
git pull --rebase origin main
git add dados/terreno/manteigas-v4.terr.gz dados/terreno/index.json
git add fonte/scripts-dados/audita_promocao.py
git status --short
```

**Antes de fazer commit, confirma no `status` que:**

- não aparece nada de `lidar-manteigas/` (são 312 MB, está fora do repositório
  — se aparecer, pára e diz-me)
- não aparece nenhum `.tif`
- o `manteigas-v3.terr.gz` continua lá e **não** foi apagado (é o recuo)

Depois:

```
git commit -m "Manteigas com o LiDAR: relevo a 8 m e altura de copa medida"
git push origin main
```

## 2. Confirmar que chegou mesmo

Espera um ou dois minutos pelo GitHub Pages e verifica pela rede, não pelo
disco:

```
curl -s https://nascimentojoel0980-design.github.io/sombra-na-estrela/dados/terreno/index.json
curl -sI https://nascimentojoel0980-design.github.io/sombra-na-estrela/dados/terreno/manteigas-v4.terr.gz
```

O primeiro tem de dizer `"ficheiro": "manteigas-v4.terr.gz"` e
`"altura_medida": true`. O segundo tem de dar `200` e um `content-length`
à volta de 8,3 MB. Se der 404, o Pages ainda não construiu — espera mais um
minuto e repete. Se ao fim de cinco minutos continuar 404, diz-me.

## 3. Responde uma vez, com

- o que o `git status --short` mostrou antes do commit
- o hash do push
- as duas linhas dos `curl` (o `ficheiro` e o `altura_medida` do índice; o
  código e o `content-length` do segundo)

---

## Não faças

- **não mexas no `fonte/terreno.js` nem no `fonte/sw.js`** — estão tratados do
  outro lado e um `git pull --rebase` por cima de alterações tuas dá conflito
- **não apagues o `manteigas-v3.terr.gz`** — é para onde recuamos se o v4 der
  problema no telemóvel
- **não commites os rasters** (`mdt_wgs84.tif`, `chm_wgs84.tif`, as 312 folhas)
- **não cozas outra zona** sem o Joel pedir

## Se correr mal no telemóvel

Recuar é uma linha: no `dados/terreno/index.json`, pôr outra vez
`"ficheiro": "manteigas-v3.terr.gz"`, `"passo": 25.0`, `"classe": 8.0`,
`"fonte": "Copernicus 30 m"` e `"altura_medida": false`, e empurrar. O
ficheiro v3 continua no sítio, por isso volta a funcionar de imediato.

## O que fica por fazer, para saberes o contexto

1. **O tecto dos 25,5 m.** O bloco `ALTV` guarda decímetros num byte, por isso
   corta aos 25,5 m — 0,50 km² das copas promovidas batem lá. Passar a passos
   de 0,2 m dava tecto de 51 m, mas obriga a mexer nos dois lados (cozedor e
   `terreno.js`) e a recozer. Não é urgente: o motor já sorteia ±28% de altura
   por planta.
2. **Mais zonas.** O cozedor é genérico: outra `--caixa`, outro `--nome`, e o
   menu apanha-a sozinho. Onde não houver LiDAR, coze-se com o Copernicus a
   30 m e o aviso "altura modelada" fica — incluindo o facto de a serra ardida
   aparecer com pinhal de pé, que só o CHM corrige.
