import { qp } from '../db.js';
import { addDays, isoDay, today } from '../outreach/dates.js';

/**
 * Did the prospect turn up?
 *
 * One rung at a time, best evidence first, and whichever rung answers is
 * recorded with the meeting so the number on the page can be explained:
 *
 *   1 audit     the audit sheet's own verdict, a human's call
 *   2 recording a call recording within a day of the slot with someone from
 *               that company in the room. Not just any recording: a transcript
 *               where only our side spoke is what a no-show looks like
 *   3 pipeline  the sales pipeline moved the company forward after the slot.
 *               You do not reach "Trial - Ongoing" without meeting anyone
 *   4 moved     a later booking for the same person: rescheduled, not missed
 *   5 upcoming  the slot is still ahead
 *   6 review    nothing proves they joined. HubSpot calling it completed lands
 *               here too: our own POC sitting on the call for ten minutes marks
 *               it completed, so it is a prompt to check, never proof
 *
 * HubSpot's meeting objects are deliberately absent from the held rungs. One
 * exists as soon as a meeting is scheduled, so it says a meeting was booked,
 * which is the question we already answered.
 */

export const OUTCOMES = ['held', 'no_show', 'rescheduled', 'upcoming', 'review'];

// Rungs 1–3 mean the prospect was in the room; `review` means we cannot say.
export const HELD = 'held';

// Pipeline stages a company only reaches after someone has actually spoken to them.
// "Lost" and "Irrelevant" are left out: a company can be written off without a meeting.
const MET_STAGES = /(interest|trial|contract|converted|pushed out|poc|pilot|negotiat)/i;
const STAGE_WINDOW_DAYS = 120;

const RECORDING_WINDOW_DAYS = 1;
const DEFAULT_WINDOW_DAYS = 240;

const lower = value => String(value ?? '').toLowerCase();
const minutes = value => (Number.isFinite(Number(value)) ? Math.round(Number(value)) : null);
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The audit sheet's own column, when it has an opinion. */
function fromAudit(meeting) {
  if (meeting.source !== 'sheet') return null;
  const said = lower(meeting.happened);
  if (said === 'yes') return { outcome: 'held', source: 'audit', note: 'The audit sheet marks it held.' };
  if (said === 'no') return { outcome: 'no_show', source: 'audit', note: 'The audit sheet marks it a no-show.' };
  if (said === 'not yet') return null; // the sheet is waiting too; let the later rungs decide
  return null;
}

/** A recording of that call with at least one person from the company on it. */
function fromRecording(recording) {
  if (!recording) return null;
  const who = recording.theirPeople?.length
    ? `${plural(recording.theirPeople.length, 'person', 'people')} from ${recording.theirPeople[0].split('@')[1] || 'their side'}`
    : 'their side';
  const length = recording.minutes ? `${recording.minutes} min` : 'recorded';
  return { outcome: 'held', source: 'recording', note: `Call recording, ${length}, ${who} in the room.` };
}

/** The sales pipeline moved this company on after the meeting. */
function fromPipeline(stage) {
  if (!stage) return null;
  return { outcome: 'held', source: 'pipeline', note: `Sales pipeline moved to "${stage.stage}" on ${stage.day}.` };
}

/**
 * The evidence for one meeting, as the waterfall decides it.
 * `context` carries what the batch queries found for this meeting.
 */
export function decide(meeting, context = {}, now = isoDay(today())) {
  const { recording = null, stage = null, hubspotCompleted = false, supersededBy = null } = context;

  if (supersededBy) {
    return { outcome: 'rescheduled', source: 'moved', note: 'This slot moved; the booking is counted at its later date.' };
  }

  const answer = fromAudit(meeting) || fromRecording(recording) || fromPipeline(stage);
  if (answer) return answer;

  // Today's meetings are not yet unproven: a recording of this morning's call
  // reaches the archive tonight.
  if (meeting.day && meeting.day >= now) {
    return { outcome: 'upcoming', source: 'schedule', note: 'The slot has not come round yet, or the recording has not been archived.' };
  }
  if (hubspotCompleted) {
    return {
      outcome: 'review',
      source: 'hubspot',
      note: 'HubSpot marks it completed, but no recording puts them in the room. Needs a human check.',
    };
  }
  return { outcome: 'review', source: 'none', note: 'Nothing shows they joined: no recording, no pipeline movement. Needs a human check.' };
}

/**
 * Re-decides every meeting in the window. Cheap enough to run whole: the
 * evidence is four indexed reads, and the meetings table is small.
 */
export async function syncMeetingEvidence({ days = DEFAULT_WINDOW_DAYS } = {}) {
  const from = isoDay(new Date(Date.now() - days * 86_400_000));

  // Dates come back as text throughout: a DATE parsed into a JS Date lands on
  // local midnight, which is the previous day once it is read back in UTC.
  const meetings = await qp(
    `SELECT id, company_domain, meeting_date::text AS day, happened, source, superseded_by
       FROM dash_meetings
      WHERE meeting_date >= $1
      ORDER BY meeting_date DESC`,
    [from]
  );
  if (!meetings.length) return { meetings: 0, status: 'skipped', reason: 'no meetings in the window' };

  const domains = [...new Set(meetings.map(m => m.company_domain).filter(Boolean))];
  const [recordings, stages, hubspot] = domains.length
    ? await Promise.all([
      // A recording counts only when someone whose email is at that company was on the call.
      qp(
        `SELECT COALESCE(e.domain, '') AS resolved_domain,
                (e.occurred_at AT TIME ZONE 'UTC')::date::text AS day,
                (e.raw->>'duration')::float AS minutes,
                COALESCE(e.raw->'external_participants', '[]'::jsonb) AS external
           FROM ctx_events e
          WHERE e.source = 'fireflies' AND e.event_type = 'meeting'
            AND e.occurred_at >= $1::date - 2`,
        [from]
      ),
      qp(
        `SELECT e.domain, (e.occurred_at AT TIME ZONE 'UTC')::date::text AS day, e.raw->>'stage' AS stage
           FROM ctx_events e
          WHERE e.source = 'sheet' AND e.event_type = 'deal_stage'
            AND e.domain = ANY($1::text[]) AND e.occurred_at >= $2::date - 1
          ORDER BY e.occurred_at`,
        [domains, from]
      ),
      qp(
        `SELECT e.domain, (e.occurred_at AT TIME ZONE 'UTC')::date::text AS day
           FROM ctx_events e
          WHERE e.source = 'hubspot' AND e.event_type = 'meeting'
            AND e.domain = ANY($1::text[]) AND e.occurred_at >= $2::date - 2
            AND e.raw->'properties'->>'hs_meeting_outcome' = 'COMPLETED'`,
        [domains, from]
      ),
    ])
    : [[], [], []];

  // A recording belongs to a company when the event resolved to it, or when one
  // of the people on the call has an email there.
  const byDomainDay = new Map();
  for (const r of recordings) {
    const their = (Array.isArray(r.external) ? r.external : []).map(String);
    const theirDomains = new Set(their.map(email => email.split('@')[1]).filter(Boolean));
    if (r.resolved_domain) theirDomains.add(r.resolved_domain);
    for (const domain of theirDomains) {
      // Only count the company as present when one of its own people was on the call.
      const theirPeople = their.filter(email => email.endsWith(`@${domain}`));
      if (!theirPeople.length) continue;
      const key = `${domain}|${r.day}`;
      const existing = byDomainDay.get(key);
      if (!existing || (r.minutes || 0) > (existing.minutes || 0)) {
        byDomainDay.set(key, { minutes: minutes(r.minutes), theirPeople });
      }
    }
  }
  const hubspotDays = new Set(hubspot.map(r => `${r.domain}|${r.day}`));
  const stagesByDomain = new Map();
  for (const s of stages) {
    if (!MET_STAGES.test(s.stage || '')) continue;
    if (!stagesByDomain.has(s.domain)) stagesByDomain.set(s.domain, []);
    stagesByDomain.get(s.domain).push(s);
  }

  const now = isoDay(today());
  const updates = meetings.map(m => {
    const context = { supersededBy: m.superseded_by, hubspotCompleted: false };
    if (m.company_domain && m.day) {
      for (let offset = -RECORDING_WINDOW_DAYS; offset <= RECORDING_WINDOW_DAYS; offset += 1) {
        const key = `${m.company_domain}|${isoDay(addDays(m.day, offset))}`;
        if (!context.recording) context.recording = byDomainDay.get(key) || null;
        if (hubspotDays.has(key)) context.hubspotCompleted = true;
      }
      // Pipeline movement counts only when it came after the meeting.
      const limit = isoDay(addDays(m.day, STAGE_WINDOW_DAYS));
      context.stage = (stagesByDomain.get(m.company_domain) || []).find(s => s.day >= m.day && s.day <= limit) || null;
    }
    return { id: m.id, ...decide(m, context, now) };
  });

  // One statement: a round trip per meeting is what makes a nightly job slow.
  await qp(
    `UPDATE dash_meetings m
        SET outcome = u.outcome, evidence_source = u.source, evidence_note = u.note, evidence_at = NOW()
       FROM (SELECT unnest($1::text[]) AS id, unnest($2::text[]) AS outcome,
                    unnest($3::text[]) AS source, unnest($4::text[]) AS note) u
      WHERE m.id = u.id`,
    [updates.map(u => u.id), updates.map(u => u.outcome), updates.map(u => u.source), updates.map(u => u.note)]
  );

  const count = outcome => updates.filter(u => u.outcome === outcome).length;
  return {
    meetings: updates.length,
    held: count('held'),
    noShow: count('no_show'),
    rescheduled: count('rescheduled'),
    upcoming: count('upcoming'),
    review: count('review'),
    byRecording: updates.filter(u => u.source === 'recording').length,
    byAudit: updates.filter(u => u.source === 'audit').length,
    byPipeline: updates.filter(u => u.source === 'pipeline').length,
    since: from,
  };
}
