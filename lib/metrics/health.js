import { qp } from '../db.js';
import { JOBS } from '../sync/jobs.js';
import { azureConfigured } from '../llm/azure.js';

/** Sync status, setup gaps, data freshness, and mapping problems worth an admin's attention. */
export async function getHealth() {
  const [runs, states, campaigns, leads, periods, verdicts, meetings, archive, unmapped, excluded, programs, team, linkedinPeople, linkedinCompanies, companyAliases] = await Promise.all([
    qp(`SELECT DISTINCT ON (job) job, status, mode, triggered_by AS "triggeredBy", stats, error,
               started_at AS "startedAt", finished_at AS "finishedAt"
          FROM dash_sync_runs ORDER BY job, id DESC`),
    qp(`SELECT job, last_success_at AS "lastSuccessAt" FROM dash_sync_state`),
    qp(`SELECT platform, status, count(*)::int AS campaigns FROM dash_campaigns GROUP BY 1, 2 ORDER BY 1, 3 DESC`),
    qp(`SELECT count(*)::int AS total, count(*) FILTER (WHERE reply_count > 0)::int AS "withReplies",
               max(synced_at) AS "lastSyncedAt", max(created_at_src) AS "latestLoadedAt" FROM dash_leads`),
    qp(`SELECT grain, min(period_start)::text AS first, max(period_start)::text AS last, count(*)::int AS rows
          FROM dash_campaign_periods GROUP BY 1`),
    qp(`SELECT platform, count(*)::int AS total, count(*) FILTER (WHERE is_negative)::int AS negative,
               count(*) FILTER (WHERE is_auto)::int AS auto, count(*) FILTER (WHERE classifier = 'llm')::int AS labelled,
               max(replied_at) AS "latestReplyAt"
          FROM dash_v_reply_verdicts GROUP BY 1`),
    qp(`SELECT count(*)::int AS total, min(meeting_date)::text AS first, max(meeting_date)::text AS last,
               max(imported_at) AS "importedAt", max(source_file) AS "sourceFile",
               count(*) FILTER (WHERE company_domain IS NULL)::int AS "withoutDomain",
               count(*) FILTER (WHERE meeting_date IS NULL)::int AS "withoutDate"
          FROM dash_meetings`),
    qp(`SELECT key, status, last_sync_at AS "lastSyncAt", left(last_error, 200) AS "lastError"
          FROM ctx_sources WHERE key IN ('instantly', 'heyreach')`),
    qp(`SELECT c.id, c.name, c.platform, c.created_at_src AS "createdAt"
          FROM dash_v_campaigns c
         WHERE c.sdr IS NULL AND NOT c.excluded AND c.created_at_src >= NOW() - INTERVAL '120 days'
         ORDER BY c.created_at_src DESC LIMIT 100`),
    qp(`SELECT c.id, c.name, c.created_at_src AS "createdAt", c.overridden
          FROM dash_v_campaigns c
         WHERE c.excluded AND c.created_at_src >= NOW() - INTERVAL '120 days'
         ORDER BY c.created_at_src DESC LIMIT 50`),
    qp(`SELECT p.slug, p.name, p.poc_name AS poc, p.match_pattern AS "matchPattern",
               COALESCE(json_agg(json_build_object('id', c.id, 'name', c.name, 'sdr', c.sdr, 'createdAt', c.created_at_src, 'overridden', c.overridden)
                        ORDER BY c.created_at_src DESC) FILTER (WHERE c.id IS NOT NULL), '[]') AS campaigns
          FROM dash_programs p
          LEFT JOIN dash_v_campaigns c ON c.program = p.slug AND NOT c.excluded
         GROUP BY p.slug, p.name, p.poc_name, p.match_pattern, p.sort_order
         ORDER BY p.sort_order`),
    qp(`SELECT t.name, t.role, t.aliases, t.is_active AS "isActive", t.color,
               count(c.id) FILTER (WHERE c.created_at_src >= NOW() - INTERVAL '90 days')::int AS "campaignsLast90Days"
          FROM dash_team t
          LEFT JOIN dash_v_campaigns c ON c.sdr = t.name
         GROUP BY t.name, t.role, t.aliases, t.is_active, t.color
         ORDER BY "campaignsLast90Days" DESC, t.name`),
    qp(`SELECT count(DISTINCT l.linkedin_id)::int AS people,
               count(DISTINCT l.linkedin_id) FILTER (WHERE l.company_domain IS NOT NULL)::int AS matched,
               count(DISTINCT l.linkedin_id) FILTER (WHERE l.no_company)::int AS "noCompany",
               (SELECT max(synced_at) FROM dash_linkedin_leads) AS "lastSyncedAt"
          FROM dash_v_linkedin_leads l
         WHERE NOT l.excluded`),
    // LinkedIn company names with no domain yet: the ones with replies first, then by people reached.
    qp(`SELECT l.company_key AS key, max(l.company_name) AS name,
               count(DISTINCT l.linkedin_id)::int AS people, count(DISTINCT l.campaign_id)::int AS campaigns,
               bool_or(l.replied) AS replied,
               (array_agg(DISTINCT candidate) FILTER (WHERE candidate IS NOT NULL))[1:5] AS candidates
          FROM dash_v_linkedin_leads l
          LEFT JOIN LATERAL unnest(l.domain_candidates) AS candidate ON TRUE
         WHERE l.company_domain IS NULL AND NOT l.no_company AND l.company_key IS NOT NULL AND NOT l.excluded
         GROUP BY 1
         ORDER BY bool_or(l.replied) DESC, count(DISTINCT l.linkedin_id) DESC, 2
         LIMIT 150`),
    qp(`SELECT company_key AS key, company_name AS name, domain, not_a_company AS "notACompany",
               updated_by AS "updatedBy", updated_at AS "updatedAt"
          FROM dash_company_aliases ORDER BY updated_at DESC LIMIT 100`),
  ]);

  const lastRun = key => runs.find(r => r.job === key) || null;
  const heyreach = lastRun('heyreach');

  // Reply text comes from the AI SDR app's syncs, so their state is this app's state too.
  const aiSdrSync = (key, label, role) => {
    const s = archive.find(a => a.key === key);
    const hours = s?.lastSyncAt ? (Date.now() - new Date(s.lastSyncAt).getTime()) / 3_600_000 : null;
    const ok = s?.status === 'ready' && hours !== null && hours <= 36;
    let detail;
    if (!s) detail = 'Not registered in the AI SDR app.';
    else if (s.status === 'error') detail = `Failing: ${s.lastError}`;
    else if (s.status === 'syncing') detail = 'Syncing now.';
    else if (hours === null) detail = 'Never synced.';
    else detail = `${ok ? 'Last' : 'Behind: last'} synced ${Math.round(hours)} h ago. ${role} It runs daily in the AI SDR app, an hour before this app's sync.`;
    return { key: `ai-sdr-${key}`, ok, label, detail };
  };

  return {
    setup: [
      {
        key: 'instantly',
        ok: Boolean(process.env.INSTANTLY_API_KEY),
        label: 'Instantly API key',
        detail: process.env.INSTANTLY_API_KEY ? 'Campaigns, analytics and leads sync.' : 'INSTANTLY_API_KEY is not set.',
      },
      aiSdrSync('instantly', 'Emails and replies (AI SDR Instantly sync)', 'Email reply wording and labels come from it.'),
      aiSdrSync('heyreach', 'LinkedIn conversations (AI SDR HeyReach sync)', 'LinkedIn reply wording and labels come from it.'),
      {
        key: 'heyreach',
        ok: Boolean(process.env.HEYREACH_API_KEY) && ['complete', 'partial'].includes(heyreach?.status),
        label: 'HeyReach API key',
        detail: process.env.HEYREACH_API_KEY
          ? heyreach?.error || 'LinkedIn campaigns, the people in them and stats sync, read-only.'
          : 'HEYREACH_API_KEY is empty. LinkedIn invites and acceptances, and any LinkedIn split by SDR, program or company, need it.',
      },
      {
        key: 'azure-openai',
        ok: azureConfigured() && ['complete', 'partial'].includes(lastRun('reply-classify')?.status),
        label: 'Reply labels (GPT-4.1 mini on Azure)',
        detail: !azureConfigured()
          ? 'AZURE_OPENAI_* is not set, so replies keep the labels from the keyword rules.'
          : lastRun('reply-classify')?.error || 'Every synced reply is read and labelled by the model; the keyword rules label it until then.',
      },
      {
        key: 'cron',
        ok: Boolean(process.env.CRON_SECRET),
        label: 'Daily sync',
        detail: process.env.CRON_SECRET ? 'GET /api/cron/sync is protected by CRON_SECRET.' : 'CRON_SECRET is not set, so the cron route refuses every call.',
      },
    ],
    jobs: Object.entries(JOBS).map(([key, job]) => ({
      key,
      label: job.label,
      lastRun: lastRun(key),
      lastSuccessAt: states.find(s => s.job === key)?.lastSuccessAt || null,
    })),
    data: {
      campaigns,
      leads: leads[0],
      periods,
      replyVerdicts: verdicts,
      meetings: meetings[0],
      aiSdrArchive: archive,
      linkedinPeople: linkedinPeople[0],
    },
    mapping: {
      campaignsWithoutSdr: unmapped,
      excludedCampaigns: excluded,
      programs,
      team,
      linkedinCompanies,
      companyAliases,
    },
  };
}
