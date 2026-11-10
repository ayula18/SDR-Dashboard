import { qp, upsertRows, withTx } from '../../db.js';
import { dashStartDate } from '../../metrics/filters.js';
import { readTab } from '../../outreach/google-sheets.js';
import { companyKey, emailedNameIndex, nameIndex } from '../../outreach/linkedin.js';
import { OUTREACH_MEETING } from '../../metrics/sql.js';
import {
  POSITIVE_SHEETS, bookedPositives, matchRow, mergeTabs, parseCurrentTab, parseOldTab, resolveDomain, rowKey, sdrName, skipReason,
} from '../../outreach/positive-sheet.js';

const COLUMNS = [
  'key', 'tab', 'sheet_row', 'person_name', 'company_name', 'domain_raw', 'company_domain', 'sdr', 'sdr_raw', 'channel',
  'sender', 'replied_on', 'date_source', 'status', 'notes', 'comments', 'mark', 'skip_reason', 'match_kind',
  'person_email', 'linkedin_id', 'campaign_id', 'lead_id', 'synced_at',
];

/** Below this share of what is stored, a read is treated as a broken sheet rather than deleted rows. */
const MIN_SHARE_OF_STORED = 0.8;

const groupBy = (rows, key) => {
  const map = new Map();
  for (const row of rows) {
    const k = key(row);
    if (k == null) continue;
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(row);
  }
  return map;
};

/** Domains by the first part of their name, only where exactly one domain answers to it. */
function uniqueRoots(domains) {
  const roots = new Map();
  for (const domain of new Set(domains)) {
    const root = domain.split('.')[0].replace(/[^a-z0-9]/g, '');
    if (root) roots.set(root, roots.has(root) ? null : domain);
  }
  return new Map([...roots].filter(([, domain]) => domain));
}

/** Everyone the rows might be about, with the days they replied. */
async function peopleFor(domains, keys) {
  const [email, linkedin, replies, labels] = await Promise.all([
    qp(`
      SELECT l.id AS "leadId", lower(l.email) AS email, COALESCE(cd.canonical_domain, l.company_domain) AS domain,
             l.campaign_id AS "campaignId", c.external_id AS "campaignRef", c.sdr, c.sdr_logs_positives AS "sdrLogs",
             c.positives_from_sheet AS "fromSheet", c.excluded,
             LEAST(l.first_contact_at, l.created_at_src)::date::text AS "touchedOn",
             CASE WHEN l.reply_count > 0 THEN l.last_reply_at::date::text END AS "lastReply"
        FROM dash_leads l
        JOIN dash_v_campaigns c ON c.id = l.campaign_id
        LEFT JOIN dash_company_domains cd ON cd.domain = l.company_domain
       WHERE COALESCE(cd.canonical_domain, l.company_domain) = ANY($1::text[])`, [domains]),
    qp(`
      SELECT l.lead_id AS "leadId", l.linkedin_id AS "linkedinId", l.person_name AS name, l.canonical_domain AS domain,
             l.company_key AS "companyKey", l.campaign_id AS "campaignId", c.external_id AS "campaignRef", c.sdr, c.sdr_logs_positives AS "sdrLogs",
             c.positives_from_sheet AS "fromSheet", c.excluded, l.added_at::date::text AS "touchedOn"
        FROM dash_linkedin_leads l
        JOIN dash_v_campaigns c ON c.id = l.campaign_id
       WHERE l.canonical_domain = ANY($1::text[]) OR l.company_key = ANY($2::text[])`, [domains, keys]),
    qp(`
      SELECT lower(person_email) AS email, person_linkedin_id AS "linkedinId", person_name AS name, platform,
             company_domain AS domain, campaign_external_id AS campaign, replied_at::date::text AS day,
             is_positive AS positive, is_negative AS negative
        FROM dash_v_reply_verdicts
       WHERE NOT is_auto`),
    qp(`
      SELECT campaign_id || ':' || id AS lead FROM dash_v_leads WHERE labelled_positive AND NOT positives_from_sheet
      UNION ALL
      SELECT campaign_id || ':' || lead_id FROM dash_v_linkedin_leads WHERE labelled_positive AND NOT positives_from_sheet`),
  ]);
  const labelled = new Set(labels.map(l => l.lead));
  const emailDays = groupBy(replies, r => r.email);
  const profileDays = groupBy(replies, r => r.linkedinId);
  const labelledPositive = p => labelled.has(`${p.campaignId}:${p.leadId}`);
  const people = [
    ...email.map(p => ({
      ...p,
      channel: 'email',
      labelledPositive: labelledPositive(p),
      replies: emailDays.get(p.email) || [],
      replyDates: [...(emailDays.get(p.email) || []).map(r => r.day), ...(p.lastReply ? [p.lastReply] : [])],
    })),
    ...linkedin.map(p => ({
      ...p,
      channel: 'linkedin',
      labelledPositive: labelledPositive(p),
      replies: profileDays.get(p.linkedinId) || [],
      replyDates: (profileDays.get(p.linkedinId) || []).map(r => r.day),
    })),
  ];
  return { people, replies };
}

/**
 * Whoever wrote back from a company without being a lead there, such as a colleague
 * the email was forwarded to. They cannot take a campaign's credit, but they can say
 * when a booked company first replied and what it said.
 */
function repliersWithoutLeads(replies, people, canonical) {
  const leads = new Set(people.flatMap(p => [p.email, p.linkedinId]).filter(Boolean));
  const byPerson = groupBy(replies.filter(r => r.domain && !leads.has(r.email || r.linkedinId)), r => r.email || r.linkedinId);
  return groupBy([...byPerson.values()].map(own => ({
    channel: own[0].platform === 'email' ? 'email' : 'linkedin',
    email: own[0].email || null,
    linkedinId: own[0].linkedinId || null,
    name: own[0].name || null,
    domain: canonical.get(own[0].domain) || own[0].domain,
    excluded: false,
    fromSheet: true,
    replies: own,
  })), p => p.domain);
}

/**
 * Meetings an SDR booked, as dash_v_meetings decides, with the channel and campaign the
 * meeting credit gave them, so a booked positive goes hand in hand with its meeting:
 * email, LinkedIn or a call. A meeting no channel places yet adds its positive once
 * Meeting checks gives it one. A split meeting's second SDR is the same conversation,
 * which bookedPositives covers once.
 */
const sdrBookedMeetings = () => qp(`
  SELECT m.company_domain AS domain, m.company_raw AS company, m.meeting_date::text AS date,
         m.form_booked_on::text AS "bookedOn",
         m.attributed_sdr AS sdr, m.campaign_sdr AS "campaignSdr", m.campaign_id AS "campaignId", m.where_rung AS "whereRung",
         CASE WHEN m.outreach_channel IN ('email', 'linkedin', 'call') THEN m.outreach_channel END AS channel
    FROM dash_v_meetings m
   WHERE ${OUTREACH_MEETING('m')} AND NOT m.rescheduled AND m.meeting_date >= $1
   ORDER BY m.share DESC, m.attributed_sdr`, [dashStartDate()]);

/** Both tabs tied to companies and people, then what SDR bookings add to them, ready to store. Writes nothing. */
export async function buildPositiveRows({ log = () => {} } = {}) {
  const [oldValues, currentValues, team, aliases, emailedNames, linkedinNames, registry, meetings] = await Promise.all([
    readTab(POSITIVE_SHEETS.old.id, POSITIVE_SHEETS.old.tab),
    readTab(POSITIVE_SHEETS.current.id, POSITIVE_SHEETS.current.tab),
    qp(`SELECT name, aliases FROM dash_team`),
    qp(`SELECT domain, canonical_domain FROM dash_company_domains`),
    qp(`
      SELECT DISTINCT COALESCE(cd.canonical_domain, l.company_domain) AS domain, l.company_name AS name
        FROM dash_leads l
        LEFT JOIN dash_company_domains cd ON cd.domain = l.company_domain
       WHERE l.company_domain IS NOT NULL AND l.company_name IS NOT NULL`),
    qp(`
      SELECT DISTINCT canonical_domain AS domain, company_name AS name
        FROM dash_linkedin_leads
       WHERE canonical_domain IS NOT NULL AND company_name IS NOT NULL`),
    qp(`SELECT domain, company_name FROM companies WHERE domain IS NOT NULL AND company_name IS NOT NULL`),
    sdrBookedMeetings(),
  ]);

  const lookups = {
    canonical: new Map(aliases.map(a => [a.domain, a.canonical_domain])),
    emailedByName: emailedNameIndex(emailedNames),
    linkedinByName: emailedNameIndex(linkedinNames),
    outreachRoots: uniqueRoots([...emailedNames, ...linkedinNames].map(r => r.domain)),
    registryByName: nameIndex(registry),
  };

  const rows = mergeTabs(parseOldTab(oldValues), parseCurrentTab(currentValues)).map(row => ({
    ...row,
    sdr: sdrName(row.sdrRaw, team),
    companyDomain: resolveDomain(row, lookups),
    companyKey: companyKey(row.companyName || row.domainRaw),
  }));

  const { people, replies } = await peopleFor(
    [...new Set([...rows.map(r => r.companyDomain), ...meetings.map(m => m.domain)].filter(Boolean))],
    [...new Set([...rows.map(r => r.companyKey), ...meetings.map(m => companyKey(m.company || m.domain || ''))].filter(Boolean))],
  );
  const byDomain = groupBy(people, p => p.domain);
  const byKey = groupBy(people.filter(p => p.channel === 'linkedin'), p => p.companyKey);
  const peopleAt = row => [...new Set([...(byDomain.get(row.companyDomain) || []), ...(byKey.get(row.companyKey) || [])])];

  const logged = rows.map(row => ({ ...row, skipReason: skipReason(row), ...matchRow(row, peopleAt) }));
  const otherRepliers = repliersWithoutLeads(replies, people, lookups.canonical);
  const booked = bookedPositives(meetings, logged, row => [...peopleAt(row), ...(otherRepliers.get(row.companyDomain) || [])]);
  log(`${rows.length} rows, ${booked.length} booked with nothing logged, ${people.length} people at their companies`);
  return [...logged, ...booked];
}

const tally = (rows, key) => rows.reduce((counts, row) => {
  const k = key(row) ?? 'none';
  counts[k] = (counts[k] || 0) + 1;
  return counts;
}, {});

/**
 * Reads two tabs and ties each row to a person, then adds SDR bookings nobody logged:
 * no Instantly or HeyReach call.
 * Replaces the table with what the sheet says now, so a corrected or deleted row
 * is corrected or gone tomorrow, except when the read looks broken: an emptied or
 * renamed tab must not wipe every SDR's positives.
 */
export const job = {
  label: 'Positive response sheet',
  dependsOn: ['company-identity', 'meetings-evidence', 'meeting-credit'],
  weight: 1,
  minSliceMs: 30_000,
  maxAgeHours: 36,

  async run({ log }) {
    const rows = await buildPositiveRows({ log });
    const [{ stored }] = await qp(`SELECT count(*)::int AS stored FROM dash_sdr_positives`);
    if (rows.length < stored * MIN_SHARE_OF_STORED) {
      throw new Error(`The sheet read ${rows.length} rows against ${stored} stored; left the table as it was. Check both tabs.`);
    }

    const now = new Date();
    const values = rows.map(r => [
      rowKey(r), r.tab, r.sheetRow, r.personName, r.companyName, r.domainRaw, r.companyDomain, r.sdr, r.sdrRaw, r.channel,
      r.sender, r.repliedOn, r.dateSource, r.status, r.notes, r.comments, r.mark, r.skipReason, r.matchKind,
      r.personEmail, r.linkedinId, r.campaignId, r.leadId, now,
    ]);
    await withTx(async client => {
      await upsertRows('dash_sdr_positives', COLUMNS, values, { conflict: ['key'], client });
      await qp(`DELETE FROM dash_sdr_positives WHERE NOT (key = ANY($1::text[]))`, [values.map(v => v[0])], client);
    });
    // Both lead views join this table, and without stats on a freshly filled table they ran ten times slower.
    await qp(`ANALYZE dash_sdr_positives`).catch(() => {});

    const counted = rows.filter(r => !r.skipReason);
    return {
      rows: rows.length,
      counted: counted.length,
      booked: rows.filter(r => r.tab === 'meeting').length,
      skipped: tally(rows.filter(r => r.skipReason), r => r.skipReason),
      matched: tally(counted, r => r.matchKind),
      creditedToCampaign: counted.filter(r => r.campaignId).length,
      noDomain: counted.filter(r => !r.companyDomain).length,
    };
  },
};
