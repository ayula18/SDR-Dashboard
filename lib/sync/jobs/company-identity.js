import { qp, upsertRows, withTx } from '../../db.js';
import { proposeGroups } from '../../outreach/company-groups.js';
import { linkedinCompanyKey } from '../../outreach/linkedin.js';

/**
 * One company, one domain — the map every page keys on.
 *
 * Three sources, strongest first. A domain already claimed by a stronger one is
 * never overwritten by a weaker one:
 *
 *   admin   a row a human wrote. Never touched by this job.
 *   review  a shared-root group a human accepted in dash_domain_merge_review.
 *   group   company_groups, curated by the AI SDR app (confirmed only).
 *   root    a shared core root this job proposed AND corroborated by a second
 *           signal, per lib/outreach/company-groups.js.
 *
 * Uncorroborated root groups are queued in dash_domain_merge_review and never
 * applied, because about half of root-only matches are wrong (014).
 *
 * 'acquired' members of company_groups are left out: outreach to Splunk is
 * outreach to Splunk, not to Cisco (013, Ayush 2026-10-19).
 */
export const job = {
  label: 'Company identity (canonical domains)',
  weight: 1,
  minSliceMs: 10_000,
  maxAgeHours: 48,

  async run({ log }) {
    const [groups, adminRows, resolved, outreach] = await Promise.all([
      // Acquired members come back too, so the run can SAY how many it skipped.
      qp(`SELECT c.domain AS domain, p.domain AS canonical, c.group_role AS role
            FROM companies c
            JOIN company_groups g ON g.id = c.company_group_id
            JOIN companies p ON p.id = g.canonical_company_id
           WHERE c.domain IS NOT NULL AND p.domain IS NOT NULL
             AND c.domain <> p.domain`),
      qp(`SELECT domain FROM dash_company_domains WHERE source = 'admin'`),
      qp(`SELECT root, domains, status, canonical FROM dash_domain_merge_review
           WHERE status <> 'pending'`),
      // Every domain our outreach has touched, with whatever identifies it.
      // The registry's name and LinkedIn URL when it knows the domain; the name
      // our own campaigns recorded when it does not.
      qp(`SELECT d.domain,
                 COALESCE(co.company_name, d.lead_name) AS company_name,
                 co.company_linkedin_url,
                 d.weight::int AS weight,
                 (co.id IS NOT NULL) AS known
            FROM (
              SELECT company_domain_raw AS domain, max(company_name) AS lead_name, count(*) AS weight
                FROM dash_v_leads WHERE company_domain_raw IS NOT NULL GROUP BY 1
              UNION ALL
              SELECT company_domain_raw, max(company_name), count(*)
                FROM dash_v_linkedin_leads WHERE company_domain_raw IS NOT NULL GROUP BY 1
            ) d
            LEFT JOIN companies co ON co.domain = d.domain`),
    ]);

    // One row per domain; outreach on both channels adds up.
    const byDomain = new Map();
    for (const r of outreach) {
      const seen = byDomain.get(r.domain);
      if (!seen) byDomain.set(r.domain, { ...r });
      else {
        seen.weight += r.weight;
        seen.company_name = seen.company_name || r.company_name;
        seen.company_linkedin_url = seen.company_linkedin_url || r.company_linkedin_url;
        seen.known = seen.known || r.known;
      }
    }

    const { confirmed, review } = proposeGroups([...byDomain.values()]);

    const byHand = new Set(adminRows.map(r => r.domain));
    const decided = new Map(resolved.map(r => [r.root, r]));
    const map = new Map(); // domain -> { canonical, source, note }
    const claim = (domain, canonical, source, note) => {
      if (domain === canonical || byHand.has(domain) || map.has(domain)) return;
      map.set(domain, { canonical, source, note });
    };

    // review (human-accepted) → group → root
    for (const r of resolved) {
      if (r.status !== 'merged' || !r.canonical) continue;
      for (const d of r.domains) claim(d, r.canonical, 'review', `root ${r.root}, accepted by hand`);
    }
    const acquired = groups.filter(g => g.role === 'acquired');
    for (const g of groups) {
      if (g.role === 'acquired') continue;
      claim(g.domain, g.canonical, 'group', `group_role ${g.role}`);
    }
    for (const c of confirmed) {
      const canonical = c.members[0].domain;
      for (const m of c.members) claim(m.domain, canonical, 'root', `root ${c.root}, corroborated by ${c.method}`);
    }

    // Sources disagree about the apex: company_groups says equinix.com →
    // equinix.co.uk while the root group says ap.equinix.com → equinix.com. The
    // views join this table ONCE, so a chain left here gives one company two
    // canonical domains. Follow every chain to its end before writing.
    const resolveChain = (start) => {
      let at = start, hops = 0;
      const seen = new Set([start]);
      while (map.has(at) && hops++ < 10) {
        const next = map.get(at).canonical;
        if (next === at || seen.has(next)) break; // self-reference or cycle
        seen.add(next);
        at = next;
      }
      return at;
    };
    for (const [domain, v] of map) {
      const end = resolveChain(v.canonical);
      if (end !== v.canonical) v.note = `${v.note}, via ${v.canonical}`;
      v.canonical = end;
    }
    // A domain that resolved onto itself is not a mapping.
    for (const [domain, v] of [...map]) if (v.canonical === domain) map.delete(domain);

    // The one definition of "same company", used by everything below. Comparing
    // raw domains instead was throwing away good evidence: the registry holds
    // both cornelis.com and cornelisnetworks.com against the same LinkedIn page,
    // which is one company disagreeing with itself, not two companies.
    const canonical = d => (d == null ? null : map.get(d)?.canonical ?? d);

    const syncedAt = new Date();
    const rows = [...map].map(([domain, v]) => [domain, v.canonical, v.source, v.note, syncedAt]);

    // Queue what nothing corroborated, leaving any human decision alone.
    const queued = review
      .filter(r => !decided.has(r.root))
      .map(r => [r.root, r.members.map(m => m.domain), 'pending',
        r.members.map(m => `${m.domain}(${m.company_name || 'no name'})`).join(' + ')]);

    await withTx(async client => {
      await client.query(`DELETE FROM dash_company_domains WHERE source <> 'admin'`);
      await upsertRows('dash_company_domains',
        ['domain', 'canonical_domain', 'source', 'note', 'synced_at'],
        rows, { conflict: ['domain'], client });
      await upsertRows('dash_domain_merge_review',
        ['root', 'domains', 'status', 'note'],
        queued, { conflict: ['root'], update: ['domains', 'note'], client });
    });

    // ── A company's LinkedIn page → its domain (017) ───────────────────────
    //
    // Read from the RAW table, never from dash_v_linkedin_leads: that view now
    // reads this map, and feeding its output back in would let one guess
    // reinforce itself.
    const [registryPages, ourPages] = await Promise.all([
      qp(`SELECT company_linkedin_url AS url, domain FROM companies
           WHERE company_linkedin_url IS NOT NULL AND domain IS NOT NULL AND merged_into_id IS NULL`),
      qp(`SELECT company_url AS url, company_domain AS domain, count(*)::int AS people
            FROM dash_linkedin_leads
           WHERE company_url IS NOT NULL AND company_domain IS NOT NULL
           GROUP BY 1, 2`),
    ]);

    const pageMap = new Map();
    for (const r of registryPages) {
      const key = linkedinCompanyKey(r.url);
      if (!key) continue;
      const domain = canonical(r.domain);
      const seen = pageMap.get(key);
      // Two registry rows disagreeing about one page is not something to guess
      // at — but they must be compared AFTER folding each onto its canonical
      // domain, or a company listed under two of its own domains looks like a
      // disagreement and its page is discarded. That is what hid Cornelis
      // Networks' page, leaving its CEO as a separate one-person company.
      if (seen && seen.domain !== domain) seen.conflict = true;
      else if (!seen) pageMap.set(key, { domain, source: 'registry', people: 0 });
    }
    // Our own resolutions fill pages the registry has no answer for. A page with
    // several answers takes the one most of its people reached, and refuses a tie:
    // a person who has moved on keeps their own domain either way, because this
    // map is only ever consulted where the person resolved to nothing.
    // Votes are counted on canonical domains, not raw ones: a company whose
    // people are split across two of its own domains would otherwise tie with
    // itself and be refused an answer it plainly has.
    const ours = new Map();
    for (const r of ourPages) {
      const key = linkedinCompanyKey(r.url);
      if (!key || pageMap.has(key)) continue;
      const domain = canonical(r.domain);
      if (!ours.has(key)) ours.set(key, new Map());
      const tally = ours.get(key);
      tally.set(domain, (tally.get(domain) || 0) + r.people);
    }
    for (const [key, tally] of ours) {
      const list = [...tally].map(([domain, people]) => ({ domain, people }))
        .sort((a, b) => b.people - a.people || a.domain.localeCompare(b.domain));
      if (list.length > 1 && list[0].people === list[1].people) continue; // tie → no answer
      pageMap.set(key, { domain: list[0].domain, source: 'outreach', people: list[0].people });
    }

    const pageRows = [...pageMap]
      .filter(([, v]) => !v.conflict)
      .map(([url, v]) => [url, v.domain, v.source, v.people ? `${v.people} people on this page` : null, syncedAt]);

    await withTx(async client => {
      await client.query(`DELETE FROM dash_linkedin_company_domains`);
      await upsertRows('dash_linkedin_company_domains',
        ['company_url', 'domain', 'source', 'note', 'synced_at'],
        pageRows, { conflict: ['company_url'], client });
    });

    // ── A stated employer name → its domain (018) ──────────────────────────
    //
    // The last rung of the closure, and the only signal every person at a
    // company carries. A page can be missing from a profile; the employer name
    // is what the person typed, so their colleague who resolved to nothing
    // still has it.
    //
    // Strict, not plurality: a page IS a company, but a name is only a label,
    // and some labels cover several employers ("Pavilion" is a community its
    // members list as their company). A name that points at more than one
    // company is refused outright rather than resolved to the popular one.
    const nameVotes = new Map();
    for (const r of await qp(
      `SELECT company_key AS key, company_domain AS domain, count(*)::int AS people
         FROM dash_linkedin_leads
        WHERE company_key IS NOT NULL AND company_domain IS NOT NULL
        GROUP BY 1, 2`
    )) {
      if (String(r.key).length < 3) continue;
      const domain = canonical(r.domain);
      if (!nameVotes.has(r.key)) nameVotes.set(r.key, new Map());
      const tally = nameVotes.get(r.key);
      tally.set(domain, (tally.get(domain) || 0) + r.people);
    }
    let ambiguousNames = 0;
    const nameRows = [];
    for (const [key, tally] of nameVotes) {
      if (tally.size > 1) { ambiguousNames++; continue; }
      const [domain, people] = [...tally][0];
      nameRows.push([key, domain, people, `${people} people state this employer`, syncedAt]);
    }

    await withTx(async client => {
      await client.query(`DELETE FROM dash_company_names`);
      await upsertRows('dash_company_names',
        ['company_key', 'domain', 'people', 'note', 'synced_at'],
        nameRows, { conflict: ['company_key'], client });
    });

    const bySource = rows.reduce((m, r) => ({ ...m, [r[2]]: (m[r[2]] || 0) + 1 }), {});
    log?.(`mapped ${rows.length} domains`, JSON.stringify(bySource));
    return {
      mapped: rows.length,
      ...bySource,
      companyPages: pageRows.length,
      companyNames: nameRows.length,
      ambiguousNames,
      keptByHand: byHand.size,
      acquiredSkipped: acquired.length,
      needsReview: queued.length,
    };
  },
};
