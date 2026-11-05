import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { meetingsByPlatform } from '../lib/metrics/meetings.js';
import { OUTREACH_MEETING, Params, scope } from '../lib/metrics/sql.js';

// Ayush, 2026-11-05: only SDR outreach belongs on this dashboard. AE, inbound,
// referral and marketing meetings are never counted, listed or flagged. A second
// rule in listMeetings (outbound direction or a campaign match) let AE meetings
// into the Overview: 31 shown for October against 14 that SDRs booked.

const code = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*(\/\/|--).*$/gm, '');

test('outreach meetings: every scoped meeting query keeps only SDR-booked meetings', () => {
  assert.match(scope('meeting', 'm', {}, new Params()), /m\.attribution = 'sourced'/);
  assert.equal(OUTREACH_MEETING('dm'), "dm.attribution = 'sourced'");
});

test('outreach meetings: no metrics query has its own rule for which meetings count', () => {
  for (const f of readdirSync(new URL('../lib/metrics/', import.meta.url))) {
    const src = code(`lib/metrics/${f}`);
    assert.ok(!/direction ILIKE 'outbound'/.test(src), `${f} decides outreach meetings by direction; use OUTREACH_MEETING`);
    assert.ok(!/attribution = 'sourced'/.test(src) || f === 'sql.js', `${f} spells the rule out; use OUTREACH_MEETING`);
    assert.ok(!/influenced/.test(src), `${f} reads meetings that came in another way`);
    // A file that reads the meetings view must apply the rule (scope adds it).
    if (/dash_v_meetings/.test(src) && f !== 'sql.js') {
      assert.ok(/OUTREACH_MEETING|scope\('meeting'/.test(src), `${f} reads dash_v_meetings without OUTREACH_MEETING`);
    }
  }
});

test('outreach meetings: the cards count meetings per platform, in the range, moved slots once', () => {
  const rows = [
    { date: '2026-10-05', platform: 'instantly', rescheduled: false },
    { date: '2026-10-06', platform: 'heyreach', rescheduled: false },
    { date: '2026-10-07', platform: 'instantly', rescheduled: true },
    { date: '2026-10-08', platform: null, rescheduled: false },
    { date: '2026-09-30', platform: 'instantly', rescheduled: false },
  ];
  assert.deepEqual(meetingsByPlatform(rows, { from: '2026-10-05', toExclusive: '2026-10-12' }), { email: 1, linkedin: 1 });
});
