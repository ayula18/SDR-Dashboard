import { qp } from '../db.js';
import { RANGE_PRESETS } from './filters.js';
import { initials } from './format.js';

const ARCHIVE_STALE_HOURS = 36;
const ARCHIVE = { instantly: ['Instantly', 'email'], heyreach: ['HeyReach', 'LinkedIn'] };
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
    qp(`SELECT DISTINCT ON (job) job, status, error, finished_at AS "finishedAt" FROM dash_sync_runs ORDER BY job, id DESC`),
    // Reply text reaches this app through the AI SDR app's syncs. A missing table just means no warning.
    qp(`SELECT key, status, last_sync_at AS "lastSyncAt" FROM ctx_sources WHERE key IN ('instantly', 'heyreach')`).catch(() => []),
  ]);

  const run = job => runs.find(r => r.job === job);
  const warnings = [];
  for (const s of archive) {
    const hours = s.lastSyncAt ? (Date.now() - new Date(s.lastSyncAt).getTime()) / 3_600_000 : Infinity;
    if (s.status !== 'syncing' && (s.status === 'error' || hours > ARCHIVE_STALE_HOURS)) {
      const [name, channel] = ARCHIVE[s.key];
      warnings.push({
        key: `archive-${s.key}`,
        message: `The AI SDR app's ${name} sync ${s.status === 'error' ? 'is failing' : 'is behind'} (last synced ${s.lastSyncAt ? shortDate(s.lastSyncAt) : 'never'}), so newer ${channel} replies have no wording or label yet.`,
      });
    }
  }
  if (run('heyreach')?.status === 'skipped' || !process.env.HEYREACH_API_KEY) {
    warnings.push({ key: 'heyreach-key', message: 'LinkedIn invites, acceptances and messages per campaign are missing until HEYREACH_API_KEY is set.' });
  }
  for (const r of runs.filter(r => r.status === 'failed')) {
    warnings.push({ key: `failed-${r.job}`, message: `Last ${r.job} sync failed: ${r.error}` });
  }

  const lastSyncAt = runs.filter(r => ['complete', 'partial'].includes(r.status)).map(r => r.finishedAt).sort().pop() || null;

  return {
    sdrs: team.filter(t => t.role === 'sdr').map(t => ({ ...t, initials: initials(t.name) })),
    team,
    programs,
    themes,
    ranges: RANGE_PRESETS,
    dataBounds: bounds[0],
    lastSyncAt,
    warnings,
  };
}
