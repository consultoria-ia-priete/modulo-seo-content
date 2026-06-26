# 🎬 Aula — SEO Content Factory

> Aula CURTA (alvo 12–16 min, é densa). Alex grava ligando a fábrica de conteúdo de um cliente.
> **Pré-produção:** Base instalada; chave fal.ai; plano Higgsfield com créditos; conta Cloudflare + gh.

## Cena 0 — Gancho (0:00–0:45)
"Conteúdo no piloto automático: a IA cria as imagens e os vídeos no padrão da sua marca, e o
cliente aprova num painel antes de publicar. Hoje a gente liga essa fábrica."

## Cena 1 — Cópia + `instalar` (0:45–2:00)
- `Use this template` → clone → `cd` → `claude` → **`instalar`**.

## Cena 2 — fal.ai (imagens) (2:00–5:00)
- Colar a `FAL_KEY` no `~/.claude/.env`.
- Gerar 1 imagem de teste com `creative-factory` → abrir o preview.html. "Já no padrão da marca."

## Cena 3 — Higgsfield (vídeos) (5:00–8:00)
- Primeiro uso → OAuth no navegador. Gerar 1 vídeo curto. "Cinematic/reel saindo da IA."

## Cena 4 — Dashboard no Cloudflare (8:00–13:00)
- `cp wrangler.toml.example wrangler.toml` + preencher.
- Criar KV + D1 + migrations + secrets + `wrangler deploy`.
- Apontar o domínio custom. "Agora você tem o painel de aprovação."

## Cena 5 — Fluxo completo (13:00–15:30)
- Provisionar cliente (`provision-client.py`) → abrir a URL do dashboard.
- Enfileirar peças (`enqueue-creative.py`) → aprovar no painel → publica. "Da geração à publicação, com aprovação no meio."

## Cena 6 — Fechamento
- "Fábrica de conteúdo ligada." Encaixe com as squads de branding/conteúdo. CTA rotativo.

---
### Erros ao vivo
- FAL_KEY não lida → conferir a linha no `.env` (e chmod 600).
- Higgsfield sem créditos → renovar plano.
- `wrangler deploy` reclama de account_id → preencher o wrangler.toml.
- Dashboard 404 → domínio custom não apontado ainda (propagação DNS).
