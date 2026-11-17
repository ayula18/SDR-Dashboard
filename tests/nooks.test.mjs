import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { mergeFunnel, shownSdrs, sumFunnel } from '../lib/metrics/funnel.js';
import { clusterMeetings, creditMeetings } from '../lib/outreach/meeting-credit.js';
import { CALL_COLUMNS, callRow } from '../lib/outreach/nooks.js';
import { bookedPositives } from '../lib/outreach/positive-sheet.js';
import { OUTREACH_ROLES, ROLES, isOutreachRole } from '../lib/outreach/roles.js';
import { formOwner } from '../lib/outreach/sdr-form.js';
import { DEFAULT_SEQUENCE, JOBS } from '../lib/sync/jobs.js';

const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');

// The shape /v1/dialer/calls returns (2026-11-17), numbers shortened.
const call = {
  id: '000c5eec-18dc-4988-8d7d-094a155e1fa1', source: 'csv', time: '2026-10-23T16:12:17.959Z', duration: 12.4,
  from: '+15100000000', to: '+13100000000', direction: 'outgoing', dialingMode: 'parallel', callLabel: 'voicemail', hungUpBy: null,
  recordingUrl: 'https://recording.nooks.in/x.wav', owner: { id: 'D9lN', _href: '/v1/users/D9lN' },
  prospect: { id: null, source: 'csv', externalId: null, name: 'David Cramer ', email: null, phoneNumber: '+13100000000' },
  callDisposition: { id: 'd1', source: 'apollo', externalId: 'x', name: 'No Answer', callOutcome: 'No Answer' },
  transcript: null, createdAt: '2026-10-23T16:12:28.483Z', updatedAt: '2026-10-24T07:03:44.572Z',
};

test('a Nooks call is stored as metadata: who, when, how it went, and never a phone number', () => {
  const users = new Map([['D9lN', { id: 'D9lN', name: 'pranesh@reo.dev', email: 'Pranesh@reo.dev' }]]);
  const at = new Date('2026-11-17T00:00:00Z');
  const row = Object.fromEntries(CALL_COLUMNS.map((c, i) => [c, callRow(call, users, at)[i]]));
  assert.deepEqual(row, {
    id: call.id, called_at: call.time, owner_id: 'D9lN', owner_email: 'pranesh@reo.dev', owner_name: 'pranesh@reo.dev',
    direction: 'outgoing', dialing_mode: 'parallel', duration_s: 12, call_label: 'voicemail', disposition: 'No Answer',
    call_outcome: 'No Answer', prospect_name: 'David Cramer', prospect_email: null, prospect_source: 'csv',
    has_recording: true, has_transcript: false, updated_at_src: call.updatedAt, synced_at: at,
  });
  assert.ok(!callRow(call, users, at).includes('+13100000000'), 'no phone number is kept');
  const deleted = callRow({ ...call, owner: { id: 'gone' } }, users, at);
  assert.deepEqual([deleted[2], deleted[3], deleted[4]], ['gone', null, null], "a user deleted in Nooks keeps only the id: the call counts, outside anyone's row");
});

test('the Nooks client only ever reads: the key could write to the workspace and the CRM', () => {
  const source = read('lib/outreach/nooks.js');
  const methods = [...source.matchAll(/method:\s*'(\w+)'/g)].map(m => m[1]);
  assert.deepEqual([...new Set(methods)], ['GET']);
  assert.ok(!/\b(POST|PUT|PATCH|DELETE)\b'/.test(source.replace(/^\s*(\/\/|\*).*$/gm, '')), 'no other verb outside comments');
});

test('what a call counts as is defined once, in dash_v_calls', () => {
  const views = read('db/migrations/900_dash_views.sql');
  assert.match(views, /\(c\.call_label = 'human' OR c\.call_outcome = 'Connect'\) AS connected/,
    'connected: Nooks heard a person, or the caller marked a connect (Nooks labels some real conversations a machine)');
  assert.match(views, /\(\(c\.call_label = 'human' OR c\.call_outcome = 'Connect'\) AND c\.duration_s >= 60\) AS conversation/,
    'conversation: connected for 60 seconds or more (Ayush: "Conversations (60+ seconds)")');
  assert.match(views, /\(c\.disposition = 'Connected - Positive' OR c\.call_outcome = 'Meeting'\) AS positive/, "positive: the caller's own mark");
  assert.match(views, /WHERE c\.direction = 'outgoing';/, 'calls made are the outgoing ones');
  for (const file of ['lib/metrics/core.js', 'lib/metrics/positives.js', 'lib/sync/jobs/positive-sheet.js']) {
    const code = read(file).replace(/^\s*(\/\/|\*|\/\*\*).*$/gm, '');
    assert.ok(!/call_label\s*=|Connected - Positive/.test(code), `${file} reads connected and positive from the view, not its own rule`);
  }
  assert.match(read('lib/metrics/core.js'), /FILTER \(WHERE l\.conversation\)/, "a conversation is the view's, not a duration rule of its own");
});

test('calls add up by day and caller, with the rates worked out from the sums', () => {
  const rows = mergeFunnel({
    grain: 'day',
    periods: ['2026-11-10', '2026-11-11'],
    email: [], linkedin: [], emailOutcomeRows: [], linkedinOutcomeRows: [], meetings: [
      { date: '2026-11-11', sdr: 'Pranesh', platform: null, outreachChannel: 'call', share: 1 },
    ],
    callRows: [
      { key: '2026-11-10|Pranesh', callsMade: 150, callsConnected: 14, conversations: 3 },
      { key: '2026-11-11|Pranesh', callsMade: 50, callsConnected: 6, conversations: 1 },
      { key: '2026-11-11|', callsMade: 30, callsConnected: 3, conversations: 1 },
      { key: '2026-11-09|Pranesh', callsMade: 99, callsConnected: 9, conversations: 2 },
    ],
    callOutcomeRows: [{ key: '2026-11-10|Pranesh', positive: 2 }],
  });
  const pranesh = sumFunnel(rows.filter(r => r.sdr === 'Pranesh'));
  assert.deepEqual(
    [pranesh.callsMade, pranesh.callsConnected, pranesh.conversations, pranesh.callPositive, pranesh.callMeetings],
    [200, 20, 4, 2, 1], 'a day outside the periods is dropped; a meeting booked on a call is a call meeting');
  assert.deepEqual([pranesh.callConnectRate, pranesh.callTalkRate, pranesh.callPositiveRate, pranesh.callMeetingRate], [10, 2, 1, 0.5]);
  assert.equal(sumFunnel(rows.filter(r => r.sdr === '')).callsMade, 30, 'calls by no one on the roster stay outside');
  assert.equal(sumFunnel([]).callConnectRate, null, 'no calls is no rate, never zero');
  assert.equal(sumFunnel([]).callTalkRate, null, 'no calls is no talk rate either');
});

test('the Call view lists the callers and any SDR from their first call; picking someone shows exactly them', () => {
  const team = [
    { name: 'Akhil', role: 'sdr' }, { name: 'Rama', role: 'sdr' }, { name: 'Sanika', role: 'sdr_extra' },
    { name: 'Pranesh', role: 'caller' }, { name: 'Yashika', role: 'caller' }, { name: 'Muskan', role: 'other' },
  ];
  const names = (picked, options) => shownSdrs(team, picked, options).map(t => t.name);
  assert.deepEqual(names(null), ['Akhil', 'Rama'], 'Email and LinkedIn still list the SDRs');
  assert.deepEqual(names(null, { channel: 'call' }), ['Pranesh', 'Yashika']);
  assert.deepEqual(names(null, { channel: 'call', dialed: new Set(['Rama', 'Sanika']) }), ['Rama', 'Pranesh', 'Yashika'], 'an SDR who has dialed joins; an extra waits to be picked');
  assert.deepEqual(names(['Akhil'], { channel: 'call' }), ['Akhil']);
});

test('callers are outreach: in the SDR filter, the meeting credit and Meeting checks, defined once', () => {
  assert.deepEqual(OUTREACH_ROLES, ['sdr', 'sdr_extra', 'caller']);
  assert.ok(ROLES.includes('other') && !isOutreachRole('other'));
  for (const file of ['lib/sync/meeting-credit.js', 'components/views/ChecksView.js']) assert.match(read(file), /isOutreachRole\(t\.role\)/, file);
  assert.match(read('lib/metrics/meta.js'), /OUTREACH_ROLES\.flatMap/);
  assert.match(read('db/migrations/034_dash_calls.sql'), /\('Pranesh', 'caller', 'pranesh@reo\.dev'/);
});

test('the form names a caller on the team, and the meeting is a call', () => {
  const team = [{ name: 'Pranesh', aliases: [] }, { name: 'Suman', aliases: [] }];
  assert.deepEqual(formOwner('Pranesh - Cold calling', team), { sdr: 'Pranesh', notSdr: false });
  assert.deepEqual(formOwner('Pranesh - Cold calling', []), { sdr: null, notSdr: true }, 'off the team, cold calling is not an SDR meeting');
  assert.deepEqual(formOwner('Cold calling', team), { sdr: null, notSdr: true });

  const rows = [
    { id: 's', domain: 'zabbix.com', date: '2026-11-05', source: 'sheet', channel: 'SDR-Others', sourceOfMeeting: 'Pranesh', sdrName: 'Pranesh', statedSdr: null, statedCampaignId: null, points: null, supersededBy: null, outcome: null },
  ];
  const input = {
    rows,
    forms: [{ dealId: 'd', domain: 'zabbix.com', date: '2026-11-05', sdr: 'Pranesh', notSdr: false, ownerRaw: 'Pranesh - Cold calling' }],
    posts: [],
    leadsByName: new Map(),
    campaigns: new Map(),
    roster: new Set(['Akhil', 'Pranesh']),
    callers: new Set(['Pranesh']),
    ours: [],
    senders: [],
    peopleAt: () => [],
    repliesAt: () => [],
    loggedAt: () => [],
    peopleByEmail: () => [],
  };
  const [credit] = creditMeetings(input);
  assert.deepEqual([credit.bookingBy, credit.sdrs, credit.channel, credit.campaignId, credit.where.rung], ['sdr', [{ name: 'Pranesh', share: 1 }], 'call', null, 'form']);
  assert.match(credit.reason, /^Pranesh on the HubSpot form; a call: the HubSpot form says cold calling\.$/);

  const [sheetOnly] = creditMeetings({ ...input, forms: [] });
  assert.deepEqual([sheetOnly.channel, sheetOnly.where.rung], ['call', 'caller'], 'a caller runs no campaigns: their booking is a call');
  const [offRoster] = creditMeetings({ ...input, roster: new Set(['Akhil']), callers: new Set() });
  assert.equal(offRoster.bookingBy, 'other', 'before 034, as it was: not an SDR meeting');
  assert.equal(clusterMeetings(rows).length, 1);
});

test("a call meeting is covered by the booker's Nooks mark before it, one mark to one meeting", () => {
  const meeting = (domain, date) => ({ domain, company: domain, date, sdr: 'Pranesh', campaignSdr: null, campaignId: null, whereRung: 'form', channel: 'call' });
  const run = (meetings, marks) => bookedPositives(meetings, [], () => [], marks);
  assert.equal(run([meeting('zabbix.com', '2026-11-05')], [{ sdr: 'Pranesh', day: '2026-11-03' }]).length, 0, 'the positive call already counts');
  const two = run([meeting('zabbix.com', '2026-11-05'), meeting('mongodb.com', '2026-11-06')], [{ sdr: 'Pranesh', day: '2026-11-03' }]);
  assert.deepEqual(two.map(b => [b.companyDomain, b.channel, b.sdr]), [['mongodb.com', 'call', 'Pranesh']], 'one mark speaks for one meeting');
  assert.equal(run([meeting('zabbix.com', '2026-11-05')], [{ sdr: 'Rama', day: '2026-11-03' }]).length, 1, "someone else's mark is not theirs");
  assert.equal(run([meeting('zabbix.com', '2026-11-05')], [{ sdr: 'Pranesh', day: '2026-11-20' }]).length, 1, 'a mark after the meeting is a later call');
  assert.equal(run([meeting('zabbix.com', '2026-11-05')], [{ sdr: 'Pranesh', day: '2026-08-01' }]).length, 1, 'or one long before it');
  assert.equal(run([{ ...meeting('acme.com', '2026-11-05'), channel: 'email', campaignId: 'c1' }], [{ sdr: 'Pranesh', day: '2026-11-03' }]).length, 1, 'only call meetings');
});

test('the Nooks job reads a few requests a run, before the positive sheet that reads its marks', () => {
  const job = JOBS['nooks-calls'];
  assert.ok(job && job.maxAgeHours >= 24);
  assert.ok(DEFAULT_SEQUENCE.indexOf('nooks-calls') < DEFAULT_SEQUENCE.indexOf('positive-sheet'));
  assert.ok(JOBS['positive-sheet'].dependsOn.includes('nooks-calls'));
  assert.match(read('lib/metrics/meta.js'), /NOOKS_API_KEY/);
});
