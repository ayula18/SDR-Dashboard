/**
 * One company, several domains — for the domains THIS dashboard has touched.
 *
 * The policy is ported from `AI SDR/dashboard/lib/context/company-groups.js`,
 * including its central rule, which that app measured on this same data:
 *
 *   A SHARED ROOT IS NEVER ENOUGH ON ITS OWN. Root-only matching pairs
 *   elastic.co ("Elastic") with elastic.run ("ElasticRun"), people.inc
 *   (Dotdash) with people.ai (People). About half of root-only matches are
 *   wrong, so they go to a review queue and a machine never applies them.
 *
 * What differs here is only the INPUT. `proposeGroups()` over there considers
 * companies that carry ctx_events; that is why alloy.co and alloy.it were never
 * looked at (they are not in `companies` at all) and why uk.leaseweb.com was
 * skipped (in `companies`, no events). Outreach reaches domains the archive
 * never sees, so this proposes over the domains in dash_leads and
 * dash_linkedin_leads instead, and takes corroborating evidence from whatever
 * we hold for them: the registry's name and LinkedIn URL when it knows the
 * domain, and the company name our own campaigns recorded when it does not.
 */

import { extractCoreRoot } from './domain-match.js';

/** Compare company names ignoring punctuation, case and spacing. */
const normName = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

/** Compare LinkedIn URLs ignoring protocol, www and trailing slash. */
const normLi = s => String(s || '').toLowerCase()
  .replace(/^https?:\/\/(www\.)?/, '')
  .replace(/\/+$/, '');

/**
 * The second signal that has to agree before a shared root becomes a group.
 * Returns the method that corroborated, or null when nothing did.
 *
 * Verbatim from the AI SDR app, so both frontends group on identical evidence.
 */
export function corroborate(members) {
  const lis = members.map(m => normLi(m.company_linkedin_url)).filter(Boolean);
  if (lis.length > 1 && new Set(lis).size < lis.length) return 'linkedin';

  const names = members.map(m => normName(m.company_name)).filter(Boolean);
  if (names.length > 1 && new Set(names).size < names.length) return 'name';

  const doms = members.map(m => m.domain);
  if (doms.some(a => doms.some(b => a !== b && a.endsWith(`.${b}`)))) return 'subdomain';

  return null;
}

/**
 * Group the given domains by core root, then split on corroboration.
 *
 * `rows`: { domain, company_name, company_linkedin_url, weight, known }.
 *
 * The canonical member is the shortest domain first — leaseweb.com, never
 * nl.leaseweb.com, which is what weight alone picked because we happened to
 * email the Dutch office most. Then a domain the registry carries, so the rest
 * of the system recognises it, and only then outreach weight.
 */
export function proposeGroups(rows) {
  const byRoot = new Map();
  for (const r of rows) {
    const root = extractCoreRoot(r.domain);
    // A bare public suffix ("ac.in", "vercel.app") extracts to '' and identifies
    // nobody; a two-character root is too generic to mean anything.
    if (!root || root.length < 3) continue;
    if (!byRoot.has(root)) byRoot.set(root, []);
    byRoot.get(root).push(r);
  }

  const confirmed = [];
  const review = [];
  for (const [root, members] of byRoot) {
    if (members.length < 2) continue;
    const labels = d => d.split('.').length;
    members.sort((a, b) =>
      labels(a.domain) - labels(b.domain)
      || Number(b.known) - Number(a.known)
      || b.weight - a.weight
      || a.domain.localeCompare(b.domain));
    const method = corroborate(members);
    if (method) confirmed.push({ root, members, method });
    else review.push({ root, members });
  }
  return { confirmed, review };
}
