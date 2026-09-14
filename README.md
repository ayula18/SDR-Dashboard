# SDR Command Center

Outreach analytics for the Reo.Dev GTM team: Instantly and HeyReach activity, the
meetings audit sheet, and allocation, analysed by SDR, program, company, message angle
and segment, week on week and month on month.

## Setup

```bash
cp .env.example .env.local   # shares DATABASE_URL and Google sign-in with the AI SDR app
npm install
npm run db:migrate           # creates dash_* tables and views (additive only)
npm run sync -- --full       # backfill from DASH_START_DATE (~10 min)
npm run dev                  # http://localhost:3002 (3000 is the AI SDR app)
```

Sign-in is Google, limited to `AUTH_ALLOWED_DOMAINS`. Every signed-in user sees the whole board.
Admin actions follow `sdr_users.role = 'admin'`, the same table and roles as the AI SDR app.

Google only sends sign-ins back to redirect URIs registered on the OAuth client this app shares
with the AI SDR app; anything else stops at Google with `redirect_uri_mismatch`. Register
`http://localhost:3002/api/auth/callback/google` for local dev (the port is pinned in `package.json`)
and `https://<deployment domain>/api/auth/callback/google` for each deployment. Both apps use the
same `AUTH_SECRET` and cookie names, so signing in to the AI SDR app on `localhost:3000` also signs
you in here.

## Where the numbers come from

| Data | Source | Sync job |
|---|---|---|
| Campaigns, lifetime totals | Instantly `/campaigns`, `/campaigns/analytics` | `instantly-campaigns` |
| Sent, leads contacted, auto-replies, bounces per week/month | Instantly analytics by date range | `instantly-periods` |
| Leads: allocation, contact, replies, interest status, replied step | Instantly `/leads/list` | `instantly-leads` |
| Per step and A/B variant results with copy | Instantly `/campaigns/analytics/steps` | `instantly-steps` |
| LinkedIn invites, acceptances, messages, replies per campaign | HeyReach campaigns and stats (needs `HEYREACH_API_KEY`) | `heyreach` |
| LinkedIn people in each campaign: company, title, sender, invite, message and reply status | HeyReach campaign leads | `heyreach-leads` |
| Replies and their text | The AI SDR app's Instantly and HeyReach syncs, archived in `ctx_events` | `reply-verdicts` (reads the archive) |
| Reply labels | GPT-4.1 mini on Azure reads each reply's own words from `ctx_events` (keyword rules until then) | `reply-classify` |
| Meetings booked, held, qualified, deal value | "Qualified Meetings 2026 - Happened Audit" CSV | `meetings-csv` / admin import |

**Who pulls what.** Each kind of data is pulled by one app, and both apps can read everything.

- **The AI SDR app pulls message content.** That covers every Instantly email and every HeyReach
  conversation. It writes them to `ctx_events` daily from its own cron (`/api/cron/context-sync`),
  an hour before this app's cron.
- **This app never calls Instantly `/emails`** and never copies reply text into `dash_*`. It keeps
  only each reply's label, a one-line reason, the model and prompt tag, an md5 fingerprint of the
  archived text, and a 160-character quote.
- **A reply goes to the model only when its fingerprint or the prompt version changes.** A reply
  with no usable answer gets one more try, then is recorded as not labelled and never sent again
  for the same text.
- **One reply per call.** Batching let neighbouring replies sway borderline decisions. Labelled
  twice, "did they say no" differed on 7 of 192 replies with batches of 20 and on 3 with one reply
  per call, at about $0.40 per 1,000 replies.
- **HeyReach is only read.** This app calls four read endpoints (campaign list, campaign people,
  sender accounts, stats), spaced to at most ~100 requests a minute, a third of the API key's
  limit. None of them makes a sender account do anything on LinkedIn.
- **A campaign's people are read once**, then again only while the campaign runs or when its
  status changes, so a normal day reads just the running campaigns.
- **Data health and the warnings banner show the AI SDR syncs**, so a stalled connector is
  visible here too.

The daily cron (`vercel.json`) runs every job incrementally within one ~5-minute function call.
Campaigns, weekly numbers, reply sentiment and meetings go first. Leads and step analytics go
last and continue where they stopped on the next run. Every API request times out after 30s
and retries.

- Check your Vercel plan's cron frequency and function duration limits.
- For a complete refresh without a time limit, run `npm run sync` anywhere with the env
  (e.g. a scheduled GitHub Action), or call `POST /api/sync` as an admin.

**Attribution.** Instantly sends from shared mailboxes, so SDR, program, theme, segment and region
are parsed from campaign names (`lib/outreach/campaign-parser.js`), e.g. `Akhil_ShortOSS-June2026`
or `Suman_CR_starting31Aug`. Test, webhook and deliverability campaigns are excluded automatically.
Admins correct anything else per campaign. HeyReach sender accounts are senior people, not SDRs,
and are kept as a separate `senders` field.

## Companies across email and LinkedIn

An Instantly campaign often targets one company, while a HeyReach campaign is a batch of people
at many companies, and its name never says which. The company is what both channels share, so
program pages lead with one row per company, email and LinkedIn side by side.

- **A LinkedIn person's company comes from their profile** and becomes a domain in this order
  (`lib/outreach/linkedin.js`): the AI SDR archive already resolved the same person; exactly one
  company in `companies` has the name; several do and email outreach has clearly worked one of
  them. The LinkedIn company link on profiles is not used, because it often points at another company.
- **Anything else keeps its LinkedIn name without a domain.** Data health lists these names, and an
  admin maps each one to a domain or marks it as not a company (`dash_company_aliases`). A mapping
  applies immediately to everyone at that company, including people synced later.
- **A LinkedIn reply belongs to the latest campaign that added its writer before it came in**, so
  someone in two campaigns is not counted as replying twice.

## Definitions

- **Leads contacted**: leads emailed for the first time in the period (Instantly's new leads contacted).
- **Replied**: a lead with a human reply. Out-of-office and other auto-replies don't count, and
  neither do off-topic messages such as job requests or people pitching us.
- **Negative**: replied and said no. That means marked Not Interested or Lost in Instantly,
  unsubscribed, or the reply was labelled declined or unsubscribed.
- **Positive**: replied, not negative, and a clear yes or not now. That means a reply labelled
  interested or not now, or a lead the SDR marked Interested, Meeting booked, Meeting completed or
  Won in Instantly. A reply with no clear intent (such as "we're already a customer") or from the
  wrong person counts as replied, not positive.
- **Reply labels**: GPT-4.1 mini (`lib/reply-llm.js`) reads only the prospect's own words and picks
  interested, not now, wrong person, replied (no clear intent), off-topic, declined, unsubscribed
  or auto-reply. Until the model has read a reply, the keyword rules in `lib/reply-sentiment.js`
  label it. Changing `PROMPT_VERSION` relabels every reply on the next sync.
- **Positive rate**: positive replies ÷ leads contacted.
- **LinkedIn people**: everyone added to a HeyReach campaign. Someone in several campaigns counts
  once in any total.
- **Invited / accepted / messaged**: a connection request went out / was accepted / a message went
  out (after acceptance, or to an existing connection). **Reached** is invited or messaged.
- **LinkedIn replied**: a human reply. Once the reply is archived and labelled the labels decide, as
  for email; until then HeyReach's own replied status does. Positive and negative follow the same
  reply labels as email (HeyReach has no SDR interest marks).
- **Acceptance rate**: accepted ÷ invited. **LinkedIn reply rate**: replied ÷ messaged.
- **Best reply**: for a person, their latest no if they said no, otherwise their best reply; for a
  company, the best across its people.
- **Company stage**: the furthest a company got on either channel, best first: meeting, positive
  reply, replied (no clear yes or no), connected on LinkedIn, contacted, said no (everyone who
  replied said no), not contacted.
- **Meetings**: rows in the audit sheet, dated by meeting date. **Held** = audited "Yes".
  Outreach views count outbound meetings plus any meeting attributed to a campaign.
- **Meeting attribution**: the campaign that loaded a lead at the same company in the 180 days
  before the meeting, preferring leads that replied. A LinkedIn campaign counts meetings at the
  companies it reached within 180 days of adding the first person there.
- **Ranges**: whole weeks (Monday start) or months. The comparison is the previous range of the
  same length. While a range is still running, date-based numbers use the same elapsed days
  and platform volumes are pro-rated.
- **Cohort views** (What's Working, coverage) follow leads loaded in the range to whatever happened
  later. Rates under 100 contacted leads are flagged `lowSample`.

## API

All endpoints require a session and return JSON. Shared query params:
`range` (`this-week`, `last-week`, `last-4-weeks`, `last-12-weeks`, `this-month`, `last-month`,
`last-3-months`, `ytd`) or `from`/`to`, plus `grain` (`week`|`month`), `sdr`, `program`, `theme`.

| Endpoint | What it returns |
|---|---|
| `GET /api/meta` | SDRs, programs, themes, range presets, data warnings |
| `GET /api/metrics/overview` | KPIs vs previous period with sparklines, outreach funnel, LinkedIn block, 12-period trend |
| `GET /api/metrics/trends?count=12` | Weekly/monthly series with WoW / MoM comparison |
| `GET /api/metrics/sdrs` | Leaderboard with rates and change |
| `GET /api/metrics/sdrs/:name` | One SDR: overview, what works by theme/program/segment/step, campaigns, meetings |
| `GET /api/metrics/campaigns?show=&q=&platform=` | Campaigns on both channels with companies, whole-campaign results and activity in the range. `show`: `active` (default), `current` (running or active in range), `running`, `all` |
| `GET /api/metrics/campaigns/:id` | Email: funnel, weekly trend, steps with copy, replies, accounts, meetings. LinkedIn: people and company funnels, companies, senders, replies |
| `GET /api/metrics/programs` | Every program's volume, lead and account funnels, period change |
| `GET /api/metrics/programs/:slug?since=` | Companies across both channels, campaigns, funnels, trend, by SDR, meetings, replies |
| `GET /api/metrics/meetings?channel=` | Totals, breakdowns (channel, SDR, program, segment, size, OSS), trend, list |
| `GET /api/metrics/insights` | SDR × theme matrix, firmographics, sequence steps, best copy, LinkedIn by sender |
| `GET /api/metrics/coverage?q=` | Allocation by load week and SDR, re-loaded and shared accounts, account table |
| `GET /api/health` | Setup gaps, sync runs, freshness, unmapped campaigns, LinkedIn companies without a domain, program membership, roster |

Admin only:

| Endpoint | Body |
|---|---|
| `POST /api/sync` | `{ jobs?: string[], mode?: 'incremental' \| 'full' }` |
| `PATCH /api/admin/campaigns/:id` | `{ sdr?, program?, theme?, segment?, excluded?, note? }` (`null` restores the parsed value, `''` clears it) |
| `DELETE /api/admin/campaigns/:id` | Removes the override |
| `POST /api/admin/team` | `{ name, role?: 'sdr' \| 'other', aliases?, email?, color?, isActive? }`, then re-parses campaigns |
| `POST /api/admin/company-aliases` | `{ name, domain }` or `{ name, notACompany: true }` for a LinkedIn company name |
| `DELETE /api/admin/company-aliases?key=` | Removes a company mapping |
| `POST /api/admin/meetings/import` | Raw CSV of the meetings audit sheet |

`GET /api/cron/sync` runs the daily sync and requires `Authorization: Bearer $CRON_SECRET`.

## Known gaps

- Reply wording and labels are only as fresh as the AI SDR app's daily sync. If that sync fails
  or falls behind, the warnings banner and Data health name the source and the last good sync.
- Email reply counts come from Instantly lead data, which can trail the reply archive by up to a
  day, so a new reply can show in the feed before it counts on its company.
- About 16% of LinkedIn people are at companies with no domain yet (the name matched nothing, or
  several companies). They show by name until an admin maps them in Data health.
- The people in paused and finished HeyReach campaigns keep the status they had when last read;
  invites accepted after a campaign stops only show in the campaign totals from `heyreach`.
- Meetings are imported from a CSV. Pointing the importer at the live Google Sheet needs its ID.
- No campaign names match Website De-anon in 2026 yet. Adjust its pattern once campaigns are named.
# SDR-Dashboard
