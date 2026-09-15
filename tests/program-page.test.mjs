import assert from 'node:assert/strict';
import test from 'node:test';
import { summarizeCompanies } from '../lib/metrics/companies.js';
import { buildConversation, parseStep, personVerdict } from '../lib/metrics/conversation.js';
import { resolveRange } from '../lib/metrics/filters.js';

const MON_14_SEP = new Date(Date.UTC(2026, 8, 14));

test('program range: since-start runs from the first campaign\'s week to today, and needs a start date', () => {
  const r = resolveRange('since-start', '2026-09-03', null, MON_14_SEP);
  assert.equal(r.preset, 'since-start');
  assert.equal(r.grain, 'week');
  assert.deepEqual(r.periods, ['2026-08-31', '2026-09-07', '2026-09-14']);
  assert.equal(r.from, '2026-08-31');
  assert.equal(r.to, '2026-09-14');
  // A link that carries since-start to a page with no program start falls back to the default.
  assert.equal(resolveRange('since-start', null, null, MON_14_SEP).preset, 'last-4-weeks');
});

test('company funnel: counts companies overall and per channel, with pipeline', () => {
  const s = summarizeCompanies([
    { channels: 'both', domain: 'a.io', email: { replied: 1, positive: 0 }, linkedin: { replied: 1, positive: 1 }, replied: 2, positive: 1, meetings: 1, meetingsHeld: 1, qualified: 1, pipeline: 5000 },
    { channels: 'email', domain: 'b.io', email: { replied: 0, positive: 0 }, linkedin: null, replied: 0, positive: 0, meetings: 0, pipeline: 0 },
    { channels: 'linkedin', domain: null, email: null, linkedin: { replied: 1, positive: 0 }, replied: 1, positive: 0, meetings: 0, pipeline: 0 },
  ]);
  assert.deepEqual([s.total, s.replied, s.positive, s.withMeeting, s.pipeline, s.withoutDomain], [3, 2, 1, 1, 5000, 1]);
  assert.deepEqual(s.email, { touched: 2, replied: 1, positive: 0 });
  assert.deepEqual(s.linkedin, { touched: 2, replied: 2, positive: 1 });
});

test('conversation: Instantly step ids are sequence, step and variant', () => {
  assert.deepEqual(parseStep('0_1_0'), { step: 1, variant: 0 });
  assert.deepEqual(parseStep('0_0_2'), { step: 0, variant: 2 });
  assert.equal(parseStep(null), null);
  assert.equal(parseStep('3'), null);
});

test('conversation: a person\'s latest no wins, otherwise their best reply', () => {
  assert.equal(personVerdict([
    { verdict: 'interested', at: '2026-09-01' },
    { verdict: 'declined', isNegative: true, at: '2026-09-05' },
  ]), 'declined');
  assert.equal(personVerdict([{ verdict: 'unknown', at: '2026-09-01' }, { verdict: 'interested', at: '2026-08-01' }]), 'interested');
  assert.equal(personVerdict([{ verdict: 'auto', isAuto: true }]), null);
});

test('conversation: sent emails show their step copy, replies their own words and label, oldest first', () => {
  const [ricky, quiet] = buildConversation({
    emailPeople: [{ email: 'quiet@streamkap.com' }, { email: 'Ricky@streamkap.com', campaigns: ['Dheeraj-WVI-08/09'] }],
    emailEvents: [
      {
        sourceEventId: 'r1', type: 'email_reply', at: '2026-09-11T10:00:00Z', email: 'ricky@streamkap.com', campaignExternalId: 'c1',
        body: 'Sounds good, send a demo link\n\nOn Thu, Sep 10, 2026 at 5:43 PM Piyush <piyush@getreodev.in> wrote:\n> Hi Ricky',
      },
      {
        sourceEventId: 's1', type: 'email_sent', at: '2026-09-10T17:43:00Z', email: 'ricky@streamkap.com', mailbox: 'piyush@getreodev.in',
        subject: 'RB2B for Developer-focused companies', step: '0_0_0', campaignExternalId: 'c1', ueType: '1',
      },
      {
        sourceEventId: 's2', type: 'email_sent', at: '2026-09-11T11:00:00Z', email: 'ricky@streamkap.com', mailbox: 'piyush@getreodev.in',
        subject: 'Re: RB2B for Developer-focused companies', step: null, campaignExternalId: 'c1', ueType: '3',
      },
    ],
    labels: new Map([['instantly:r1', { verdict: 'interested', reason: 'Asks for a demo link', isPositive: true }]]),
    steps: new Map([['c1:0:0', { subject: 'RB2B for Developer-focused companies', copy: 'x'.repeat(400) }]]),
    campaignNames: new Map([['c1', 'Dheeraj-WVI-08/09']]),
  });

  assert.equal(ricky.email, 'Ricky@streamkap.com', 'people who replied come first');
  assert.deepEqual(ricky.events.map(e => e.id), ['instantly:s1', 'instantly:r1', 'instantly:s2']);
  const [first, reply, byHand] = ricky.events;
  assert.deepEqual([first.kind, first.step, first.truncated, first.campaign], ['template', 1, true, 'Dheeraj-WVI-08/09']);
  assert.equal(reply.direction, 'received');
  assert.ok(reply.text.startsWith('Sounds good, send a demo link'));
  assert.ok(!reply.text.includes('wrote:'), 'the quoted thread is not their words');
  assert.deepEqual([reply.verdict, reply.isPositive], ['interested', true]);
  assert.deepEqual([byHand.manual, byHand.text], [true, null]);
  assert.deepEqual([ricky.verdict, ricky.sent, ricky.received], ['interested', 2, 1]);
  assert.equal(quiet.events.length, 0);
});

test('conversation: a LinkedIn thread keeps who sent each message and the reply\'s label', () => {
  const [paul] = buildConversation({
    linkedinPeople: [{ linkedinId: 'p1', name: 'Paul Dudley', title: 'GTM', senders: ['dheeraj dola'] }],
    linkedinEvents: [
      { sourceEventId: 'm2', type: 'linkedin_reply', at: '2026-09-09T17:05:00Z', linkedinId: 'p1', personName: 'Paul Dudley', body: 'What identification rate do you see?', profileUrl: 'https://www.linkedin.com/in/paul' },
      { sourceEventId: 'm1', type: 'linkedin_message', at: '2026-09-08T22:08:00Z', linkedinId: 'p1', sender: 'dheeraj dola', body: 'hi paul' },
    ],
    labels: new Map([['heyreach:m2', { verdict: 'interested', isPositive: true }]]),
  });
  assert.equal(paul.profileUrl, 'https://www.linkedin.com/in/paul');
  assert.deepEqual(paul.events.map(e => [e.direction, e.by]), [['sent', 'dheeraj dola'], ['received', 'Paul Dudley']]);
  assert.deepEqual([paul.events[1].isPositive, paul.verdict], [true, 'interested']);
});
