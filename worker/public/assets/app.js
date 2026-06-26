// seocontent — frontend público de aprovação (embedded CRM Funnels)
// Slug + token vêm injetados em data-attrs do <body>

(function () {
  const SLUG = document.body.dataset.slug || "";
  const TOKEN = document.body.dataset.token || "";

  if (!SLUG || !TOKEN) {
    document.querySelector("#grid").innerHTML =
      '<div class="loading">⚠️ Acesso direto não permitido. Use o link da sua sub-conta CRM Funnels.</div>';
    return;
  }

  const API = `/api/${encodeURIComponent(SLUG)}`;
  const counts = { pending: 0, approved: 0, published: 0, rejected: 0, needs_review: 0 };

  async function fetchState() {
    try {
      const r = await fetch(`${API}/state?t=${encodeURIComponent(TOKEN)}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } catch (e) {
      return { error: e.message };
    }
  }

  function fmtDate(iso) {
    if (!iso) return "";
    try {
      const d = new Date(iso);
      return d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
    } catch { return ""; }
  }

  function renderRedoInfo(c, redoLimit) {
    const used = c.redo_count || 0;
    const remaining = redoLimit - used;
    if (used === 0 && c.status === "pending") {
      return `<div class="redo-info">✏️ Você tem ${redoLimit} ajuste${redoLimit === 1 ? "" : "s"} disponível${redoLimit === 1 ? "" : "is"} pra essa peça</div>`;
    }
    if (c.status === "needs_review" || (c.status === "rejected" && used > 0 && used < redoLimit)) {
      return `<div class="redo-info warning">🔄 Refazendo (${used}/${redoLimit} ajuste${used === 1 ? "" : "s"} usado${used === 1 ? "" : "s"})</div>`;
    }
    if (used >= redoLimit && (c.status === "pending" || c.status === "needs_review")) {
      return `<div class="redo-info locked">🔒 Limite de ajustes atingido. Aprove ou descarte.</div>`;
    }
    return "";
  }

  function escapeHtml(s) {
    return String(s || "").replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  }

  function statusLabel(s) {
    return ({pending:"AGUARDANDO",approved:"APROVADO",rejected:"AJUSTE PEDIDO",needs_review:"REFEITO · REVISAR",published:"PUBLICADO"})[s] || s;
  }

  // SVG icons das plataformas (mesmo padrão do creative-dashboard local)
  const PLATFORM_ICONS = {
    instagram: '<svg viewBox="0 0 24 24" fill="none"><rect x="3" y="3" width="18" height="18" rx="5" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="12" r="4" stroke="currentColor" stroke-width="1.8"/><circle cx="17.5" cy="6.5" r="1.2" fill="currentColor"/></svg>',
    facebook: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M13.5 22v-8h2.7l.4-3.1h-3.1V8.9c0-.9.3-1.5 1.6-1.5h1.7V4.6c-.3 0-1.3-.1-2.5-.1-2.5 0-4.2 1.5-4.2 4.3v2.4H7.4V14h2.7v8h3.4z"/></svg>',
    linkedin_profile: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M4.98 3.5C4.98 4.88 3.87 6 2.5 6S0 4.88 0 3.5C0 2.12 1.13 1 2.5 1s2.48 1.12 2.48 2.5zM5 8H0v16h5V8zm7.98 0H8.05v16h4.93v-8.4c0-4.6 5.96-5 5.96 0V24h4.93V13.86c0-7.7-8.78-7.4-10.89-3.62V8z"/></svg>',
    linkedin_page: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M4.98 3.5C4.98 4.88 3.87 6 2.5 6S0 4.88 0 3.5C0 2.12 1.13 1 2.5 1s2.48 1.12 2.48 2.5zM5 8H0v16h5V8zm7.98 0H8.05v16h4.93v-8.4c0-4.6 5.96-5 5.96 0V24h4.93V13.86c0-7.7-8.78-7.4-10.89-3.62V8z"/></svg>',
    google_business_profile: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C8.1 2 5 5.1 5 9c0 5.3 7 13 7 13s7-7.7 7-13c0-3.9-3.1-7-7-7zm0 9.5a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5z"/></svg>',
    tiktok: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M19.6 6.3a4.7 4.7 0 0 1-2.8-1c-.8-.6-1.4-1.5-1.6-2.5h-3v13.4c0 1.7-1.4 3-3 3s-3-1.4-3-3 1.4-3 3-3c.3 0 .6 0 .9.1V10c-.3 0-.6-.1-.9-.1A6.3 6.3 0 1 0 15.4 16V9.4c1.2.8 2.7 1.3 4.2 1.3V7.7c0-.5 0-.9.1-1.4z"/></svg>',
    youtube: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M23.5 6.2c-.3-1-1-1.8-2-2C19.6 3.7 12 3.7 12 3.7s-7.6 0-9.5.5c-1 .3-1.8 1-2 2C0 8.1 0 12 0 12s0 3.9.5 5.8c.3 1 1 1.8 2 2 1.9.5 9.5.5 9.5.5s7.6 0 9.5-.5c1-.3 1.7-1 2-2 .5-1.9.5-5.8.5-5.8s0-3.9-.5-5.8zM9.6 15.6V8.4l6.2 3.6-6.2 3.6z"/></svg>',
  };
  const PLATFORM_LABELS = {
    instagram: "Instagram",
    facebook: "Facebook",
    linkedin_profile: "LinkedIn (perfil)",
    linkedin_page: "LinkedIn (page)",
    google_business_profile: "Google Business",
    tiktok: "TikTok",
    youtube: "YouTube",
  };

  function renderPlatforms(platforms) {
    if (!platforms || platforms.length === 0) return "";
    const icons = platforms.map((p) => {
      const svg = PLATFORM_ICONS[p] || '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="currentColor"/></svg>';
      const label = PLATFORM_LABELS[p] || p;
      return `<span class="platform-icon" data-platform="${p}" title="Será publicado no ${label}">${svg}</span>`;
    }).join("");
    return `<div class="platforms"><span class="label">Posta em:</span>${icons}</div>`;
  }

  function renderYourDirection(c) {
    // Mostra a direção que o CLIENTE escreveu (rejected sem refazer ainda OU needs_review)
    const used = c.redo_count || 0;
    if (used > 0 && (c.direcao || c.motivo)) {
      const motivoBlock = c.motivo ? `<span class="field">Motivo: <b>${escapeHtml(c.motivo)}</b></span>` : "";
      const dirBlock = c.direcao ? `<span class="field">Direção: <b>${escapeHtml(c.direcao)}</b></span>` : "";
      return `<div class="your-direction"><strong>📝 Você pediu este ajuste:</strong>${motivoBlock}${dirBlock}</div>`;
    }
    return "";
  }

  function detectMediaType(c, url) {
    if (c.media_type) return c.media_type;
    if (url && /\.(mp4|webm|mov)(\?|$)/i.test(url)) return "video/mp4";
    return "image/jpeg";
  }

  function renderThumb(c, url) {
    if (!url) return '<div class="placeholder">aguardando render</div>';
    const mt = detectMediaType(c, url);
    if (mt.startsWith("video/")) {
      return `<video src="${escapeHtml(url)}" muted playsinline preload="metadata" loop class="video-thumb"></video>`;
    }
    return `<img src="${escapeHtml(url)}" alt="${escapeHtml(c.id)}" loading="lazy">`;
  }

  function renderCard(c, redoLimit, platforms) {
    const thumb = (c.urls && c.urls[0]) || "";
    const slot = c.slot_brt || c.scheduled_for || "";
    const used = c.redo_count || 0;
    const slideCount = c.urls ? c.urls.length : 0;
    const canReject = (c.status === "pending" || c.status === "needs_review") && used < redoLimit;
    const canApprove = c.status === "pending" || c.status === "needs_review";
    const captionLong = (c.caption || "").length > 200;
    const mediaType = c.media_type || (thumb && /\.(mp4|webm|mov)(\?|$)/i.test(thumb) ? "video/mp4" : "image/jpeg");
    const isVideo = mediaType.startsWith("video/");

    const urlsAttr = JSON.stringify(c.urls || []).replace(/"/g, "&quot;");
    const viewBtnLabel = isVideo
      ? "▶️ Reproduzir"
      : slideCount > 1 ? `📂 Ver ${slideCount} slides` : "";
    const slidesBtn = (isVideo || slideCount > 1)
      ? `<button class="btn-view-slides" data-id="${escapeHtml(c.id)}" type="button">${viewBtnLabel}</button>`
      : "";
    return `
      <article class="card" data-id="${c.id}" data-status="${c.status}" data-urls="${urlsAttr}" data-tema="${escapeHtml(c.tema || c.id)}" data-media-type="${mediaType}" data-kind="${c.kind || ""}">
        <div class="img-wrap">
          ${renderThumb(c, thumb)}
          <span class="badge-id">${escapeHtml(c.id)}</span>
          <span class="badge-status" data-status="${c.status}">${statusLabel(c.status)}</span>
          ${isVideo ? `<span class="badge-media">🎬 vídeo${c.duration_s ? " " + c.duration_s + "s" : ""}</span>` : ""}
          ${slidesBtn}
        </div>
        <div class="body">
          <div class="meta">${fmtDate(c.created_at)} · ${escapeHtml(slot)} · ${isVideo ? "vídeo" : slideCount + " " + (slideCount === 1 ? "slide" : "slides")}${c.aspect_ratio ? " · " + c.aspect_ratio : ""}</div>
          <h3 class="tema">${c.tema ? escapeHtml(c.tema) : "<em>sem tema</em>"}</h3>
          ${renderPlatforms(platforms)}
          ${c.caption ? `
            <div class="caption-wrap" data-expanded="false">
              <div class="caption-preview">${escapeHtml(c.caption)}</div>
              ${captionLong ? '<button class="caption-toggle" type="button">▼ Ver caption completa</button>' : ''}
            </div>
          ` : ""}
          ${renderRedoInfo(c, redoLimit)}
          ${renderYourDirection(c)}
          ${c.applied_direction ? `<div class="applied-direction"><strong>✨ Direção aplicada na refação:</strong> ${escapeHtml(c.applied_direction)}</div>` : ""}
          <div class="actions">
            <button class="btn btn-approve" data-id="${escapeHtml(c.id)}" ${!canApprove ? "disabled" : ""}>✓ Aprovar</button>
            <button class="btn btn-reject" data-id="${escapeHtml(c.id)}" ${!canReject ? "disabled" : ""}>${canReject ? "✗ Pedir ajuste" : "🔒 Sem ajustes"}</button>
          </div>
        </div>
      </article>
    `;
  }

  function updateStats(creatives) {
    Object.keys(counts).forEach((k) => (counts[k] = 0));
    creatives.forEach((c) => {
      const s = c.status || "pending";
      if (counts.hasOwnProperty(s)) counts[s]++;
    });
    document.getElementById("count-pending").textContent = counts.pending + counts.needs_review;
    document.getElementById("count-approved").textContent = counts.approved;
    document.getElementById("count-published").textContent = counts.published;
    // Tabs
    const agendados = counts.pending + counts.approved;
    const publicados = counts.published;
    const revisar = counts.needs_review + counts.rejected;
    const cAg = document.getElementById("tab-count-agendados");
    const cPub = document.getElementById("tab-count-publicados");
    const cRev = document.getElementById("tab-count-revisar");
    if (cAg) cAg.textContent = agendados;
    if (cPub) cPub.textContent = publicados;
    if (cRev) cRev.textContent = revisar;
    // Mostra aba "Revisar" só se tem item lá
    const revTab = document.querySelector('.tab[data-tab="revisar"]');
    if (revTab) revTab.hidden = revisar === 0;
  }

  let activeTab = "agendados";
  function statusInTab(status, tab) {
    if (tab === "agendados") return status === "pending" || status === "approved";
    if (tab === "publicados") return status === "published";
    if (tab === "revisar") return status === "needs_review" || status === "rejected";
    return true;
  }
  function applyTab() {
    document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === activeTab));
    document.querySelectorAll(".card").forEach((card) => {
      card.style.display = statusInTab(card.dataset.status, activeTab) ? "" : "none";
    });
  }
  // ── Lightbox (galeria de slides OU player de vídeo) ───────────────────────────────
  let lbState = { urls: [], idx: 0, title: "", mediaType: "image/jpeg" };

  function openLightbox(card) {
    let urls = [];
    try {
      urls = JSON.parse(card.dataset.urls || "[]");
    } catch (e) { urls = []; }
    if (!urls.length) return;
    lbState.urls = urls;
    lbState.idx = 0;
    lbState.title = (card.dataset.id || "") + (card.dataset.tema ? " — " + card.dataset.tema : "");
    lbState.mediaType = card.dataset.mediaType || "image/jpeg";
    renderLightbox();
    document.getElementById("lightbox").hidden = false;
    document.body.style.overflow = "hidden";
  }
  function closeLightbox() {
    document.getElementById("lightbox").hidden = true;
    document.body.style.overflow = "";
    // Pausa qualquer video em playback
    const stage = document.querySelector(".lightbox-stage");
    if (stage) {
      stage.querySelectorAll("video").forEach((v) => { v.pause(); });
    }
  }
  function navLightbox(delta) {
    const total = lbState.urls.length;
    lbState.idx = (lbState.idx + delta + total) % total;
    renderLightbox();
  }
  function renderLightbox() {
    const { urls, idx, title, mediaType } = lbState;
    const stage = document.querySelector(".lightbox-stage");
    if (!stage) return;
    const currentUrl = urls[idx] || "";
    const isVideo = mediaType.startsWith("video/") || /\.(mp4|webm|mov)(\?|$)/i.test(currentUrl);
    // Remove media existente
    stage.querySelectorAll("img, video").forEach((el) => el.remove());
    if (currentUrl) {
      let mediaEl;
      if (isVideo) {
        mediaEl = document.createElement("video");
        mediaEl.src = currentUrl;
        mediaEl.controls = true;
        mediaEl.autoplay = true;
        mediaEl.playsInline = true;
        mediaEl.id = "lightbox-img";  // mantém id legacy
      } else {
        mediaEl = document.createElement("img");
        mediaEl.src = currentUrl;
        mediaEl.id = "lightbox-img";
        mediaEl.alt = title;
      }
      stage.insertBefore(mediaEl, stage.firstChild);
    }
    document.getElementById("lightbox-current").textContent = idx + 1;
    document.getElementById("lightbox-total").textContent = urls.length;
    document.getElementById("lightbox-title").textContent = title;
    document.querySelector(".lightbox-prev").disabled = urls.length <= 1;
    document.querySelector(".lightbox-next").disabled = urls.length <= 1;
  }
  function setupLightbox() {
    document.querySelectorAll(".btn-view-slides").forEach((b) => {
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        const card = b.closest(".card");
        if (card) openLightbox(card);
      });
    });
    document.querySelectorAll(".card .img-wrap img").forEach((img) => {
      img.addEventListener("click", () => {
        const card = img.closest(".card");
        if (card) openLightbox(card);
      });
    });
    const lb = document.getElementById("lightbox");
    if (!lb || lb.dataset.bound === "1") return;
    lb.dataset.bound = "1";
    document.querySelector(".lightbox-close").addEventListener("click", closeLightbox);
    document.querySelector(".lightbox-prev").addEventListener("click", () => navLightbox(-1));
    document.querySelector(".lightbox-next").addEventListener("click", () => navLightbox(1));
    lb.addEventListener("click", (e) => { if (e.target === lb) closeLightbox(); });
    document.addEventListener("keydown", (e) => {
      if (lb.hidden) return;
      if (e.key === "Escape") closeLightbox();
      if (e.key === "ArrowLeft") navLightbox(-1);
      if (e.key === "ArrowRight") navLightbox(1);
    });
  }

  function setupCaptionToggle() {
    document.querySelectorAll(".caption-toggle").forEach((btn) => {
      btn.addEventListener("click", () => {
        const wrap = btn.closest(".caption-wrap");
        if (!wrap) return;
        const isExpanded = wrap.dataset.expanded === "true";
        wrap.dataset.expanded = isExpanded ? "false" : "true";
        btn.textContent = isExpanded ? "▼ Ver caption completa" : "▲ Recolher";
      });
    });
  }

  function setupTabs() {
    document.querySelectorAll(".tab").forEach((t) => {
      t.addEventListener("click", () => {
        activeTab = t.dataset.tab;
        applyTab();
      });
    });
  }

  async function setStatus(id, status, payload = {}) {
    const r = await fetch(`${API}/state/${encodeURIComponent(id)}?t=${encodeURIComponent(TOKEN)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status, ...payload }),
    });
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      alert(`Erro: ${err.error || r.statusText}`);
      return false;
    }
    return true;
  }

  function openRejectModal(id, tema) {
    const m = document.getElementById("reject-modal");
    document.getElementById("reject-target").textContent = tema || id;
    document.getElementById("reject-motivo").value = "";
    document.getElementById("reject-direcao").value = "";
    m.hidden = false;
    document.body.style.overflow = "hidden";
    document.getElementById("reject-confirm").onclick = async () => {
      const motivo = document.getElementById("reject-motivo").value.trim();
      const direcao = document.getElementById("reject-direcao").value.trim();
      if (!direcao) {
        alert("Por favor escreva a direção pra refazer — sem isso o conteúdo não tem como melhorar.");
        return;
      }
      const ok = await setStatus(id, "rejected", { motivo, direcao });
      if (ok) {
        m.hidden = true;
        document.body.style.overflow = "";
        load();
      }
    };
  }

  function setupActions() {
    document.querySelectorAll(".btn-approve").forEach((b) => {
      b.addEventListener("click", async () => {
        if (b.disabled) return;
        b.disabled = true;
        const ok = await setStatus(b.dataset.id, "approved");
        if (ok) load();
      });
    });
    document.querySelectorAll(".btn-reject").forEach((b) => {
      b.addEventListener("click", () => {
        if (b.disabled) return;
        const card = b.closest(".card");
        openRejectModal(b.dataset.id, card.querySelector(".tema")?.textContent);
      });
    });
    document.getElementById("reject-cancel").onclick = () => {
      document.getElementById("reject-modal").hidden = true;
      document.body.style.overflow = "";
    };
  }

  async function load() {
    const grid = document.getElementById("grid");
    grid.innerHTML = '<div class="loading">Carregando...</div>';
    const data = await fetchState();
    if (data.error) {
      grid.innerHTML = `<div class="loading">⚠️ ${data.error}</div>`;
      return;
    }
    if (data.client?.name) {
      document.getElementById("client-name").textContent = data.client.name;
    }
    const creatives = (data.creatives || []).filter((c) => c.status !== "archived");
    updateStats(creatives);
    if (creatives.length === 0) {
      grid.innerHTML = '<div class="loading">✨ Nenhum criativo no momento. Os próximos chegam aqui automaticamente.</div>';
      return;
    }
    // Ordem:
    //   1. precisa de ação (needs_review > pending > rejected) ordenados por scheduled ASC
    //   2. approved (próximos a publicar primeiro — ASC por scheduled_for)
    //   3. published (mais recente publicado primeiro — DESC por published_at)
    const groupOrder = { needs_review: 0, pending: 1, rejected: 2, approved: 3, published: 4 };
    creatives.sort((a, b) => {
      const ga = groupOrder[a.status] ?? 99;
      const gb = groupOrder[b.status] ?? 99;
      if (ga !== gb) return ga - gb;
      // Mesmo grupo:
      if (a.status === "published") {
        const pa = a.published_at || a.scheduled_for || "";
        const pb = b.published_at || b.scheduled_for || "";
        return pb.localeCompare(pa);  // DESC
      }
      // approved/pending/needs_review: próximo primeiro (ASC)
      const sa = a.scheduled_for || "";
      const sb = b.scheduled_for || "";
      return sa.localeCompare(sb);  // ASC
    });
    const clientPlatforms = data.client?.platforms || [];
    // Cada peça pode ter platforms próprio (override) — ex: GMB só posta em google_business_profile
    grid.innerHTML = creatives.map((c) => renderCard(c, data.redoLimit ?? 1, c.platforms || clientPlatforms)).join("");
    setupActions();
    setupCaptionToggle();
    setupLightbox();
    // Auto-seleciona aba: Revisar > Agendados > Publicados (vai pra onde tem o que importa)
    const counts2 = creatives.reduce((acc, c) => { acc[c.status] = (acc[c.status]||0) + 1; return acc; }, {});
    if ((counts2.needs_review || 0) > 0 && activeTab === "agendados" && !document._tabSelectedOnce) {
      activeTab = "revisar";
    }
    document._tabSelectedOnce = true;
    applyTab();
    document.getElementById("updated-at").textContent = "atualizado " + new Date().toLocaleTimeString("pt-BR");
  }

  document.addEventListener("DOMContentLoaded", () => {
    setupTabs();
    load();
    // Polling a cada 30s pra refletir mudanças (peça refeita pelo MESTRE)
    setInterval(load, 30000);
  });
})();
