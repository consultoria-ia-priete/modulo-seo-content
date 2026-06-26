#!/usr/bin/env bash
# scan-secrets.sh — Varredura de segredos antes de versionar o SEU trabalho.
#
# Uso:  bash scan-secrets.sh [DIR]      (default: diretório atual)
#
# Detecta padrões GENÉRICOS de chave/segredo (não guarda dado de ninguém).
# Sai != 0 se achar algo — rode antes de qualquer `git push`.
set -uo pipefail
DIR="${1:-.}"
RED=$'\033[0;31m'; GRN=$'\033[0;32m'; NC=$'\033[0m'

EXCLUDES=(--exclude-dir=.git --exclude-dir=node_modules --exclude-dir=.wrangler
  --exclude-dir=dist --exclude-dir=build --exclude="*.example" --exclude="*.bak"
  --exclude="*.lock" --exclude="package-lock.json" --exclude="scan-secrets.sh")

# label|||regex (ERE). Apenas padrões genéricos — zero valor hardcoded.
PATTERNS=(
  "Chave de API tipo CRM (pit-)|||pit-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}"
  "Token de acesso Meta (EAA)|||EAA[A-Za-z0-9]{20,}"
  "Refresh token Google (1//)|||1//[0-9A-Za-z_-]{30,}"
  "Client secret Google (GOCSPX-)|||GOCSPX-[A-Za-z0-9_-]{10,}"
  "AWS access key (AKIA)|||AKIA[0-9A-Z]{16}"
  "Chave privada (BEGIN PRIVATE KEY)|||-----BEGIN[[:space:]]+(RSA[[:space:]]+)?PRIVATE[[:space:]]+KEY-----"
  "fal.ai key com valor|||FAL_KEY[[:space:]]*=[[:space:]]*[0-9a-f]{8}"
  "Bearer token longo|||[Bb]earer[[:space:]]+[A-Za-z0-9._-]{30,}"
  "Slack/token genérico (xox)|||xox[baprs]-[A-Za-z0-9-]{10,}"
)

echo "🔎 scan-secrets em: ${DIR}"
echo "─────────────────────────────────────────────"
FOUND=0
for entry in "${PATTERNS[@]}"; do
  label="${entry%%|||*}"; regex="${entry##*|||}"
  hits="$(grep -rInE "${EXCLUDES[@]}" -- "$regex" "$DIR" 2>/dev/null)"
  if [[ -n "$hits" ]]; then
    FOUND=1; echo "${RED}✗ ${label}${NC}"; echo "$hits" | sed 's/^/    /'; echo ""
  fi
done
echo "─────────────────────────────────────────────"
if [[ "$FOUND" -ne 0 ]]; then
  echo "${RED}✗ Achei possível segredo. NÃO faça push até remover/trocar por placeholder.${NC}"
  echo "  Lembre: .mcp.json, .env* e segredos NUNCA vão pro git (o .gitignore já cobre)."
  exit 1
fi
echo "${GRN}✓ Limpo: nenhum segredo detectado.${NC}"
exit 0
