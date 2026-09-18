#!/usr/bin/env bash
# Publica o site no GitHub Pages. Correr no Git Bash, dentro da pasta do repositorio.
set -u
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GHUSER="nascimentojoel0980-design"
REPO="https://github.com/$GHUSER/sombra-na-estrela.git"
cd "$DIR" || { echo "ERRO: pasta nao encontrada"; exit 1; }

# defesas contra falhas de push neste repositorio (850 MB, ficheiros grandes)
git config --global --add safe.directory "*" 2>/dev/null
git config core.compression 0
git config pack.window 0
git config pack.depth 0
git config pack.threads 1
git config --unset http.postBuffer 2>/dev/null
git config http.version HTTP/1.1
git remote remove origin 2>/dev/null
git remote add origin "$REPO"

if [ -n "$(git status --porcelain)" ]; then
  git add -A
  git commit -q -m "${1:-actualizacao}"
fi

echo "A ver o que ja esta no GitHub..."
git fetch -q origin main 2>/dev/null
REMOTO=$(git rev-parse origin/main 2>/dev/null)
if [ -n "$REMOTO" ]; then
  SHAS=$(git log --format=%H --reverse "$REMOTO..HEAD")
else
  SHAS=$(git log --format=%H --reverse)
fi
if [ -z "$SHAS" ]; then echo "Nada para enviar."; exit 0; fi

# envia commit a commit: tudo de uma vez rebenta a memoria do git
N=$(echo "$SHAS" | wc -l); I=0
for SHA in $SHAS; do
  I=$((I+1))
  echo "[$I/$N] $(git log -1 --format=%s "$SHA")"
  git push origin "$SHA:refs/heads/main" || { echo "FALHOU em $SHA"; exit 1; }
done
git branch --set-upstream-to=origin/main main 2>/dev/null
echo "TUDO ENVIADO. O GitHub Pages reconstroi em 1-3 minutos."
echo "https://$GHUSER.github.io/sombra-na-estrela/"
