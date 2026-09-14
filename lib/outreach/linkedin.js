/**
 * LinkedIn people → the company accounts email outreach also uses.
 *
 * HeyReach campaign names never say which companies they target, but every
 * person's profile names their company. The name becomes a domain in this order:
 *   archive       the AI SDR app already resolved this person's conversation
 *   name          exactly one company in `companies` carries the name
 *   name_emailed  several do, and email outreach has clearly worked one of them
 *                 ("Lightricks" is lightricks.com, not ltx.io)
 * Anything else keeps its company name without a domain until an admin maps it.
 * The LinkedIn company link on a profile is not used: it often points at a
 * different company than the one the person works for.
 */

// Words that vary between how LinkedIn and our companies table write the same name.
const COMMON_WORDS = /\b(inc|llc|ltd|limited|corp|corporation|co|gmbh|ai|labs?|technologies|technology|software|hq|the|group|systems)\b/g;
const NO_COMPANY = /^(self[\s-]?employed|freelanc|stealth\b|retired$|unemployed$|independent( consultant)?$|confidential$|open to work|none$|n\/?a$|-+$)/;

/** "Mistral AI" and "Mistral" → "mistral"; null when there is no name. */
export function companyKey(name) {
  const raw = String(name ?? '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
  const key = raw.replace(/\(.*?\)/g, ' ').replace(COMMON_WORDS, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
  return key || raw.replace(/[^a-z0-9]+/g, ' ').trim() || null;
}

/** "Self-employed", "Stealth AI Startup" and similar are placeholders, not companies. */
export const isNoCompany = name => NO_COMPANY.test(String(name ?? '').trim().toLowerCase());

/** `companies` rows ({ domain, company_name }) → company key → the domains that carry it. */
export function nameIndex(rows) {
  const index = new Map();
  for (const { domain, company_name: name } of rows) {
    const key = companyKey(name);
    if (!key || !domain) continue;
    const domains = index.get(key);
    if (!domains) index.set(key, [domain]);
    else if (!domains.includes(domain)) domains.push(domain);
  }
  return index;
}

/**
 * @param {{ companyName?: string|null, linkedinId?: string|null }} person
 * @param {{ archive: Map<string, string>, byName: Map<string, string[]>, emailed: Map<string, number> }} lookups
 *   archive: linkedin id → domain; byName: nameIndex(); emailed: domain → email leads loaded
 * @returns {{ domain: string|null, resolution: string, candidates: string[]|null }}
 */
export function resolveCompany({ companyName, linkedinId }, { archive, byName, emailed }) {
  const fromArchive = linkedinId != null ? archive.get(String(linkedinId)) || null : null;
  const blank = !String(companyName ?? '').trim();
  if (blank) return fromArchive ? { domain: fromArchive, resolution: 'archive', candidates: null } : { domain: null, resolution: 'no_company', candidates: null };
  if (isNoCompany(companyName)) return { domain: null, resolution: 'no_company', candidates: null };
  if (fromArchive) return { domain: fromArchive, resolution: 'archive', candidates: null };

  const candidates = byName.get(companyKey(companyName)) || [];
  if (candidates.length === 1) return { domain: candidates[0], resolution: 'name', candidates: null };
  if (!candidates.length) return { domain: null, resolution: 'unmatched', candidates: null };

  const leads = d => emailed.get(d) || 0;
  const ranked = [...candidates].sort((a, b) => leads(b) - leads(a) || a.localeCompare(b));
  if (leads(ranked[0]) > leads(ranked[1])) return { domain: ranked[0], resolution: 'name_emailed', candidates: null };
  return { domain: null, resolution: 'ambiguous', candidates: ranked.slice(0, 5) };
}
