/** Percentage with one decimal, or null when there is no denominator. */
export const rate = (num, den) => (den > 0 ? Math.round((num / den) * 1000) / 10 : null);

/** Human reply labels from best to worst, for a person's or company's best reply. dash_v_linkedin_leads repeats this order. */
export const REPLY_RANK = ['interested', 'deferred', 'not_the_person', 'unknown', 'declined', 'unsubscribed'];

/** Reply labels that make a reply positive: interested, or not now. dash_v_reply_verdicts repeats this list. */
export const POSITIVE_VERDICTS = ['interested', 'deferred'];

/** Relative change in percent, or null when there is nothing to compare against. */
export const change = (current, previous) => (previous > 0 ? Math.round(((current - previous) / previous) * 1000) / 10 : null);

/** Difference between two rates, in percentage points. */
export const pointChange = (current, previous) =>
  (current == null || previous == null ? null : Math.round((current - previous) * 10) / 10);

/**
 * Below this many contacted leads a rate is still shown, but flagged as noise.
 * Positive rates run around 1%, so under ~100 leads a single reply swings the rate by a point.
 */
export const MIN_SAMPLE = 100;

export const initials = name => String(name ?? '?').slice(0, 2).toUpperCase();

export const notFound = message => Object.assign(new Error(message), { status: 404 });
export const badRequest = message => Object.assign(new Error(message), { status: 400 });

/**
 * Marks the best and worst rows by positive rate among rows with enough
 * sample, for green/red highlighting.
 */
export function markExtremes(rows, key = 'positiveRate') {
  const eligible = rows.filter(r => !r.lowSample && r[key] != null);
  if (eligible.length < 2) return rows;
  const best = Math.max(...eligible.map(r => r[key]));
  const worst = Math.min(...eligible.map(r => r[key]));
  if (best === worst) return rows;
  return rows.map(r => ({
    ...r,
    best: !r.lowSample && r[key] === best,
    worst: !r.lowSample && r[key] === worst,
  }));
}
