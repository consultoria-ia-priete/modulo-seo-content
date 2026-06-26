# 🌐 seocontent-worker — Dashboard público de aprovação

Cloudflare Worker + Pages que serve `{{SEO_WORKER_DOMAIN}}` —
dashboard embedded na CRM Funnels pra cliente aprovar/rejeitar criativos.

## Arquitetura

```
Mac (produção)              Cloudflare (dashboard + cron)         CRM Funnels (cliente vê)
──────────────              ──────────────────────────────       ──────────────
pipeline-daily 07:15  ───►  POST /admin/queue                     embedded iframe
upload pro CDN              KV: creative:<slug>:<id>              Custom menu link
                            ───►  Cliente aprova/rejeita
                            ───►  Cron 12h/18h/21h
                            ───►  POST CRM Funnels social-posting
```

## Setup inicial (uma vez só)

### 1. Instalar dependências

```bash
cd $PROJECTS_ROOT/_AGENCY/seocontent-worker
npm install
```

### 2. Criar KV namespace

```bash
npx wrangler kv namespace create STATE
```

Output mostra um `id` — copiar pro `wrangler.toml`:

```toml
[[kv_namespaces]]
binding = "STATE"
id = "<id-retornado>"
```

### 3. Configurar secrets

```bash
# CRM Funnels API key — usado pra publicar posts via cron
npx wrangler secret put GHL_API_KEY
# (cola a key pit-... quando pedir)

# Admin token — shared secret entre Mac e Worker pra POST /admin/queue
npx wrangler secret put ADMIN_TOKEN
# (cola um token longo aleatório, ex: openssl rand -hex 32)
```

Salvar o ADMIN_TOKEN também em `/Users/Shared/alexpriete-publisher/seocontent-admin-token.txt`
pro Mac usar nas chamadas POST.

### 4. Deploy do Worker

```bash
npx wrangler deploy
```

Primeiro deploy cria URL `https://seocontent.<account>.workers.dev`.

### 5. Configurar custom domain

**No painel Cloudflare** (https://dash.cloudflare.com → Workers & Pages → seocontent → Settings → Triggers → Custom Domains):

- Adicionar `{{SEO_WORKER_DOMAIN}}`
- Cloudflare detecta que `crmfunnels.app` não está na CF — pede pra adicionar zona

**Na Umbler (DNS de crmfunnels.app):**
- Adicionar registro CNAME: `seocontent` → `<worker>.<account>.workers.dev`
- OU: mover nameservers de crmfunnels.app pra Cloudflare (mais robusto, SSL automático)

Aguardar propagação DNS (~5min).

### 6. Provisionar primeiro cliente

```bash
# Pre-req: cliente tem brand-profile.json com publishing.ghl_location_id preenchido
python3 scripts/provision-client.py alex-sscia
# → output mostra a URL completa pra colar no CRM Funnels Custom Menu
```

Repetir pra cada cliente: `floor-to-ceiling`, `jrs-flooring`, etc.

### 7. Criar Custom Menu Link na sub-conta CRM Funnels

No painel CRM Funnels daquele cliente: **Settings → Custom Menu Links → Add**

- **Name:** "Conteúdo com IA"
- **Icon:** 🎨
- **URL:** cola a URL gerada no passo 6
- **Open as:** Embedded iframe
- **Available for:** All Users (ou roles específicas)

Pronto — cliente vê o menu, clica, aprova/rejeita.

## Operação diária

### Mac registra novos criativos

Após `pipeline-daily.sh` terminar, ele faz POST pro Worker:

```bash
curl -X POST https://{{SEO_WORKER_DOMAIN}}/admin/queue \
  -H "Content-Type: application/json" \
  -H "X-Admin-Token: $(cat /Users/Shared/alexpriete-publisher/seocontent-admin-token.txt)" \
  -d '{
    "slug": "alex-sscia",
    "creatives": [
      {"id": "C38", "tema": "...", "caption": "...", "urls": [...], "scheduled_for": "2026-05-06 12:00 BRT"}
    ]
  }'
```

(integração via hook no daily-pipeline.sh, fica como TODO pós-deploy)

### Cliente aprova

Cliente clica menu na CRM Funnels → vê dashboard embedded → aprova/rejeita.

- **Aprovar:** status vira `approved`. Cron Worker vai publicar quando bater `scheduled_for`.
- **Rejeitar com direção:** status vira `rejected`, `redo_count` incrementa. Mac (MESTRE) vê via /admin/clients e refaz a peça. Pode rejeitar **só 1 vez** por peça (rate limit).

### Worker publica

Cron triggers em 15h/21h/00h UTC = 12h/18h/21h BRT:
- Lê todos approved com `scheduled_for` matching ±30min
- Chama CRM Funnels social-posting API com URLs CDN + caption
- Marca `published`

## Endpoints

| Método | Path | Auth | Função |
|---|---|---|---|
| GET | `/<slug>?t=<token>` | token URL | Dashboard HTML embedded |
| GET | `/api/<slug>/state?t=<token>` | token URL | Lista criativos do cliente |
| POST | `/api/<slug>/state/<id>?t=<token>` | token URL | Aprova/rejeita |
| POST | `/admin/queue` | X-Admin-Token | Mac registra criativos |
| GET | `/admin/clients` | X-Admin-Token | Lista todos clientes + tokens |
| GET | `/health` | público | Healthcheck |

## Troubleshooting

- **403 no dashboard:** token inválido ou expirado. Re-provisionar com `--rotate-token`.
- **Iframe não embeda na CRM Funnels:** verificar `ALLOWED_FRAME_ORIGINS` em wrangler.toml inclui o origin CRM Funnels.
- **Cron não publica:** ver logs `npx wrangler tail`. Confirmar `GHL_API_KEY` setado e `accountIds` no meta do cliente.
- **DNS não propaga:** aguardar até 24h. Usar `dig {{SEO_WORKER_DOMAIN}}` pra confirmar resolução.

## Próximas ondas

- 🌋 Onda 2: aba "Já publicados" + calendar view
- 🌌 Onda 3: comentários slide-a-slide
- ⛓️ Onda 4: auto-criação dos Custom Menu Links via MCP gohighlevel
