-- ─────────────────────────────────────────────────────────────────────────
-- Plataforma Interna da Agência v1 — D1 Schema Inicial
-- Aprovado: 2026-05-11 | Aplicar em: agency-platform-db
-- Ref: _AGENCY/_opensquad/playbooks/delivery-catalog.yaml
--       _AGENCY/_opensquad/playbooks/brand-profile.schema.json
--
-- Como aplicar (Alex roda local):
--   cd _AGENCY/seocontent-worker
--   wrangler d1 create agency-platform-db        # devolve database_id
--   # adicionar binding em wrangler.toml com o database_id retornado
--   wrangler d1 execute agency-platform-db --remote --file=migrations/0001_init.sql
-- ─────────────────────────────────────────────────────────────────────────

PRAGMA foreign_keys = ON;

-- ─── TENANTS ─────────────────────────────────────────────────────────────
-- 1 row inicial (a agência do Alex). Multi-tenant whitelabel só destrava na Fase 4.
CREATE TABLE IF NOT EXISTS tenants (
    id            TEXT PRIMARY KEY,
    name          TEXT NOT NULL,
    owner_email   TEXT NOT NULL,
    domain        TEXT,
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ─── CLIENTS ─────────────────────────────────────────────────────────────
-- Source of truth dos 9 clientes. Eixos (market/business_model/niche/language)
-- são DESCRITIVOS — não controlam ativação de deliverable (gate = integrations).
CREATE TABLE IF NOT EXISTS clients (
    slug            TEXT PRIMARY KEY,
    tenant_id       TEXT NOT NULL DEFAULT 'alex-priete-agency',
    legacy_id       TEXT,
    display_name    TEXT NOT NULL,
    market          TEXT NOT NULL CHECK (market IN ('br','us','pt','es','other')),
    business_model  TEXT NOT NULL CHECK (business_model IN ('services_local','clinic','b2b_saas','real_estate_launch','infoproduct')),
    niche           TEXT,
    language        TEXT NOT NULL CHECK (language IN ('pt_br','en','pt_pt','es')),
    brand_profile   TEXT,
    status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','archived')),
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_clients_market ON clients(market);
CREATE INDEX IF NOT EXISTS idx_clients_business_model ON clients(business_model);
CREATE INDEX IF NOT EXISTS idx_clients_status ON clients(status);

-- ─── INTEGRATIONS ────────────────────────────────────────────────────────
-- Gate dos deliverables. Uma integração por canal por cliente. Sem credencial
-- válida aqui → policy MESTRE faz skip silencioso do deliverable que depende.
CREATE TABLE IF NOT EXISTS integrations (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    client_slug        TEXT NOT NULL,
    channel            TEXT NOT NULL CHECK (channel IN (
                          'ghl','gsc','google_ads','google_lsa',
                          'meta_ads','meta_pixel','ig_business','linkedin',
                          'tracking','quiz_funnel','higgsfield','windsor_ai'
                        )),
    status             TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','configured','verified','invalid','expired')),
    config             TEXT,
    last_verified_at   TEXT,
    last_error         TEXT,
    created_at         TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at         TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(client_slug, channel),
    FOREIGN KEY (client_slug) REFERENCES clients(slug) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_integrations_client ON integrations(client_slug);
CREATE INDEX IF NOT EXISTS idx_integrations_channel ON integrations(channel);
CREATE INDEX IF NOT EXISTS idx_integrations_status ON integrations(status);

-- ─── DELIVERABLES STATE ──────────────────────────────────────────────────
-- Estado atual de cada deliverable × cliente. Policy MESTRE consulta isto
-- pra decidir próxima ação. `deliverable_id` é o `id` do delivery-catalog.yaml.
CREATE TABLE IF NOT EXISTS deliverables_state (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    client_slug         TEXT NOT NULL,
    deliverable_id      TEXT NOT NULL,
    category            TEXT NOT NULL CHECK (category IN ('onboarding','steady_state','health')),
    status              TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','in_progress','done','skipped','failed','blocked')),
    last_dispatched_at  TEXT,
    last_completed_at   TEXT,
    next_due_at         TEXT,
    fail_count          INTEGER NOT NULL DEFAULT 0,
    skip_reason         TEXT,
    notes               TEXT,
    updated_at          TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(client_slug, deliverable_id),
    FOREIGN KEY (client_slug) REFERENCES clients(slug) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_deliverables_state_client ON deliverables_state(client_slug);
CREATE INDEX IF NOT EXISTS idx_deliverables_state_next_due ON deliverables_state(next_due_at);
CREATE INDEX IF NOT EXISTS idx_deliverables_state_status ON deliverables_state(status);

-- ─── RUNS ────────────────────────────────────────────────────────────────
-- Histórico de execuções do MESTRE (launchd 7h BRT ou manual via cockpit).
CREATE TABLE IF NOT EXISTS runs (
    id                       INTEGER PRIMARY KEY AUTOINCREMENT,
    trigger                  TEXT NOT NULL DEFAULT 'launchd_daily' CHECK (trigger IN ('launchd_daily','manual','cockpit','webhook')),
    status                   TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running','success','partial','failed')),
    started_at               TEXT NOT NULL DEFAULT (datetime('now')),
    finished_at              TEXT,
    clients_processed        INTEGER NOT NULL DEFAULT 0,
    deliverables_dispatched  INTEGER NOT NULL DEFAULT 0,
    deliverables_skipped     INTEGER NOT NULL DEFAULT 0,
    errors_count             INTEGER NOT NULL DEFAULT 0,
    duration_seconds         INTEGER,
    summary                  TEXT
);

CREATE INDEX IF NOT EXISTS idx_runs_started ON runs(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_runs_status ON runs(status);

-- ─── RUN EVENTS ──────────────────────────────────────────────────────────
-- Auditoria fina dentro de cada run. 1 row por decisão/dispatch/skip/error.
CREATE TABLE IF NOT EXISTS run_events (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id          INTEGER NOT NULL,
    client_slug     TEXT NOT NULL,
    deliverable_id  TEXT,
    event_type      TEXT NOT NULL CHECK (event_type IN ('decision','dispatch','skip','complete','error','approve','reject')),
    detail          TEXT,
    occurred_at     TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE,
    FOREIGN KEY (client_slug) REFERENCES clients(slug) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_run_events_run ON run_events(run_id);
CREATE INDEX IF NOT EXISTS idx_run_events_client ON run_events(client_slug);
CREATE INDEX IF NOT EXISTS idx_run_events_type ON run_events(event_type);

-- ─── APPROVALS ───────────────────────────────────────────────────────────
-- Fila de aprovações pendentes. Pode duplicar o que tá no KV pro seocontent
-- dashboard (canon: feedback_aprovacao_via_dashboard_canonico), mas com
-- estrutura relacional pra cockpit consultar cross-cliente.
CREATE TABLE IF NOT EXISTS approvals (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    client_slug     TEXT NOT NULL,
    deliverable_id  TEXT NOT NULL,
    artifact_kind   TEXT NOT NULL CHECK (artifact_kind IN ('copy','carousel','article','landing','email','ad_creative','video','report')),
    artifact_ref    TEXT,
    preview_url     TEXT,
    status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','published','expired')),
    feedback        TEXT,
    sla_hours       INTEGER NOT NULL DEFAULT 24,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    decided_at      TEXT,
    decided_by      TEXT,
    FOREIGN KEY (client_slug) REFERENCES clients(slug) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_approvals_status ON approvals(status);
CREATE INDEX IF NOT EXISTS idx_approvals_client ON approvals(client_slug);
CREATE INDEX IF NOT EXISTS idx_approvals_created ON approvals(created_at DESC);

-- ─── METRICS SNAPSHOTS ───────────────────────────────────────────────────
-- Séries temporais de KPIs cross-channel. 1 row por métrica × cliente × período.
-- Source: gsc | ghl | meta | google_ads | google_lsa | windsor | krob | manual.
CREATE TABLE IF NOT EXISTS metrics_snapshots (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    client_slug      TEXT NOT NULL,
    metric_id        TEXT NOT NULL,
    metric_category  TEXT NOT NULL CHECK (metric_category IN ('acquisition','conversion','revenue','engagement','health')),
    value            REAL NOT NULL,
    value_unit       TEXT CHECK (value_unit IN ('count','pct','currency_brl','currency_usd','currency_eur','position','seconds','ratio')),
    source           TEXT NOT NULL,
    period_start     TEXT NOT NULL,
    period_end       TEXT NOT NULL,
    captured_at      TEXT NOT NULL DEFAULT (datetime('now')),
    raw_payload      TEXT,
    FOREIGN KEY (client_slug) REFERENCES clients(slug) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_metrics_client_period ON metrics_snapshots(client_slug, period_end DESC);
CREATE INDEX IF NOT EXISTS idx_metrics_metric ON metrics_snapshots(metric_id);
CREATE INDEX IF NOT EXISTS idx_metrics_category ON metrics_snapshots(metric_category);

-- ─── SCHEMA VERSION TRACKING ─────────────────────────────────────────────
-- Tabela meta pra controlar migrations aplicadas.
CREATE TABLE IF NOT EXISTS _migrations (
    version     INTEGER PRIMARY KEY,
    name        TEXT NOT NULL,
    applied_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO _migrations (version, name) VALUES (1, '0001_init')
ON CONFLICT(version) DO NOTHING;

-- ─── TENANT INICIAL ──────────────────────────────────────────────────────
-- 1 tenant. Whitelabel multi-tenant fica em Fase 4 (CONGELADA).
INSERT INTO tenants (id, name, owner_email, domain) VALUES
    ('minha-agencia', 'Minha Agência', 'voce@exemplo.com', 'SEU-DOMINIO.com')
ON CONFLICT(id) DO NOTHING;
