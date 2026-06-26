# SEO Content Factory — âncora do Claude Code

## O que é este repositório

Módulo da **fábrica de conteúdo com IA**: gera imagens (fal.ai, skill `creative-factory`) e
vídeos (Higgsfield, skill `higgsfield-content`) a partir das squads de conteúdo, com um
**dashboard de aprovação** (Cloudflare Worker em `worker/`) onde o cliente aprova antes de publicar.

**Requer a Base instalada** (as skills de geração já estão em `~/.claude/skills/`). Este módulo
**configura** essas skills e faz o **deploy do worker**.

O aluno **não programa**. Fale simples, um passo por vez, espere o "ok".

## Triage

| O aluno diz… | Você faz |
|---|---|
| "instalar", "ligar a fábrica de conteúdo", "configurar SEO content", "começar" | Invoca **`install-seo-content`** |
| "gerar imagem/carrossel" | Usa a skill global `creative-factory` |
| "gerar vídeo/reel" | Usa a skill global `higgsfield-content` |
| "provisionar cliente no dashboard" | `worker/scripts/provision-client.py` |
| "deu erro", "não gera", "deploy falhou" | Lê `docs/troubleshooting.md` |

## Princípios

- Aprovação **sempre** via dashboard (o cliente aprova antes de publicar).
- `FAL_KEY` em `~/.claude/.env` (chmod 600); Higgsfield via OAuth. Nada de chave no repo.
- `worker/wrangler.toml` (IDs reais) e `.env` no `.gitignore`. `scan-secrets.sh` antes de push.

## Mapa do repositório

| Caminho | Propósito |
|---|---|
| `.claude/skills/install-seo-content/SKILL.md` | Instalador guiado (config + deploy) |
| `worker/` | Cloudflare Worker do dashboard de aprovação (src, migrations, scripts, public) |
| `worker/wrangler.toml.example` | Modelo de config (copie pra wrangler.toml e preencha) |
| `worker/scripts/provision-client.py` | Provisiona um cliente no dashboard |
| `worker/scripts/enqueue-creative.py` | Enfileira peças geradas pra aprovação |
| `aula/`, `docs/` | Aula + troubleshooting/windows |

## Plataforma
macOS por padrão; Windows: `docs/windows.md`.
