import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getOutcomes, whoBooked } from '../lib/metrics/outcomes.js';

const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const meeting = { domain: 'acme.com', date: '2026-10-20' };

test('a meeting is put to the person whose reply led to it', () => {
  const said = (name, at, extra = {}) => ({ domain: 'acme.com', name, at, ...extra });
  assert.equal(whoBooked(meeting, []), null);
  assert.equal(whoBooked({ domain: null, date: '2026-10-20' }, [said('Ann', '2026-10-10', { positive: true })]), null, 'no company, no person');

  const interested = said('Ann', '2026-10-01', { positive: true });
  const logged = said('Bob', '2026-10-15', { logged: true });
  const other = said('Cal', '2026-10-18');
  assert.equal(whoBooked(meeting, [other, logged, interested]).name, 'Ann', 'an interested reply beats a later one');
  assert.equal(whoBooked(meeting, [other, logged]).name, 'Bob', 'a name on the sheet beats a reply that is neither');
  assert.equal(whoBooked(meeting, [other]).name, 'Cal');
  assert.equal(whoBooked(meeting, [said('Ann', '2026-09-01', { positive: true }), said('Dee', '2026-10-05', { positive: true })]).name, 'Dee', 'the latest of a kind');
});

test('only a reply near the meeting at that company counts as leading to it', () => {
  assert.equal(whoBooked(meeting, [{ domain: 'other.com', name: 'X', at: '2026-10-10', positive: true }]), null);
  assert.equal(whoBooked(meeting, [{ domain: 'acme.com', name: 'Old', at: '2026-08-01', positive: true }]), null, 'over 60 days before');
  assert.equal(whoBooked(meeting, [{ domain: 'acme.com', name: 'Later', at: '2026-10-25', positive: true }]), null, 'after the meeting');
  assert.equal(whoBooked(meeting, [{ domain: 'acme.com', name: 'Same day', at: '2026-10-20T15:00:00Z' }]).name, 'Same day');
});

test('the list asks for what the number counted, and refuses anything else', async () => {
  await assert.rejects(getOutcomes({ from: '2026-10-01', toExclusive: '2026-10-02' }, { kind: 'replies' }), /positive or meetings/);
  await assert.rejects(getOutcomes({ from: '2026-10-01', toExclusive: '2026-10-02' }, { kind: 'positive', channel: 'none' }), /email or linkedin/);
  const source = read('lib/metrics/outcomes.js');
  assert.match(source, /positiveResponses\(filters/, 'positives come from the list the cards agree with');
  assert.match(source, /listMeetings\(filters, \{ \.\.\.range, platform: PLATFORM\[channel\] \|\| null, withRescheduled: false/, 'meetings as the funnel counts them: no moved slots');
});

test('Positive and Meetings numbers open their names on the SDR page, the Overview and program pages', () => {
  assert.match(read('components/views/SdrsView.js'), /useOutcomes\(\)/);
  assert.match(read('components/views/OverviewView.js'), /useOutcomes\(\)/);
  assert.match(read('components/views/ProgramDetailView.js'), /useOutcomes\(\)/);
  const funnel = read('components/views/funnel.js');
  for (const key of ['emailPositive', 'emailMeetings', 'linkedinPositive', 'linkedinMeetings']) {
    assert.match(funnel, new RegExp(`key: '${key}'[^\\n]*outcome: '`), `${key} does not open its names`);
  }
  assert.match(read('components/views/overview.js'), /CountButton/);
  assert.match(read('components/views/program.js'), /CountButton/);
});

test('meeting tables on other pages open the conversation too', () => {
  for (const file of ['components/views/MeetingsView.js', 'components/views/SdrDetailView.js', 'components/views/CampaignDetailView.js']) {
    assert.match(read(file), /onRowClick=\{openConversation\}/, file);
    assert.match(read(file), /\{conversation\}/, file);
  }
  assert.match(read('components/views/ProgramDetailView.js'), /rows=\{data\.meetings\}[\s\S]{0,80}onRowClick=/);
});

test('the two email counts say what they are, in one place', () => {
  const funnel = read('components/views/funnel.js');
  assert.match(funnel, /label: 'Total emails', note: 'all steps'/);
  assert.match(funnel, /label: 'First emails', note: 'step 1 only'/);
  assert.match(read('components/views/program.js'), /label: 'Total emails \(all steps\)'/);
  for (const file of ['components/views/funnel.js', 'components/views/program.js', 'components/views/SdrsView.js']) {
    assert.doesNotMatch(read(file), /label: 'Emails sent'/, `${file} still says Emails sent`);
  }
});
