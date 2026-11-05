import { test } from 'node:test';
import assert from 'node:assert/strict';
import { changesAgainst, emailCard, linkedinCard } from '../lib/metrics/programs.js';

const email = (positive, people, meetings) => emailCard({ allSent: 500 }, { positive }, { people }, meetings);
const li = (positive, sent, accepted, meetings) => linkedinCard({ invitesSent: sent, invitesAccepted: accepted }, { positive }, meetings);

test('Email %: positives and meetings, each per person emailed', () => {
  const card = email(18, 4063, 5);
  assert.equal(card.positiveRate, 0.44);
  assert.equal(card.meetingRate, 0.12);
  assert.equal(email(1, 8, 2).positiveRate, 12.5);
  assert.equal(email(1, 8, 2).meetingRate, 25);
});

test('LinkedIn %: acceptances, positives and meetings, each per invite sent', () => {
  const card = li(18, 4451, 993, 8);
  assert.equal(card.acceptanceRate, 22.3);
  assert.equal(card.positiveRate, 0.4);
  assert.equal(card.meetingRate, 0.18);
});

test('nothing sent means no rate, never zero or a division error', () => {
  assert.equal(email(3, 0, 1).positiveRate, null);
  assert.equal(email(3, 0, 1).meetingRate, null);
  assert.equal(emailCard({ allSent: 0 }, { positive: 0 }, null, 0).positiveRate, null);
  assert.equal(li(2, 0, 0, 1).acceptanceRate, null);
  assert.equal(li(2, 0, 0, 1).positiveRate, null);
});

test('against the range before: counts change in percent, pro-rated volumes included; rates in points, not pro-rated', () => {
  const now = email(20, 1000, 4), before = email(10, 1000, 4);
  const halfway = changesAgainst(now, before, 0.5);
  assert.equal(halfway.positive, 100);
  assert.equal(halfway.peopleEmailed, 100, 'half the range against half of the last one would be flat; a whole range against half is double');
  assert.equal(halfway.positiveRate, 1);
  assert.equal(halfway.meetingRate, 0);
  assert.equal(changesAgainst(email(1, 0, 0), before, 1).positiveRate, null, 'no rate now, no change to show');
});
