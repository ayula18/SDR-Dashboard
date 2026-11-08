import { toDay } from './dates.js';
import { domainFromEmail } from './domains.js';
import { emailsIn, peopleInPost, postChannel } from './meeting-posts.js';

/**
 * WHO BOOKED EACH MEETING AND WHERE IT CAME FROM, decided once (Ayush, 2026-11-08):
 * "where we are sure, like the form, treat it as truth; only on edge cases, where we
 * are not very sure, put our waterfall model to check for the meeting source."
 *
 * Pure, so every rule is tested without a database. lib/sync/meeting-credit.js
 * reads the inputs and stores what this returns.
 *
 * 1 One meeting, not repeats. Records of one company within MERGE_DAYS are one
 *   meeting, held on the latest of their dates.
 * 2 Who booked it. The SDR's own entry on the dashboard, else the HubSpot form
 *   (each form row is one meeting: the nearest), else the audit sheet, else the
 *   booking alert. Half each only where the audit sheet itself splits the meeting
 *   between two SDRs (two rows at 0.5 points), or two form rows name two people.
 *   Someone who is not on the SDR roster has not booked an SDR meeting.
 * 3 Where it came from, the first of:
 *     the campaign the SDR stated on the dashboard
 *     the conversation pasted on the form: the person in it and the campaign that
 *       reached them, or at least its channel (a Nooks call has no campaign)
 *     the booker's own logged positive at that company in the REPLY_DAYS before
 *     a reply from that company in the REPLY_DAYS before, through outreach
 *     the booker's own outreach that reached the company in the TOUCH_DAYS before
 *     nothing: the SDR's meeting, with no campaign
 *   A broadcast (event invites, announcements, hiring) never claims a meeting.
 */

export const MERGE_DAYS = 7;
/** How far a form's date can sit from a meeting and still be that meeting (FORM_MATCH_DAYS in sdr-form.js). */
export const FORM_DAYS = 14;
/** How far a post's "scheduled on" date can sit from the meeting it describes. */
export const POST_DAYS = 21;
export const REPLY_DAYS = 60;
export const TOUCH_DAYS = 180;

const CHANNEL_OF = { instantly: 'email', heyreach: 'linkedin' };
const CHANNEL_WORD = { email: 'email', linkedin: 'LinkedIn', call: 'call' };
// Which record speaks for a meeting when two say different things: the SDR's own,
// then the audited sheet, then the alert, then HubSpot, then the form's own row.
const SOURCE_RANK = { manual: 0, sheet: 1, slack: 2, hubspot: 3, form: 4 };
const SOURCE_WORD = { manual: 'the dashboard entry', sheet: 'the audit sheet', slack: 'the booking alert', hubspot: 'HubSpot', form: 'the HubSpot form' };

const DAY_MS = 86_400_000;
/** Days from `at` to `day`: positive when `at` is before it. */
const before = (day, at) => Math.round((toDay(day) - toDay(at)) / DAY_MS);
const rank = row => SOURCE_RANK[row.source] ?? 9;
const distinct = values => [...new Set(values.filter(Boolean))];
const fmt = iso => {
  const d = toDay(iso);
  return `${d.getUTCDate()} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()]}`;
};
const ago = (day, at) => {
  const n = before(day, at);
  return n <= 0 ? 'on the day' : n === 1 ? 'the day before' : `${n} days before`;
};
/** "Deeksha  Bhargava", "dheeraj dola 🐦‍🔥": an account's name as a chat shows it. */
const accountName = value => String(value ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
const names = list => list.length <= 1 ? list.join('') : `${list.slice(0, -1).join(', ')} and ${list.at(-1)}`;

/**
 * Records of one meeting → one cluster: a company's records within MERGE_DAYS of the
 * first, joined to wherever the booking moved (`supersededBy`, which the booking
 * alerts record). workato.com was booked for 30 Jul and moved to 12 Aug: the audit
 * sheet holds the first slot, the alert the second, and both counted.
 *
 * The meeting is kept at its first record known to be held, else its latest live one.
 * The alerts call any second booking by the same person a move, so a follow-up looks
 * like one: pinecone.io met on 28 Jul (the audit says held) and booked again for
 * 20 Aug. That is still one SDR meeting, on the day it happened. A moved record stays
 * in the cluster as evidence.
 */
export function clusterMeetings(rows) {
  const ordered = [...rows].sort((a, b) => (a.domain || '').localeCompare(b.domain || '') || a.date.localeCompare(b.date) || rank(a) - rank(b));
  const groups = [];
  for (const row of ordered) {
    const last = groups.at(-1);
    if (row.domain && last && last[0].domain === row.domain && before(row.date, last[0].date) <= MERGE_DAYS) last.push(row);
    else groups.push([row]);
  }
  // Join the groups a move links, so a booking that moved more than a week is still one meeting.
  const groupOf = new Map(groups.flatMap((g, i) => g.map(r => [r.id, i])));
  const parent = groups.map((_, i) => i);
  const root = i => (parent[i] === i ? i : (parent[i] = root(parent[i])));
  for (const row of rows) {
    if (row.supersededBy && groupOf.has(row.supersededBy)) parent[root(groupOf.get(row.id))] = root(groupOf.get(row.supersededBy));
  }
  const merged = new Map();
  groups.forEach((g, i) => merged.set(root(i), [...(merged.get(root(i)) || []), ...g]));

  return [...merged.values()].map(list => {
    const live = list.filter(r => !r.supersededBy);
    const held = live.filter(r => r.outcome === 'held').sort((a, b) => a.date.localeCompare(b.date) || rank(a) - rank(b) || a.id.localeCompare(b.id));
    const kept = held[0] || [...(live.length ? live : list)].sort((a, b) => b.date.localeCompare(a.date) || rank(a) - rank(b) || a.id.localeCompare(b.id))[0];
    return { domain: kept.domain || list.find(r => r.domain)?.domain || null, rows: list, forms: [], posts: [], kept, date: kept.date };
  });
}

/** Each item goes to the one meeting at its company it sits nearest, within `days`. */
export function attachNearest(items, clusters, days, key) {
  const byDomain = new Map();
  for (const c of clusters) if (c.domain) byDomain.set(c.domain, [...(byDomain.get(c.domain) || []), c]);
  for (const item of items) {
    if (!item.domain || !item.date) continue;
    const gap = c => Math.min(...c.rows.map(r => Math.abs(before(r.date, item.date))));
    const best = (byDomain.get(item.domain) || [])
      .filter(c => gap(c) <= days)
      .sort((a, b) => gap(a) - gap(b) || b.date.localeCompare(a.date))[0];
    if (best) best[key].push(item);
  }
}

/** The audit sheet splitting a meeting between two SDRs: two of its rows, 0.5 points each, naming two people. */
const auditSplit = rows => {
  const halves = distinct(rows.filter(r => r.source === 'sheet' && Number(r.points) === 0.5).map(r => r.sdrName));
  return halves.length >= 2 ? halves.sort() : null;
};

/** The SDR team's channel: "SDR" on the audit sheet, the booking alert and the form's own rows. Not "SDR-Others". */
export const isSdrTeam = channel => /^sdr$/i.test(String(channel ?? '').trim());

const shares = (list, by, sure) => ({ sdrs: list.map(name => ({ name, share: 1 / list.length })), by, sure });

/**
 * Who booked a meeting, from what says so outright. null when nothing says an SDR
 * did; `{ unnamed: true }` when it came through the SDR team with nobody named, which
 * the outreach then has to settle; `{ other }` when the form names someone else.
 */
export function whoBooked(cluster) {
  const rows = cluster.rows;
  const stated = distinct(rows.map(r => r.statedSdr));
  if (stated.length) return shares(stated, 'stated', 'sure');

  const formNames = distinct(cluster.forms.map(f => f.sdr));
  const split = auditSplit(rows);
  if (formNames.length) {
    if (split && formNames.every(n => split.includes(n))) return shares(split, 'split', 'sure');
    return shares(formNames, 'form', 'sure');
  }
  const formOther = cluster.forms.find(f => f.notSdr);
  if (formOther) return { other: formOther.ownerRaw, by: 'form', sure: 'sure' };
  if (split) return shares(split, 'split', 'sure');

  const named = [...rows].filter(r => r.sdrName).sort((a, b) => rank(a) - rank(b));
  if (named.length) return shares([named[0].sdrName], named[0].source, 'likely');
  // Which team a booking came through is the best record's word on it: the audit sheet's
  // "Inbound" stands over an alert whose booking link belonged to the SDR team. A booking
  // that moved speaks through the slot it moved to.
  const team = [...rows].filter(r => r.channel)
    .sort((a, b) => Number(Boolean(a.supersededBy)) - Number(Boolean(b.supersededBy)) || rank(a) - rank(b) || b.date.localeCompare(a.date))[0];
  // AI SDR's own bookings are outreach with no person: "AI SDR" on the form or the sheet.
  // A blank form says nothing.
  const aiSdr = cluster.forms.some(f => /^ai sdr$/i.test(f.ownerRaw || '')) || /^ai sdr$/i.test(team?.sourceOfMeeting || '');
  if (rows.some(r => r.statedCampaignId) || aiSdr || isSdrTeam(team?.channel)) {
    return { sdrs: [], unnamed: true, by: 'channel', sure: 'unsure' };
  }
  // "SDR-Others" is outbound by someone outside the SDR team, whom the sheet names:
  // Piyush's own outreach, Pranesh's calls, a champion who changed jobs. Muni and
  // Suman's ABM are on the roster, so the named rung above already took theirs.
  if (/^sdr/i.test(team?.channel || '') && team.sourceOfMeeting) return { other: team.sourceOfMeeting, by: team.source, sure: 'likely' };
  return null;
}

const describeWho = who => {
  const people = names(who.sdrs.map(s => s.name));
  if (who.by === 'stated') return `${people} said so on the dashboard`;
  if (who.by === 'split') return `${people}, half each: the audit sheet splits it`;
  if (who.by === 'form') return who.sdrs.length > 1 ? `${people}, half each: two HubSpot forms` : `${people} on the HubSpot form`;
  if (who.by === 'outreach') return `nobody named; ${people}'s outreach led to it`;
  return `${SOURCE_WORD[who.by] || who.by} names ${people}`;
};

/**
 * Where an SDR's meeting came from: the first rung of the waterfall that has an
 * answer. `ctx`: campaigns (Map id → { name, platform, sdr, kind, excluded }),
 * peopleAt / repliesAt / loggedAt (domain → rows), peopleByEmail (address → rows),
 * ours (our own people's names) and senders (our LinkedIn accounts' names).
 */
export function whereFrom(cluster, who, ctx) {
  const day = cluster.date;
  const domain = cluster.domain;
  const within = (at, days) => {
    const n = before(day, at);
    return n >= -1 && n <= days;
  };
  const campaignOf = id => ctx.campaigns.get(id) || null;
  const usable = id => {
    const c = campaignOf(id);
    return c && !c.excluded && c.kind !== 'broadcast' ? c : null;
  };
  const bookers = new Set((who.sdrs || []).map(s => s.name));
  const mine = id => bookers.has(campaignOf(id)?.sdr);
  const answer = (rung, sure, fields) => ({ rung, sure, campaignId: null, channel: null, ...fields });

  const stated = cluster.rows.find(r => r.statedCampaignId && campaignOf(r.statedCampaignId) && !campaignOf(r.statedCampaignId).excluded);
  if (stated) {
    const c = campaignOf(stated.statedCampaignId);
    return answer('stated', 'sure', { campaignId: stated.statedCampaignId, channel: CHANNEL_OF[c.platform], note: `the SDR picked ${c.name} on the dashboard` });
  }
  if (!domain) return answer('none', 'unsure', { channel: 'unknown', note: 'no company to look up' });

  const people = ctx.peopleAt(domain);
  const replies = ctx.repliesAt(domain);

  // The conversation the SDR pasted on the form.
  const post = [...cluster.posts].sort((a, b) => Math.abs(before(day, a.date)) - Math.abs(before(day, b.date)))[0] || null;
  let channel = post ? postChannel(post.said) : null;
  if (channel === 'call') return answer('post', 'sure', { channel: 'call', note: 'a call: the form has the Nooks call pasted' });
  // Padded, so "Ahmed M" is not found in "Ahmed, many thanks".
  const text = post ? ` ${accountName(post.said)} ` : '';
  const shows = name => Boolean(name) && text.includes(` ${name} `);
  const senderSeen = p => Boolean(p.sender) && shows(accountName(p.sender));
  // Which of our LinkedIn accounts the pasted chat is on. Only a campaign on one of them
  // carried that conversation: hosted.ai's chat is on Achintya Gupta's account, and the
  // one campaign that reached Rony there ran on Chandra Brahmasa's. A person's own
  // sender says it best; else the campaign's accounts.
  const accounts = new Set((ctx.senders || []).map(accountName).filter(shows));
  const onShownAccount = p => {
    const c = campaignOf(p.campaignId);
    if (!accounts.size || (p.channel || CHANNEL_OF[c?.platform]) !== 'linkedin') return true;
    const own = p.sender ? [p.sender] : c?.senders || [];
    return !own.length || own.some(name => accounts.has(accountName(name)));
  };
  if (post) {
    // Anyone at the company, and anyone whose address the conversation shows, wherever
    // our data files them: litellm.ai's booker wrote from varoon@berri.ai.
    const elsewhere = emailsIn(post.said).flatMap(e => (ctx.peopleByEmail ? ctx.peopleByEmail(e) : []));
    const pool = [...people, ...replies.filter(r => r.campaignId).map(r => ({ ...r, reachedAt: r.at })), ...elsewhere];
    const { people: inPost, how } = peopleInPost(post.said, pool, ctx.ours);
    const found = inPost
      .filter(p => usable(p.campaignId) && p.reachedAt && before(day, p.reachedAt) >= -1 && (!channel || p.channel === channel) && onShownAccount(p))
      .sort((a, b) => Number(mine(b.campaignId)) - Number(mine(a.campaignId))
        || Number(senderSeen(b)) - Number(senderSeen(a))
        || String(b.reachedAt).localeCompare(String(a.reachedAt)))[0];
    if (found) {
      const c = campaignOf(found.campaignId);
      return answer('post', channel && how === 'name' ? 'sure' : 'likely', {
        campaignId: found.campaignId, channel: found.channel, person: found.name || found.email,
        note: `the ${CHANNEL_WORD[found.channel]} conversation pasted on the form is with ${found.name || found.email}, reached by ${c.name}`,
      });
    }
    if (!channel) {
      const seen = distinct(inPost.map(p => p.channel));
      if (seen.length === 1) channel = seen[0];
    }
  }
  const channelFits = row => !channel || row.channel === channel;
  const postNote = channel && post ? `the form shows a ${CHANNEL_WORD[channel]} conversation` : null;

  // What the booker logged on the positive response sheet.
  const logged = ctx.loggedAt(domain)
    .filter(r => (who.unnamed ? ctx.roster.has(r.sdr) : bookers.has(r.sdr)) && within(r.day, REPLY_DAYS) && channelFits(r))
    .map(r => (usable(r.campaignId) && onShownAccount(r) ? r : { ...r, campaignId: null }))
    .sort((a, b) => Number(Boolean(b.campaignId)) - Number(Boolean(a.campaignId)) || b.day.localeCompare(a.day));
  if (logged[0]?.campaignId) {
    const r = logged[0];
    return answer('positive', 'sure', {
      campaignId: r.campaignId, channel: r.channel, person: r.personName, sdr: r.sdr,
      note: `${r.sdr} logged ${r.personName || 'their'} positive reply ${ago(day, r.day)}, through ${campaignOf(r.campaignId).name}`,
    });
  }
  if (logged[0] && !channel) channel = logged[0].channel;

  // A reply from that company that came through outreach.
  const near = replies.filter(r => within(r.at, REPLY_DAYS) && channelFits(r));
  const reply = near.filter(r => usable(r.campaignId) && onShownAccount(r))
    .sort((a, b) => Number(mine(b.campaignId)) - Number(mine(a.campaignId)) || Number(b.positive) - Number(a.positive) || String(b.at).localeCompare(String(a.at)))[0];
  if (reply) {
    return answer('reply', 'likely', {
      campaignId: reply.campaignId, channel: reply.channel, person: reply.name || reply.email,
      note: `${reply.name || reply.email || 'someone there'} replied to ${campaignOf(reply.campaignId).name} ${ago(day, reply.at)}`,
    });
  }
  const toBroadcast = near.filter(r => campaignOf(r.campaignId)?.kind === 'broadcast').sort((a, b) => String(b.at).localeCompare(String(a.at)))[0];
  if (toBroadcast) {
    return answer('broadcast', 'likely', {
      channel: toBroadcast.channel,
      note: `they replied only to ${campaignOf(toBroadcast.campaignId).name}, a broadcast, which never claims a meeting`,
    });
  }

  // The booker's own outreach reached them, with no reply we hold. With nobody named,
  // the SDR team's booking link came in someone's message: the latest SDR outreach there.
  const touch = people
    .filter(p => p.reachedAt && usable(p.campaignId) && within(p.reachedAt, TOUCH_DAYS) && channelFits(p) && onShownAccount(p)
      && (who.unnamed ? ctx.roster.has(campaignOf(p.campaignId).sdr) : mine(p.campaignId)))
    .sort((a, b) => Number(senderSeen(b)) - Number(senderSeen(a)) || String(b.reachedAt).localeCompare(String(a.reachedAt)))[0];
  if (touch) {
    // The conversation pasted on the form is on that campaign's LinkedIn account.
    const onAccount = senderSeen(touch);
    return answer('touch', onAccount ? 'likely' : 'unsure', {
      campaignId: touch.campaignId, channel: touch.channel,
      note: `no reply found; ${campaignOf(touch.campaignId).name} reached them ${ago(day, touch.reachedAt)}`
        + (onAccount ? `, and the form's LinkedIn conversation is on ${touch.sender.replace(/\s+/g, ' ')}'s account` : postNote ? `, and ${postNote}` : ''),
    });
  }
  return answer('none', channel ? 'likely' : 'unsure', {
    channel: channel || 'unknown',
    note: postNote ? `${postNote}, with nobody our campaigns reached` : 'no outreach of ours reached them',
  });
}

/**
 * A booking with no company, named from its invitee: a work address, else a person
 * our LinkedIn outreach reached under that exact name (one company only), else a
 * form post in the same week that names them. `leadsByName`: lowercased full name → domains.
 */
export function resolveCompany(row, { leadsByName = new Map(), posts = [] } = {}) {
  if (row.domain) return null;
  const fromEmail = domainFromEmail(row.inviteeEmail);
  if (fromEmail) return { domain: fromEmail, how: `the invitee's address, ${row.inviteeEmail}` };
  const name = String(row.invitee || '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (name.split(' ').length < 2) return null;
  const domains = distinct(leadsByName.get(name) || []);
  if (domains.length === 1) return { domain: domains[0], how: `${row.invitee}, whom our LinkedIn outreach reached there` };
  const post = posts.find(p => p.domain && Math.abs(before(row.date, p.date)) <= MERGE_DAYS && p.said.toLowerCase().includes(name));
  return post ? { domain: post.domain, how: `${row.invitee}, named in the form post for ${post.domain}` } : null;
}

/**
 * Every meeting record → its credit. `input`: rows (dash_meetings, company canonical),
 * forms (dash_sdr_form), posts (readFormPost + date), roster (Set of SDR names),
 * and the lookups whereFrom reads. A live record merged into another carries
 * `mergedInto` and counts nowhere; a moved one keeps its own row, rescheduled as
 * before, with the credit of the meeting it moved to.
 */
export function creditMeetings(input) {
  const { rows, forms = [], posts = [], roster } = input;
  const resolved = new Map();
  const placed = rows.map(row => {
    const found = resolveCompany(row, input);
    if (found) resolved.set(row.id, found);
    return found ? { ...row, domain: found.domain } : row;
  });
  const clusters = clusterMeetings(placed);
  attachNearest(forms, clusters, FORM_DAYS, 'forms');
  attachNearest(posts, clusters, POST_DAYS, 'posts');

  const out = new Map();
  for (const cluster of clusters) {
    const credit = creditCluster(cluster, { ...input, roster });
    const companyNote = cluster.rows.map(r => resolved.get(r.id)).find(Boolean);
    const dates = distinct(cluster.rows.map(r => r.date)).sort().map(fmt);
    const together = cluster.rows.length < 2 ? null
      : `${cluster.rows.length} records of one meeting${dates.length > 1 ? ` (${names(dates)})` : ''}, counted once on ${fmt(cluster.date)}${cluster.kept.outcome === 'held' && dates.length > 1 ? ', the day it was held' : ''}.`;
    for (const row of cluster.rows) {
      out.set(row.id, {
        id: row.id,
        mergedInto: row.id === cluster.kept.id || row.supersededBy ? null : cluster.kept.id,
        domain: cluster.domain,
        ...credit,
        reason: [companyNote ? `Company from ${companyNote.how}.` : null, credit.reason,
          together].filter(Boolean).join(' '),
      });
    }
  }
  return rows.map(r => out.get(r.id));
}

function creditCluster(cluster, ctx) {
  let who = whoBooked(cluster);
  if (!who) return { bookingBy: cluster.rows.some(r => r.channel) ? 'other' : 'unknown', sdrs: [], campaignId: null, channel: null, who: null, where: null, reason: 'Nothing says an SDR booked it.' };
  if (who.other) {
    const said = who.by === 'form' ? `The HubSpot form says ${who.other}.` : `${SOURCE_WORD[who.by] || who.by} says ${who.other} booked it, outside the SDR team.`;
    return { bookingBy: 'other', sdrs: [], campaignId: null, channel: null, who: { by: who.by, sure: who.sure }, where: null, reason: `${said[0].toUpperCase()}${said.slice(1)}` };
  }

  // Stated campaign without a stated SDR: the campaign's SDR said it was theirs.
  const stated = cluster.rows.find(r => r.statedCampaignId);
  if (who.unnamed && stated && ctx.roster.has(ctx.campaigns.get(stated.statedCampaignId)?.sdr)) {
    who = shares([ctx.campaigns.get(stated.statedCampaignId).sdr], 'stated', 'sure');
  }

  const offRoster = (who.sdrs || []).filter(s => !ctx.roster.has(s.name)).map(s => s.name);
  if (offRoster.length && offRoster.length === who.sdrs.length) {
    return { bookingBy: 'other', sdrs: [], campaignId: null, channel: null, who: { by: who.by, sure: who.sure }, where: null, reason: `Booked by ${names(offRoster)}, who is not an SDR.` };
  }
  if (offRoster.length) who = shares(who.sdrs.map(s => s.name).filter(n => ctx.roster.has(n)), who.by, who.sure);

  const where = whereFrom(cluster, who, ctx);
  if (who.unnamed) {
    const sdr = where.sdr || ctx.campaigns.get(where.campaignId)?.sdr;
    if (sdr && ctx.roster.has(sdr)) who = { ...shares([sdr], 'outreach', 'unsure'), unnamed: false };
  }
  const whoText = who.unnamed ? 'Booked through the SDR team, with nobody named' : describeWho(who);
  return {
    bookingBy: 'sdr',
    sdrs: who.sdrs,
    campaignId: where.campaignId,
    channel: where.channel,
    who: { by: who.by, sure: who.sure },
    where: { rung: where.rung, sure: where.sure, person: where.person || null },
    reason: `${whoText[0].toUpperCase()}${whoText.slice(1)}; ${where.note}.`,
  };
}
