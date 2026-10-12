/**
 * Decide which jobs run, in what order, and with how much of the budget.
 *
 * WHY THIS EXISTS: the old scheduler walked a hardcoded sequence and handed each
 * job *all* the remaining time. The two jobs at the end therefore only ever ran
 * if everything before them happened to finish early — and as the early jobs
 * grew, they stopped doing so. heyreach-leads went 7 days without running and
 * instantly-steps 15, with nothing recorded, because "skipped until next run"
 * never arrives when the same jobs eat the budget again tomorrow.
 *
 * Two rules fix that, and both are needed:
 *
 *   ORDER   by staleness debt, so whatever has waited longest goes first. On its
 *           own this only rotates the victim.
 *   SLICE   each job a bounded share, so a greedy job cannot consume the tail.
 *           On its own this does not help when the order is fixed.
 *
 * Together, a backlog drains over a few days and then every job runs every day.
 *
 * Pure on purpose: no database, no clock, no imports. The caller loads history
 * and applies the plan; everything here is a function of its arguments, which is
 * what lets it be tested without a database (tests/plan.test.mjs).
 */

/** Below this, starting a job is worse than deferring it: it burns its rate-limit slot for nothing. */
const DEFAULT_MIN_SLICE_MS = 20_000;
/** No single job may take more than this share of the budget, however far behind it is. */
const DEFAULT_MAX_SHARE = 0.5;

/**
 * Order jobs so that no job appears before one it depends on.
 *
 * `dependsOn` is an ORDERING constraint, never a gate: a child is still
 * scheduled when its parent is deferred, because every dependency here is
 * satisfiable with yesterday's parent data, and gating would reproduce exactly
 * the cascade this scheduler exists to prevent.
 *
 * @throws if the graph has a cycle, which is a programming error worth failing on
 */
export function topoSort(jobs) {
  const byName = new Map(jobs.map(j => [j.name, j]));
  const state = new Map(); // name → 'visiting' | 'done'
  const out = [];

  const visit = (name, trail) => {
    if (state.get(name) === 'done') return;
    if (state.get(name) === 'visiting') {
      throw new Error(`Dependency cycle in sync jobs: ${[...trail, name].join(' → ')}`);
    }
    const job = byName.get(name);
    if (!job) return; // a dependency outside this run is simply not a constraint
    state.set(name, 'visiting');
    for (const dep of job.dependsOn || []) visit(dep, [...trail, name]);
    state.set(name, 'done');
    out.push(job);
  };

  for (const job of jobs) visit(job.name, []);
  return out;
}

/** Hours since a job last made progress. Never having succeeded outranks everything. */
export function stalenessHours(job, history, now) {
  const h = history?.[job.name];
  const last = h?.lastProgressAt ?? h?.lastSuccessAt ?? null;
  if (!last) return Infinity;
  return (now - new Date(last).getTime()) / 3_600_000;
}

/**
 * Build the run plan.
 *
 * @param {Array<{name: string, dependsOn?: string[], weight?: number, minSliceMs?: number}>} jobs
 * @param {Object} history  name → { lastSuccessAt, lastProgressAt }
 * @param {number} now      epoch ms
 * @param {number} budgetMs total time for the whole run
 * @param {number} reserveMs time held back for bookkeeping after the last job
 * @returns {{slices: Array, deferred: Array}}
 */
export function planRun({ jobs, history = {}, now = Date.now(), budgetMs, reserveMs = 10_000 }) {
  const ordered = topoSort(jobs);
  const spendable = Math.max(0, budgetMs - reserveMs);

  const ranked = ordered.map((job, i) => ({
    job,
    order: i,
    staleHours: stalenessHours(job, history, now),
    minSliceMs: job.minSliceMs ?? DEFAULT_MIN_SLICE_MS,
    weight: job.weight ?? 1,
  }));

  // Most-starved first. Ties break on the topological order so the plan is
  // deterministic: the same inputs must always produce the same plan.
  const byDebt = [...ranked].sort((a, b) =>
    (b.staleHours - a.staleHours) || (a.order - b.order));

  // Admit jobs in debt order while their floors still fit. A job that cannot be
  // given a real slice is deferred explicitly, with its reason — never silently.
  const admitted = [];
  const deferred = [];
  let committed = 0;
  for (const entry of byDebt) {
    if (committed + entry.minSliceMs <= spendable) {
      admitted.push(entry);
      committed += entry.minSliceMs;
    } else {
      deferred.push({
        job: entry.job.name,
        staleHours: entry.staleHours,
        reason: 'Not enough budget left to give this job a useful slice; it goes first next run',
      });
    }
  }

  // Share out what is left beyond the floors, by weight, capped so no single job
  // can take the run over regardless of how far behind it is.
  const leftover = spendable - committed;
  const totalWeight = admitted.reduce((sum, e) => sum + e.weight, 0) || 1;
  const cap = Math.floor(spendable * DEFAULT_MAX_SHARE);

  for (const entry of admitted) {
    const extra = Math.floor(leftover * (entry.weight / totalWeight));
    entry.budgetMs = Math.max(entry.minSliceMs, Math.min(entry.minSliceMs + extra, cap));
  }

  // Execute in dependency order, not debt order: the debt decided *who* runs,
  // the topological order decides *when*, so parents still write what children read.
  const slices = admitted
    .sort((a, b) => a.order - b.order)
    .map(e => ({
      job: e.job.name,
      budgetMs: e.budgetMs,
      staleHours: e.staleHours,
      reason: e.staleHours === Infinity ? 'has never completed' : `last progress ${Math.round(e.staleHours)}h ago`,
    }));

  return { slices, deferred };
}
