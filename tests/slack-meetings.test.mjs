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

// The real shape of a screened booking, as the bot has posted them since
// October 2026: the team's answer edited into the first line, the booking, and
// the bot's verdict at the foot.
const screened = ({ first = null, verdict = ':white_check_mark: Qualified  ·  ICP: Yes  ·  DevTool  ·  CI/CD &amp; Build Systems' } = {}) => [
  ...(first ? [first] : []),
  ':date: *New meeting booked*',
  '',
  '*Owner:* Content  (Marketing)',
  '*Basis:* declared_by_invitee',
  '*Email:* <mailto:annap@gitlab.com|annap@gitlab.com>',
  '*Company:* GitLab  (`<http://gitlab.com|gitlab.com>`)',
  '*When:* 12 Oct 2026, 04:00 PM IST',
  '*Booked via:* `Reo.Dev` - Demo - Web  (link says: Website)',
  '*Where they heard:* I saw your content/blogs/podcasts etc',
  verdict,
].join('\n');

test('slack meetings: a screened booking keeps the verdict, the reason and how it was booked', () => {
  const m = parseAlert(screened({ first: '– No Action  ·  by <@U0B1EADH0P4>  ·  12 Oct, 11:18 AM IST' }));
  assert.equal(m.domain, 'gitlab.com');
  assert.equal(m.qualified, 'qualified');
  assert.equal(m.qualificationNote, 'ICP: Yes · DevTool · CI/CD & Build Systems');
  assert.equal(m.action, 'No Action');
  assert.equal(m.bookedVia, 'Reo.Dev - Demo - Web (link says: Website)');
  assert.equal(m.heardFrom, 'I saw your content/blogs/podcasts etc');
});

test('slack meetings: an unqualified booking keeps the bot\'s reason', () => {
  const m = parseAlert(screened({
    first: ':white_check_mark: *Qualification Email* sent  ·  by <@U05SZ5JLM36>  ·  8 Oct, 5:35 PM IST',
    verdict: ':red_circle: *Unqualified*  ·  Personal email, no company to check. Ask which org they are evaluating for.',
  }));
  assert.equal(m.qualified, 'unqualified');
  assert.equal(m.qualificationNote, 'Personal email, no company to check. Ask which org they are evaluating for.');
  assert.equal(m.action, 'Qualification Email sent');
});

test('slack meetings: a booking nobody has screened carries no verdict', () => {
  const m = parseAlert(alert());
  assert.equal(m.qualified, null);
  assert.equal(m.qualificationNote, null);
  assert.equal(m.action, null);
  assert.equal(m.heardFrom, null);
});

test('slack meetings: "Qualification Email sent" is an action, never a verdict', () => {
  const m = parseAlert(screened({
    first: ':white_check_mark: *Qualification Email* sent  ·  by <@U05SZ5JLM36>  ·  8 Oct, 5:35 PM IST',
    verdict: '',
  }));
  assert.equal(m.qualified, null);
  assert.equal(m.action, 'Qualification Email sent');
});
