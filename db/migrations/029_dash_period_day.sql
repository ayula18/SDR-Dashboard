-- Day-level activity per campaign, beside weeks and months, so a date range can be
-- exact and day on day can be counted at all (Ayush, 2026-11-06). Only widens the
-- check: rows already stored stay valid, and every reader of this table already
-- filters by grain. Instantly gives a day by a one-day analytics read; HeyReach's
-- daily stats already arrive with every campaign read.
ALTER TABLE dash_campaign_periods DROP CONSTRAINT IF EXISTS dash_campaign_periods_grain_check;
ALTER TABLE dash_campaign_periods ADD CONSTRAINT dash_campaign_periods_grain_check CHECK (grain IN ('day', 'week', 'month'));
