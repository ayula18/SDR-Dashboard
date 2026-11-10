import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DEFAULT_SEQUENCE, JOBS } from '../lib/sync/jobs.js';
import { formMeetingDate, formOwner, formRow, meetingsOnlyOnForm } from '../lib/outreach/sdr-form.js';

const team = [{ name: 'Akhil', aliases: [] }, { name: 'Suman', aliases: [] }];
const NOW = new Date('2026-11-05T00:00:00Z');
const deal = (over = {}, companies = [{ domain: 'https://www.concordium.com/', name: 'Concordium' }]) => ({
  id: 1, companies, properties: { date_of_meeting_sdr_form: '2026-10-12', sdr_owner: 'Ahmed', source_of_meeting: 'Outbound', createdate: '2026-10-09T10:00:00Z', ...over },
});

test('the owner: a person, something else, or nothing said', () => {
  assert.deepEqual(formOwner('Akhil', team), { sdr: 'Akhil', notSdr: false });
  assert.deepEqual(formOwner('Suman - ABM', team), { sdr: 'Suman', notSdr: false });
  for (const other of ['Ads', 'Inbound', 'Referral', 'Ecosystem', 'Outbound - Old', 'Pranesh - Cold calling']) assert.deepEqual(formOwner(other, team), { sdr: null, notSdr: true }, other);
  assert.deepEqual(formOwner('', team), { sdr: null, notSdr: false }, 'blank is most inbound and AE deals: it says nothing');
  assert.deepEqual(formOwner('AI SDR', team), { sdr: null, notSdr: false }, 'outreach, with no person to credit');
});

test('a date a typed year too far is pulled back; a real one is left alone', () => {
  assert.equal(formMeetingDate('2027-07-02', NOW), '2026-07-02');
  assert.equal(formMeetingDate('2026-12-22', NOW), '2026-12-22');
  assert.equal(formMeetingDate('2026-10-12', NOW), '2026-10-12');
  assert.equal(formMeetingDate('', NOW), null);
});

test('a deal becomes a row: the domain cleaned and folded, the booking day only when it can be one', () => {
  const r = formRow(deal(), { team, canonical: new Map([['concordium.com', 'concordium.io']]), now: NOW });
  assert.deepEqual([r.companyDomain, r.meetingDate, r.sdr, r.notSdr, r.bookedOn], ['concordium.io', '2026-10-12', 'Ahmed', false, '2026-10-09']);
  assert.equal(formRow(deal({ createdate: '2026-04-27T00:00:00Z' }), { team, now: NOW }).bookedOn, null, 'a deal months older is not the booking');
  assert.equal(formRow(deal({ createdate: '2026-11-01T00:00:00Z' }), { team, now: NOW }).bookedOn, null, 'a deal made after the meeting is not either');
  assert.equal(formRow(deal({ date_of_meeting_sdr_form: null }), { team, now: NOW }), null);
  assert.equal(formRow(deal({}, []), { team, now: NOW }).companyDomain, null);
});

test('only a meeting no other source has becomes its own row, once', () => {
  const row = over => ({ dealId: '1', companyDomain: 'velt.dev', meetingDate: '2026-07-15', sdr: 'Akhil', notSdr: false, ...over });
  assert.equal(meetingsOnlyOnForm([row()], []).length, 1);
  assert.equal(meetingsOnlyOnForm([row()], [{ domain: 'velt.dev', date: '2026-07-20' }]).length, 0, 'within 14 days it is that meeting');
  assert.equal(meetingsOnlyOnForm([row()], [{ domain: 'velt.dev', date: '2026-09-01' }]).length, 1);
  assert.equal(meetingsOnlyOnForm([row(), row({ dealId: '2', meetingDate: '2026-07-16' })], []).length, 1, 'two deals, one meeting');
  assert.equal(meetingsOnlyOnForm([row({ sdr: null })], []).length, 0, 'blank or Ads never makes a meeting');
  const fingerprint = row({ companyDomain: 'fingerprint.com', meetingDate: '2026-07-30', createdOn: '2026-06-27' });
  assert.equal(meetingsOnlyOnForm([fingerprint], [{ domain: 'fingerprint.com', date: '2026-06-30' }]).length, 0, 'a month typed wrong on the deal behind that meeting');
  assert.equal(meetingsOnlyOnForm([{ ...fingerprint, createdOn: '2026-07-25' }], [{ domain: 'fingerprint.com', date: '2026-06-30' }]).length, 1, 'a deal made after that meeting is a new one');
  assert.equal(meetingsOnlyOnForm([{ ...fingerprint, meetingDate: '2026-10-26', createdOn: '2026-04-27' }], [{ domain: 'fingerprint.com', date: '2026-06-30' }]).length, 1, 'months later on an old deal is a later meeting');
  assert.equal(meetingsOnlyOnForm([row({ companyDomain: null })], []).length, 0);
});

test('who booked a meeting is decided once, by the meeting credit, and the view only reads it', () => {
  const views = readFileSync(new URL('../db/migrations/900_dash_views.sql', import.meta.url), 'utf8');
  const meetings = views.slice(views.indexOf('CREATE VIEW dash_v_meetings'));
  assert.ok(!/direction ILIKE 'outbound'/.test(meetings), 'the audit sheet says Outbound on Referral and Ads too');
  assert.ok(!/ILIKE 'sdr%'/.test(meetings), '"SDR-Others" is not the SDR team: Piyush, Pranesh, champions who changed jobs');
  assert.match(meetings, /LEFT JOIN dash_meeting_credit cr ON cr\.meeting_id = dm\.id/);
  assert.match(meetings, /COALESCE\(cr\.booking_by, 'unknown'\) AS booking_by/);
  assert.match(meetings, /WHERE NOT m\.internal AND m\.merged_into IS NULL;/, 'a repeat of a meeting counts nowhere');
  // The form's SDR is never stamped on every record near it (prism-ml's "Ads" row counted as Dheeraj's).
  assert.ok(!/form\.sdr AS form_sdr/.test(meetings));
  assert.ok(!/dash_v_linkedin_leads/.test(meetings), 'no campaign is guessed in the view from whatever last reached the company');
  const credit = readFileSync(new URL('../lib/outreach/meeting-credit.js', import.meta.url), 'utf8');
  const who = credit.slice(credit.indexOf('export function whoBooked'));
  const at = text => who.indexOf(text);
  assert.ok(at('statedSdr') < at('cluster.forms') && at('cluster.forms') < at('auditSplit(rows)') && at('formOther') < at('r.sdrName'),
    'their own word, then the form, then the audit split, then a name on a record');
});

test('the job is registered, and runs after what it matches and before what reads it', () => {
  assert.ok(JOBS['meetings-sdr-form']);
  const at = job => DEFAULT_SEQUENCE.indexOf(job);
  assert.ok(at('meetings-sdr-form') > at('meetings-slack'));
  assert.ok(at('meetings-sdr-form') > at('meetings-slack'));
  assert.ok(at('meetings-sdr-form') < at('meetings-hubspot'));
  assert.ok(at('meetings-sdr-form') < at('positive-sheet'));
});

test('HubSpot is only ever read: search and batch reads are the only calls', () => {
  const client = readFileSync(new URL('../lib/outreach/hubspot.js', import.meta.url), 'utf8');
  const paths = [...client.matchAll(/call\('([^']+)'/g)].map(m => m[1]);
  assert.deepEqual(paths.sort(), ['/crm/v3/objects/companies/batch/read', '/crm/v3/objects/deals/search', '/crm/v4/associations/deals/companies/batch/read']);
});
