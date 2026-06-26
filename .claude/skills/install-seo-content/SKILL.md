---
name: install-seo-content
description: "Liga a fábrica de conteúdo com IA: configura a fal.ai (imagens) e o Higgsfield (vídeos) e faz deploy do dashboard de aprovação (Cloudflare Worker). Use quando o aluno disser 'instalar', 'configurar SEO content', 'ligar a fábrica de conteúdo', 'gerar imagens/vídeos', 'começar'. Requer a Base instalada."
---

# Skill: install-seo-content — Sua fábrica de conteúdo com IA

Você está ligando a **SEO Content Factory** do aluno: gerar imagens (fal.ai) e vídeos
(Higgsfield) a partir das squads de conteúdo, com um **dashboard de aprovação** no Cloudflare
onde ele aprova antes de publicar. O aluno **não programa** — fale simples, um passo por vez.

> Pré-requisito forte: a **Base** já instalada (as skills `creative-factory` e
> `higgsfield-content` já estão em `~/.claude/skills/`). Esta skill **configura** essas skills
> e faz o **deploy do worker** — ela não reinstala as skills.

Ao final, o aluno terá: fal.ai com chave configurada, Higgsfield autorizado, e o worker de
aprovação no ar (`seocontent.SEU-DOMINIO.com`) com o primeiro cliente provisionado.

## Passo 0 — Pré-requisitos

- **Base** instalada (skills globais + uma pasta de agência).
- Conta **fal.ai** (pega a API key em fal.ai/dashboard/keys).
- Plano **Higgsfield** ativo (a geração de vídeo consome créditos).
- Conta **Cloudflare** + `gh` logado + Node (`npx wrangler`).

## Passo 1 — fal.ai (imagens)

A skill `creative-factory` lê a chave de `~/.claude/.env`. Configure:
```bash
mkdir -p ~/.claude && touch ~/.claude/.env && chmod 600 ~/.claude/.env
# adiciona a linha se não existir:
grep -q '^FAL_KEY=' ~/.claude/.env || echo 'FAL_KEY=<sua-chave-fal>' >> ~/.claude/.env
```
Valide gerando 1 imagem de teste com a skill `creative-factory` (ela monta o preview.html).
"Olha sua primeira imagem saindo da IA, já no padrão da sua marca."

## Passo 2 — Higgsfield (vídeos)

A skill `higgsfield-content` usa o MCP `https://mcp.higgsfield.ai/mcp` (já no `.mcp.json`
do template). No **primeiro uso**, o Higgsfield pede **OAuth no navegador** — autorize.
Confirme que o plano tem créditos. Gere 1 vídeo curto de teste pra validar.

## Passo 3 — Deploy do dashboard de aprovação (Cloudflare Worker)

O worker vive em `worker/`. Configure e suba:
```bash
cd worker
cp wrangler.toml.example wrangler.toml   # preencha account_id, domínio, KV id, D1 id
npm install
npx wrangler login

# Criar recursos (copie os IDs retornados pro wrangler.toml):
npx wrangler kv namespace create STATE
npx wrangler d1 create agency-platform-db
npx wrangler d1 migrations apply agency-platform-db --remote

# Secrets do worker:
npx wrangler secret put ADMIN_TOKEN      # gere um: openssl rand -hex 32 (salve em ~/.claude/secrets/seocontent-admin.txt)
npx wrangler secret put GHL_API_KEY      # a chave do CRM Funnels (se for publicar pelo worker)

npx wrangler deploy
```
> `wrangler.toml` (com IDs reais) está no `.gitignore` — não vai pro GitHub.
> Configure o domínio custom no painel da Cloudflare apontando pro worker.

## Passo 4 — Provisionar o primeiro cliente no dashboard

```bash
export SEOCONTENT_WORKER_URL="https://seocontent.SEU-DOMINIO.com"
python3 worker/scripts/provision-client.py <slug-do-cliente>
```
Gera o token único e a URL do dashboard do cliente. Mostre ao aluno a URL abrindo.

## Passo 5 — Fluxo completo (a prova)

1. Uma squad de conteúdo gera as peças (ex: `conteudo-viral`, `viral-reels-seo`).
2. Enfileira no worker:
   ```bash
   export SEOCONTENT_WORKER_URL="https://seocontent.SEU-DOMINIO.com"
   export SEOCONTENT_CLIENT_SLUG="<slug>"
   python3 worker/scripts/enqueue-creative.py <YYYY-MM-DD>
   ```
3. O cliente abre o dashboard → vê pending → **aprova** → o worker publica (via CRM Funnels).

## Validação final

- [ ] `FAL_KEY` em `~/.claude/.env` + 1 imagem de teste gerada (creative-factory)
- [ ] Higgsfield autorizado (OAuth) + 1 vídeo de teste
- [ ] Worker deployado (`npx wrangler deploy` ok) + D1/KV criados + secrets setados
- [ ] Cliente provisionado, dashboard abre
- [ ] Fluxo gerar → enfileirar → aprovar testado ao menos 1 vez
- [ ] `scripts/scan-secrets.sh .` = 0 hits (wrangler.toml e .env fora do git)

Marque com o aluno cada item de `aula/checklist.md`.

## Troubleshooting

`docs/troubleshooting.md`. Comuns: FAL_KEY não lida (chmod/linha errada no .env), Higgsfield
sem créditos, `wrangler deploy` sem account_id (preencher o wrangler.toml), dashboard 404
(domínio custom não apontado).
