import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emailsIn, peopleInPost, postChannel, readFormPost } from '../lib/outreach/meeting-posts.js';
import { attachNearest, clusterMeetings, creditMeetings, resolveCompany, whereFrom, whoBooked } from '../lib/outreach/meeting-credit.js';

test('the form post is read for its company, its meeting date and the pasted conversation', () => {
  const post = readFormPost('<http://nimbleway.com|nimbleway.com> - Meeting booked\n11/5/26 - Meeting scheduled on\n\nJustus Santiago\nGood to be connected Garima!', '2026-11-03T19:15:04Z');
  assert.deepEqual(post, { domain: 'nimbleway.com', date: '2026-11-05', said: 'Justus Santiago\nGood to be connected Garima!' });
  assert.equal(readFormPost('netdata.cloud - Meeting booked\n9/2/26 - Meeting scheduled on\nhi').domain, 'netdata.cloud', 'a domain typed without a link');
  assert.equal(readFormPost(':calendar: *New meeting booked*\n*Owner:* SDR'), null, "the booking bot's alert is another message");
  assert.equal(readFormPost('Vectara meeting booked via referral from Aerospike'), null);
});

test('a mistyped date on the form is placed by when it was posted', () => {
  assert.equal(readFormPost('ag-grid.com - Meeting booked\n3/17/27 - Meeting scheduled on\nhi', '2026-03-10T10:00:00Z').date, '2026-03-17', 'a typed year');
  assert.equal(readFormPost('dash0.com - Meeting booked\n12/8/26 - Meeting scheduled on\nhi', '2026-08-11T10:00:00Z').date, '2026-08-12', 'typed day first');
  assert.equal(readFormPost('x.com - Meeting booked\n11/5/26 - Meeting scheduled on\nhi', '2026-11-03T10:00:00Z').date, '2026-11-05');
  assert.equal(readFormPost('x.com - Meeting booked\n12/8/26 - Meeting scheduled on\nhi').date, '2026-12-08', 'with no post time, as typed');
});

test('the pasted conversation shows its channel', () => {
  assert.equal(postChannel('[00:00:03] pranesh@reo.dev: Corey?\n\n[00:00:04] Corey Fitz: Hello?'), 'call');
  assert.equal(postChannel('-----------Nooks AI summary :crystal_ball:----------- - Suman introduced Reo.Dev'), 'call');
  assert.equal(postChannel('Nov 22 Gaurav Jain sent the following messages at 3:01 AM View Gaurav’s profile Gaurav Jain'), 'linkedin');
  assert.equal(postChannel('Justus Santiago\nYesterday 3:53am\nGood to be connected Garima!\nAvatar\nGarima Bajoria'), 'linkedin');
  assert.equal(postChannel('Gaurav: Hi Pankaj, Thank you for connecting! I am the Co-founder/CTO of Reo.Dev'), 'linkedin');
  assert.equal(postChannel('External Inbox Piyush Agarwal <piyush@getreo.dev> Tue, Jan 6, 10:36 PM (11 days ago) to tanny Hi Tanny'), 'email');
  assert.equal(postChannel('Sure Chirag, I have sent an invite. On Tuesday, Sep 15, 2026 at 6:36 pm chirag.verma@otpless.com wrote: Hey Piyush'), 'email');
  assert.equal(postChannel('Thanks for connecting!\nOn Mon, Feb 24 Piyush wrote: hello'), 'email', 'the first mark that only one channel carries decides');
  assert.equal(postChannel('Piyush: Hi Lauren, I am the Co-founder of Reo.Dev'), null, 'a bare message shows no channel');
  assert.equal(postChannel(''), null);
});

test('the people in a pasted conversation are found among those our outreach reached', () => {
  const people = [
    { name: 'Justus Santiago', campaignId: 'li-1' },
    { email: 'gal@checksum.ai', campaignId: 'em-1' },
    { name: 'Kunal Shah', campaignId: 'li-2' },
    { name: 'Kunal Mehta', campaignId: 'li-3' },
    { name: 'Rehmat Kaur', campaignId: 'li-4' },
  ];
  assert.deepEqual(peopleInPost('Justus Santiago\nGood to be connected!', people).people.map(p => p.campaignId), ['li-1']);
  assert.equal(peopleInPost('From: piyush to: gal@checksum.ai Hi Gal', people).how, 'name');
  assert.deepEqual(peopleInPost('Hi Rehmat, Thank you for connecting!', people), { people: [people[4]], how: 'first name' }, 'a first name only one person has');
  assert.equal(peopleInPost('Hi Kunal, thanks for connecting!', people).people.length, 0, 'two people share it: nobody');
  assert.equal(peopleInPost('Hey Piyush, sounds good', [{ name: 'Piyush Rao' }], ['Piyush Agarwal']).people.length, 0, 'our own side is greeted, not found');
  assert.deepEqual(emailsIn('On Friday varoon@berri.ai wrote: and <piyush@reodev.co>.'), ['varoon@berri.ai', 'piyush@reodev.co']);
});

const row = (id, domain, date, extra = {}) => ({ id, domain, date, source: 'slack', channel: null, sdrName: null, statedSdr: null, statedCampaignId: null, points: null, supersededBy: null, outcome: null, ...extra });

test('records of one meeting are one: a week at the company, or wherever the booking moved', () => {
  const clusters = clusterMeetings([
    row('a', 'acme.com', '2026-08-24', { source: 'sheet' }),
    row('b', 'acme.com', '2026-08-26'),
    row('c', 'acme.com', '2026-09-10'),
    row('w1', 'workato.com', '2026-07-30', { source: 'sheet' }),
    row('w2', 'workato.com', '2026-07-30', { supersededBy: 'w3' }),
    row('w3', 'workato.com', '2026-08-12'),
    row('n1', null, '2026-08-24'),
    row('n2', null, '2026-08-24'),
  ]);
  const of = id => clusters.find(c => c.rows.some(r => r.id === id));
  assert.equal(of('a'), of('b'), 'two days apart');
  assert.notEqual(of('a'), of('c'), 'over a week apart');
  assert.equal(of('b').kept.id, 'b', 'kept at the latest');
  assert.equal(of('w1'), of('w3'), 'the alert says it moved, 13 days on');
  assert.equal(of('w1').kept.id, 'w3');
  assert.notEqual(of('n1'), of('n2'), 'no company: nothing ties them');
});

test('a meeting is kept on the first day it is known to have been held', () => {
  const [c] = clusterMeetings([
    row('sheet', 'pinecone.io', '2026-07-28', { source: 'sheet', outcome: 'held' }),
    row('alert1', 'pinecone.io', '2026-07-28', { supersededBy: 'alert2', outcome: 'rescheduled' }),
    row('alert2', 'pinecone.io', '2026-08-20', { outcome: 'held' }),
  ]);
  assert.equal(c.kept.id, 'sheet', 'the follow-up booked for 20 Aug is not a second SDR meeting, nor its date');
});

test('a form row is one meeting: the nearest at its company', () => {
  const clusters = clusterMeetings([row('early', 'cypress.io', '2026-06-11', { source: 'sheet' }), row('late', 'cypress.io', '2026-06-22', { source: 'sheet' })]);
  attachNearest([{ domain: 'cypress.io', date: '2026-06-24', sdr: 'Akhil' }], clusters, 14, 'forms');
  assert.deepEqual(clusters.map(c => c.forms.length), [0, 1]);
});

const cluster = (rows, forms = [], posts = []) => {
  const [c] = clusterMeetings(rows);
  return { ...c, forms, posts };
};

test('who booked: their own word, then the form, then the audit sheet, then the alert', () => {
  const sheet = row('s', 'acme.com', '2026-08-01', { source: 'sheet', sdrName: 'Muni' });
  assert.deepEqual(whoBooked(cluster([{ ...sheet, statedSdr: 'Rama' }], [{ sdr: 'Akhil' }])).sdrs, [{ name: 'Rama', share: 1 }]);
  assert.deepEqual(whoBooked(cluster([sheet], [{ sdr: 'Akhil' }])), { sdrs: [{ name: 'Akhil', share: 1 }], by: 'form', sure: 'sure' }, 'form over sheet, no split (cypress.io)');
  assert.deepEqual(whoBooked(cluster([sheet])), { sdrs: [{ name: 'Muni', share: 1 }], by: 'sheet', sure: 'likely' });
  assert.equal(whoBooked(cluster([sheet], [{ sdr: null, notSdr: true, ownerRaw: 'Ads' }])).other, 'Ads');
  assert.deepEqual(whoBooked(cluster([sheet], [{ sdr: 'Akhil' }, { sdr: 'Dheeraj' }])).sdrs.map(s => s.share), [0.5, 0.5], 'two forms, two people');
});

test('half each only where the audit sheet itself splits the meeting', () => {
  const half = (id, sdrName) => row(id, 'formance.com', '2026-08-24', { source: 'sheet', sdrName, points: 0.5 });
  const split = whoBooked(cluster([half('a', 'Dheeraj'), half('b', 'Akhil')], [{ sdr: 'Akhil' }]));
  assert.deepEqual(split, { sdrs: [{ name: 'Akhil', share: 0.5 }, { name: 'Dheeraj', share: 0.5 }], by: 'split', sure: 'sure' });
  const marketing = whoBooked(cluster([half('a', 'Akhil')]));
  assert.deepEqual(marketing.sdrs, [{ name: 'Akhil', share: 1 }], 'the other half went to marketing: the SDR takes it');
});

test('which team a booking came through is the best record\'s word', () => {
  const alert = row('a', 'chronicle.software', '2026-08-25', { channel: 'SDR' });
  assert.equal(whoBooked(cluster([alert, row('s', 'chronicle.software', '2026-08-25', { source: 'sheet', channel: 'Inbound' })])), null, 'the audit says Inbound');
  assert.equal(whoBooked(cluster([alert])).unnamed, true, 'the SDR team, nobody named');
  assert.equal(whoBooked(cluster([alert], [{ sdr: null, ownerRaw: null }])).unnamed, true, 'a blank form says nothing');
  assert.equal(whoBooked(cluster([row('r', 'x.com', '2026-08-31', { channel: 'Inbound' })], [{ sdr: null, ownerRaw: 'AI SDR' }])).unnamed, true, '"AI SDR" on the form');
  const moved = [row('m', null, '2026-08-24', { channel: 'Referral', supersededBy: 'n' }), row('n', null, '2026-08-31', { channel: 'SDR' })];
  assert.equal(whoBooked({ ...clusterMeetings(moved)[0], forms: [], posts: [] }).unnamed, true, 'a moved booking speaks through its new slot');
});

const campaigns = new Map([
  ['akhil-li', { name: 'Akhil_LI', platform: 'heyreach', sdr: 'Akhil', kind: 'outreach' }],
  ['akhil-li-2', { name: 'Akhil_LI_2', platform: 'heyreach', sdr: 'Akhil', kind: 'outreach' }],
  ['akhil-em', { name: 'Akhil_Email', platform: 'instantly', sdr: 'Akhil', kind: 'outreach' }],
  ['rama-li', { name: 'Rama_LI', platform: 'heyreach', sdr: 'Rama', kind: 'outreach' }],
  ['fundraise', { name: 'Fundraise announcement', platform: 'instantly', sdr: null, kind: 'broadcast' }],
  ['kubecon', { name: 'AI_SDR_Kubecon_2026_Li', platform: 'heyreach', sdr: null, kind: 'broadcast' }],
]);
const ctx = (data = {}) => ({
  campaigns,
  roster: new Set(['Akhil', 'Rama', 'Dheeraj']),
  ours: ['Piyush Agarwal', 'Gaurav Jain', 'Deeksha Bhargava'],
  senders: ['Gaurav Jain', 'Deeksha Bhargava', 'Achintya Gupta', 'Chandra Brahmasa'],
  peopleAt: () => data.people || [],
  repliesAt: () => data.replies || [],
  loggedAt: () => data.logged || [],
  peopleByEmail: email => (data.elsewhere || []).filter(p => p.email === email),
});
const akhil = { sdrs: [{ name: 'Akhil', share: 1 }], by: 'form', sure: 'sure' };
const meeting = (posts = []) => cluster([row('m', 'acme.com', '2026-10-31')], [], posts);
const post = said => ({ domain: 'acme.com', date: '2026-10-31', said });

test('where it came from: the person in the pasted conversation and the campaign that reached them', () => {
  const people = [
    { channel: 'linkedin', name: 'Jane Doe', campaignId: 'rama-li', reachedAt: '2026-10-01', sender: 'Gaurav Jain' },
    { channel: 'linkedin', name: 'Jane Doe', campaignId: 'akhil-li', reachedAt: '2026-09-01', sender: 'Deeksha Bhargava' },
    { channel: 'linkedin', name: 'Jane Doe', campaignId: 'kubecon', reachedAt: '2026-10-20' },
  ];
  const where = whereFrom(meeting([post('Jane Doe sent the following message at 3:01 AM')]), akhil, ctx({ people }));
  assert.equal(where.campaignId, 'akhil-li', "the booker's own campaign first; a broadcast never");
  assert.equal(where.sure, 'sure');
  const onAccount = whereFrom(meeting([post('Jane Doe sent the following message. View Gaurav’s profile Gaurav Jain')]), { ...akhil, sdrs: [{ name: 'Dheeraj', share: 1 }] }, ctx({ people }));
  assert.equal(onAccount.campaignId, 'rama-li', "nobody's own: the campaign on the account the chat is on");
  assert.equal(whereFrom(meeting([post('[00:00:01] akhil@reo.dev: Hi\n[00:00:02] Jane Doe: Hello?')]), akhil, ctx({ people })).channel, 'call');
});

test('a LinkedIn chat on one of our accounts is claimed only by a campaign on that account', () => {
  const people = [{ channel: 'linkedin', name: 'Rony Moyal', campaignId: 'rama-li', reachedAt: '2026-06-08', sender: 'Chandra Brahmasa' }];
  const where = whereFrom(meeting([post('Achintya Gupta 7:36 PM Hi Rony, Thank you for connecting! Rony Moyal sent the following message')]), akhil, ctx({ people }));
  assert.deepEqual([where.rung, where.campaignId, where.channel], ['none', null, 'linkedin'], 'hosted.ai');
  assert.equal(whereFrom(meeting([post('Chandra Brahmasa 7:36 PM Hi Rony! Rony Moyal sent the following message')]), akhil, ctx({ people })).campaignId, 'rama-li');
});

test('an address the conversation shows finds its person wherever they are filed', () => {
  const elsewhere = [{ channel: 'email', email: 'varoon@berri.ai', campaignId: 'akhil-em', reachedAt: '2026-06-25' }];
  const where = whereFrom(meeting([post('Looking forward. On Friday, Jul 3 varoon@berri.ai wrote: Just booked')]), akhil, ctx({ elsewhere }));
  assert.equal(where.campaignId, 'akhil-em');
});

test("the channel the form shows narrows every rung below it", () => {
  const people = [{ channel: 'email', email: 'x@acme.com', campaignId: 'akhil-em', reachedAt: '2026-10-01' }, { channel: 'linkedin', name: 'Sam Lee', campaignId: 'akhil-li', reachedAt: '2026-08-01' }];
  const where = whereFrom(meeting([post('Hi Bob, Thank you for connecting!')]), akhil, ctx({ people }));
  assert.deepEqual([where.rung, where.campaignId, where.channel], ['touch', 'akhil-li', 'linkedin'], 'the email touch is later, but the chat was on LinkedIn');
});

test('then what the booker logged, then a reply through outreach, never a broadcast', () => {
  const logged = [{ sdr: 'Akhil', day: '2026-10-20', channel: 'linkedin', campaignId: 'akhil-li', personName: 'Zach' }, { sdr: 'Rama', day: '2026-10-25', channel: 'email', campaignId: 'rama-li' }];
  assert.equal(whereFrom(meeting(), akhil, ctx({ logged })).campaignId, 'akhil-li');
  const replies = [
    { channel: 'email', campaignId: 'fundraise', at: '2026-10-25', positive: true },
    { channel: 'linkedin', campaignId: 'rama-li', at: '2026-10-10', positive: false },
  ];
  assert.equal(whereFrom(meeting(), akhil, ctx({ replies })).campaignId, 'rama-li', 'a reply through outreach, even another SDR\'s');
  const onlyBroadcast = whereFrom(meeting(), akhil, ctx({ replies: [replies[0]] }));
  assert.deepEqual([onlyBroadcast.rung, onlyBroadcast.campaignId, onlyBroadcast.channel], ['broadcast', null, 'email'], 'harness.io: the KubeCon invite claims nothing');
  assert.equal(whereFrom(meeting(), akhil, ctx({ replies: [{ ...replies[1], at: '2026-07-01' }] })).rung, 'none', 'over 60 days before');
});

test("touch-only credit goes to the booker's own outreach, never someone else's", () => {
  const people = [{ channel: 'linkedin', name: 'A B', campaignId: 'rama-li', reachedAt: '2026-10-01' }];
  assert.equal(whereFrom(meeting(), akhil, ctx({ people })).rung, 'none');
  const own = whereFrom(meeting(), akhil, ctx({ people: [...people, { channel: 'email', email: 'c@acme.com', campaignId: 'akhil-em', reachedAt: '2026-06-01' }] }));
  assert.deepEqual([own.rung, own.campaignId, own.sure], ['touch', 'akhil-em', 'unsure']);
  assert.equal(whereFrom(meeting(), akhil, ctx({ people: [{ ...people[0], campaignId: 'akhil-em', reachedAt: '2026-03-01' }] })).rung, 'none', 'over 180 days before');
});

test('every record gets its credit and its reason; repeats and moves point at the meeting', () => {
  const rows = [
    row('s1', 'formance.com', '2026-08-24', { source: 'sheet', sdrName: 'Dheeraj', points: 0.5, channel: 'SDR' }),
    row('s2', 'formance.com', '2026-08-24', { source: 'sheet', sdrName: 'Akhil', points: 0.5, channel: 'SDR' }),
    row('m1', 'velt.dev', '2026-07-15', { source: 'form', sdrName: 'Aaryan', channel: 'SDR' }),
    row('w1', 'workato.com', '2026-07-30', { supersededBy: 'w2', channel: 'SDR' }),
    row('w2', 'workato.com', '2026-08-12', { channel: 'SDR' }),
  ];
  const credit = creditMeetings({
    rows,
    forms: [{ domain: 'formance.com', date: '2026-08-24', sdr: 'Akhil' }, { domain: 'velt.dev', date: '2026-07-15', sdr: 'Aaryan' }, { domain: 'workato.com', date: '2026-07-30', sdr: 'Rama' }],
    posts: [],
    leadsByName: new Map(),
    ...ctx(),
  });
  const by = Object.fromEntries(credit.map(c => [c.id, c]));
  assert.equal(by.s1.mergedInto, null);
  assert.equal(by.s2.mergedInto, 's1');
  assert.deepEqual(by.s1.sdrs, [{ name: 'Akhil', share: 0.5 }, { name: 'Dheeraj', share: 0.5 }]);
  assert.match(by.s1.reason, /^Akhil and Dheeraj, half each: the audit sheet splits it; no outreach of ours reached them\. 2 records of one meeting, counted once on 24 Aug\.$/);
  assert.deepEqual([by.m1.bookingBy, by.m1.reason], ['other', 'Booked by Aaryan, who is not an SDR.']);
  assert.deepEqual([by.w2.mergedInto, by.w2.sdrs[0].name, by.w1.mergedInto, by.w1.sdrs[0].name], [null, 'Rama', null, 'Rama'], 'the moved slot keeps its own row, with the credit');
});

test('"SDR-Others" is outbound outside the SDR team unless it names someone on it', () => {
  const others = (sourceOfMeeting, sdrName = null) => cluster([row('s', 'deepgram.com', '2026-09-26', { source: 'sheet', channel: 'SDR-Others', sourceOfMeeting, sdrName })]);
  assert.deepEqual(whoBooked(others('Piyush')), { other: 'Piyush', by: 'sheet', sure: 'likely' }, "Piyush's own outreach");
  assert.equal(whoBooked(others('Pranesh')).other, 'Pranesh');
  assert.equal(whoBooked(others('Champion changed jobs')).other, 'Champion changed jobs');
  assert.deepEqual(whoBooked(others('Suman', 'Suman')).sdrs, [{ name: 'Suman', share: 1 }], "Suman's ABM");
  assert.equal(whoBooked(others('AI SDR')).unnamed, true, "AI SDR's booking is outreach");
  const credit = creditMeetings({ rows: [row('s', 'deepgram.com', '2026-09-26', { source: 'sheet', channel: 'SDR-Others', sourceOfMeeting: 'Piyush' })], forms: [], posts: [], leadsByName: new Map(), ...ctx() });
  assert.deepEqual([credit[0].bookingBy, credit[0].reason], ['other', 'The audit sheet says Piyush booked it, outside the SDR team.']);
});

test('a booking with no company is named from its invitee', () => {
  const posts = [{ domain: 'bito.ai', date: '2026-09-14', said: 'Max Aldinger sent the following message' }];
  assert.deepEqual(resolveCompany({ domain: null, date: '2026-09-15', inviteeEmail: 'max@bito.ai' }), { domain: 'bito.ai', how: "the invitee's address, max@bito.ai" });
  assert.equal(resolveCompany({ domain: null, date: '2026-09-15', inviteeEmail: 'max@gmail.com', invitee: 'Max Aldinger' }, { posts }).domain, 'bito.ai');
  assert.equal(resolveCompany({ domain: null, date: '2026-08-18', invitee: 'Daniel Baralt' }, { leadsByName: new Map([['daniel baralt', ['virtru.com']]]) }).domain, 'virtru.com');
  assert.equal(resolveCompany({ domain: null, date: '2026-08-18', invitee: 'Sam Lee' }, { leadsByName: new Map([['sam lee', ['a.com', 'b.com']]]) }), null, 'two companies: neither');
  assert.equal(resolveCompany({ domain: 'acme.com', invitee: 'Max Aldinger' }, { posts }), null);
});
