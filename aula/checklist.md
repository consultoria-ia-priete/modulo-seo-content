# ✅ Checklist de conclusão — SEO Content Factory

## Pré-requisitos
- [ ] Base instalada (skills creative-factory + higgsfield-content em ~/.claude/skills/)
- [ ] Conta fal.ai (API key) e plano Higgsfield com créditos
- [ ] Conta Cloudflare + Node + `gh`

## fal.ai (imagens)
- [ ] `FAL_KEY` em `~/.claude/.env` (chmod 600)
- [ ] 1 imagem de teste gerada (creative-factory) com preview.html

## Higgsfield (vídeos)
- [ ] OAuth autorizado no primeiro uso
- [ ] 1 vídeo de teste gerado

## Dashboard (Cloudflare Worker)
- [ ] `wrangler.toml` preenchido (account_id, domínio, KV id, D1 id)
- [ ] KV + D1 criados; migrations aplicadas
- [ ] Secrets `ADMIN_TOKEN` (+ `GHL_API_KEY` se publicar) setados
- [ ] `wrangler deploy` ok; domínio custom apontado
- [ ] Cliente provisionado; dashboard abre

## Validação (teste de fogo)
- [ ] Fluxo gerar → enfileirar → aprovar → publicar testado 1x

## Segurança
- [ ] `wrangler.toml` e `.env` fora do git
- [ ] `scripts/scan-secrets.sh .` = 0 hits

## Aula
- [ ] Aula gravada: da config da fal.ai até a aprovação publicando
