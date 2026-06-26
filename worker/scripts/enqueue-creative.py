#!/usr/bin/env python3
"""enqueue-creative.py — Enfileira carrosseis no Worker seocontent.

Le JSONs + cdn-urls.json de uma data específica (gerada pelo pipeline-daily)
e faz POST pro Worker /admin/queue com scheduled_for em UTC ISO 8601.

Uso:
    python3 enqueue-creative.py <date> [--status pending|approved] [--publish-date YYYY-MM-DD]

Ferramenta do Claude Code (não roda via launchd). E' chamada manualmente
quando precisamos sincronizar peças geradas com o Worker.
"""
import sys
import os
import json
import argparse
import datetime
import urllib.request
import urllib.error
import ssl

# Config via env (sem hardcode). Defina antes de rodar:
#   SEOCONTENT_WORKER_URL    = https://seocontent.SEU-DOMINIO.com
#   SEOCONTENT_PIPELINE_ROOT = <pasta do cliente>/squads/conteudo-viral/output/pipeline-daily
#   SEOCONTENT_CLIENT_SLUG   = <slug do cliente>
WORKER_URL = os.environ.get("SEOCONTENT_WORKER_URL", "https://seocontent.SEU-DOMINIO.com")
PIPELINE_ROOT = os.environ.get(
    "SEOCONTENT_PIPELINE_ROOT",
    os.path.join(os.getcwd(), "squads/conteudo-viral/output/pipeline-daily"),
)
CLIENT_SLUG = os.environ.get("SEOCONTENT_CLIENT_SLUG", "meu-cliente")

ctx = ssl.create_default_context()


def load_admin_token():
    # Token do Worker — armazenado em ~/.claude/secrets/ pra ficar com Claude Code env
    candidates = [
        os.path.expanduser("~/.claude/secrets/seocontent-admin.txt"),
        "/Users/Shared/alexpriete-publisher/seocontent-admin-token.txt",
    ]
    for p in candidates:
        if os.path.exists(p):
            return open(p).read().strip()
    raise SystemExit("ERRO: ADMIN_TOKEN nao encontrado em ~/.claude/secrets/seocontent-admin.txt")


SLOT_HOUR_BRT = {"12h00": 12, "18h00": 18, "21h00": 21}


def brt_to_utc_iso(date_iso: str, hour_brt: int) -> str:
    # BRT = UTC-3, sem DST
    dt_brt = datetime.datetime.fromisoformat(f"{date_iso}T{hour_brt:02d}:00:00")
    dt_utc = dt_brt + datetime.timedelta(hours=3)
    return dt_utc.strftime("%Y-%m-%dT%H:%M:%SZ")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("date", help="data dos JSONs (YYYY-MM-DD)")
    ap.add_argument("--status", default="pending", choices=["pending", "approved"])
    ap.add_argument("--publish-date", help="quando publicar (YYYY-MM-DD). Default = mesma data.")
    ap.add_argument("--only", help="enfileira só esses IDs (separados por vírgula)")
    args = ap.parse_args()

    day_dir = os.path.join(PIPELINE_ROOT, args.date)
    if not os.path.isdir(day_dir):
        sys.exit(f"ERRO: {day_dir} nao existe")

    cdn_path = os.path.join(day_dir, "cdn-urls.json")
    cdn = json.load(open(cdn_path))

    publish_date = args.publish_date or args.date
    only_ids = set(args.only.split(",")) if args.only else None

    creatives = []
    for cid in sorted(cdn.keys()):
        if only_ids and cid not in only_ids:
            continue
        urls = cdn[cid]
        if not urls or len(urls) != 8 or any(u is None for u in urls):
            print(f"  ! skip {cid}: URLs invalidos")
            continue
        json_path = os.path.join(day_dir, f"{cid}.json")
        if not os.path.exists(json_path):
            print(f"  ! skip {cid}: json ausente")
            continue
        cdata = json.load(open(json_path))
        slot = cdata.get("slot_brt", "").strip()
        hour = SLOT_HOUR_BRT.get(slot)
        if hour is None:
            print(f"  ! skip {cid}: slot invalido {slot!r}")
            continue
        scheduled_utc = brt_to_utc_iso(publish_date, hour)
        creatives.append({
            "id": cid,
            "tema": cdata.get("tema", ""),
            "caption": cdata.get("caption", ""),
            "urls": urls,
            "slot_brt": slot,
            "scheduled_for": scheduled_utc,
            "scheduled_for_display": f"{publish_date} {hour:02d}:00 BRT",
            "data_publicacao": publish_date,
            "status": args.status,
        })
        print(f"  + {cid} ({slot}) → {scheduled_utc} ({args.status})")

    if not creatives:
        sys.exit("Nada pra enfileirar")

    payload = {"slug": CLIENT_SLUG, "creatives": creatives}
    token = load_admin_token()
    body = json.dumps(payload).encode()
    req = urllib.request.Request(
        f"{WORKER_URL}/admin/queue",
        data=body, method="POST",
        headers={
            "Content-Type": "application/json",
            "X-Admin-Token": token,
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 seocontent-tools/1.0",
            "Accept": "application/json",
        },
    )
    try:
        r = urllib.request.urlopen(req, context=ctx, timeout=30)
        print(f"\n✓ {json.loads(r.read())}")
    except urllib.error.HTTPError as e:
        sys.exit(f"\n✗ HTTP {e.code}: {e.read().decode()[:300]}")


if __name__ == "__main__":
    main()
