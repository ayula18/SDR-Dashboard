@AGENTS.md

## Project notes

- Data lives in the Supabase database shared with the AI SDR app (`DATABASE_URL`, transaction pooler).
  - This app owns only `dash_*` tables and views. Migrations in `db/migrations` must stay additive.
  - Read AI SDR tables (`companies`, `ctx_events`, `sdr_users`) but never alter them.
  - Never run session-level `SET` through the pooler; it leaks into other clients. `lib/db.js` runs writes in `BEGIN READ WRITE` transactions.
- `lib/sync`, `lib/metrics`, `lib/outreach` and `lib/db.js` are shared by route handlers and plain-node scripts, so they use relative imports with `.js` extensions (no `@/`).
- Commands:
  - `npm run db:migrate`
  - `npm run sync` (add `-- --full` to backfill, or name a job)
  - `npm run import:meetings`
- Attribution: SDR, program and theme are parsed from campaign names (`lib/outreach/campaign-parser.js`) and corrected with `dash_campaign_overrides`. HeyReach sender accounts are senior people, not SDRs.
- Who pulls what: the AI SDR app pulls message content (Instantly emails, HeyReach conversations) into `ctx_events` from its own daily cron. This app never calls Instantly `/emails` and never copies reply text; `reply-verdicts` and `reply-classify` read the archive and store only labels.
- Reply labels: GPT-4.1 mini (`lib/reply-llm.js`) labels a reply once per md5 fingerprint of its archived text and `PROMPT_VERSION`. Metrics and the AI SDR app read labels through `dash_v_reply_verdicts`.
- HeyReach is read-only and throttled to ~100 requests/min in `lib/outreach/heyreach.js`; keep every HeyReach call a read. `heyreach-leads` stores each campaign's people in `dash_linkedin_leads`, re-reading a campaign only while it runs or when its status changes.
- Companies across channels: a LinkedIn person's company is resolved to a domain by `lib/outreach/linkedin.js`; admin mappings in `dash_company_aliases` override it through `dash_v_linkedin_leads`. The company is the unit email and LinkedIn share.
- Views live in `900_dash_views.sql`, which is re-applied on every migrate and sorts after every table migration.
- Program pages (`getProgramDetail`) default to everything since the program's first campaign and take `channel` (both | email | linkedin). Conversations (`lib/metrics/conversation.js`) read message text from `ctx_events` when someone opens one; never copy that text into `dash_*` tables.
