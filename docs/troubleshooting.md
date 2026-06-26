# 🆘 Troubleshooting — SEO Content Factory

### Sintoma: a fal.ai não gera (chave não lida)
**Causa:** `FAL_KEY` ausente/errada no `~/.claude/.env`.
**Conserto:** confira a linha `FAL_KEY=...` no `~/.claude/.env` (sem aspas, sem espaços),
`chmod 600 ~/.claude/.env`, e reabra o Claude Code.

### Sintoma: Higgsfield falha / não autoriza
**Causa:** OAuth não feito, ou plano sem créditos.
**Conserto:** no primeiro uso, autorize no navegador. Confira créditos no painel do Higgsfield.

### Sintoma: `wrangler deploy` reclama de account_id / binding
**Causa:** `wrangler.toml` não preenchido (você copiou o `.example` mas não trocou os IDs).
**Conserto:** preencha `account_id`, o domínio, o `id` do KV e o `database_id` do D1.
Crie os recursos com `wrangler kv namespace create STATE` e `wrangler d1 create agency-platform-db`.

### Sintoma: dashboard dá 404 / não abre no domínio
**Causa:** domínio custom não apontado pro worker, ou DNS ainda propagando.
**Conserto:** configure o domínio custom na Cloudflare apontando pro worker; aguarde a propagação.

### Sintoma: `provision-client.py` / `enqueue-creative.py` batem no domínio errado
**Causa:** variáveis de ambiente não setadas.
**Conserto:** `export SEOCONTENT_WORKER_URL="https://seocontent.SEU-DOMINIO.com"` (e
`SEOCONTENT_CLIENT_SLUG`, `SEOCONTENT_PIPELINE_ROOT` quando aplicável) antes de rodar.
