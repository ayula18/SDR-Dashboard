import { qp } from '../db.js';
import { googleSheetsConfigured } from '../outreach/google-sheets.js';
import { hubspotConfigured } from '../outreach/hubspot.js';
import { JOBS } from '../sync/jobs.js';
import { RANGE_PRESETS } from './filters.js';
import { initials } from './format.js';

const ARCHIVE_STALE_HOURS = 36;
/** Every AI SDR sync a number on this board reads, and what goes missing when it stops. */
export const ARCHIVE = {
  instantly: ['Instantly', 'newer email replies have no wording or label yet'],
  instantly_aisdr: ['Instantly (AI SDR workspace)', 'newer AI SDR email replies have no wording or label yet'],
  heyreach: ['HeyReach', 'newer LinkedIn replies have no wording or label yet'],
  slack: ['Slack', 'newer meeting bookings are missing'],
  hubspot: ['HubSpot', 'newer meetings are missing'],
};
const shortDate = d => new Date(d).toUTCString().slice(5, 11); // "16 Aug"

/** Everything a filter bar needs, plus warnings about data the numbers can't yet include. */
export async function getMeta() {
  const [team, programs, themes, bounds, runs, archive] = await Promise.all([
    qp(`SELECT name, color, role FROM dash_team WHERE is_active ORDER BY name`),
    qp(`SELECT slug, name, poc_name AS poc, description FROM dash_programs WHERE is_active ORDER BY sort_order`),
    qp(`SELECT COALESCE(theme, 'Other') AS theme, count(*)::int AS campaigns
          FROM dash_v_campaigns
         WHERE NOT excluded AND created_at_src >= NOW() - INTERVAL '180 days'
         GROUP BY 1 ORDER BY 2 DESC`),
    qp(`SELECT min(period_start)::text AS first, max(period_start)::text AS last FROM dash_campaign_periods WHERE grain = 'week'`),
    qp(`SELECT job,
               (array_agg(status      ORDER BY id DESC))[1] AS status,
               (array_agg(error       ORDER BY id DESC))[1] AS error,
               (array_agg(finished_at ORDER BY id DESC))[1] AS "finishedAt",
               max(finished_at) FILTER (WHERE status IN ('complete', 'partial')) AS "lastProgressAt"
          FROM dash_sync_runs
         GROUP BY job`),
    // Reply text and meetings reach this app through the AI SDR app's syncs. A missing table just means no warning.
    qp(`SELECT key, status, last_sync_at AS "lastSyncAt"
          FROM ctx_sources WHERE key = ANY($1::text[])`, [Object.keys(ARCHIVE)]).catch(() => []),
  ]);

  const run = job => runs.find(r => r.job === job);
  const warnings = [];
  for (const s of archive) {
    const hours = s.lastSyncAt ? (Date.now() - new Date(s.lastSyncAt).getTime()) / 3_600_000 : Infinity;
    // 'syncing' used to suppress this warning outright. A run killed mid-page leaves
    // the status stuck at 'syncing' forever, so that silenced the one alarm that
    // would have caught it — three weeks of a dead HeyReach sync went unreported.
    // Only an in-flight run that is still fresh is allowed to stay quiet.
    if (s.status === 'syncing' && hours <= ARCHIVE_STALE_HOURS) continue;
    if (s.status !== 'error' && hours <= ARCHIVE_STALE_HOURS) continue;

    const [name, consequence] = ARCHIVE[s.key];
    const state = s.status === 'error' ? 'is failing'
      : s.status === 'syncing' ? 'has been stuck mid-run'
      : 'is behind';
    warnings.push({
      key: `archive-${s.key}`,
      message: `The AI SDR app's ${name} sync ${state} (last synced ${s.lastSyncAt ? shortDate(s.lastSyncAt) : 'never'}), so ${consequence}.`,
    });
  }
  if (run('heyreach')?.status === 'skipped' || !process.env.HEYREACH_API_KEY) {
    warnings.push({ key: 'heyreach-key', message: 'LinkedIn invites, acceptances and messages per campaign are missing until HEYREACH_API_KEY is set.' });
  }
  if (!googleSheetsConfigured()) {
    warnings.push({ key: 'google-key', message: 'SDR positive responses and the meetings audit stop updating until GOOGLE_SERVICE_ACCOUNT_B64 is set, because neither sheet can be read.' });
  }
  if (!hubspotConfigured()) {
    warnings.push({ key: 'hubspot-key', message: 'Who booked each meeting stops updating from the SDR form until HUBSPOT_ACCESS_TOKEN is set.' });
  }
  // 'abandoned' is a run the platform killed before it could record anything. It is
  // a failure, and it is the one that used to leave a job looking permanently 'running'.
  for (const r of runs.filter(r => JOBS[r.job] && (r.status === 'failed' || r.status === 'abandoned'))) {
    warnings.push({
      key: `failed-${r.job}`,
      message: r.status === 'abandoned'
        ? `Last ${r.job} sync was killed before it finished, so its results are incomplete.`
        : `Last ${r.job} sync failed: ${r.error}`,
    });
  }

  // Only jobs that still exist. A retired job keeps its last run row for ever:
  // `instantly-replies` stopped running on 11 Sep 2026, and that one row is what
  // made every page say "Synced 35 days ago".
  const live = runs.filter(r => JOBS[r.job] && r.lastProgressAt);
  const at = r => new Date(r.lastProgressAt).getTime();

  // Math.max, never `.sort()`. The default sort compares Dates as strings, so it
  // orders them by weekday and month NAME: "Fri Sep 11" sorts after "Fri Oct 16",
  // which is how one September run outranked every October one.
  const lastSyncAt = live.length ? new Date(Math.max(...live.map(at))).toISOString() : null;
  // The stalest input. "Synced 2 minutes ago" is true of the newest job and a lie
  // about the page, so the floor travels with it.
  const oldestSyncAt = live.length ? new Date(Math.min(...live.map(at))).toISOString() : null;

  // maxAgeHours has been declared on every job since they were written and read by
  // nothing at all, so a single fresh job let the header claim the page was minutes
  // old while the numbers under it were weeks behind.
  for (const [name, job] of Object.entries(JOBS)) {
    if (!job.maxAgeHours) continue;
    const progress = runs.find(r => r.job === name)?.lastProgressAt;
    const hours = progress ? (Date.now() - new Date(progress).getTime()) / 3_600_000 : Infinity;
    if (hours <= job.maxAgeHours) continue;
    warnings.push({
      key: `stale-${name}`,
      message: `${job.label} last got somewhere ${progress ? shortDate(progress) : 'never'}`
        + `, past the ${job.maxAgeHours}h it is meant to refresh in, so those numbers are behind.`,
    });
  }

  return {
    // The SDR filter: the SDRs first, then the people an SDR list only shows when picked.
    sdrs: [...team.filter(t => t.role === 'sdr'), ...team.filter(t => t.role === 'sdr_extra')].map(t => ({ ...t, initials: initials(t.name) })),
    team,
    programs,
    themes,
    ranges: RANGE_PRESETS,
    dataBounds: bounds[0],
    lastSyncAt,
    oldestSyncAt,
    warnings,
  };
}
