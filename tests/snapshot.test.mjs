import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSnapshot, isNewOutreach, METRICS } from '../lib/metrics/snapshot.js';

// Snapshot View (Ayush, 2026-11-17): the 13 Nov SDR weekly report's layout, calls added.

test('no segments and no calls connected (Ayush, 2026-11-17)', () => {
  assert.deepEqual(METRICS, ['emails', 'invites', 'callsMade', 'conversations', 'positiveNew', 'positiveOld', 'meetingsNew', 'meetingsOld']);
});

test('new outreach only where the first touch is inside the dates; a call is its own touch', () => {
  const from = '2026-11-09';
  assert.ok(isNewOutreach({ channel: 'email', firstTouch: '2026-11-12T10:00:00Z', from }), 'Rama, Virtuozzo: first emailed 12 Nov');
  assert.ok(!isNewOutreach({ channel: 'email', firstTouch: '2026-09-24T10:00:00Z', from }), 'Akhil, Tenstorrent: first emailed 24 Sep');
  assert.ok(!isNewOutreach({ channel: 'linkedin', firstTouch: null, from }), 'no touch to show is not claimed as new');
  assert.ok(isNewOutreach({ channel: 'call', firstTouch: null, from }), 'a call positive or meeting is the call\'s own');
  assert.ok(!isNewOutreach({ channel: 'call', firstTouch: '2026-10-01T00:00:00Z', from }), 'unless the company was emailed before');
});

test('a row per person, then everyone together, results split by when the outreach began', () => {
  const rows = buildSnapshot({
    people: ['Akhil', 'Pranesh'],
    from: '2026-11-09',
    emails: [{ sdr: 'Akhil', n: 5 }, { sdr: 'Suman', n: 9 }],
    invites: [{ sdr: 'Akhil', n: 3 }],
    calls: [{ sdr: 'Pranesh', made: 10, conversations: 1 }],
    positives: [{ sdr: 'Akhil', domain: 'b.com', channel: 'email', n: 1 }, { sdr: 'Pranesh', domain: null, channel: 'call', n: 1 }],
    meetings: [{ sdr: 'Akhil', domain: 'b.com', outreachChannel: 'email', share: 1 }],
    firstTouch: new Map([['Akhil|b.com', '2026-09-24T00:00:00Z']]),
  });
  assert.deepEqual(rows.map(r => r.person), ['Akhil', 'Pranesh', 'All 2'], 'someone not shown (Suman) is left out');
  const [akhil, pranesh, all] = rows;
  assert.deepEqual([akhil.emails, akhil.invites, akhil.positiveOld, akhil.meetingsOld], [5, 3, 1, 1], 'reached in September: old outreach');
  assert.deepEqual([pranesh.callsMade, pranesh.conversations, pranesh.positiveNew], [10, 1, 1], 'a call positive is the call\'s own');
  assert.ok(all.total);
  assert.deepEqual([all.emails, all.invites, all.callsMade, all.positiveNew + all.positiveOld, all.meetingsNew + all.meetingsOld], [5, 3, 10, 2, 1]);
  assert.ok(!('segment' in all), 'no segment anywhere');
});
