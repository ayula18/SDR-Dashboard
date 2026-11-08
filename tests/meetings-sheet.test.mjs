import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MEETINGS_SHEET, sheetMeetingRows, sheetRecords } from '../lib/sync/meetings.js';
import { DEFAULT_SEQUENCE, JOBS } from '../lib/sync/jobs.js';

const HEADER = ['Company', 'OSS, Non OSS', 'Employee Band', 'Segment', 'Segment Clean', 'Champion', 'Champion - Job Title', 'Senior Champion?',
  'Meeting Date', 'Source of Meeting', 'Channel', 'Points', 'Qualified', 'Deal Value', 'Week', 'Month', 'Meeting Happened?'];
const team = [{ name: 'Akhil', aliases: [] }, { name: 'Harshini', aliases: ['harishni'] }, { name: 'Muni', aliases: [] }];

test('the audit sheet is read by its header, one meeting per filled row', () => {
  const values = [
    HEADER,
    ['formance.com', 'OSS', '51-100', 'SMB - Green Flag', 'SMB', 'Antoine', 'CTO', 'Yes', '24-Aug', 'Akhil', 'SDR', '0.5', 'Yes', '30,000', 'ws 24 Aug 2026', '01/08/2026', 'Yes'],
    ['', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', ''],
    ['zeliot.in', 'Non OSS', '101-200', 'SMB', 'SMB', 'Rakesh', '-', 'No', '2-November', 'Referral', 'Referral', '1', 'Yes', '30,000', 'ws 26 Oct 2032', '01/10/2026'],
  ];
  const records = sheetRecords(values);
  assert.equal(records.length, 2, 'blank rows are not meetings');
  const [formance, zeliot] = sheetMeetingRows(records, team, { sourceFile: 'tab', importedAt: new Date('2026-11-08') });
  const at = name => ['id', 'company_domain', 'company_raw', 'meeting_date', 'week_start', 'month_start', 'source_of_meeting', 'channel', 'direction', 'sdr_name', 'qualified', 'points', 'deal_value', 'happened', 'segment', 'employee_bucket'].indexOf(name);
  assert.equal(formance[at('meeting_date')], '2026-08-24');
  assert.equal(formance[at('sdr_name')], 'Akhil');
  assert.equal(formance[at('points')], 0.5, 'the sheet\'s own split');
  assert.equal(formance[at('happened')], 'Yes');
  assert.equal(formance[at('segment')], 'SMB');
  assert.equal(zeliot[at('meeting_date')], '2026-11-02', 'a full month name, in the week bucket of late October');
  assert.equal(zeliot[at('sdr_name')], null, 'a referral is nobody on the team');
  assert.equal(zeliot[at('happened')], null, 'not audited yet');
  assert.equal(zeliot.at(-1), 'sheet');
});

test('a row keeps its id while its company, date, source and champion stay, and twice is once', () => {
  const row = ['acme.com', '', '', '', '', 'Ann', '', '', '9-Jan', 'Akhil', 'SDR', '1', 'Yes', '', 'ws 5 Jan 2026', '01/01/2026', 'Yes'];
  const read = rows => sheetMeetingRows(sheetRecords([HEADER, ...rows]), team, { sourceFile: 't', importedAt: new Date() });
  const [first] = read([row]);
  const [again] = read([[...row.slice(0, 16), 'Manual review']]);
  assert.equal(first[0], again[0], 'a new verdict is the same meeting');
  assert.notEqual(read([[...row.slice(0, 5), 'Bob', ...row.slice(6)]])[0][0], first[0], 'another champion is another row');
  assert.equal(read([row, row]).length, 1);
});

test('a tab that lost its columns is refused, not read as no meetings', () => {
  assert.throws(() => sheetRecords([['Company', 'Week'], ['acme.com', 'ws 5 Jan 2026']]), /no "Meeting Date", "Source of Meeting", "Channel" column/);
  assert.throws(() => sheetRecords([]), /no "Company"/);
});

test('the sheet is read before the jobs that stand aside for it', () => {
  assert.equal(MEETINGS_SHEET.id, '1O8LQo-AluQ_5C0VyHhZh1L32QTlycsdz5ERKGO40h1c');
  assert.ok(JOBS['meetings-sheet']);
  const at = key => DEFAULT_SEQUENCE.indexOf(key);
  for (const later of ['meetings-slack', 'meetings-sdr-form', 'meetings-hubspot', 'meetings-evidence', 'positive-sheet']) {
    assert.ok(at('meetings-sheet') < at(later), `meetings-sheet before ${later}`);
  }
});
