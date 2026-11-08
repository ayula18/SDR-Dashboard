import { qp } from '../db.js';
import { creditMeetings } from '../outreach/meeting-credit.js';
import { emailsIn, readFormPost } from '../outreach/meeting-posts.js';
import { parseAlert } from './slack-meetings.js';

/**
 * Everything creditMeetings (lib/outreach/meeting-credit.js) weighs, read from what
 * this app and the AI SDR app already hold: no API call. Reads only.
 *
 * `campaigns` lets a rehearsal pass its own campaign list, for instance with
 * broadcasts marked before the migration that stores them has run.
 */
export async function loadCreditInputs({ campaigns: given = null } = {}) {
  const [rows, forms, postRows, team, senders, aliases, campaignRows] = await Promise.all([
    qp(`
      SELECT dm.id, COALESCE(cd.canonical_domain, dm.company_domain) AS domain, dm.company_raw AS "companyRaw",
             dm.meeting_date::text AS date, dm.source, dm.channel, dm.source_of_meeting AS "sourceOfMeeting", dm.sdr_name AS "sdrName", dm.stated_sdr AS "statedSdr",
             dm.campaign_id AS "statedCampaignId", dm.points::float AS points, dm.superseded_by AS "supersededBy", dm.outcome
        FROM dash_meetings dm
        LEFT JOIN dash_company_domains cd ON cd.domain = dm.company_domain
        LEFT JOIN dash_internal_domains idom ON idom.domain = COALESCE(cd.canonical_domain, dm.company_domain)
       WHERE idom.domain IS NULL AND dm.meeting_date IS NOT NULL`),
    qp(`SELECT deal_id AS "dealId", company_domain AS domain, meeting_date::text AS date, sdr, not_sdr AS "notSdr",
               owner_raw AS "ownerRaw", booked_on::text AS "bookedOn"
          FROM dash_sdr_form`),
    // The form's posts. The booking bot's own alerts ("New meeting booked") are another message.
    qp(`SELECT source_event_id AS id, occurred_at AS "postedAt", body
          FROM ctx_events
         WHERE source = 'slack' AND raw->>'channel' = 'C05TANDC64F'
           AND body LIKE '%- Meeting booked%' AND body NOT LIKE '%New meeting booked%'`),
    qp(`SELECT name, role FROM dash_team`),
    qp(`SELECT DISTINCT sender AS name FROM dash_linkedin_leads WHERE sender IS NOT NULL
        UNION SELECT DISTINCT unnest(senders) FROM dash_campaigns`),
    qp(`SELECT domain, canonical_domain FROM dash_company_domains`),
    given ? null : qp(`SELECT id, name, platform, sdr, excluded, kind, senders FROM dash_v_campaigns`),
  ]);

  const canonical = new Map(aliases.map(a => [a.domain, a.canonical_domain]));
  const spellings = new Map();
  for (const a of aliases) spellings.set(a.canonical_domain, [...(spellings.get(a.canonical_domain) || [a.canonical_domain]), a.domain]);
  const posts = postRows.map(p => {
    const post = readFormPost(p.body, p.postedAt);
    return post && { id: p.id, postedAt: p.postedAt, ...post, domain: post.domain && (canonical.get(post.domain) || post.domain) };
  }).filter(Boolean);

  // Who a booking with no company was, from its alert: the invitee's name and address.
  const noCompany = rows.filter(r => !r.domain && r.source === 'slack');
  const alerts = noCompany.length ? await qp(
    `SELECT source_event_id AS id, body FROM ctx_events WHERE source = 'slack' AND source_event_id = ANY($1::text[])`,
    [noCompany.map(r => r.id.replace(/^slack:/, ''))]) : [];
  const alertById = new Map(alerts.map(a => [`slack:${a.id}`, parseAlert(a.body)]));
  for (const row of noCompany) {
    const alert = alertById.get(row.id);
    if (alert) Object.assign(row, { invitee: alert.person || null, inviteeEmail: alert.email || null });
  }
  const invitees = [...new Set(noCompany.map(r => r.invitee?.trim().toLowerCase()).filter(Boolean))];
  const named = invitees.length ? await qp(
    `SELECT lower(person_name) AS name, company_domain AS domain FROM dash_v_linkedin_leads
      WHERE lower(person_name) = ANY($1::text[]) AND company_domain IS NOT NULL`, [invitees]) : [];
  const leadsByName = new Map();
  for (const n of named) leadsByName.set(n.name, [...(leadsByName.get(n.name) || []), n.domain]);

  // Everyone our outreach reached at these companies, and every reply from them.
  const domains = [...new Set([...rows.map(r => r.domain), ...named.map(n => n.domain), ...posts.map(p => p.domain)].filter(Boolean))];
  const raw = [...new Set(domains.flatMap(d => spellings.get(d) || [d]))];
  const [emailPeople, linkedinPeople, replies, logged] = await Promise.all([
    qp(`SELECT 'email' AS channel, company_domain AS domain, lower(email) AS email, campaign_id AS "campaignId",
               COALESCE(first_contact_at, last_contact_at, created_at_src)::text AS "reachedAt"
          FROM dash_leads WHERE company_domain = ANY($1::text[])`, [raw]),
    qp(`SELECT 'linkedin' AS channel, company_domain AS domain, person_name AS name, NULL AS email,
               linkedin_id AS "linkedinId", campaign_id AS "campaignId", sender,
               COALESCE(first_touch_at, added_at)::text AS "reachedAt"
          FROM dash_v_linkedin_leads WHERE company_domain = ANY($1::text[]) AND reached`, [domains]),
    qp(`SELECT CASE v.platform WHEN 'email' THEN 'email' ELSE 'linkedin' END AS channel, v.company_domain AS domain,
               v.person_name AS name, lower(v.person_email) AS email, v.person_linkedin_id AS "linkedinId",
               c.id AS "campaignId", v.replied_at::text AS at, v.is_positive AS positive, v.is_negative AS negative
          FROM dash_v_reply_verdicts v
          LEFT JOIN dash_campaigns c ON c.external_id = v.campaign_external_id
                                    AND c.platform = CASE v.platform WHEN 'email' THEN 'instantly' ELSE 'heyreach' END
         WHERE NOT v.is_auto AND v.company_domain = ANY($1::text[])`, [raw]),
    // With the account a LinkedIn positive's lead was messaged from, which a chat on the form can contradict.
    qp(`SELECT s.company_domain AS domain, s.sdr, s.replied_on::text AS day, s.channel, s.campaign_id AS "campaignId",
               s.person_name AS "personName", ll.sender
          FROM dash_v_sheet_positives s
          LEFT JOIN dash_linkedin_leads ll ON s.channel = 'linkedin' AND ll.campaign_id = s.campaign_id AND ll.lead_id = s.lead_id
         WHERE s.tab <> 'meeting' AND s.company_domain IS NOT NULL`),
  ]);

  // The people behind every address a post shows, wherever our data files them.
  const addresses = [...new Set(posts.flatMap(p => emailsIn(p.said)))];
  const [emailedAt, repliedFrom] = addresses.length ? await Promise.all([
    qp(`SELECT 'email' AS channel, company_domain AS domain, lower(email) AS email, campaign_id AS "campaignId",
               COALESCE(first_contact_at, last_contact_at, created_at_src)::text AS "reachedAt"
          FROM dash_leads WHERE lower(email) = ANY($1::text[])`, [addresses]),
    qp(`SELECT CASE v.platform WHEN 'email' THEN 'email' ELSE 'linkedin' END AS channel, v.company_domain AS domain,
               v.person_name AS name, lower(v.person_email) AS email, c.id AS "campaignId", v.replied_at::text AS "reachedAt"
          FROM dash_v_reply_verdicts v
          JOIN dash_campaigns c ON c.external_id = v.campaign_external_id
                               AND c.platform = CASE v.platform WHEN 'email' THEN 'instantly' ELSE 'heyreach' END
         WHERE NOT v.is_auto AND lower(v.person_email) = ANY($1::text[])`, [addresses]),
  ]) : [[], []];
  const byEmail = new Map();
  for (const p of [...emailedAt, ...repliedFrom]) byEmail.set(p.email, [...(byEmail.get(p.email) || []), p]);

  const byDomain = list => {
    const map = new Map();
    for (const item of list) {
      const d = canonical.get(item.domain) || item.domain;
      map.set(d, [...(map.get(d) || []), { ...item, domain: d }]);
    }
    return domain => map.get(domain) || [];
  };

  return {
    rows,
    forms,
    posts,
    roster: new Set(team.filter(t => t.role === 'sdr' || t.role === 'sdr_extra').map(t => t.name)),
    ours: [...team.map(t => t.name), ...senders.map(s => s.name)],
    senders: senders.map(s => s.name).filter(Boolean),
    campaigns: given || new Map(campaignRows.map(c => [c.id, c])),
    leadsByName,
    peopleByEmail: email => byEmail.get(email) || [],
    peopleAt: byDomain([...emailPeople, ...linkedinPeople]),
    repliesAt: byDomain(replies),
    loggedAt: byDomain(logged),
  };
}

/** Every meeting record's credit, as the job will store it. Writes nothing. */
export async function buildMeetingCredit(options) {
  const input = await loadCreditInputs(options);
  return { input, credit: creditMeetings(input) };
}
