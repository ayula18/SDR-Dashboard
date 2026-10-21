/** Percentage with one decimal, or null when there is no denominator. */
export const rate = (num, den) => (den > 0 ? Math.round((num / den) * 1000) / 10 : null);

/**
 * What to call a company in a list.
 *
 * A name that is really a domain is not a name, and the rule holds for EVERY
 * source of a name, not just one. It was first written for Instantly's
 * `company_name`, which often carries the domain itself (alloy.com, alloy.co and
 * alloy.it all arrived named "alloy.com" and looked like three duplicate rows) —
 * and applied to that field alone. The AI SDR registry has the same habit: 1,271
 * of its 28,525 companies store a domain in `company_name`, and because the
 * registry was trusted unconditionally, 112 rows rendered as "armadin.com" or
 * "hifi.com" when the real name was sitting in the next argument.
 *
 * So: take the first candidate that is actually a name. Only if none is do we
 * fall back to the domain we keyed on.
 *
 * CASE IS THE TEST, and deliberately so — no /i flag. Plenty of companies are
 * genuinely named after a domain (Checkout.com, Lunar.dev, Verbit.ai, SRE.ai),
 * and rejecting those made it worse, not better: lunar.dev was then labelled
 * "Boomi", the stale employer one of its people had typed. Measured across the
 * registry's 1,271 domain-shaped names — 681 are all lowercase and are the
 * domain copied into the name field, 486 carry a capital and are real names.
 */
const DOMAIN_RESTATED = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/;
const isRealName = v => {
  const s = String(v ?? '').trim();
  return s !== '' && !DOMAIN_RESTATED.test(s);
};
export function displayCompany(matchedName, leadName, domain) {
  for (const candidate of [matchedName, leadName]) {
    if (isRealName(candidate)) return String(candidate).trim();
  }
  return domain || matchedName || leadName || null;
}

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
