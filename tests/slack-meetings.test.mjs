import assert from 'node:assert/strict';
import test from 'node:test';
import { parseAlert } from '../lib/sync/slack-meetings.js';

const alert = (fields = {}) => [
  ':calendar: *New meeting booked*',
  '',
  `*Owner:* ${fields.owner ?? 'SDR  (SDR Team)'}`,
  `*Basis:* ${fields.basis ?? 'link'}`,
  `*Name:* ${fields.name ?? 'Paul Dudley'}`,
  `*Email:* ${fields.email ?? '<mailto:paul@streamkap.com|paul@streamkap.com>'}`,
  `*Company:* ${fields.company ?? '<http://streamkap.com|streamkap.com>'}`,
  `*When:* ${fields.when ?? '16 Sep 2026, 08:00 PM IST'}`,
  '*Booked via:* 30 Minute  (link says: SDR)',
].join('\n');

test('slack meetings: the booking alert gives a company, a date and a channel', () => {
  const m = parseAlert(alert());
  assert.equal(m.domain, 'streamkap.com');
  assert.equal(m.date.toISOString().slice(0, 10), '2026-09-16');
  assert.equal(m.sourceOfMeeting, 'SDR');
  assert.equal(m.channel, 'SDR');
  assert.equal(m.direction, 'Outbound');
  assert.equal(m.person, 'Paul Dudley');
  assert.equal(m.email, 'paul@streamkap.com');
});

test('slack meetings: inbound and marketing bookings are not outbound', () => {
  assert.equal(parseAlert(alert({ owner: 'Website  (Inbound)' })).direction, 'Inbound');
  assert.equal(parseAlert(alert({ owner: 'Ads  (Marketing)' })).channel, 'Marketing');
  assert.equal(parseAlert(alert({ owner: 'Referral  (Referral)' })).channel, 'Referral');
});

test('slack meetings: the work email names the company when the alert cannot', () => {
  const m = parseAlert(alert({ company: 'Unknown', email: '<mailto:paul@streamkap.com|paul@streamkap.com>' }));
  assert.equal(m.domain, 'streamkap.com');
});

test('slack meetings: a personal-email booking belongs to no company', () => {
  const m = parseAlert(alert({ company: 'Unknown', email: '<mailto:askangad25@gmail.com|askangad25@gmail.com>' }));
  assert.equal(m.domain, null);
  assert.equal(m.companyRaw, 'Unknown');
});

test('slack meetings: chatter and undated alerts are ignored', () => {
  assert.equal(parseAlert('Hey, as we have already booked a call with them, we will give the demo'), null);
  assert.equal(parseAlert(alert({ when: 'tomorrow' })), null);
  assert.equal(parseAlert(null), null);
});
