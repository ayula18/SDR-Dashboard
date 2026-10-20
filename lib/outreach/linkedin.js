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

import { domainFromEmail } from './domains.js';

// Words that vary between how LinkedIn and our companies table write the same name.
const COMMON_WORDS = /\b(inc|llc|ltd|limited|corp|corporation|co|gmbh|ai|labs?|technologies|technology|software|hq|the|group|systems)\b/g;
// HeyReach reports whatever a person typed as their employer, so the field also
// carries LinkedIn headline text. "Open to: Interim Executive & Strategy Advisor"
// and "Multiple early stage startups" were being counted as companies reached.
const NO_COMPANY = /^(self[\s-]?employed|freelanc|stealth\b|retired$|unemployed$|independent( consultant)?$|confidential$|open to\b|none$|n\/?a$|-+$|multiple\b|various\b|several\b|startups?$|early[\s-]stage startups|looking for\b|seeking\b)/;

/** "Mistral AI" and "Mistral" → "mistral"; null when there is no name. */
export function companyKey(name) {
  const raw = String(name ?? '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
  const key = raw.replace(/\(.*?\)/g, ' ').replace(COMMON_WORDS, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
  return key || raw.replace(/[^a-z0-9]+/g, ' ').trim() || null;
}

/** "Self-employed", "Stealth AI Startup" and similar are placeholders, not companies. */
export const isNoCompany = name => NO_COMPANY.test(String(name ?? '').trim().toLowerCase());

/**
 * Emailed companies by name key → the one domain carrying it.
 *
 * A name several domains answer to is left out rather than guessed at. This
 * exists because the registry index below knows only `companies`: a firm we
 * email every week but that was never enriched stayed unmatched for ever, and
 * then counted twice — once as its emailed domain, once as a LinkedIn name.
 */
export function emailedNameIndex(rows) {
  const byKey = new Map();
  for (const { domain, name } of rows) {
    const key = companyKey(name);
    if (!key || !domain) continue;
    if (!byKey.has(key)) byKey.set(key, new Set());
    byKey.get(key).add(domain);
  }
  return new Map([...byKey].filter(([, d]) => d.size === 1).map(([k, d]) => [k, [...d][0]]));
}

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
export function resolveCompany(person, lookups) {
  const { companyName, linkedinId, companyUrl, workEmail } = person;
  const { archive, byName, byEmailedName, byLinkedinUrl, byPersonName, emailed } = lookups;
  const urlKey = linkedinCompanyKey(companyUrl);
  const blank = !String(companyName ?? '').trim();

  // A placeholder employer is not a company, whatever else we hold for them.
  if (!blank && isNoCompany(companyName)) {
    return { domain: null, resolution: 'no_company', urlKey: null, candidates: null };
  }

  // Rung 1. The company's own LinkedIn page, matched to the registry.
  //
  // This ranks ABOVE the work email, and the order is the whole point. Measured
  // on 4,422 people carrying both signals, they disagree 656 times, and in those
  // disagreements the page matches the employer LinkedIn reports now 572 times
  // against the email's 299. HeyReach's enriched address is often a PREVIOUS
  // employer: Cribl people on @meshiq.com, Chainguard on @dynamo.ai, OutSystems
  // on @securonix.com. We reached these people on LinkedIn at the company they
  // are at today, so crediting the one they left invents outreach we never did.
  if (urlKey && byLinkedinUrl) {
    const fromUrl = byLinkedinUrl.get(urlKey);
    if (fromUrl) return { domain: fromUrl, resolution: 'company_linkedin', urlKey, candidates: null };
  }

  const nameKey = blank ? null : companyKey(companyName);

  // Rung 2. Their work email — but only where it agrees with the employer they
  // claim, or where they claim none for it to contradict. Of 1,220 people whose
  // page the registry cannot answer, the email agrees with the stated employer
  // 964 times and contradicts it 256 times; a contradiction means we do not know
  // which is current, and guessing is what put people at companies they left.
  const fromEmail = domainFromEmail(workEmail);
  if (fromEmail && (blank || companyAgreesWithDomain(nameKey, fromEmail))) {
    return { domain: fromEmail, resolution: 'work_email', urlKey, candidates: null };
  }

  const fromArchive = linkedinId != null ? archive.get(String(linkedinId)) || null : null;
  if (fromArchive) return { domain: fromArchive, resolution: 'archive', urlKey, candidates: null };
  // A page still dedupes two people at one company even when it names no domain.
  if (blank) return { domain: null, resolution: urlKey ? 'linkedin_only' : 'no_company', urlKey, candidates: null };

  const candidates = byName.get(nameKey) || [];
  if (candidates.length === 1) return { domain: candidates[0], resolution: 'name', urlKey, candidates: null };

  if (candidates.length > 1) {
    const leads = d => emailed.get(d) || 0;
    const ranked = [...candidates].sort((a, b) => leads(b) - leads(a) || a.localeCompare(b));
    if (leads(ranked[0]) > leads(ranked[1])) return { domain: ranked[0], resolution: 'name_emailed', urlKey, candidates: null };
    return { domain: null, resolution: 'ambiguous', urlKey, candidates: ranked.slice(0, 5) };
  }

  // Not in the registry. A company our own campaigns email is just as good an
  // answer, and was previously consulted only to break a tie between candidates
  // the registry had already produced — never as a source of its own.
  const emailedDomain = byEmailedName?.get(nameKey) || null;
  if (emailedDomain) return { domain: emailedDomain, resolution: 'emailed_name', urlKey, candidates: null };

  // Rung 5. The same person, reached on the other channel, where we know the
  // domain from their email address.
  //
  // A name on its own is NOT evidence. Measured on this data, 482 unresolved
  // people share a name with an emailed lead and only 120 of those agree about
  // the company — the rest are different people, or the same person at a job
  // they have since left. "The same SDR worked both" corroborates nothing
  // either: it is true of 416 of the 482 by default.
  const fromPerson = byPersonName?.get(personNameKey(person.personName));
  if (fromPerson && companyAgreesWithDomain(nameKey, fromPerson)) {
    return { domain: fromPerson, resolution: 'person_email', urlKey, candidates: null };
  }

  return { domain: null, resolution: urlKey ? 'linkedin_only' : 'unmatched', urlKey, candidates: null };
}

/** A LinkedIn company page, comparable across protocol, www and trailing slash. */
export function linkedinCompanyKey(url) {
  const u = String(url ?? '').trim().toLowerCase()
    .replace(/^https?:\/\/(www\.)?/, '')
    .replace(/\/+$/, '')
    .split('?')[0];
  return /^([a-z]{2,3}\.)?linkedin\.com\/company\/[^/]+$/.test(u) ? u : null;
}

/** A person's name, comparable with an email local part ("Jason McClelland" ↔ jason.mcclelland@). */
export const personNameKey = name => {
  const k = String(name ?? '').toLowerCase().replace(/[^a-z]/g, '');
  return k.length >= 8 ? k : null;
};

/** Does the employer someone claims agree with the domain their email is on? */
function companyAgreesWithDomain(nameKey, domain) {
  if (!nameKey || !domain) return false;
  const root = String(domain).split('.')[0];
  if (root.length < 4) return false;
  const flat = nameKey.replace(/[^a-z0-9]/g, '');
  return flat.includes(root) || root.includes(flat);
}
