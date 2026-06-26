-- ─────────────────────────────────────────────────────────────────────────
-- Plataforma Interna da Agência v1 — Seed dos 10 clientes
-- Idempotente: re-rodar atualiza metadados estruturais (display_name, niche,
-- etc) mas PRESERVA brand_profile, status e created_at.
--
-- Aplicar:
--   wrangler d1 execute agency-platform-db --remote --file=migrations/0002_seed_clients.sql
-- ─────────────────────────────────────────────────────────────────────────

-- ─── 10 CLIENTES ATIVOS (2026-05-12) ────────────────────────────────────
-- Eixos: market | business_model | niche | language
-- brand_profile fica NULL até import dos brand-profile.json existentes.

INSERT INTO clients (slug, legacy_id, display_name, market, business_model, niche, language) VALUES
    ('floor-to-ceiling',              'FLOOR_TO_CEILING',              'Floor to Ceiling',             'us', 'services_local',     'Hose Cleaning',                'en'),
    ('jrs-flooring',                  'JRS_FLOORING',                  'JR''S Flooring',               'us', 'services_local',     'Hardwood Flooring',            'en'),
    ('mendes-flooring',               'MENDES_FLOORING',               'Mendes Flooring',              'us', 'services_local',     'Hardwood Flooring',            'en'),
    ('oma-head-spa',                  'OMA_HEAD_SPA',                  'Oma Head Spa',                 'pt', 'services_local',     'Serviços Estéticos',           'pt_pt'),
    ('odontoconnect',                 'ODONTOCONNECT',                 'OdontoConnect',                'br', 'clinic',             'Clínica Odontológica',         'pt_br'),
    ('dental-solution',               'DENTAL_SOLUTION',               'Dental Solution',              'br', 'b2b_saas',           'Sistemas pra Clínicas',        'pt_br'),
    ('ballarin-sou-viver-milao',      'BALLARIN_SOU_VIVER_MILAO',      'Ballarin · Sou Viver Milão',   'br', 'real_estate_launch', 'Lançamento MCMV',              'pt_br'),
    ('investbens-residencial-serraria','INVESTBENS_RESIDENCIAL_SERRARIA','Investbens · Residencial Serraria','br','real_estate_launch','Lançamento MCMV Serraria',   'pt_br'),
    ('alex-sscia',                    'ALEX_SSCIA',                    'Alex Priete · ConsultorIA',    'br', 'infoproduct',        'Mentoria/Infoproduto IA',      'pt_br'),
    ('allan-priete',                  'ALLAN_PRIETE',                  'Allan Priete',                 'br', 'infoproduct',        'Infoproduto',                  'pt_br')
ON CONFLICT(slug) DO UPDATE SET
    legacy_id      = excluded.legacy_id,
    display_name   = excluded.display_name,
    market         = excluded.market,
    business_model = excluded.business_model,
    niche          = excluded.niche,
    language       = excluded.language,
    updated_at     = datetime('now');
    -- INTENCIONAL: NÃO sobrescreve brand_profile, status nem created_at.

-- ─── DELIVERABLES INICIAIS (onboarding pendente pra todos) ──────────────
-- Cada cliente começa com 6 deliverables de onboarding em status 'pending'.
-- Steady-state deliverables serão criados pelo MESTRE conforme onboarding
-- avança e integrations ficam 'verified'.
--
-- Lista vem do delivery-catalog.yaml seção `onboarding`/categoria onboarding:
--   brand_profile_completion, ghl_location_setup, gsc_oauth_link,
--   sitemap_submission, keyword_cluster_research, meta_ads_account_link,
--   meta_pixel_capi_setup, krob_tracking_setup, ig_account_connect,
--   linkedin_account_connect, google_ads_setup, google_lsa_setup,
--   quiz_funnel_setup
--
-- Inserimos TODOS pra TODOS — policy MESTRE faz skip silencioso quando
-- credencial necessária não existe.

-- 10 clientes × 13 deliverables = 130 rows.
-- Compound SELECT/UNION ALL hit D1's "too many terms" limit, então geramos explícito.
INSERT INTO deliverables_state (client_slug, deliverable_id, category, status) VALUES
    ('floor-to-ceiling', 'brand_profile_completion', 'onboarding', 'pending'),
    ('floor-to-ceiling', 'ghl_location_setup', 'onboarding', 'pending'),
    ('floor-to-ceiling', 'gsc_oauth_link', 'onboarding', 'pending'),
    ('floor-to-ceiling', 'sitemap_submission', 'onboarding', 'pending'),
    ('floor-to-ceiling', 'keyword_cluster_research', 'onboarding', 'pending'),
    ('floor-to-ceiling', 'meta_ads_account_link', 'onboarding', 'pending'),
    ('floor-to-ceiling', 'meta_pixel_capi_setup', 'onboarding', 'pending'),
    ('floor-to-ceiling', 'krob_tracking_setup', 'onboarding', 'pending'),
    ('floor-to-ceiling', 'ig_account_connect', 'onboarding', 'pending'),
    ('floor-to-ceiling', 'linkedin_account_connect', 'onboarding', 'pending'),
    ('floor-to-ceiling', 'google_ads_setup', 'onboarding', 'pending'),
    ('floor-to-ceiling', 'google_lsa_setup', 'onboarding', 'pending'),
    ('floor-to-ceiling', 'quiz_funnel_setup', 'onboarding', 'pending'),
    ('jrs-flooring', 'brand_profile_completion', 'onboarding', 'pending'),
    ('jrs-flooring', 'ghl_location_setup', 'onboarding', 'pending'),
    ('jrs-flooring', 'gsc_oauth_link', 'onboarding', 'pending'),
    ('jrs-flooring', 'sitemap_submission', 'onboarding', 'pending'),
    ('jrs-flooring', 'keyword_cluster_research', 'onboarding', 'pending'),
    ('jrs-flooring', 'meta_ads_account_link', 'onboarding', 'pending'),
    ('jrs-flooring', 'meta_pixel_capi_setup', 'onboarding', 'pending'),
    ('jrs-flooring', 'krob_tracking_setup', 'onboarding', 'pending'),
    ('jrs-flooring', 'ig_account_connect', 'onboarding', 'pending'),
    ('jrs-flooring', 'linkedin_account_connect', 'onboarding', 'pending'),
    ('jrs-flooring', 'google_ads_setup', 'onboarding', 'pending'),
    ('jrs-flooring', 'google_lsa_setup', 'onboarding', 'pending'),
    ('jrs-flooring', 'quiz_funnel_setup', 'onboarding', 'pending'),
    ('mendes-flooring', 'brand_profile_completion', 'onboarding', 'pending'),
    ('mendes-flooring', 'ghl_location_setup', 'onboarding', 'pending'),
    ('mendes-flooring', 'gsc_oauth_link', 'onboarding', 'pending'),
    ('mendes-flooring', 'sitemap_submission', 'onboarding', 'pending'),
    ('mendes-flooring', 'keyword_cluster_research', 'onboarding', 'pending'),
    ('mendes-flooring', 'meta_ads_account_link', 'onboarding', 'pending'),
    ('mendes-flooring', 'meta_pixel_capi_setup', 'onboarding', 'pending'),
    ('mendes-flooring', 'krob_tracking_setup', 'onboarding', 'pending'),
    ('mendes-flooring', 'ig_account_connect', 'onboarding', 'pending'),
    ('mendes-flooring', 'linkedin_account_connect', 'onboarding', 'pending'),
    ('mendes-flooring', 'google_ads_setup', 'onboarding', 'pending'),
    ('mendes-flooring', 'google_lsa_setup', 'onboarding', 'pending'),
    ('mendes-flooring', 'quiz_funnel_setup', 'onboarding', 'pending'),
    ('oma-head-spa', 'brand_profile_completion', 'onboarding', 'pending'),
    ('oma-head-spa', 'ghl_location_setup', 'onboarding', 'pending'),
    ('oma-head-spa', 'gsc_oauth_link', 'onboarding', 'pending'),
    ('oma-head-spa', 'sitemap_submission', 'onboarding', 'pending'),
    ('oma-head-spa', 'keyword_cluster_research', 'onboarding', 'pending'),
    ('oma-head-spa', 'meta_ads_account_link', 'onboarding', 'pending'),
    ('oma-head-spa', 'meta_pixel_capi_setup', 'onboarding', 'pending'),
    ('oma-head-spa', 'krob_tracking_setup', 'onboarding', 'pending'),
    ('oma-head-spa', 'ig_account_connect', 'onboarding', 'pending'),
    ('oma-head-spa', 'linkedin_account_connect', 'onboarding', 'pending'),
    ('oma-head-spa', 'google_ads_setup', 'onboarding', 'pending'),
    ('oma-head-spa', 'google_lsa_setup', 'onboarding', 'pending'),
    ('oma-head-spa', 'quiz_funnel_setup', 'onboarding', 'pending'),
    ('odontoconnect', 'brand_profile_completion', 'onboarding', 'pending'),
    ('odontoconnect', 'ghl_location_setup', 'onboarding', 'pending'),
    ('odontoconnect', 'gsc_oauth_link', 'onboarding', 'pending'),
    ('odontoconnect', 'sitemap_submission', 'onboarding', 'pending'),
    ('odontoconnect', 'keyword_cluster_research', 'onboarding', 'pending'),
    ('odontoconnect', 'meta_ads_account_link', 'onboarding', 'pending'),
    ('odontoconnect', 'meta_pixel_capi_setup', 'onboarding', 'pending'),
    ('odontoconnect', 'krob_tracking_setup', 'onboarding', 'pending'),
    ('odontoconnect', 'ig_account_connect', 'onboarding', 'pending'),
    ('odontoconnect', 'linkedin_account_connect', 'onboarding', 'pending'),
    ('odontoconnect', 'google_ads_setup', 'onboarding', 'pending'),
    ('odontoconnect', 'google_lsa_setup', 'onboarding', 'pending'),
    ('odontoconnect', 'quiz_funnel_setup', 'onboarding', 'pending'),
    ('dental-solution', 'brand_profile_completion', 'onboarding', 'pending'),
    ('dental-solution', 'ghl_location_setup', 'onboarding', 'pending'),
    ('dental-solution', 'gsc_oauth_link', 'onboarding', 'pending'),
    ('dental-solution', 'sitemap_submission', 'onboarding', 'pending'),
    ('dental-solution', 'keyword_cluster_research', 'onboarding', 'pending'),
    ('dental-solution', 'meta_ads_account_link', 'onboarding', 'pending'),
    ('dental-solution', 'meta_pixel_capi_setup', 'onboarding', 'pending'),
    ('dental-solution', 'krob_tracking_setup', 'onboarding', 'pending'),
    ('dental-solution', 'ig_account_connect', 'onboarding', 'pending'),
    ('dental-solution', 'linkedin_account_connect', 'onboarding', 'pending'),
    ('dental-solution', 'google_ads_setup', 'onboarding', 'pending'),
    ('dental-solution', 'google_lsa_setup', 'onboarding', 'pending'),
    ('dental-solution', 'quiz_funnel_setup', 'onboarding', 'pending'),
    ('ballarin-sou-viver-milao', 'brand_profile_completion', 'onboarding', 'pending'),
    ('ballarin-sou-viver-milao', 'ghl_location_setup', 'onboarding', 'pending'),
    ('ballarin-sou-viver-milao', 'gsc_oauth_link', 'onboarding', 'pending'),
    ('ballarin-sou-viver-milao', 'sitemap_submission', 'onboarding', 'pending'),
    ('ballarin-sou-viver-milao', 'keyword_cluster_research', 'onboarding', 'pending'),
    ('ballarin-sou-viver-milao', 'meta_ads_account_link', 'onboarding', 'pending'),
    ('ballarin-sou-viver-milao', 'meta_pixel_capi_setup', 'onboarding', 'pending'),
    ('ballarin-sou-viver-milao', 'krob_tracking_setup', 'onboarding', 'pending'),
    ('ballarin-sou-viver-milao', 'ig_account_connect', 'onboarding', 'pending'),
    ('ballarin-sou-viver-milao', 'linkedin_account_connect', 'onboarding', 'pending'),
    ('ballarin-sou-viver-milao', 'google_ads_setup', 'onboarding', 'pending'),
    ('ballarin-sou-viver-milao', 'google_lsa_setup', 'onboarding', 'pending'),
    ('ballarin-sou-viver-milao', 'quiz_funnel_setup', 'onboarding', 'pending'),
    ('investbens-residencial-serraria', 'brand_profile_completion', 'onboarding', 'pending'),
    ('investbens-residencial-serraria', 'ghl_location_setup', 'onboarding', 'pending'),
    ('investbens-residencial-serraria', 'gsc_oauth_link', 'onboarding', 'pending'),
    ('investbens-residencial-serraria', 'sitemap_submission', 'onboarding', 'pending'),
    ('investbens-residencial-serraria', 'keyword_cluster_research', 'onboarding', 'pending'),
    ('investbens-residencial-serraria', 'meta_ads_account_link', 'onboarding', 'pending'),
    ('investbens-residencial-serraria', 'meta_pixel_capi_setup', 'onboarding', 'pending'),
    ('investbens-residencial-serraria', 'krob_tracking_setup', 'onboarding', 'pending'),
    ('investbens-residencial-serraria', 'ig_account_connect', 'onboarding', 'pending'),
    ('investbens-residencial-serraria', 'linkedin_account_connect', 'onboarding', 'pending'),
    ('investbens-residencial-serraria', 'google_ads_setup', 'onboarding', 'pending'),
    ('investbens-residencial-serraria', 'google_lsa_setup', 'onboarding', 'pending'),
    ('investbens-residencial-serraria', 'quiz_funnel_setup', 'onboarding', 'pending'),
    ('alex-sscia', 'brand_profile_completion', 'onboarding', 'pending'),
    ('alex-sscia', 'ghl_location_setup', 'onboarding', 'pending'),
    ('alex-sscia', 'gsc_oauth_link', 'onboarding', 'pending'),
    ('alex-sscia', 'sitemap_submission', 'onboarding', 'pending'),
    ('alex-sscia', 'keyword_cluster_research', 'onboarding', 'pending'),
    ('alex-sscia', 'meta_ads_account_link', 'onboarding', 'pending'),
    ('alex-sscia', 'meta_pixel_capi_setup', 'onboarding', 'pending'),
    ('alex-sscia', 'krob_tracking_setup', 'onboarding', 'pending'),
    ('alex-sscia', 'ig_account_connect', 'onboarding', 'pending'),
    ('alex-sscia', 'linkedin_account_connect', 'onboarding', 'pending'),
    ('alex-sscia', 'google_ads_setup', 'onboarding', 'pending'),
    ('alex-sscia', 'google_lsa_setup', 'onboarding', 'pending'),
    ('alex-sscia', 'quiz_funnel_setup', 'onboarding', 'pending'),
    ('allan-priete', 'brand_profile_completion', 'onboarding', 'pending'),
    ('allan-priete', 'ghl_location_setup', 'onboarding', 'pending'),
    ('allan-priete', 'gsc_oauth_link', 'onboarding', 'pending'),
    ('allan-priete', 'sitemap_submission', 'onboarding', 'pending'),
    ('allan-priete', 'keyword_cluster_research', 'onboarding', 'pending'),
    ('allan-priete', 'meta_ads_account_link', 'onboarding', 'pending'),
    ('allan-priete', 'meta_pixel_capi_setup', 'onboarding', 'pending'),
    ('allan-priete', 'krob_tracking_setup', 'onboarding', 'pending'),
    ('allan-priete', 'ig_account_connect', 'onboarding', 'pending'),
    ('allan-priete', 'linkedin_account_connect', 'onboarding', 'pending'),
    ('allan-priete', 'google_ads_setup', 'onboarding', 'pending'),
    ('allan-priete', 'google_lsa_setup', 'onboarding', 'pending'),
    ('allan-priete', 'quiz_funnel_setup', 'onboarding', 'pending')
ON CONFLICT(client_slug, deliverable_id) DO NOTHING;
-- INTENCIONAL: DO NOTHING preserva qualquer mudança de status que já tenha
-- acontecido manualmente ou via run anterior.

-- ─── REGISTRO DA MIGRATION ──────────────────────────────────────────────
INSERT INTO _migrations (version, name) VALUES (2, '0002_seed_clients')
ON CONFLICT(version) DO NOTHING;

-- ─── SMOKE TEST (não executa nada, só pra verificar contagens) ──────────
-- Apos rodar essa migration, valide com:
--   wrangler d1 execute agency-platform-db --remote --command="SELECT COUNT(*) AS clients FROM clients;"
--   → deve retornar 10
--   wrangler d1 execute agency-platform-db --remote --command="SELECT COUNT(*) AS deliverables FROM deliverables_state;"
--   → deve retornar 130 (10 clientes × 13 deliverables de onboarding)
--   wrangler d1 execute agency-platform-db --remote --command="SELECT market, COUNT(*) FROM clients GROUP BY market;"
--   → br=6, us=3, pt=1
