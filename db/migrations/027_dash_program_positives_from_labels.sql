-- ═══════════════════════════════════════════════════════════════════════════
-- Programs whose positives stay on our reply labels for now.
--
-- WHY (Ayush, 2026-11-05): SDR positives come from the positive response sheet
-- (026), but Dheeraj has not logged his HuggingFace and WVI replies there, so real
-- ones such as Lightricks vanished: HuggingFace went from 10 to 1 and WVI from 7 to
-- 1 for 29 Jun - 1 Nov. Until that log arrives these two programs keep our labels.
-- A row that IS on the sheet still counts, once, through the sheet.
--
-- WHEN THE LOG IS IN: set this back to FALSE in a new migration, and take the
-- programs out of LABELS_FOR_NOW in components/views/definitions.js.
--
-- ┌─────────────────────────────────────────────────────────────────────────┐
-- │ Writes only dash_* objects. IDEMPOTENT — safe to run multiple times.    │
-- └─────────────────────────────────────────────────────────────────────────┘
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE dash_programs ADD COLUMN IF NOT EXISTS positives_from_labels BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE dash_programs SET positives_from_labels = TRUE WHERE slug IN ('huggingface', 'wvi');
