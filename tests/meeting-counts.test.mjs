import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { groupMeetings, meetingsByPlatform, oneRowPerMeeting, totalsFromMeetings } from '../lib/metrics/meetings.js';
import { mergeFunnel } from '../lib/metrics/funnel.js';
import { DEFAULT_SEQUENCE, JOBS } from '../lib/sync/jobs.js';

// formance.com: the audit sheet splits it, so dash_v_meetings gives one row per SDR at half each.
const formance = [
  { id: 'm1', date: '2026-08-24', sdr: 'Akhil', share: 0.5, platform: 'heyreach', held: true },
  { id: 'm1', date: '2026-08-24', sdr: 'Dheeraj', share: 0.5, platform: 'heyreach', held: true },
];
const other = { id: 'm2', date: '2026-08-25', sdr: 'Akhil', share: 1, platform: 'instantly', held: false };
const moved = { id: 'm3', date: '2026-08-20', sdr: 'Rama', share: 1, platform: 'heyreach', rescheduled: true };

test('a split meeting is one meeting in a total, and half for each SDR', () => {
  assert.equal(totalsFromMeetings([...formance, other, moved]).meetings, 2);
  assert.equal(totalsFromMeetings([...formance, other, moved]).held, 1);
  assert.equal(totalsFromMeetings([...formance, other, moved]).rescheduled, 1);
  const bySdr = Object.fromEntries(groupMeetings([...formance, other], r => r.sdr).map(g => [g.key, g.meetings]));
  assert.deepEqual(bySdr, { Akhil: 1.5, Dheeraj: 0.5 });
  assert.deepEqual(meetingsByPlatform([...formance, other], { from: '2026-08-01', toExclusive: '2026-09-01' }), { email: 1, linkedin: 1 });
});

test('the SDR table gives each SDR their share of a split meeting', () => {
  const rows = mergeFunnel({ grain: 'month', periods: ['2026-08-01'], email: [], linkedin: [], emailOutcomeRows: [], linkedinOutcomeRows: [], meetings: formance });
  const of = name => rows.find(r => r.sdr === name)?.linkedinMeetings;
  assert.equal(of('Akhil'), 0.5);
  assert.equal(of('Dheeraj'), 0.5);
});

test('a list shows a split meeting once, with both names', () => {
  const list = oneRowPerMeeting([...formance, other]);
  assert.equal(list.length, 2);
  assert.deepEqual([list[0].sdr, list[0].share], ['Akhil ½ + Dheeraj ½', 1]);
  assert.deepEqual([list[1].sdr, list[1].share], ['Akhil', 1]);
  assert.deepEqual([oneRowPerMeeting([formance[0]])[0].sdr, oneRowPerMeeting([formance[0]])[0].share], ['Akhil ½', 0.5], 'only one of the two picked');
});

test('no query counts meeting rows: meetings are summed by share', () => {
  const dir = new URL('../lib/metrics/', import.meta.url);
  for (const file of readdirSync(dir).filter(f => f.endsWith('.js'))) {
    const source = readFileSync(new URL(file, dir), 'utf8');
    // The SELECT that reads the view: from its last SELECT up to FROM/JOIN dash_v_meetings.
    // count(DISTINCT m.id) is a count of meetings; count(*) is a count of SDR shares, which is wrong.
    for (const m of source.matchAll(/\b(?:FROM|JOIN)\s+dash_v_meetings\b/g)) {
      const head = source.slice(0, m.index);
      const select = head.slice(head.lastIndexOf('SELECT'));
      assert.ok(!/count\(\*\)/.test(select), `${file}: count(*) over dash_v_meetings; use MEETINGS`);
    }
  }
});

test('the credit runs after every meetings job and before what reads it', () => {
  assert.ok(JOBS['meeting-credit']);
  const at = key => DEFAULT_SEQUENCE.indexOf(key);
  for (const before of ['meetings-sheet', 'meetings-slack', 'meetings-sdr-form', 'meetings-hubspot', 'meetings-evidence']) {
    assert.ok(at(before) < at('meeting-credit'), `${before} before meeting-credit`);
  }
  assert.ok(at('meeting-credit') < at('positive-sheet'), 'booked positives follow the credit');
  assert.ok(JOBS['positive-sheet'].dependsOn.includes('meeting-credit'));
});
