-- ═══════════════════════════════════════════════════════════════════════════
-- What a campaign is: outreach, or a broadcast.
--
-- WHY (Ayush, 2026-11-08): "the ai sdr kubecon was not even outreach, it was an
-- automated campaign to send event invites." Akhil's harness.io meeting was credited
-- to AI_SDR_Kubecon_2026_Li, and 17 meetings to the Fundraise announcement, because
-- the attribution took whichever campaign had last reached the company. A broadcast
-- keeps its own sends and positive replies, "each campaign's positive response should
-- be counted", but a meeting's campaign is only the outreach it came from
-- (lib/outreach/meeting-credit.js), so a broadcast never claims one.
--
-- The broadcasts are the ones Ayush confirmed ("all are broadcast"): event invites
-- (KubeCon, including Muni's KubeCon emails, and the SF cocktail party), the
-- fundraise announcement, hiring, and partner outreach. A campaign with no row here
-- is outreach. A new broadcast needs a row; nothing guesses from a name.
--
-- ┌─────────────────────────────────────────────────────────────────────────┐
-- │ Writes only dash_* objects. IDEMPOTENT — safe to run multiple times.    │
-- └─────────────────────────────────────────────────────────────────────────┘
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS dash_campaign_kinds (
  campaign_id TEXT PRIMARY KEY REFERENCES dash_campaigns(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('outreach', 'broadcast')),
  note        TEXT,
  updated_by  TEXT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO dash_campaign_kinds (campaign_id, kind, note, updated_by)
SELECT c.id, 'broadcast', v.note, 'migration 031'
  FROM (VALUES
    ('instantly:8a50b4cc-c3d8-40ef-820b-8ec2e2d8c631', 'Fundraise announcement'),
    ('instantly:a5a94af7-927a-47ee-aa81-18443d71c1fa', 'Fund raise announcement'),
    ('heyreach:570271',                                'SF-Cocktail-Party: event invite'),
    ('heyreach:663731',                                'AI_SDR_Kubecon_2026_Li: event invite'),
    ('instantly:a0760d77-fdee-4600-a41c-0106904df3c5', 'AI_SDR_Kubecon_2026_T1: event invite'),
    ('instantly:a5801a6a-630e-40fd-81ae-0c66b3c93dbe', 'AI_SDR_p3 kubecon outreach nba: event invite'),
    ('instantly:2a017789-f408-4b1b-97ba-fcdf70c9d824', 'Muni_Kubecon_19Feb: event invite'),
    ('instantly:4cd1e78e-2988-4ecb-a1a6-c3268ebaa487', 'Muni_Kubecon_4Mar: event invite'),
    ('heyreach:648362',                                'Partner Outreach P0'),
    ('heyreach:424897',                                'AM Hiring Outreach'),
    ('instantly:c74c8cf7-b832-4061-8bcf-733703cf9d57', 'AE Hiring campaign'),
    ('instantly:4e47e17e-a8b0-4065-a20d-fb5989252016', 'AE Hiring campaign (copy)'),
    ('instantly:649b9a8a-23bd-4442-8c25-7d67f9f1757a', 'SDR Hiring campaign'),
    ('instantly:0847bf06-5fd1-4989-b5ae-d37db30699b4', 'SDR Hiring campaign (copy)')
  ) AS v(id, note)
  JOIN dash_campaigns c ON c.id = v.id
ON CONFLICT (campaign_id) DO NOTHING;
