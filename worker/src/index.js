/**
 * seocontent-worker — Dashboard de aprovação + Plataforma Interna Agência v1.
 *
 * Endpoints legacy (dashboard cliente):
 *   GET  /<slug>?t=<token>           → serve HTML do dashboard (embedded-ready)
 *   GET  /api/<slug>/state?t=<tok>   → retorna criativos pendentes/recentes do cliente
 *   POST /api/<slug>/state/<id>?t=   → aprova/rejeita (com motivo+direção)
 *   POST /admin/queue                → Mac registra novos criativos (auth via X-Admin-Token)
 *   GET  /admin/clients              → lista clientes + tokens (admin only)
 *
 * Endpoints v1 (Plataforma Interna — D1-backed, X-Admin-Token):
 *   GET   /api/v1/clients                                    → lista clientes
 *   GET   /api/v1/clients/:slug                              → detalhe + integrações + deliverables
 *   PATCH /api/v1/clients/:slug/deliverables/:deliverableId  → orchestrator atualiza estado
 *   POST  /api/v1/state/snapshot                             → Mac envia latest.json (UPSERT)
 *   GET   /api/v1/runs?limit=N                               → últimas runs
 *   POST  /api/v1/runs                                       → orchestrator abre nova run
 *   PATCH /api/v1/runs/:id                                   → finaliza/atualiza run
 *   POST  /api/v1/runs/:id/events                            → registra evento dentro da run
 *
 * Cron triggers (UTC): 15h/21h/00h = 12h/18h/21h BRT.
 *   Cada disparo lê KV approved + scheduled_for matching agora ± 30min,
 *   chama CRM Funnels social-posting API e marca published.
 *
 * KV layout:
 *   client:<slug>:meta              → {name, brand, ghlLocationId, ghlUserId, accountIds}
 *   client:<slug>:token             → token único de 64 chars
 *   creative:<slug>:<id>            → {tema, caption, urls[], status, scheduled_for, redo_count, ...}
 *   creative:<slug>:list            → array de IDs ordenados por data
 */

const REDO_LIMIT = 2;  // Cliente pode pedir até 2 ajustes por peça (1ª tenta IA, 2ª refina)
const MAX_DIRECAO_LEN = 1000;
const MAX_MOTIVO_LEN = 300;

// ─── Helpers ──────────────────────────────────────────────────────────

function jsonResponse(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      ...extraHeaders,
    },
  });
}

function htmlResponse(html, status = 200, allowedOrigins = "") {
  // Permite embedded em qualquer origem (CRM Funnels, white-label, etc)
  // CSP frame-ancestors * aceita qualquer iframe parent. X-Frame-Options omitido
  // (a presença mesmo permissiva pode conflitar com CSP em browsers antigos).
  return new Response(html, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": "frame-ancestors *",
    },
  });
}

async function getClientBySlug(env, slug) {
  const meta = await env.STATE.get(`client:${slug}:meta`, "json");
  return meta;
}

async function validateToken(env, slug, token) {
  if (!slug || !token) return false;
  // Aceita 3 formatos: token (legacy), token_internal (CRM Funnels embed), token_external (link cliente)
  const candidates = await Promise.all([
    env.STATE.get(`client:${slug}:token_internal`),
    env.STATE.get(`client:${slug}:token_external`),
    env.STATE.get(`client:${slug}:token`),  // legacy backward-compat
  ]);
  for (const stored of candidates) {
    if (!stored) continue;
    if (stored.length !== token.length) continue;
    // constant-time compare
    let diff = 0;
    for (let i = 0; i < stored.length; i++) {
      diff |= stored.charCodeAt(i) ^ token.charCodeAt(i);
    }
    if (diff === 0) return true;
  }
  return false;
}

async function getClientCreatives(env, slug) {
  const list = (await env.STATE.get(`creative:${slug}:list`, "json")) || [];
  const items = await Promise.all(
    list.map(async (id) => {
      const item = await env.STATE.get(`creative:${slug}:${id}`, "json");
      return item ? { id, ...item } : null;
    })
  );
  return items.filter(Boolean);
}

// ─── Handlers ─────────────────────────────────────────────────────────

async function handleDashboard(req, env, slug) {
  const url = new URL(req.url);
  const token = url.searchParams.get("t");
  const valid = await validateToken(env, slug, token);
  if (!valid) {
    return htmlResponse(
      `<!doctype html><html><body style="font-family:system-ui;padding:40px;background:#000;color:#fff">
       <h1>🔒 Acesso negado</h1>
       <p>Link inválido ou expirado. Acesse pelo menu da sua sub-conta CRM Funnels.</p>
       </body></html>`,
      403,
      env.ALLOWED_FRAME_ORIGINS || ""
    );
  }
  // Serve HTML do dashboard via static assets
  const asset = await env.ASSETS.fetch(new URL("/index.html", req.url));
  const html = await asset.text();
  // Injeta slug + token no HTML (data attrs no body)
  const injected = html.replace(
    "<body",
    `<body data-slug="${slug}" data-token="${token}"`
  );
  return htmlResponse(injected, 200, env.ALLOWED_FRAME_ORIGINS || "");
}

async function handleGetState(req, env, slug) {
  const url = new URL(req.url);
  const token = url.searchParams.get("t");
  if (!(await validateToken(env, slug, token))) {
    return jsonResponse({ error: "unauthorized" }, 401);
  }
  const meta = await getClientBySlug(env, slug);
  const creatives = await getClientCreatives(env, slug);
  return jsonResponse({ client: meta, creatives, redoLimit: REDO_LIMIT });
}

async function handleSetState(req, env, slug, creativeId, ctx) {
  const url = new URL(req.url);
  const token = url.searchParams.get("t");
  if (!(await validateToken(env, slug, token))) {
    return jsonResponse({ error: "unauthorized" }, 401);
  }
  let body;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "invalid json" }, 400);
  }
  const { status, motivo, direcao } = body;
  if (!["approved", "rejected"].includes(status)) {
    return jsonResponse({ error: "status inválido (use approved/rejected)" }, 400);
  }
  const key = `creative:${slug}:${creativeId}`;
  const item = await env.STATE.get(key, "json");
  if (!item) return jsonResponse({ error: "criativo não encontrado" }, 404);

  // Regra: 1 ajuste max por peça
  if (status === "rejected") {
    const count = item.redo_count || 0;
    if (count >= REDO_LIMIT) {
      return jsonResponse(
        {
          error: `limite de ${REDO_LIMIT} ajuste(s) atingido. Aprove ou descarte definitivamente.`,
          redo_count: count,
        },
        409
      );
    }
    item.redo_count = count + 1;
    item.motivo = (motivo || "").slice(0, MAX_MOTIVO_LEN);
    item.direcao = (direcao || "").slice(0, MAX_DIRECAO_LEN);
  }
  item.status = status;
  item.updated_at = new Date().toISOString();
  await env.STATE.put(key, JSON.stringify(item));

  // Publish-on-approve: se aprovado e SEM scheduled_for futuro, publica imediato (background)
  let publishImmediate = false;
  if (status === "approved" && ctx) {
    const sched = item.scheduled_for ? new Date(item.scheduled_for) : null;
    const now = new Date();
    if (!sched || sched <= now) {
      publishImmediate = true;
      ctx.waitUntil(publishImmediateBackground(env, slug, creativeId, item));
    }
  }
  return jsonResponse({ ok: true, item, publishImmediate });
}

async function publishImmediateBackground(env, slug, creativeId, item) {
  try {
    const meta = await getClientBySlug(env, slug);
    const { results, errors } = await publishToGHL(env, meta, item);
    item.status = "published";
    item.published_at = new Date().toISOString();
    item.published_via = "approve-immediate";
    item.ghl_post_ids = results.map((r) => ({ platform: r.platform, postId: r.postId, accountId: r.accountId, pending_id_backfill: !!r.pending_id_backfill }));
    item.pending_id_backfill = results.some((r) => r.pending_id_backfill);
    if (errors.length) item.publish_partial_errors = errors;
    delete item.publish_error;
    await env.STATE.put(`creative:${slug}:${creativeId}`, JSON.stringify(item));
    console.log(`[approve-immediate] ✓ published ${slug}/${creativeId} (${results.length} platforms)`);
  } catch (e) {
    console.error(`[approve-immediate] ✗ ${slug}/${creativeId}: ${e.message}`);
    item.publish_error = e.message;
    item.status = "approved";
    await env.STATE.put(`creative:${slug}:${creativeId}`, JSON.stringify(item));
  }
}

async function handleAdminQueue(req, env) {
  // Auth via shared secret entre Mac e Worker
  const adminToken = req.headers.get("X-Admin-Token");
  if (!env.ADMIN_TOKEN || adminToken !== env.ADMIN_TOKEN) {
    return jsonResponse({ error: "unauthorized" }, 401);
  }
  let payload;
  try {
    payload = await req.json();
  } catch {
    return jsonResponse({ error: "invalid json" }, 400);
  }
  const { slug, creatives } = payload;
  if (!slug || !Array.isArray(creatives)) {
    return jsonResponse({ error: "missing slug or creatives[]" }, 400);
  }
  const meta = await getClientBySlug(env, slug);
  if (!meta) return jsonResponse({ error: `cliente ${slug} não cadastrado` }, 404);

  // Política cross-cliente 2026-05-11: creative.platforms é obrigatório.
  // Sem isso, publishToGHL faria fallback pra client.platforms e publicaria em
  // canais não declarados (incidente FTC: posts IG/FB vazaram pro GMB).
  for (const c of creatives) {
    if (!c.id) continue;
    if (!Array.isArray(c.platforms) || c.platforms.length === 0) {
      return jsonResponse(
        { error: `creative.platforms é obrigatório e não pode ser vazio (creative ${c.id})` },
        400
      );
    }
  }

  const ids = (await env.STATE.get(`creative:${slug}:list`, "json")) || [];
  for (const c of creatives) {
    if (!c.id) continue;
    const key = `creative:${slug}:${c.id}`;
    const existing = (await env.STATE.get(key, "json")) || {};
    // Status: prioridade c (admin enviou) > existing > default pending
    const merged = {
      ...existing,
      ...c,
      status: c.status || existing.status || "pending",
      redo_count: existing.redo_count || 0,
      created_at: existing.created_at || new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    await env.STATE.put(key, JSON.stringify(merged));
    if (!ids.includes(c.id)) ids.unshift(c.id);
  }
  // Mantém só últimos 200 IDs por cliente
  const trimmed = ids.slice(0, 200);
  await env.STATE.put(`creative:${slug}:list`, JSON.stringify(trimmed));
  return jsonResponse({ ok: true, count: creatives.length, total: trimmed.length });
}

// POST /admin/upload — recebe imagens base64 + metadata, sobe pro CRM Funnels CDN, salva no KV.
// Mac envia 1 chamada com tudo (caption, slides base64), Worker faz upload + queue.
async function handleAdminUpload(req, env) {
  const adminToken = req.headers.get("X-Admin-Token");
  if (!env.ADMIN_TOKEN || adminToken !== env.ADMIN_TOKEN) {
    return jsonResponse({ error: "unauthorized" }, 401);
  }
  if (!env.GHL_API_KEY) return jsonResponse({ error: "GHL_API_KEY not configured" }, 500);

  let payload;
  try {
    payload = await req.json();
  } catch {
    return jsonResponse({ error: "invalid json" }, 400);
  }
  const { slug, creatives } = payload;
  if (!slug || !Array.isArray(creatives)) {
    return jsonResponse({ error: "missing slug or creatives[]" }, 400);
  }
  const meta = await getClientBySlug(env, slug);
  if (!meta) return jsonResponse({ error: `cliente ${slug} não cadastrado` }, 404);
  if (!meta.ghlLocationId) return jsonResponse({ error: "client missing ghlLocationId" }, 400);

  // Mesma validação do /admin/queue: creative.platforms é obrigatório (cross-cliente 2026-05-11)
  for (const c of creatives) {
    if (!c.id) continue;
    if (!Array.isArray(c.platforms) || c.platforms.length === 0) {
      return jsonResponse(
        { error: `creative.platforms é obrigatório e não pode ser vazio (creative ${c.id})` },
        400
      );
    }
  }

  const results = [];
  const ids = (await env.STATE.get(`creative:${slug}:list`, "json")) || [];

  for (const c of creatives) {
    if (!c.id) {
      results.push({ id: c.id, ok: false, error: "missing id" });
      continue;
    }

    // Suporta 3 modos de entrada:
    //   1. slides_base64[] (legacy carrossel image/jpeg)
    //   2. media[] = [{ base64, mime_type, filename }]  (genérico: image OR video)
    //   3. media_urls[] (URLs públicas externas — skip upload, salva direto)
    const urls = [];
    let uploadFailed = false;
    let primaryMimeType = c.media_type || "image/jpeg";

    if (Array.isArray(c.media_urls) && c.media_urls.length > 0) {
      // Modo 3: URLs externas (Higgsfield/R2/CDN qualquer). Skip upload.
      urls.push(...c.media_urls);
    } else if (Array.isArray(c.media) && c.media.length > 0) {
      // Modo 2: media[] genérico — cada item tem base64 + mime_type
      for (let i = 0; i < c.media.length; i++) {
        const m = c.media[i];
        if (!m.base64) {
          results.push({ id: c.id, ok: false, error: `media[${i}] missing base64` });
          uploadFailed = true;
          break;
        }
        const mime = m.mime_type || "image/jpeg";
        const ext = mime.startsWith("video/") ? "mp4" : mime.startsWith("image/png") ? "png" : "jpg";
        const fname = m.filename || `${c.id}-${String(i + 1).padStart(2, "0")}.${ext}`;
        try {
          const url = await uploadMediaToGHL(env, meta, m.base64, fname, mime);
          urls.push(url);
          if (i === 0) primaryMimeType = mime;
        } catch (e) {
          results.push({ id: c.id, ok: false, error: `upload media[${i}]: ${e.message}` });
          uploadFailed = true;
          break;
        }
      }
    } else if (Array.isArray(c.slides_base64) && c.slides_base64.length > 0) {
      // Modo 1: legacy — slides_base64[] sempre image/jpeg
      for (let i = 0; i < c.slides_base64.length; i++) {
        const b64 = c.slides_base64[i];
        try {
          const url = await uploadMediaToGHL(
            env, meta, b64,
            `${c.id}-slide-${String(i + 1).padStart(2, "0")}.jpg`,
            "image/jpeg"
          );
          urls.push(url);
        } catch (e) {
          results.push({ id: c.id, ok: false, error: `upload slide ${i + 1}: ${e.message}` });
          uploadFailed = true;
          break;
        }
      }
      primaryMimeType = "image/jpeg";
    } else {
      results.push({ id: c.id, ok: false, error: "missing media: pass slides_base64[] OR media[] OR media_urls[]" });
      continue;
    }
    if (uploadFailed) continue;

    const key = `creative:${slug}:${c.id}`;
    const existing = (await env.STATE.get(key, "json")) || {};
    // Remove campos pesados antes de persistir
    const { slides_base64, media, ...cClean } = c;
    const merged = {
      ...existing,
      ...cClean,
      id: c.id,
      urls,
      media_type: c.media_type || primaryMimeType,
      kind: c.kind || (primaryMimeType.startsWith("video/") ? "video" : "carousel"),
      duration_s: c.duration_s || null,
      aspect_ratio: c.aspect_ratio || null,
      status: c.status || existing.status || "pending",
      redo_count: existing.redo_count || 0,
      created_at: existing.created_at || new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    await env.STATE.put(key, JSON.stringify(merged));
    if (!ids.includes(c.id)) ids.unshift(c.id);
    results.push({ id: c.id, ok: true, urls_count: urls.length, media_type: merged.media_type });
  }

  await env.STATE.put(`creative:${slug}:list`, JSON.stringify(ids.slice(0, 200)));
  return jsonResponse({ ok: true, results });
}

async function uploadMediaToGHL(env, meta, base64Data, filename, mimeType = "image/jpeg") {
  // base64Data pode vir como "data:image/jpeg;base64,XXXX", "data:video/mp4;base64,XXXX" ou só "XXXX"
  const cleanB64 = base64Data.replace(/^data:[^;]+;base64,/, "");
  const bytes = Uint8Array.from(atob(cleanB64), (ch) => ch.charCodeAt(0));
  const apiKey = meta.ghlApiKey || env.GHL_API_KEY;
  if (!apiKey) throw new Error("CRM Funnels API key not configured for client");

  const boundary = "----CFFormBoundary" + crypto.randomUUID().replace(/-/g, "");
  const enc = new TextEncoder();
  const head = enc.encode(
    `--${boundary}\r\nContent-Disposition: form-data; name="altId"\r\n\r\n${meta.ghlLocationId}\r\n` +
    `--${boundary}\r\nContent-Disposition: form-data; name="altType"\r\n\r\nlocation\r\n` +
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
    `Content-Type: ${mimeType}\r\n\r\n`
  );
  const tail = enc.encode(`\r\n--${boundary}--\r\n`);
  const body = new Uint8Array(head.length + bytes.length + tail.length);
  body.set(head, 0);
  body.set(bytes, head.length);
  body.set(tail, head.length + bytes.length);

  const r = await fetch("https://services.leadconnectorhq.com/medias/upload-file", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Version: "2021-07-28",
      "Content-Type": `multipart/form-data; boundary=${boundary}`,
      Accept: "application/json",
      "User-Agent": "Mozilla/5.0 (seocontent-worker)",
    },
    body,
  });
  if (!r.ok) {
    const text = await r.text();
    throw new Error(`CRM Funnels upload ${r.status}: ${text.slice(0, 150)}`);
  }
  const data = await r.json();
  if (!data.url) throw new Error(`CRM Funnels upload sem url: ${JSON.stringify(data).slice(0, 150)}`);
  return data.url;
}

// Alias retrocompat (caso scripts externos chamem o nome antigo)
const uploadJpegToGHL = (env, meta, base64Data, filename) =>
  uploadMediaToGHL(env, meta, base64Data, filename, "image/jpeg");

async function handleAdminDeleteCreative(req, env, slug, creativeId) {
  const adminToken = req.headers.get("X-Admin-Token");
  if (!env.ADMIN_TOKEN || adminToken !== env.ADMIN_TOKEN) {
    return jsonResponse({ error: "unauthorized" }, 401);
  }
  const key = `creative:${slug}:${creativeId}`;
  const existing = await env.STATE.get(key);
  if (!existing) return jsonResponse({ error: "not found" }, 404);
  await env.STATE.delete(key);
  // Remove ID da lista também
  const ids = (await env.STATE.get(`creative:${slug}:list`, "json")) || [];
  const filtered = ids.filter((x) => x !== creativeId);
  await env.STATE.put(`creative:${slug}:list`, JSON.stringify(filtered));
  return jsonResponse({ ok: true, deleted: creativeId });
}

async function handleAdminClients(req, env) {
  const adminToken = req.headers.get("X-Admin-Token");
  if (!env.ADMIN_TOKEN || adminToken !== env.ADMIN_TOKEN) {
    return jsonResponse({ error: "unauthorized" }, 401);
  }
  // Lista todos client:*:meta
  const list = await env.STATE.list({ prefix: "client:" });
  const clients = {};
  for (const k of list.keys) {
    const m = k.name.match(/^client:([^:]+):(meta|token)$/);
    if (!m) continue;
    const [, slug, kind] = m;
    clients[slug] = clients[slug] || {};
    if (kind === "meta") clients[slug].meta = await env.STATE.get(k.name, "json");
    if (kind === "token") clients[slug].token = await env.STATE.get(k.name);
  }
  return jsonResponse({ clients });
}

// ─── Cron handler ─────────────────────────────────────────────────────

async function handleCron(controller, env, ctx) {
  const now = new Date();
  console.log(`[cron] firing at ${now.toISOString()}`);
  // Pra cada cliente, busca approved com scheduled_for matching ±30min
  const list = await env.STATE.list({ prefix: "client:" });
  const slugs = new Set();
  for (const k of list.keys) {
    const m = k.name.match(/^client:([^:]+):meta$/);
    if (m) slugs.add(m[1]);
  }
  for (const slug of slugs) {
    const meta = await getClientBySlug(env, slug);
    const creatives = await getClientCreatives(env, slug);
    const ready = creatives.filter((c) => {
      if (c.status !== "approved") return false;
      if (!c.scheduled_for) return false;
      const sched = new Date(c.scheduled_for);
      const diffMin = Math.abs((now - sched) / 60000);
      return diffMin <= 30;
    });
    for (const c of ready) {
      try {
        const { results, errors } = await publishToGHL(env, meta, c);
        c.status = "published";
        c.published_at = new Date().toISOString();
        c.published_via = "cron";
        c.ghl_post_ids = results.map((r) => ({ platform: r.platform, postId: r.postId, accountId: r.accountId, pending_id_backfill: !!r.pending_id_backfill }));
        c.pending_id_backfill = results.some((r) => r.pending_id_backfill);
        if (errors.length) c.publish_partial_errors = errors;
        delete c.publish_error;
        await env.STATE.put(`creative:${slug}:${c.id}`, JSON.stringify(c));
        console.log(`[cron] ✓ published ${slug}/${c.id} (${results.length} platforms)`);
      } catch (e) {
        console.error(`[cron] ✗ ${slug}/${c.id}: ${e.message}`);
        c.publish_error = e.message;
        await env.STATE.put(`creative:${slug}:${c.id}`, JSON.stringify(c));
      }
    }
  }
}

async function publishToGHL(env, meta, creative) {
  // Prioridade: chave por cliente (meta.ghlApiKey) > fallback env global
  const apiKey = meta.ghlApiKey || env.GHL_API_KEY;
  if (!apiKey) throw new Error("CRM Funnels API key not configured (meta.ghlApiKey or env.GHL_API_KEY)");
  if (!meta.ghlLocationId) throw new Error(`client missing ghlLocationId`);
  if (!creative.urls || creative.urls.length === 0) throw new Error("creative missing urls");

  // Política cross-cliente 2026-05-11: creative.platforms é obrigatório e explícito.
  // Sem fallback pra meta.platforms — fail-loud se chegou aqui sem platforms.
  if (!Array.isArray(creative.platforms) || creative.platforms.length === 0) {
    throw new Error(
      `creative ${creative.id} sem platforms — input deveria ter sido rejeitado em /admin/queue ou /admin/upload`
    );
  }
  const platforms = creative.platforms;
  const results = [];
  const errors = [];

  for (const plat of platforms) {
    const accountId = meta.accountIds?.[plat];
    if (!accountId) {
      const msg = `${plat}: accountId missing in client meta`;
      console.warn(`[publish] ${msg}`);
      errors.push(msg);
      continue;
    }
    // media_type vem do creative (default image/jpeg pra retrocompat).
    // Suportado: image/jpeg, image/png, video/mp4
    const mediaType = creative.media_type || "image/jpeg";
    const payload = {
      type: "post",
      userId: meta.ghlUserId,
      accountIds: [accountId],
      media: creative.urls.map((u) => ({ url: u, type: mediaType })),
      summary: creative.caption || "",
      status: "published",
    };
    const res = await fetch(
      `https://services.leadconnectorhq.com/social-media-posting/${meta.ghlLocationId}/posts`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Version: "2021-07-28",
          "Content-Type": "application/json",
          Accept: "application/json",
          "User-Agent": "Mozilla/5.0 (seocontent-worker)",
        },
        body: JSON.stringify(payload),
      }
    );
    if (!res.ok) {
      const text = await res.text();
      const msg = `${plat} ${res.status}: ${text.slice(0, 200)}`;
      console.error(`[publish] ${msg}`);
      errors.push(msg);
      continue;
    }
    const data = await res.json().catch(() => ({}));
    let postId = data?.postId || data?.id || data?.data?.id || data?.post?.id || null;
    let pendingIdBackfill = false;
    if (!postId) {
      // 2026-05-24: A API nova do CRM Funnels (POST .../posts) retorna 201 "Created Post"
      // em estado ASSÍNCRONO — sem postId/_id confiável no body imediato. A ausência
      // de postId NÃO significa falha: o 2xx já é aceite de submissão e o post vai pro ar.
      // Tentamos reconciliar o id real via list endpoint; se a latência não deixar achar
      // agora, marcamos pending_id_backfill (preenchível depois) em vez de reverter.
      // O fail-loud legítimo (zero plataformas aceitas) continua abaixo via results.length.
      postId = await reconcileGhlPostId(meta, apiKey, accountId, creative).catch((err) => {
        console.warn(`[publish] ${plat}: reconcile falhou (${err?.message || err})`);
        return null;
      });
      if (!postId) {
        pendingIdBackfill = true;
        const msg = `${plat}: CRM Funnels ${res.status} aceito sem postId no body — submissão OK, id pendente de backfill.`;
        console.warn(`[publish] ${msg}`);
        errors.push(msg);
      }
    }
    results.push({ platform: plat, accountId, postId, pending_id_backfill: pendingIdBackfill });
  }

  // Fail-loud legítimo [[feedback_publish_to_ghl_fail_loud]]: se ZERO plataformas
  // aceitaram (todas 4xx/5xx ou accountId vazio), nada foi pro ar → throw.
  // NÃO marcar published com platforms vazio (incidente JRS).
  if (results.length === 0) {
    throw new Error(`No posts created. Errors: ${errors.join(" | ") || "no platforms attempted"}`);
  }
  // A partir de 2026-05-24: "2xx sem postId" NÃO é mais falha. Pelo menos uma
  // plataforma aceitou a submissão (results.length > 0), logo o conteúdo foi publicado.
  return { results, errors };
}

// Reconciliação de postId pós-submissão (CRM Funnels retorna 2xx assíncrono sem id no body).
// Lista os posts recentes da location filtrando pelo account e tenta casar pelo post
// mais recente (best-effort). Retorna null se não achar — caller marca pending_id_backfill.
async function reconcileGhlPostId(meta, apiKey, accountId, creative) {
  const res = await fetch(
    `https://services.leadconnectorhq.com/social-media-posting/${meta.ghlLocationId}/posts/list`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Version: "2021-07-28",
        "Content-Type": "application/json",
        Accept: "application/json",
        "User-Agent": "Mozilla/5.0 (seocontent-worker)",
      },
      body: JSON.stringify({
        type: "all",
        accountId,
        skip: 0,
        limit: 5,
        includeUsers: false,
      }),
    }
  );
  if (!res.ok) {
    throw new Error(`list ${res.status}`);
  }
  const data = await res.json().catch(() => ({}));
  const posts = data?.posts || data?.data?.posts || data?.data || [];
  if (!Array.isArray(posts) || posts.length === 0) return null;
  // Posts costumam vir ordenados por criação desc; pega o mais recente e extrai o id.
  const recent = posts[0];
  return recent?._id || recent?.id || recent?.postId || null;
}

// ═══════════════════════════════════════════════════════════════════════
//  Plataforma Interna Agência v1 — API REST (D1-backed)
//  Aprovado 2026-05-11. Prefixo /api/v1/ pra não conflitar com /api/<slug>/state legacy.
// ═══════════════════════════════════════════════════════════════════════

function requireAdmin(req, env) {
  const adminToken = req.headers.get("X-Admin-Token");
  if (!env.ADMIN_TOKEN || adminToken !== env.ADMIN_TOKEN) {
    return jsonResponse({ error: "unauthorized" }, 401);
  }
  return null;
}

function requireDB(env) {
  if (!env.DB) {
    return jsonResponse(
      {
        error: "D1 binding not configured",
        hint: "Run `wrangler d1 create agency-platform-db`, add binding to wrangler.toml, then re-deploy.",
      },
      503
    );
  }
  return null;
}

// GET /api/v1/dashboard — agregado leve cross-cliente pra Mission Control.
// Lê SÓ de D1 + KV cache (sem live fetch pra CRM Funnels/Meta). Sempre <500ms.
async function handleApiV1Dashboard(req, env) {
  const authErr = requireAdmin(req, env);
  if (authErr) return authErr;
  const dbErr = requireDB(env);
  if (dbErr) return dbErr;

  const todayBrt = new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);

  // 1. Lista clientes ativos
  const { results: clients } = await env.DB.prepare(
    `SELECT slug, legacy_id, display_name, market, business_model, niche, language, status
       FROM clients WHERE status = 'active' ORDER BY display_name`
  ).all();

  // 2. Integrações: status por cliente
  const { results: integsRaw } = await env.DB.prepare(
    `SELECT client_slug, channel, status FROM integrations`
  ).all();
  const integsByClient = {};
  for (const i of integsRaw) {
    (integsByClient[i.client_slug] ||= []).push(i);
  }

  // 3. Deliverables: contagem por status × cliente
  const { results: delivRaw } = await env.DB.prepare(
    `SELECT client_slug, status, COUNT(*) as n FROM deliverables_state GROUP BY client_slug, status`
  ).all();
  const delivByClient = {};
  for (const d of delivRaw) {
    (delivByClient[d.client_slug] ||= {})[d.status] = d.n;
  }

  // 4. Última run global do MESTRE
  const lastRun = await env.DB.prepare(
    `SELECT id, trigger, status, started_at, finished_at, errors_count, deliverables_dispatched
       FROM runs ORDER BY started_at DESC LIMIT 1`
  ).first();

  // 5. Pra cada cliente: agrega contagem de creatives (KV) + caches sales/ads
  const items = await Promise.all(clients.map(async (c) => {
    const slug = c.slug;

    // KV creatives — lista ordem desc, computa publicado-hoje + pendentes
    const ids = (await env.STATE.get(`creative:${slug}:list`, "json")) || [];
    let publishedToday = false;
    let pendingApproval = 0;
    let lastPublishedId = null;
    let lastPublishedAt = null;
    for (const id of ids.slice(0, 30)) {
      const item = await env.STATE.get(`creative:${slug}:${id}`, "json");
      if (!item) continue;
      if (item.status === "pending") pendingApproval++;
      if (item.status === "published" && item.published_at) {
        if (!lastPublishedAt) {
          lastPublishedId = id;
          lastPublishedAt = item.published_at;
        }
        // Compara em BRT (UTC-3)
        const ymdBrt = new Date(new Date(item.published_at).getTime() - 3 * 3600_000)
          .toISOString().slice(0, 10);
        if (ymdBrt === todayBrt) publishedToday = true;
      }
    }

    // Caches de sales e ads (não força refresh, só lê se existir e dentro do TTL)
    const salesCache = await env.STATE.get(`sales:${slug}:30d`, "json");
    const adsCache = await env.STATE.get(`ads:${slug}:30d`, "json");

    // Pendências calculadas
    const pendencias = [];
    const dCounts = delivByClient[slug] || {};
    if ((dCounts.pending || 0) > 0) {
      pendencias.push({ label: `${dCounts.pending} onboarding pendente(s)`, severity: "info" });
    }
    if ((dCounts.failed || 0) > 0) {
      pendencias.push({ label: `${dCounts.failed} deliverable falhou`, severity: "error" });
    }
    const brokenIntegs = (integsByClient[slug] || []).filter((i) => i.status === "invalid" || i.status === "expired");
    if (brokenIntegs.length) {
      pendencias.push({ label: `${brokenIntegs.length} integração quebrada`, severity: "error" });
    }
    if (pendingApproval > 0) {
      pendencias.push({ label: `${pendingApproval} criativo aguardando aprovação`, severity: "warn" });
    }

    // Campanhas agregado leve
    let campaigns = { configured: false };
    if (adsCache) {
      if (adsCache.error) {
        campaigns = { configured: false, error: adsCache.error };
      } else {
        campaigns = {
          configured: true,
          spend: adsCache.insights?.spend || 0,
          leads: adsCache.insights?.leads || 0,
          cost_per_lead: adsCache.insights?.cost_per_lead || 0,
          active_count: (adsCache.campaigns || []).filter((x) => x.status === "ACTIVE").length,
          paused_count: (adsCache.campaigns || []).filter((x) => x.status === "PAUSED").length,
          currency: adsCache.account?.currency || "BRL",
          cached_at: adsCache.cached_at,
        };
      }
    }

    // Goal métrica por business_model (canon Alex 2026-05-14):
    //   infoproduct → vendas (alunos histórico via tags)
    //   real_estate_launch → leads + conversão CRM
    //   services_local | clinic → leads + posts publicados
    //   b2b_saas → leads + assinaturas (placeholder)
    let goalMetric;
    if (c.business_model === "infoproduct") {
      goalMetric = { type: "sales", label: "Vendas (alunos)", value: salesCache?.alunos?.total ?? null };
    } else if (c.business_model === "real_estate_launch") {
      goalMetric = { type: "lead_conversion", label: "Leads no CRM", value: salesCache?.leads?.total ?? null };
    } else if (c.business_model === "services_local" || c.business_model === "clinic") {
      // Pra serviços, foco em volume de conteúdo publicado + leads
      const publishedCount = ids.length; // últimos 30 IDs registrados
      goalMetric = { type: "content_volume", label: "Posts publicados", value: publishedCount };
    } else {
      goalMetric = { type: "leads", label: "Leads", value: salesCache?.leads?.total ?? null };
    }

    return {
      slug,
      legacy_id: c.legacy_id,
      display_name: c.display_name,
      market: c.market,
      business_model: c.business_model,
      niche: c.niche,
      goal_metric: goalMetric,

      today: {
        published: publishedToday,
        last_published_id: lastPublishedId,
        last_published_at: lastPublishedAt,
        pending_approval: pendingApproval,
      },

      sales: salesCache ? {
        leads_30d: salesCache.leads?.total || 0,
        alunos: salesCache.alunos?.total || 0,
        cached_at: salesCache.cached_at,
        token_unauthorized: Array.isArray(salesCache.errors) &&
          salesCache.errors.some((e) => /403|does not have access/i.test(e)),
      } : null,

      campaigns,

      integrations_summary: {
        verified: (integsByClient[slug] || []).filter((i) => i.status === "verified").length,
        configured: (integsByClient[slug] || []).filter((i) => i.status === "configured").length,
        pending: (integsByClient[slug] || []).filter((i) => i.status === "pending").length,
        broken: brokenIntegs.length,
      },

      deliverables_summary: dCounts,
      pendencias,
    };
  }));

  // Routines: agregado simples — usa última run + indicador se cron Worker (todo dia) tá ativo
  const routines = {
    mestre_last_run: lastRun ? {
      id: lastRun.id,
      status: lastRun.status,
      started_at: lastRun.started_at,
      finished_at: lastRun.finished_at,
      errors_count: lastRun.errors_count,
      deliverables_dispatched: lastRun.deliverables_dispatched,
      ran_today: lastRun.started_at && lastRun.started_at.startsWith(todayBrt.replace(/-/g, "-")),
    } : null,
    worker_cron: { schedule: "0 * * * *", description: "hourly publish trigger" },
  };

  return jsonResponse({
    captured_at: new Date().toISOString(),
    today_brt: todayBrt,
    clients_count: items.length,
    clients: items,
    routines,
  });
}

// GET /api/v1/clients — lista 10 clientes com classification, status, last_updated.
async function handleApiV1ClientsList(req, env) {
  const authErr = requireAdmin(req, env);
  if (authErr) return authErr;
  const dbErr = requireDB(env);
  if (dbErr) return dbErr;

  const { results } = await env.DB.prepare(
    `SELECT slug, legacy_id, display_name, market, business_model, niche, language,
            status, created_at, updated_at
       FROM clients
       WHERE status = 'active'
       ORDER BY display_name ASC`
  ).all();

  return jsonResponse({
    count: results.length,
    clients: results,
  });
}

// GET /api/v1/clients/:slug — detalhe + integrações configuradas + deliverables_state.
async function handleApiV1ClientDetail(req, env, slug) {
  const authErr = requireAdmin(req, env);
  if (authErr) return authErr;
  const dbErr = requireDB(env);
  if (dbErr) return dbErr;

  const client = await env.DB.prepare(
    `SELECT * FROM clients WHERE slug = ?`
  ).bind(slug).first();
  if (!client) return jsonResponse({ error: `client ${slug} not found` }, 404);

  // Parse brand_profile JSON se existir
  if (client.brand_profile && typeof client.brand_profile === "string") {
    try { client.brand_profile = JSON.parse(client.brand_profile); } catch {}
  }

  const integrations = await env.DB.prepare(
    `SELECT channel, status, config, last_verified_at, last_error
       FROM integrations WHERE client_slug = ?`
  ).bind(slug).all();

  const deliverables = await env.DB.prepare(
    `SELECT deliverable_id, category, status, last_dispatched_at, last_completed_at,
            next_due_at, fail_count, skip_reason
       FROM deliverables_state
       WHERE client_slug = ?
       ORDER BY category ASC, deliverable_id ASC`
  ).bind(slug).all();

  // Parse JSON em integrations.config
  const integs = integrations.results.map((row) => {
    if (row.config && typeof row.config === "string") {
      try { row.config = JSON.parse(row.config); } catch {}
    }
    return row;
  });

  return jsonResponse({
    client,
    integrations: integs,
    deliverables: deliverables.results,
  });
}

// POST /api/v1/state/snapshot — Mac envia latest.json gerado por build-all.py.
// Worker faz UPSERT idempotente em clients + integrations + deliverables_state.
async function handleApiV1SnapshotIngest(req, env) {
  const authErr = requireAdmin(req, env);
  if (authErr) return authErr;
  const dbErr = requireDB(env);
  if (dbErr) return dbErr;

  let snapshot;
  try { snapshot = await req.json(); } catch {
    return jsonResponse({ error: "invalid json" }, 400);
  }
  if (!Array.isArray(snapshot.clients)) {
    return jsonResponse({ error: "missing clients[] in snapshot" }, 400);
  }

  let upserted = 0;
  let integsUpserted = 0;

  for (const c of snapshot.clients) {
    if (!c.slug || !c.classification) continue;
    const cls = c.classification;

    await env.DB.prepare(
      `INSERT INTO clients (slug, legacy_id, display_name, market, business_model, niche, language)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(slug) DO UPDATE SET
         legacy_id      = excluded.legacy_id,
         display_name   = excluded.display_name,
         market         = excluded.market,
         business_model = excluded.business_model,
         niche          = excluded.niche,
         language       = excluded.language,
         updated_at     = datetime('now')`
    ).bind(
      c.slug, c.legacy_id || null, c.display_name,
      cls.market, cls.business_model, cls.niche || "", cls.language
    ).run();
    upserted++;

    // Sincroniza presença de integrações (sem secrets — só status pending/configured)
    if (c.integrations && typeof c.integrations === "object") {
      for (const [channel, enabled] of Object.entries(c.integrations)) {
        const status = enabled ? "configured" : "pending";
        await env.DB.prepare(
          `INSERT INTO integrations (client_slug, channel, status)
           VALUES (?, ?, ?)
           ON CONFLICT(client_slug, channel) DO UPDATE SET
             status = CASE
               WHEN integrations.status IN ('verified','invalid','expired') THEN integrations.status
               ELSE excluded.status END,
             updated_at = datetime('now')`
        ).bind(c.slug, channel, status).run();
        integsUpserted++;
      }
    }
  }

  return jsonResponse({
    ok: true,
    captured_at: snapshot.captured_at || null,
    clients_upserted: upserted,
    integrations_upserted: integsUpserted,
  });
}

// ─── CRM Funnels helpers (Mission Control #3) ────────────────────────────────────
// CRM Funnels API: https://highlevel.stoplight.io/docs/integrations/. Auth via Private
// Integration Token (PIT). Token vive em env.GHL_API_KEY (já existe pro pipeline
// de social posting). Quando outros clientes tiverem PITs próprios, vai vir do KV.

const GHL_BASE = "https://services.leadconnectorhq.com";
const GHL_VERSION = "2021-07-28";

async function ghlFetch(env, path, opts = {}, apiKey = null) {
  const token = apiKey || env.GHL_API_KEY;
  if (!token) {
    throw new Error("GHL_API_KEY not provided (env nem per-client)");
  }
  const url = path.startsWith("http") ? path : `${GHL_BASE}${path}`;
  const r = await fetch(url, {
    ...opts,
    headers: {
      "Authorization": `Bearer ${token}`,
      "Version": GHL_VERSION,
      "Accept": "application/json",
      ...(opts.headers || {}),
    },
  });
  if (!r.ok) {
    const body = await r.text();
    const err = new Error(`CRM Funnels ${r.status} on ${path}: ${body.slice(0, 300)}`);
    err.status = r.status;
    throw err;
  }
  return r.json();
}

// Resolve o PIT (Private Integration Token) do cliente.
// Prioridade: KV `ghl:<slug>:pit` > env.GHL_API_KEY (default Alex).
// Quando outros clientes tiverem PIT, Alex roda:
//   wrangler kv key put --binding=STATE "ghl:jrs-flooring:pit" "pit-XXXXX"
async function resolveGhlApiKey(env, slug) {
  const perClient = await env.STATE.get(`ghl:${slug}:pit`);
  if (perClient) return perClient;
  return env.GHL_API_KEY || null;
}

// Resolve o ghl_location_id de um cliente (lendo D1; futuro lookup por KV).
async function resolveGhlLocationId(env, slug) {
  const row = await env.DB.prepare(
    `SELECT i.config FROM integrations i
     WHERE i.client_slug = ? AND i.channel = 'ghl' AND i.status IN ('configured','verified') LIMIT 1`
  ).bind(slug).first();
  if (row && row.config) {
    try {
      const c = typeof row.config === "string" ? JSON.parse(row.config) : row.config;
      if (c.location_id) return c.location_id;
    } catch {}
  }
  // Fallback: brand_profile.json no campo clients.brand_profile
  const client = await env.DB.prepare(`SELECT brand_profile FROM clients WHERE slug = ?`).bind(slug).first();
  if (client && client.brand_profile) {
    try {
      const bp = typeof client.brand_profile === "string" ? JSON.parse(client.brand_profile) : client.brand_profile;
      const loc = bp?.integrations?.ghl?.location_id || bp?.publishing?.ghl_location_id;
      if (loc) return loc;
    } catch {}
  }
  return null;
}

// ─── Lead Attribution (cruza CRM Funnels contacts.attributionSource) ────────────
// Cada contact tem `attributionSource` e `lastAttributionSource` com:
//   { url, campaign, campaign_id, adset_id, ad_id, utm_source, utm_medium,
//     utm_campaign, utm_content, utm_term, ip, fbclid, gclid, ... }
// Usado pra ligar lead → ad → criativo sem precisar de Meta API.

// GET /api/v1/clients/:slug/lead-attribution?days=N&limit=N
async function handleApiV1ClientLeadAttribution(req, env, slug) {
  const authErr = requireAdmin(req, env);
  if (authErr) return authErr;
  const dbErr = requireDB(env);
  if (dbErr) return dbErr;

  const url = new URL(req.url);
  const days = Math.min(Math.max(parseInt(url.searchParams.get("days") || "30", 10), 1), 365);
  const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") || "10", 10), 1), 50);
  const forceRefresh = url.searchParams.get("refresh") === "1";

  const cacheKey = `leadattr:${slug}:${days}d`;
  if (!forceRefresh) {
    const cached = await env.STATE.get(cacheKey, "json");
    if (cached && cached.cached_at && Date.now() - new Date(cached.cached_at).getTime() < 7_200_000) {
      return jsonResponse({ ...cached, cache_hit: true });
    }
  }

  const locationId = await resolveGhlLocationId(env, slug);
  if (!locationId) {
    return jsonResponse({ error: "ghl_location_id not configured", slug }, 503);
  }
  const apiKey = await resolveGhlApiKey(env, slug);
  if (!apiKey) {
    return jsonResponse({ error: "CRM Funnels PIT not available", slug }, 503);
  }

  const since = new Date(Date.now() - days * 86400_000);
  const sinceMs = since.getTime();
  const errors = [];
  let leads = [];

  try {
    const res = await ghlFetch(env, "/contacts/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        locationId,
        pageLimit: 100,
        sort: [{ field: "dateAdded", direction: "desc" }],
      }),
    }, apiKey);
    const all = res.contacts || [];

    leads = all
      .filter((c) => {
        const d = c.dateAdded ? new Date(c.dateAdded).getTime() : 0;
        return d >= sinceMs;
      })
      .map((c) => {
        const attr = c.attributionSource || c.lastAttributionSource || {};
        return {
          id: c.id,
          name: [c.firstName, c.lastName].filter(Boolean).join(" ") || c.contactName || c.email || c.phone || c.id,
          email: c.email || null,
          phone: c.phone || null,
          date_added: c.dateAdded,
          source: c.source || null,
          tags: Array.isArray(c.tags) ? c.tags.slice(0, 5) : [],
          attribution: {
            campaign: attr.campaign || attr.utm_campaign || null,
            campaign_id: attr.campaign_id || attr.campaignId || null,
            ad_id: attr.ad_id || attr.adId || null,
            adset_id: attr.adset_id || attr.adsetId || null,
            utm_source: attr.utm_source || null,
            utm_medium: attr.utm_medium || null,
            utm_campaign: attr.utm_campaign || null,
            utm_content: attr.utm_content || null,
            utm_term: attr.utm_term || null,
            referrer: attr.referrer || attr.referer || null,
            url: attr.url || null,
            fbclid: attr.fbclid || null,
            gclid: attr.gclid || null,
          },
        };
      })
      .slice(0, limit);
  } catch (e) {
    errors.push(`contacts: ${e.message}`);
  }

  // Agrega por campanha (tabela tipo print do Alex)
  const byCampaign = {};
  for (const l of leads) {
    const key = l.attribution.campaign || l.attribution.utm_campaign || l.source || "(sem campanha)";
    byCampaign[key] = (byCampaign[key] || 0) + 1;
  }

  const payload = {
    slug,
    location_id: locationId,
    period: { from: since.toISOString(), to: new Date().toISOString(), days },
    leads_count: leads.length,
    leads,
    by_campaign: byCampaign,
    cached_at: new Date().toISOString(),
    cache_ttl_seconds: 7200,
    errors: errors.length ? errors : undefined,
  };

  await env.STATE.put(cacheKey, JSON.stringify(payload), { expirationTtl: 14400 });
  return jsonResponse({ ...payload, cache_hit: false });
}

// ─── Google Ads helpers (Mission Control #5) ────────────────────────────
// Docs: https://developers.google.com/google-ads/api/rest/overview. Auth com
// Developer Token + OAuth refresh token por cliente (cada conta Google Ads
// tem seu próprio). MCC otimizar custo.
// Placeholder: implementação real exige OAuth flow + developer-token approval
// do Google (pode levar dias). Por hora, retorna 503 estruturado.

async function resolveGoogleAdsConfig(env, slug) {
  const row = await env.DB.prepare(
    `SELECT config FROM integrations
     WHERE client_slug = ? AND channel = 'google_ads' AND status IN ('configured','verified') LIMIT 1`
  ).bind(slug).first();
  if (row && row.config) {
    try {
      const c = typeof row.config === "string" ? JSON.parse(row.config) : row.config;
      return c;  // {customer_id, mcc_id?, refresh_token_ref?}
    } catch {}
  }
  return null;
}

// GET /api/v1/clients/:slug/google-ads?days=N — agregado Google Ads.
async function handleApiV1ClientGoogleAds(req, env, slug) {
  const authErr = requireAdmin(req, env);
  if (authErr) return authErr;
  const dbErr = requireDB(env);
  if (dbErr) return dbErr;

  const url = new URL(req.url);
  const days = Math.min(Math.max(parseInt(url.searchParams.get("days") || "30", 10), 1), 90);

  // Cache
  const cacheKey = `gads:${slug}:${days}d`;
  const cached = await env.STATE.get(cacheKey, "json");
  if (cached && url.searchParams.get("refresh") !== "1" &&
      cached.cached_at && Date.now() - new Date(cached.cached_at).getTime() < 7_200_000) {
    return jsonResponse({ ...cached, cache_hit: true });
  }

  const config = await resolveGoogleAdsConfig(env, slug);
  if (!config || !config.customer_id) {
    return jsonResponse({
      slug,
      error: "google_ads.customer_id not configured for this client",
      hint: "Configure integrations.google_ads.config.customer_id no D1. Vai precisar do MCC + OAuth.",
    }, 503);
  }

  if (!env.GOOGLE_ADS_DEVELOPER_TOKEN || !env.GOOGLE_ADS_OAUTH_REFRESH_TOKEN) {
    return jsonResponse({
      slug,
      customer_id: config.customer_id,
      error: "Google Ads secrets não configurados (GOOGLE_ADS_DEVELOPER_TOKEN, GOOGLE_ADS_OAUTH_REFRESH_TOKEN)",
      hint: "Pré-req: Developer token aprovado pelo Google (1-3 dias) + OAuth refresh token. Setup completo em separado.",
    }, 503);
  }

  // Implementação real Google Ads API (REST): exige access_token via refresh.
  // Por hora, NÃO chamamos — voltamos placeholder funcional.
  const payload = {
    slug,
    customer_id: config.customer_id,
    error: "Google Ads endpoint pendente implementação completa",
    hint: "Endpoint structure pronto; OAuth + Developer Token approval ainda a fazer.",
    cached_at: new Date().toISOString(),
  };
  await env.STATE.put(cacheKey, JSON.stringify(payload), { expirationTtl: 14400 });
  return jsonResponse({ ...payload, status: 503 }, 503);
}

// ─── Meta Marketing API helpers (Mission Control #2) ────────────────────
// Docs: https://developers.facebook.com/docs/marketing-api/. Auth Bearer.
// Token vive em env.META_ACCESS_TOKEN (System User token preferencial).
// Cada cliente da agência terá seu próprio ad_account_id em
// integrations.meta_ads.config.account_id no D1.

const META_GRAPH = "https://graph.facebook.com/v21.0";

async function metaFetch(env, path, opts = {}) {
  if (!env.META_ACCESS_TOKEN) {
    const e = new Error("META_ACCESS_TOKEN not configured in Worker secrets");
    e.code = "META_TOKEN_MISSING";
    throw e;
  }
  const url = path.startsWith("http") ? path : `${META_GRAPH}${path}`;
  const sep = url.includes("?") ? "&" : "?";
  const finalUrl = `${url}${sep}access_token=${env.META_ACCESS_TOKEN}`;
  const r = await fetch(finalUrl, opts);
  if (!r.ok) {
    const body = await r.text();
    const err = new Error(`Meta ${r.status} on ${path}: ${body.slice(0, 300)}`);
    err.status = r.status;
    throw err;
  }
  return r.json();
}

async function resolveMetaAdAccount(env, slug) {
  // Tenta D1 integrations.meta_ads.config primeiro
  const row = await env.DB.prepare(
    `SELECT config FROM integrations
     WHERE client_slug = ? AND channel = 'meta_ads' AND status IN ('configured','verified') LIMIT 1`
  ).bind(slug).first();
  if (row && row.config) {
    try {
      const c = typeof row.config === "string" ? JSON.parse(row.config) : row.config;
      if (c.account_id) return c.account_id;
    } catch {}
  }
  // Fallback: brand_profile.integrations.meta_ads.account_id
  const client = await env.DB.prepare(`SELECT brand_profile FROM clients WHERE slug = ?`).bind(slug).first();
  if (client && client.brand_profile) {
    try {
      const bp = typeof client.brand_profile === "string" ? JSON.parse(client.brand_profile) : client.brand_profile;
      const id = bp?.integrations?.meta_ads?.account_id;
      if (id) return id;
    } catch {}
  }
  return null;
}

// GET /api/v1/clients/:slug/ads?days=N — agregado Meta Ads.
async function handleApiV1ClientAds(req, env, slug) {
  const authErr = requireAdmin(req, env);
  if (authErr) return authErr;
  const dbErr = requireDB(env);
  if (dbErr) return dbErr;

  const url = new URL(req.url);
  const days = Math.min(Math.max(parseInt(url.searchParams.get("days") || "30", 10), 1), 90);
  const forceRefresh = url.searchParams.get("refresh") === "1";

  const cacheKey = `ads:${slug}:${days}d`;
  if (!forceRefresh) {
    const cached = await env.STATE.get(cacheKey, "json");
    if (cached && cached.cached_at && Date.now() - new Date(cached.cached_at).getTime() < 7_200_000) {
      return jsonResponse({ ...cached, cache_hit: true });
    }
  }

  const adAccountIdRaw = await resolveMetaAdAccount(env, slug);
  if (!adAccountIdRaw) {
    return jsonResponse({
      slug,
      error: "meta_ads.account_id not configured for this client",
      hint: "Set integrations.meta_ads.config.account_id (formato act_XXXXX) no D1 ou brand_profile.",
    }, 503);
  }
  // Normaliza ad account id pro formato `act_XXX`
  const adAccountId = adAccountIdRaw.startsWith("act_") ? adAccountIdRaw : `act_${adAccountIdRaw}`;

  if (!env.META_ACCESS_TOKEN) {
    return jsonResponse({
      slug,
      ad_account_id: adAccountId,
      error: "META_ACCESS_TOKEN secret not configured in Worker",
      hint: "Rode: wrangler secret put META_ACCESS_TOKEN (use System User token c/ ads_read permission)",
    }, 503);
  }

  const now = new Date();
  const since = new Date(now.getTime() - days * 86400_000);
  const sinceYmd = since.toISOString().slice(0, 10);
  const todayYmd = now.toISOString().slice(0, 10);
  const timeRange = JSON.stringify({ since: sinceYmd, until: todayYmd });

  let account = null;
  let insights = { spend: 0, impressions: 0, clicks: 0, ctr: 0, cpc: 0, reach: 0, leads: 0, cost_per_lead: 0 };
  let campaigns = [];
  let topAds = [];
  const errors = [];

  // ── 1. Account meta ──
  try {
    const r = await metaFetch(env, `/${adAccountId}?fields=id,name,currency,timezone_name,account_status,balance`);
    account = {
      id: r.id, name: r.name, currency: r.currency,
      timezone: r.timezone_name, status: r.account_status,
    };
  } catch (e) {
    errors.push(`account: ${e.message}`);
  }

  // ── 2. Insights agregados conta-level ──
  try {
    const fields = "spend,impressions,clicks,ctr,cpc,reach,actions,cost_per_action_type";
    const r = await metaFetch(env, `/${adAccountId}/insights?fields=${fields}&time_range=${encodeURIComponent(timeRange)}&level=account`);
    const row = (r.data || [])[0] || {};
    insights.spend = parseFloat(row.spend || "0");
    insights.impressions = parseInt(row.impressions || "0", 10);
    insights.clicks = parseInt(row.clicks || "0", 10);
    insights.ctr = parseFloat(row.ctr || "0");
    insights.cpc = parseFloat(row.cpc || "0");
    insights.reach = parseInt(row.reach || "0", 10);
    // Extrai "lead" das actions
    const leadAction = (row.actions || []).find((a) => a.action_type === "lead");
    insights.leads = leadAction ? parseInt(leadAction.value, 10) : 0;
    const cpl = (row.cost_per_action_type || []).find((a) => a.action_type === "lead");
    insights.cost_per_lead = cpl ? parseFloat(cpl.value) : 0;
  } catch (e) {
    errors.push(`insights: ${e.message}`);
  }

  // ── 3. Campanhas ativas (top 10) ──
  try {
    const r = await metaFetch(env, `/${adAccountId}/campaigns?fields=id,name,status,effective_status,objective,daily_budget,lifetime_budget,created_time&limit=10`);
    campaigns = (r.data || [])
      .filter((c) => c.effective_status !== "DELETED" && c.effective_status !== "ARCHIVED")
      .map((c) => ({
        id: c.id,
        name: c.name,
        status: c.effective_status || c.status,
        objective: c.objective,
        daily_budget: c.daily_budget ? parseInt(c.daily_budget, 10) / 100 : null,
        lifetime_budget: c.lifetime_budget ? parseInt(c.lifetime_budget, 10) / 100 : null,
        created_time: c.created_time,
      }))
      .slice(0, 10);
  } catch (e) {
    errors.push(`campaigns: ${e.message}`);
  }

  // ── 4. Top 5 ads por spend ──
  try {
    const fields = "id,name,status,spend,impressions,clicks,ctr,cpc,actions";
    const r = await metaFetch(env, `/${adAccountId}/insights?fields=${fields}&time_range=${encodeURIComponent(timeRange)}&level=ad&limit=5&sort=spend_descending`);
    topAds = (r.data || []).map((a) => {
      const leadAct = (a.actions || []).find((x) => x.action_type === "lead");
      return {
        id: a.ad_id || a.id,
        name: a.ad_name || a.name,
        spend: parseFloat(a.spend || "0"),
        impressions: parseInt(a.impressions || "0", 10),
        clicks: parseInt(a.clicks || "0", 10),
        ctr: parseFloat(a.ctr || "0"),
        cpc: parseFloat(a.cpc || "0"),
        leads: leadAct ? parseInt(leadAct.value, 10) : 0,
      };
    });
  } catch (e) {
    errors.push(`top_ads: ${e.message}`);
  }

  const payload = {
    slug,
    ad_account_id: adAccountId,
    account,
    period: { from: sinceYmd, to: todayYmd, days },
    insights,
    campaigns,
    top_ads: topAds,
    cached_at: now.toISOString(),
    cache_ttl_seconds: 600,
    errors: errors.length ? errors : undefined,
  };

  await env.STATE.put(cacheKey, JSON.stringify(payload), { expirationTtl: 14400 });
  return jsonResponse({ ...payload, cache_hit: false });
}

// GET /api/v1/clients/:slug/sales?days=N — agregado vendas/leads/opportunities.
async function handleApiV1ClientSales(req, env, slug) {
  const authErr = requireAdmin(req, env);
  if (authErr) return authErr;
  const dbErr = requireDB(env);
  if (dbErr) return dbErr;

  const url = new URL(req.url);
  const days = Math.min(Math.max(parseInt(url.searchParams.get("days") || "30", 10), 1), 365);
  const forceRefresh = url.searchParams.get("refresh") === "1";

  // Cache 10min no KV (reduz CRM Funnels API rate)
  const cacheKey = `sales:${slug}:${days}d`;
  if (!forceRefresh) {
    const cached = await env.STATE.get(cacheKey, "json");
    if (cached && cached.cached_at && Date.now() - new Date(cached.cached_at).getTime() < 7_200_000) {
      return jsonResponse({ ...cached, cache_hit: true });
    }
  }

  const locationId = await resolveGhlLocationId(env, slug);
  if (!locationId) {
    return jsonResponse({
      error: "ghl_location_id not configured for this client",
      hint: "Set integrations.ghl.location_id in brand-profile or configure via onboarding",
    }, 503);
  }

  const apiKey = await resolveGhlApiKey(env, slug);
  if (!apiKey) {
    return jsonResponse({
      error: "CRM Funnels PIT (api key) not available",
      hint: "Set KV ghl:<slug>:pit ou GHL_API_KEY secret",
    }, 503);
  }

  const now = new Date();
  const since = new Date(now.getTime() - days * 86400_000);
  const sinceIso = since.toISOString();

  let leadsTotal = 0;
  let alunosTotal = 0;         // contatos com tag aluno-* (modelo Alex)
  let alunosBreakdown = {};    // contagem por tag específica (aluno-sscia, aluno-consultoria-mini, etc)
  let opps = { total: 0, open: 0, won: 0, lost: 0, abandoned: 0, value_open: 0, value_won: 0 };
  let recentLeads = [];
  let errors = [];

  // ── 1. Contacts (leads): /contacts/search sem filtro de data ──
  // CRM Funnels search v2 não aceita operator gte em date_added direto. Estratégia:
  // buscar últimos 100 (sort desc por dateAdded) e filtrar no Worker.
  // Memória feedback_ghl_funil_sscia_modelo_jornada: Alex usa tags `aluno-*` em
  // contatos pra trackear vendas (não opportunities formais).
  try {
    const body = {
      locationId,
      pageLimit: 100,
      sort: [{ field: "dateAdded", direction: "desc" }],
    };
    const res = await ghlFetch(env, "/contacts/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }, apiKey);
    const allContacts = res.contacts || [];
    const sinceMs = since.getTime();
    const filtered = allContacts.filter((c) => {
      const d = c.dateAdded ? new Date(c.dateAdded).getTime() : 0;
      return d >= sinceMs;
    });
    leadsTotal = filtered.length;
    recentLeads = filtered.slice(0, 5).map((c) => ({
      id: c.id,
      name: [c.firstName, c.lastName].filter(Boolean).join(" ") || c.contactName || c.email || c.phone || c.id,
      email: c.email || null,
      phone: c.phone || null,
      source: c.source || null,
      tags: Array.isArray(c.tags) ? c.tags.slice(0, 5) : [],
      created_at: c.dateAdded || null,
    }));

  } catch (e) {
    errors.push(`contacts: ${e.message}`);
  }

  // ── 1b. Alunos histórico (tags aluno-* / cliente-*) ──
  // Modelo Alex/SSCIA: vendas via tag (memória feedback_ghl_funil_sscia_modelo_jornada).
  // Filtro de tags no CRM Funnels é match EXATO. Estratégia:
  //   (1) GET /locations/:id/tags → todas tags da location
  //   (2) Filtrar tags com prefixo aluno- ou cliente- (configurável)
  //   (3) Pra cada, contar contatos com aquela tag
  // Sem filtro de data — esses são contatos histórico (já compraram).
  try {
    const tagsRes = await ghlFetch(env, `/locations/${locationId}/tags`, {}, apiKey);
    const sellingTagPrefixes = ["aluno-", "cliente-"];
    const sellingTags = (tagsRes.tags || [])
      .map((t) => t.name)
      .filter((name) => sellingTagPrefixes.some((p) => name.toLowerCase().startsWith(p)));

    // Conta cada tag em paralelo (mantém latência baixa)
    const counts = await Promise.all(
      sellingTags.map(async (tagName) => {
        try {
          const r = await ghlFetch(env, "/contacts/search", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              locationId,
              pageLimit: 1,
              filters: [{ field: "tags", operator: "contains", value: tagName }],
            }),
          }, apiKey);
          return [tagName, r.total || 0];
        } catch {
          return [tagName, 0];
        }
      })
    );

    for (const [tag, n] of counts) {
      if (n > 0) {
        alunosBreakdown[tag] = n;
        alunosTotal += n;
      }
    }
  } catch (e) {
    errors.push(`alunos_tags: ${e.message}`);
  }

  // ── 2. Opportunities: /opportunities/search (date no formato YYYY-MM-DD) ──
  try {
    const url2 = new URL(`${GHL_BASE}/opportunities/search`);
    url2.searchParams.set("location_id", locationId);
    url2.searchParams.set("limit", "100");
    // CRM Funnels aceita date no formato YYYY-MM-DD (date-only, sem time)
    url2.searchParams.set("date", sinceIso.slice(0, 10));
    const res = await ghlFetch(env, url2.toString(), {}, apiKey);
    const list = res.opportunities || [];
    opps.total = res.meta?.total ?? list.length;
    for (const o of list) {
      const status = (o.status || "open").toLowerCase();
      const value = Number(o.monetaryValue || 0);
      if (status === "won")       { opps.won++;       opps.value_won  += value; }
      else if (status === "lost")  opps.lost++;
      else if (status === "abandoned") opps.abandoned++;
      else { opps.open++; opps.value_open += value; }
    }
  } catch (e) {
    // Silencia erro de date format (CRM Funnels muda schema sem aviso, e modelo
    // Alex/SSCIA usa tags `aluno-*` em vez de opportunities — não bloqueia
    // nada). Re-abilitar quando integrar conversões reais (TODO).
    const benign = /start date|date.*invalid|400/i.test(e.message);
    if (!benign) {
      errors.push(`opportunities: ${e.message}`);
    }
  }

  const payload = {
    slug,
    location_id: locationId,
    period: { from: sinceIso, to: now.toISOString(), days },
    leads: {
      total: leadsTotal,
      recent: recentLeads,
    },
    // Modelo Alex/SSCIA: vendas via tags aluno-* (não opportunities formais).
    // Funciona se brand-profile/cliente segue esse padrão. Pra outros clientes
    // que usam opportunities, "opportunities" abaixo segue acessível.
    alunos: {
      total: alunosTotal,
      breakdown: alunosBreakdown,
    },
    opportunities: opps,
    cached_at: now.toISOString(),
    cache_ttl_seconds: 600,
    errors: errors.length ? errors : undefined,
  };

  // Persiste cache (mesmo com erros parciais — cockpit mostra o que vier)
  await env.STATE.put(cacheKey, JSON.stringify(payload), { expirationTtl: 14400 });

  return jsonResponse({ ...payload, cache_hit: false });
}

// GET /api/v1/clients/:slug/content?limit=N — conteúdo agendado/publicado/falho.
// Lê do KV (`creative:<slug>:list` + `creative:<slug>:<id>`). Não exige D1.
// Mission Control #1: "subiu ou não subiu" sem precisar abrir o dashboard seocontent.
async function handleApiV1ClientContent(req, env, slug) {
  const authErr = requireAdmin(req, env);
  if (authErr) return authErr;

  const url = new URL(req.url);
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "30", 10), 100);

  // Lista de IDs já vem em ordem reverse-chronological (mais novos primeiro).
  const ids = (await env.STATE.get(`creative:${slug}:list`, "json")) || [];
  const sliced = ids.slice(0, limit);

  // Busca em paralelo
  const items = await Promise.all(
    sliced.map(async (id) => {
      const item = await env.STATE.get(`creative:${slug}:${id}`, "json");
      if (!item) return null;
      // Não devolve campos pesados / debug; só o que cockpit usa.
      return {
        id,
        tema: item.tema || null,
        caption: item.caption || null,
        platforms: item.platforms || [],
        status: item.status || "pending",
        scheduled_for: item.scheduled_for || null,
        published_at: item.published_at || null,
        publish_error: item.publish_error || null,
        publish_partial_errors: item.publish_partial_errors || null,
        ghl_post_ids: item.ghl_post_ids || null,
        redo_count: item.redo_count || 0,
        motivo: item.motivo || null,
        urls: Array.isArray(item.urls) ? item.urls.slice(0, 1) : null,  // só thumbnail
        created_at: item.created_at || null,
        updated_at: item.updated_at || null,
      };
    })
  );

  const filtered = items.filter(Boolean);

  // Buckets úteis pro cockpit
  const buckets = {
    pending:   filtered.filter((c) => c.status === "pending"),
    approved:  filtered.filter((c) => c.status === "approved"),
    published: filtered.filter((c) => c.status === "published"),
    failed:    filtered.filter((c) => c.publish_error || c.status === "rejected"),
  };

  return jsonResponse({
    slug,
    count_total: filtered.length,
    counts_by_status: {
      pending:   buckets.pending.length,
      approved:  buckets.approved.length,
      published: buckets.published.length,
      failed:    buckets.failed.length,
    },
    items: filtered,
  });
}

// GET /api/v1/runs?limit=N — últimas runs do MESTRE.
async function handleApiV1RunsList(req, env) {
  const authErr = requireAdmin(req, env);
  if (authErr) return authErr;
  const dbErr = requireDB(env);
  if (dbErr) return dbErr;

  const url = new URL(req.url);
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "20", 10), 100);

  const { results } = await env.DB.prepare(
    `SELECT id, trigger, status, started_at, finished_at,
            clients_processed, deliverables_dispatched, deliverables_skipped,
            errors_count, duration_seconds
       FROM runs
       ORDER BY started_at DESC
       LIMIT ?`
  ).bind(limit).all();

  return jsonResponse({ count: results.length, runs: results });
}

// POST /api/v1/runs — orchestrator abre uma run nova.
async function handleApiV1RunCreate(req, env) {
  const authErr = requireAdmin(req, env);
  if (authErr) return authErr;
  const dbErr = requireDB(env);
  if (dbErr) return dbErr;

  let body;
  try { body = await req.json(); } catch { body = {}; }
  const trigger = body.trigger || "launchd_daily";
  if (!["launchd_daily", "manual", "cockpit", "webhook"].includes(trigger)) {
    return jsonResponse({ error: "invalid trigger" }, 400);
  }

  const result = await env.DB.prepare(
    `INSERT INTO runs (trigger, status) VALUES (?, 'running')
     RETURNING id, trigger, status, started_at`
  ).bind(trigger).first();

  return jsonResponse({ ok: true, run: result }, 201);
}

// PATCH /api/v1/runs/:id — orchestrator finaliza/atualiza run.
async function handleApiV1RunPatch(req, env, runId) {
  const authErr = requireAdmin(req, env);
  if (authErr) return authErr;
  const dbErr = requireDB(env);
  if (dbErr) return dbErr;

  let body;
  try { body = await req.json(); } catch {
    return jsonResponse({ error: "invalid json" }, 400);
  }

  // Campos atualizáveis (whitelist).
  const allowed = [
    "status", "finished_at", "clients_processed",
    "deliverables_dispatched", "deliverables_skipped",
    "errors_count", "duration_seconds", "summary",
  ];
  const sets = [];
  const binds = [];
  for (const k of allowed) {
    if (k in body) {
      sets.push(`${k} = ?`);
      binds.push(body[k]);
    }
  }
  if (sets.length === 0) {
    return jsonResponse({ error: "no fields to update" }, 400);
  }
  if (body.status && !["running", "success", "partial", "failed"].includes(body.status)) {
    return jsonResponse({ error: "invalid status" }, 400);
  }
  binds.push(runId);

  await env.DB.prepare(`UPDATE runs SET ${sets.join(", ")} WHERE id = ?`).bind(...binds).run();

  const updated = await env.DB.prepare(
    `SELECT * FROM runs WHERE id = ?`
  ).bind(runId).first();
  if (!updated) return jsonResponse({ error: "run not found" }, 404);

  return jsonResponse({ ok: true, run: updated });
}

// POST /api/v1/runs/:id/events — orchestrator registra evento (decision/dispatch/skip/...).
async function handleApiV1RunEventCreate(req, env, runId) {
  const authErr = requireAdmin(req, env);
  if (authErr) return authErr;
  const dbErr = requireDB(env);
  if (dbErr) return dbErr;

  let body;
  try { body = await req.json(); } catch {
    return jsonResponse({ error: "invalid json" }, 400);
  }

  const { client_slug, deliverable_id, event_type, detail } = body;
  if (!client_slug || !event_type) {
    return jsonResponse({ error: "client_slug and event_type required" }, 400);
  }
  const validEvents = ["decision", "dispatch", "skip", "complete", "error", "approve", "reject"];
  if (!validEvents.includes(event_type)) {
    return jsonResponse({ error: `event_type must be one of: ${validEvents.join(", ")}` }, 400);
  }

  const detailJson = detail ? (typeof detail === "string" ? detail : JSON.stringify(detail)) : null;

  const result = await env.DB.prepare(
    `INSERT INTO run_events (run_id, client_slug, deliverable_id, event_type, detail)
     VALUES (?, ?, ?, ?, ?)
     RETURNING id, occurred_at`
  ).bind(runId, client_slug, deliverable_id || null, event_type, detailJson).first();

  return jsonResponse({ ok: true, event: result }, 201);
}

// PATCH /api/v1/clients/:slug/deliverables/:deliverableId — orchestrator atualiza estado.
async function handleApiV1DeliverableStatePatch(req, env, slug, deliverableId) {
  const authErr = requireAdmin(req, env);
  if (authErr) return authErr;
  const dbErr = requireDB(env);
  if (dbErr) return dbErr;

  let body;
  try { body = await req.json(); } catch {
    return jsonResponse({ error: "invalid json" }, 400);
  }

  const allowed = ["status", "last_dispatched_at", "last_completed_at", "next_due_at", "fail_count", "skip_reason", "notes"];
  const sets = [];
  const binds = [];
  for (const k of allowed) {
    if (k in body) {
      sets.push(`${k} = ?`);
      binds.push(body[k]);
    }
  }
  if (sets.length === 0) {
    return jsonResponse({ error: "no fields to update" }, 400);
  }
  sets.push("updated_at = datetime('now')");
  binds.push(slug, deliverableId);

  await env.DB.prepare(
    `UPDATE deliverables_state SET ${sets.join(", ")}
     WHERE client_slug = ? AND deliverable_id = ?`
  ).bind(...binds).run();

  const updated = await env.DB.prepare(
    `SELECT * FROM deliverables_state WHERE client_slug = ? AND deliverable_id = ?`
  ).bind(slug, deliverableId).first();
  if (!updated) return jsonResponse({ error: "deliverable_state not found" }, 404);

  return jsonResponse({ ok: true, deliverable: updated });
}

// ─── Router ───────────────────────────────────────────────────────────

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    const path = url.pathname;

    // CORS preflight
    if (req.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type,X-Admin-Token",
        },
      });
    }

    // Admin endpoints
    if (path === "/admin/queue" && req.method === "POST") return handleAdminQueue(req, env);
    if (path === "/admin/upload" && req.method === "POST") return handleAdminUpload(req, env);
    if (path === "/admin/clients" && req.method === "GET") return handleAdminClients(req, env);
    let dm;
    if ((dm = path.match(/^\/admin\/creative\/([^/]+)\/(.+)$/)) && req.method === "DELETE") {
      return handleAdminDeleteCreative(req, env, dm[1], dm[2]);
    }

    // API v1 — Plataforma Interna Agência (D1-backed, /api/v1/ prefix)
    if (path === "/api/v1/dashboard" && req.method === "GET") return handleApiV1Dashboard(req, env);
    if (path === "/api/v1/clients" && req.method === "GET") return handleApiV1ClientsList(req, env);
    let v1m;
    if ((v1m = path.match(/^\/api\/v1\/clients\/([a-z0-9-]+)$/)) && req.method === "GET") {
      return handleApiV1ClientDetail(req, env, v1m[1]);
    }
    if ((v1m = path.match(/^\/api\/v1\/clients\/([a-z0-9-]+)\/content$/)) && req.method === "GET") {
      return handleApiV1ClientContent(req, env, v1m[1]);
    }
    if ((v1m = path.match(/^\/api\/v1\/clients\/([a-z0-9-]+)\/sales$/)) && req.method === "GET") {
      return handleApiV1ClientSales(req, env, v1m[1]);
    }
    if ((v1m = path.match(/^\/api\/v1\/clients\/([a-z0-9-]+)\/ads$/)) && req.method === "GET") {
      return handleApiV1ClientAds(req, env, v1m[1]);
    }
    if ((v1m = path.match(/^\/api\/v1\/clients\/([a-z0-9-]+)\/google-ads$/)) && req.method === "GET") {
      return handleApiV1ClientGoogleAds(req, env, v1m[1]);
    }
    if ((v1m = path.match(/^\/api\/v1\/clients\/([a-z0-9-]+)\/lead-attribution$/)) && req.method === "GET") {
      return handleApiV1ClientLeadAttribution(req, env, v1m[1]);
    }
    if (path === "/api/v1/state/snapshot" && req.method === "POST") return handleApiV1SnapshotIngest(req, env);
    if (path === "/api/v1/runs" && req.method === "GET") return handleApiV1RunsList(req, env);
    if (path === "/api/v1/runs" && req.method === "POST") return handleApiV1RunCreate(req, env);
    if ((v1m = path.match(/^\/api\/v1\/runs\/(\d+)$/)) && req.method === "PATCH") {
      return handleApiV1RunPatch(req, env, parseInt(v1m[1], 10));
    }
    if ((v1m = path.match(/^\/api\/v1\/runs\/(\d+)\/events$/)) && req.method === "POST") {
      return handleApiV1RunEventCreate(req, env, parseInt(v1m[1], 10));
    }
    if ((v1m = path.match(/^\/api\/v1\/clients\/([a-z0-9-]+)\/deliverables\/([a-z0-9_]+)$/)) && req.method === "PATCH") {
      return handleApiV1DeliverableStatePatch(req, env, v1m[1], v1m[2]);
    }

    // API legacy (per-cliente seocontent dashboard)
    let m;
    if ((m = path.match(/^\/api\/([^/]+)\/state$/)) && req.method === "GET") {
      return handleGetState(req, env, m[1]);
    }
    if ((m = path.match(/^\/api\/([^/]+)\/state\/(.+)$/)) && req.method === "POST") {
      return handleSetState(req, env, m[1], m[2], ctx);
    }

    // Static assets (CSS/JS)
    if (path.startsWith("/assets/")) {
      return env.ASSETS.fetch(req);
    }

    // Health check
    if (path === "/health") return jsonResponse({ ok: true, ts: new Date().toISOString() });

    // Dashboard por slug: /<slug>
    if (path === "/" || path === "") {
      return htmlResponse(
        `<!doctype html><html><body style="font-family:system-ui;padding:40px;background:#000;color:#fff">
         <h1>SEO Content — Dashboard de aprovação</h1>
         <p>Acesse via menu da sua sub-conta CRM Funnels.</p>
         </body></html>`,
        200,
        env.ALLOWED_FRAME_ORIGINS || ""
      );
    }
    const slugMatch = path.match(/^\/([a-z0-9-]+)\/?$/i);
    if (slugMatch && req.method === "GET") {
      return handleDashboard(req, env, slugMatch[1]);
    }

    return jsonResponse({ error: "not found" }, 404);
  },

  async scheduled(controller, env, ctx) {
    ctx.waitUntil(handleCron(controller, env, ctx));
  },
};
