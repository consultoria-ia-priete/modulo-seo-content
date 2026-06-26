#!/usr/bin/env python3
"""provision-client.py — Provisiona um novo cliente no seocontent worker.

Lê brand-profile.json do cliente em PROJETOS_CLAUDE_CODE, gera token único,
escreve no KV via wrangler CLI, e (opcional) cria menu link na sub-conta CRM Funnels.

Uso:
    python3 provision-client.py <slug> [--create-ghl-menu]

Slug deve bater com o diretório do cliente (ex: "alex-sscia", "floor-to-ceiling").

Pré-requisitos:
- wrangler instalado (npm install)
- KV namespace STATE criado (wrangler kv namespace create STATE)
- Worker já deployado (wrangler deploy)
"""
import argparse
import json
import os
import secrets
import subprocess
import sys
from pathlib import Path

PROJECTS_ROOT = Path(os.environ.get("PROJECTS_ROOT", Path.home() / "Documents" / "PROJETOS_CLAUDE_CODE"))
# Onde está este worker (default: o próprio repo do módulo, dois níveis acima de scripts/).
WORKER_DIR = Path(os.environ.get("SEOCONTENT_WORKER_DIR", Path(__file__).resolve().parent.parent))
# Domínio público do seu worker (troque pelo seu).
WORKER_URL = os.environ.get("SEOCONTENT_WORKER_URL", "https://seocontent.SEU-DOMINIO.com")

# Slug → diretório do cliente (OVERRIDES pra dirs que não derivam direto do slug).
# Pra clientes novos cujo dir = slug.upper().replace("-","_") (ex: karina-priete →
# KARINA_PRIETE), NÃO precisa registrar aqui — o resolve_client_dir() deriva sozinho.
SLUG_MAP = {
    "alex-sscia": "ALEX_SSCIA",
    "floor-to-ceiling": "FLOOR_TO_CEILING",
    "jrs-flooring": "JRS_FLOORING",
    "ballarin": "BALLARIN SOU VIVER MILAO",
    "allan-priete": "ALLAN_PRIETE",
}


def resolve_client_dir(slug: str) -> Path:
    """Acha o diretório do cliente. Usa SLUG_MAP como override; senão deriva
    do slug (karina-priete → KARINA_PRIETE)."""
    if slug in SLUG_MAP:
        return PROJECTS_ROOT / SLUG_MAP[slug]
    return PROJECTS_ROOT / slug.upper().replace("-", "_")


def kv_put(key: str, value: str):
    cmd = [
        "npx", "wrangler", "kv", "key", "put",
        "--binding=STATE", "--remote",
        key, value,
    ]
    r = subprocess.run(cmd, cwd=WORKER_DIR, capture_output=True, text=True)
    if r.returncode != 0:
        print(f"✗ KV put {key}: {r.stderr}", file=sys.stderr)
        return False
    return True


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("slug", help="slug do cliente (alex-sscia, floor-to-ceiling, etc)")
    parser.add_argument("--rotate-internal", action="store_true", help="rotaciona token_internal (URL CRM Funnels embed)")
    parser.add_argument("--rotate-external", action="store_true", help="rotaciona token_external (link cliente)")
    parser.add_argument("--rotate-all", action="store_true", help="rotaciona ambos os tokens")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    slug = args.slug
    client_dir = resolve_client_dir(slug)
    if not client_dir.exists():
        print(f"✗ diretório do cliente não existe: {client_dir}", file=sys.stderr)
        print(f"  (slug '{slug}' deriva pra '{client_dir.name}'; registre em SLUG_MAP se o dir for diferente)", file=sys.stderr)
        sys.exit(1)

    bp_path = client_dir / "_opensquad" / "_memory" / "brand-profile.json"
    if not bp_path.exists():
        print(f"✗ brand-profile.json não existe: {bp_path}", file=sys.stderr)
        sys.exit(2)

    bp = json.load(open(bp_path))
    # Lê CRM Funnels API key: 1º do ghl-credentials.md, senão fallback pro .mcp.json
    import re
    creds_path = client_dir / "_opensquad" / "_memory" / "ghl-credentials.md"
    ghl_api_key = None
    if creds_path.exists():
        m = re.search(r"pit-[a-f0-9-]{36}", creds_path.read_text())
        if m:
            ghl_api_key = m.group(0)
    if not ghl_api_key:
        mcp_path = client_dir / ".mcp.json"
        if mcp_path.exists():
            try:
                mcp = json.load(open(mcp_path))
                k = mcp.get("mcpServers", {}).get("gohighlevel", {}).get("env", {}).get("GHL_API_KEY", "")
                if k and not k.startswith("{{"):
                    ghl_api_key = k
            except Exception:
                pass
    meta = {
        "slug": slug,
        "name": bp.get("client", {}).get("name") or bp.get("brand", {}).get("main"),
        "brand": bp.get("brand", {}).get("main"),
        "ghlLocationId": bp.get("publishing", {}).get("ghl_location_id"),
        "ghlUserId": bp.get("publishing", {}).get("ghl_user_id"),
        "ghlApiKey": ghl_api_key,
        "accountIds": bp.get("publishing", {}).get("ghl_account_ids", {}),
        "platforms": bp.get("publishing", {}).get("default_platforms", ["instagram"]),
    }

    # Lê tokens existentes pra decidir rotacionar ou manter
    def _kv_get(key):
        r = subprocess.run(
            ["npx", "wrangler", "kv", "key", "get", "--binding=STATE", "--remote", key],
            capture_output=True, text=True, cwd=WORKER_DIR
        )
        if r.returncode != 0 or "Value not found" in (r.stdout + r.stderr):
            return None
        # wrangler imprime o valor cru no stdout
        return r.stdout.strip().split("\n")[-1] if r.stdout.strip() else None

    rotate_internal = args.rotate_internal or args.rotate_all
    rotate_external = args.rotate_external or args.rotate_all
    existing_internal = _kv_get(f"client:{slug}:token_internal")
    existing_external = _kv_get(f"client:{slug}:token_external")
    legacy = _kv_get(f"client:{slug}:token")

    # Migração: se tem só legacy `token`, vira `token_internal`
    if not existing_internal and legacy:
        existing_internal = legacy

    token_internal = secrets.token_urlsafe(48) if (rotate_internal or not existing_internal) else existing_internal
    token_external = secrets.token_urlsafe(48) if (rotate_external or not existing_external) else existing_external

    url_internal = f"{WORKER_URL}/{slug}?t={token_internal}"
    url_external = f"{WORKER_URL}/{slug}?t={token_external}"

    print(f"=== Provisioning {slug} ===")
    print(f"  Cliente:    {meta['name']}")
    print(f"  Marca:      {meta['brand']}")
    print(f"  CRM Funnels loc:    {meta['ghlLocationId'] or '(faltando)'}")
    print(f"  CRM Funnels API key: {('pit-...' + meta['ghlApiKey'][-6:]) if meta['ghlApiKey'] else '(NÃO ENCONTRADA — Worker usará env.GHL_API_KEY)'}")
    print(f"  Plataformas: {', '.join(meta['platforms'])}")
    print()
    print(f"  🔒 token_internal (CRM Funnels embed): {token_internal[:8]}...{token_internal[-4:]} {'⟳ NOVO' if rotate_internal or token_internal != existing_internal else '(mantido)'}")
    print(f"  🌐 token_external (link cliente): {token_external[:8]}...{token_external[-4:]} {'⟳ NOVO' if rotate_external or token_external != existing_external else '(mantido)'}")
    print()

    if args.dry_run:
        print("(dry-run — nada foi escrito)")
        return

    ok1 = kv_put(f"client:{slug}:meta", json.dumps(meta))
    ok2 = kv_put(f"client:{slug}:token_internal", token_internal)
    ok3 = kv_put(f"client:{slug}:token_external", token_external)
    if ok1 and ok2 and ok3:
        print(f"\n✓ Provisionado em KV (3 chaves: meta + token_internal + token_external)")
        print(f"\n📌 URL pra colar no Custom Menu Link da sub-conta CRM Funnels (FIXA):")
        print(f"   {url_internal}")
        print(f"\n📨 URL pra mandar pro cliente via WhatsApp/email (ROTACIONÁVEL):")
        print(f"   {url_external}\n")
    else:
        print("\n✗ Falha em pelo menos 1 KV put — confira wrangler login + namespace STATE")
        sys.exit(3)


if __name__ == "__main__":
    main()
