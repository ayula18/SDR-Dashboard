import { qp } from '../db.js';
import { ownWords } from '../reply-sentiment.js';
import { REPLY_RANK, badRequest } from './format.js';

/**
 * One company's outreach as a conversation: every email and LinkedIn message we
 * sent the people a program reached there, and everything they wrote back, with
 * the label each reply got.
 *
 * Read live from the AI SDR archive (ctx_events) when someone opens it; no
 * message text is copied into dash_* tables. Two gaps in that archive:
 *   - sequence emails are archived without their text, so a sent email shows
 *     its step's copy from Instantly, which the campaign sync keeps to the first
 *     STEP_COPY_CHARS characters
 *   - emails an SDR sends by hand from Instantly are archived without text
 */

export const CONVERSATION_CHANNELS = ['both', 'email', 'linkedin'];
const MAX_PEOPLE = 60;
const MAX_EVENTS = 150;
const MAX_TEXT = 4000;
const STEP_COPY_CHARS = 400; // lib/sync/jobs/instantly-campaigns.js keeps this much of each step's copy

const time = value => (value ? new Date(value).getTime() : 0);
const clip = text => {
  const s = String(text || '').trim();
  return s.length > MAX_TEXT ? `${s.slice(0, MAX_TEXT)}…` : s;
};

/** Instantly's step id "0_1_0" (sequence, step, variant) → { step: 1, variant: 0 }, both zero-based. */
export function parseStep(value) {
  const parts = String(value ?? '').split('_');
  if (parts.length !== 3) return null;
  const [, step, variant] = parts.map(Number);
  return Number.isInteger(step) && Number.isInteger(variant) ? { step, variant } : null;
}

/** What a person's replies come to: their latest no when they said one, otherwise their best reply. */
export function personVerdict(replies) {
  const human = replies.filter(r => r.verdict && !r.isAuto);
  const noes = human.filter(r => r.isNegative).sort((a, b) => time(b.at) - time(a.at));
  if (noes.length) return noes[0].verdict;
  const ranked = human
    .filter(r => REPLY_RANK.includes(r.verdict))
    .sort((a, b) => REPLY_RANK.indexOf(a.verdict) - REPLY_RANK.indexOf(b.verdict));
  return ranked[0]?.verdict || null;
}

function labelled(event, label) {
  return {
    ...event,
    verdict: label?.verdict || null,
    reason: label?.reason || null,
    isPositive: Boolean(label?.isPositive),
    isNegative: Boolean(label?.isNegative),
    isAuto: Boolean(label?.isAuto),
  };
}

function emailEvent(e, { labels, steps, campaignNames }) {
  const id = `instantly:${e.sourceEventId}`;
  const campaign = campaignNames.get(e.campaignExternalId) || null;

  if (e.type === 'email_reply') {
    return labelled({
      id, channel: 'email', direction: 'received', at: e.at, by: e.email, subject: e.subject || null,
      step: null, campaign, manual: false, kind: 'message', text: clip(ownWords(e.body) || e.body), truncated: false,
    }, labels.get(id));
  }

  const parsed = String(e.ueType) === '3' ? null : parseStep(e.step);
  const copy = parsed ? steps.get(`${e.campaignExternalId}:${parsed.step}:${parsed.variant}`) : null;
  return labelled({
    id,
    channel: 'email',
    direction: 'sent',
    at: e.at,
    by: e.mailbox || null,
    subject: e.subject || copy?.subject || null,
    step: parsed ? parsed.step + 1 : null,
    campaign,
    manual: !parsed,
    kind: copy?.copy ? 'template' : 'none',
    text: copy?.copy ? clip(copy.copy) : null,
    truncated: Boolean(copy?.copy && copy.copy.length >= STEP_COPY_CHARS),
  }, null);
}

function linkedinEvent(e, { labels }) {
  const id = `heyreach:${e.sourceEventId}`;
  const received = e.type === 'linkedin_reply';
  return labelled({
    id,
    channel: 'linkedin',
    direction: received ? 'received' : 'sent',
    at: e.at,
    by: received ? e.personName : e.sender,
    subject: null,
    step: null,
    campaign: null,
    manual: false,
    kind: 'message',
    text: clip(e.body),
    truncated: false,
  }, received ? labels.get(id) : null);
}

function withTimeline(person, events) {
  const timeline = events.sort((a, b) => time(a.at) - time(b.at)).slice(-MAX_EVENTS);
  const received = timeline.filter(e => e.direction === 'received');
  const last = timeline[timeline.length - 1];
  return {
    ...person,
    verdict: personVerdict(received),
    sent: timeline.length - received.length,
    received: received.length,
    lastActivityAt: last?.at || person.lastActivityAt || null,
    events: timeline,
  };
}

const outcomeGroup = p => (p.positive ? 0 : p.received > 0 && !p.negative ? 1 : p.negative ? 2 : 3);

/**
 * People and their timelines from rows already read. Pure, so it is tested
 * without a database. Replies are matched to labels by "<source>:<event id>",
 * the id dash_v_reply_verdicts uses.
 */
export function buildConversation({
  emailPeople = [], linkedinPeople = [], emailEvents = [], linkedinEvents = [],
  labels = new Map(), steps = new Map(), campaignNames = new Map(),
}) {
  const ctx = { labels, steps, campaignNames };
  const group = (rows, key) => rows.reduce((map, row) => map.set(key(row), [...(map.get(key(row)) || []), row]), new Map());
  const byEmail = group(emailEvents, e => String(e.email).toLowerCase());
  const byProfile = group(linkedinEvents, e => e.linkedinId);

  const people = [
    ...emailPeople.map(p => withTimeline({
      key: `email:${p.email}`,
      channel: 'email',
      name: p.email,
      title: null,
      email: p.email,
      profileUrl: null,
      campaigns: p.campaigns || [],
      sdrs: p.sdrs || [],
      senders: [],
      replied: Boolean(p.replied),
      positive: Boolean(p.positive),
      negative: Boolean(p.negative),
      lastActivityAt: p.lastAt || null,
    }, (byEmail.get(String(p.email).toLowerCase()) || []).map(e => emailEvent(e, ctx)))),
    ...linkedinPeople.map(p => {
      const raw = byProfile.get(p.linkedinId) || [];
      return withTimeline({
        key: `linkedin:${p.linkedinId}`,
        channel: 'linkedin',
        name: p.name || 'LinkedIn member',
        title: p.title || null,
        email: null,
        profileUrl: raw.find(e => e.profileUrl)?.profileUrl || null,
        campaigns: p.campaigns || [],
        sdrs: p.sdrs || [],
        senders: p.senders || [],
        replied: Boolean(p.replied),
        positive: Boolean(p.positive),
        negative: Boolean(p.negative),
        lastActivityAt: p.lastAt || null,
      }, raw.map(e => linkedinEvent(e, ctx)));
    }),
  ];

  return people.sort((a, b) => outcomeGroup(a) - outcomeGroup(b) || time(b.lastActivityAt) - time(a.lastActivityAt));
}

/**
 * `company` is a domain, or "name:<company key>" for a LinkedIn company with no
 * domain yet (as companiesAcrossChannels keys them). `program` keeps the people
 * that program reached; each person's timeline still shows everything we have
 * with them, from any campaign.
 */
export async function getConversation({ company, program = null, channel = 'both' }) {
  const key = String(company || '').trim().toLowerCase();
  if (!key) throw badRequest('Say which company: a domain, or name:<company key>');
  const view = CONVERSATION_CHANNELS.includes(channel) ? channel : 'both';
  const domain = key.startsWith('name:') ? null : key;

  const [emailPeople, linkedinPeople, named] = await Promise.all([
    view !== 'linkedin' && domain ? qp(`
      SELECT l.email, max(l.company_name) AS company_name,
             array_agg(DISTINCT l.campaign_name) AS campaigns,
             array_agg(DISTINCT l.sdr) FILTER (WHERE l.sdr IS NOT NULL) AS sdrs,
             bool_or(l.replied) AS replied, bool_or(l.positive) AS positive, bool_or(l.negative) AS negative,
             max(GREATEST(l.last_contact_at, l.last_reply_at)) AS last_at
        FROM dash_v_leads l
       WHERE l.company_domain = $1 AND NOT l.excluded AND ($2::text IS NULL OR l.program = $2)
       GROUP BY l.email
       ORDER BY bool_or(l.replied) DESC, max(GREATEST(l.last_contact_at, l.last_reply_at)) DESC NULLS LAST
       LIMIT ${MAX_PEOPLE}`, [domain, program]) : [],
    view !== 'email' ? qp(`
      SELECT l.linkedin_id, max(l.person_name) AS name, max(l.position) AS title, max(l.company_name) AS company_name,
             array_agg(DISTINCT l.campaign_name) AS campaigns,
             array_agg(DISTINCT l.sdr) FILTER (WHERE l.sdr IS NOT NULL) AS sdrs,
             array_agg(DISTINCT l.sender) FILTER (WHERE l.sender IS NOT NULL) AS senders,
             bool_or(l.replied) AS replied, bool_or(l.positive) AS positive, bool_or(l.negative) AS negative,
             max(GREATEST(l.added_at, l.last_action_at, l.last_reply_at)) AS last_at
        FROM dash_v_linkedin_leads l
       WHERE COALESCE(l.company_domain, 'name:' || l.company_key) = $1
         AND NOT l.no_company AND NOT l.excluded AND ($2::text IS NULL OR l.program = $2)
       GROUP BY l.linkedin_id
       ORDER BY bool_or(l.replied) DESC, max(GREATEST(l.added_at, l.last_action_at, l.last_reply_at)) DESC NULLS LAST
       LIMIT ${MAX_PEOPLE}`, [key, program]) : [],
    domain ? qp(`SELECT company_name FROM companies WHERE domain = $1 LIMIT 1`, [domain]) : [],
  ]);

  const emails = [...new Set(emailPeople.flatMap(p => [p.email, String(p.email).toLowerCase()]))];
  const profileIds = linkedinPeople.map(p => p.linkedin_id);
  const [emailEvents, linkedinEvents] = await Promise.all([
    emails.length ? qp(`
      SELECT source_event_id, event_type, occurred_at, person_email, owner_name, subject, body, step, campaign_id,
             raw->>'ue_type' AS ue_type
        FROM ctx_events
       WHERE source = 'instantly' AND event_type IN ('email_sent', 'email_reply') AND person_email = ANY($1::text[])
       ORDER BY occurred_at`, [emails]) : [],
    profileIds.length ? qp(`
      SELECT source_event_id, event_type, occurred_at, owner_name, person_name, body,
             raw->'profile'->>'linkedinId' AS linkedin_id, raw->'profile'->>'profileUrl' AS profile_url
        FROM ctx_events
       WHERE source = 'heyreach' AND event_type IN ('linkedin_message', 'linkedin_reply')
         AND raw->'profile'->>'linkedinId' = ANY($1::text[])
       ORDER BY occurred_at`, [profileIds]) : [],
  ]);

  const replyIds = [
    ...emailEvents.filter(e => e.event_type === 'email_reply').map(e => `instantly:${e.source_event_id}`),
    ...linkedinEvents.filter(e => e.event_type === 'linkedin_reply').map(e => `heyreach:${e.source_event_id}`),
  ];
  const campaignIds = [...new Set(emailEvents.map(e => e.campaign_id).filter(Boolean))];
  const [labelRows, stepRows] = await Promise.all([
    replyIds.length ? qp(`
      SELECT id, verdict, reason, is_positive, is_negative, is_auto
        FROM dash_v_reply_verdicts WHERE id = ANY($1::text[])`, [replyIds]) : [],
    campaignIds.length ? qp(`
      SELECT c.external_id, c.name, st.step, st.variant, st.subject, st.body_preview
        FROM dash_campaigns c
        LEFT JOIN dash_campaign_steps st ON st.campaign_id = c.id
       WHERE c.platform = 'instantly' AND c.external_id = ANY($1::text[])`, [campaignIds]) : [],
  ]);

  const people = buildConversation({
    emailPeople: emailPeople.map(p => ({
      email: p.email, campaigns: p.campaigns, sdrs: p.sdrs, replied: p.replied, positive: p.positive, negative: p.negative, lastAt: p.last_at,
    })),
    linkedinPeople: linkedinPeople.map(p => ({
      linkedinId: p.linkedin_id, name: p.name, title: p.title, campaigns: p.campaigns, sdrs: p.sdrs, senders: p.senders,
      replied: p.replied, positive: p.positive, negative: p.negative, lastAt: p.last_at,
    })),
    emailEvents: emailEvents.map(e => ({
      sourceEventId: e.source_event_id, type: e.event_type, at: e.occurred_at, email: e.person_email, mailbox: e.owner_name,
      subject: e.subject, body: e.body, step: e.step, campaignExternalId: e.campaign_id, ueType: e.ue_type,
    })),
    linkedinEvents: linkedinEvents.map(e => ({
      sourceEventId: e.source_event_id, type: e.event_type, at: e.occurred_at, sender: e.owner_name, personName: e.person_name,
      body: e.body, linkedinId: e.linkedin_id, profileUrl: e.profile_url,
    })),
    labels: new Map(labelRows.map(r => [r.id, { verdict: r.verdict, reason: r.reason, isPositive: r.is_positive, isNegative: r.is_negative, isAuto: r.is_auto }])),
    steps: new Map(stepRows.filter(r => r.step != null).map(r => [`${r.external_id}:${r.step}:${r.variant}`, { subject: r.subject, copy: r.body_preview }])),
    campaignNames: new Map(stepRows.map(r => [r.external_id, r.name])),
  });

  return {
    company: {
      key,
      domain,
      name: named[0]?.company_name || emailPeople[0]?.company_name || linkedinPeople[0]?.company_name || domain || key.slice(5),
    },
    program,
    channel: view,
    people,
    totals: {
      people: people.length,
      sent: people.reduce((s, p) => s + p.sent, 0),
      received: people.reduce((s, p) => s + p.received, 0),
      positive: people.filter(p => p.positive).length,
    },
  };
}
