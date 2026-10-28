-- Which Instantly workspace a campaign lives in.
--
-- A workspace is reachable only with its own API key, so the per-campaign jobs
-- (steps, leads) have to know which key to use before they can ask about a
-- campaign. Without this column every campaign looked like the original
-- workspace, so the 43 campaigns in the AI SDR send workspace — 811 sent
-- emails, 92 replies, 14 opportunities — were invisible to this dashboard
-- while every job reported itself complete.
--
-- 'instantly' is the original workspace, so the default is right for every row
-- already here. HeyReach campaigns keep it too: it is read only together with
-- platform = 'instantly'.
ALTER TABLE dash_campaigns ADD COLUMN IF NOT EXISTS workspace text NOT NULL DEFAULT 'instantly';

-- The campaigns job sweeps deleted rows per workspace, and the steps and leads
-- jobs walk one workspace's campaigns at a time.
CREATE INDEX IF NOT EXISTS dash_campaigns_platform_workspace_idx ON dash_campaigns (platform, workspace);
