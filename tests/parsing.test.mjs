import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv, parseCsvObjects } from '../lib/csv.js';
import { domainFromEmail, normalizeDomain } from '../lib/outreach/domains.js';
import { meetingDate } from '../lib/sync/meetings.js';

const iso = d => d.toISOString().slice(0, 10);

test('CSV: quoted commas, doubled quotes and newlines inside quotes', () => {
  const rows = parseCsv('a,b,c\n"x, y","he said ""hi""","line1\nline2"\r\n1,2,3\n');
  assert.deepEqual(rows, [['a', 'b', 'c'], ['x, y', 'he said "hi"', 'line1\nline2'], ['1', '2', '3']]);
});

test('CSV: BOM stripped, headers and values trimmed', () => {
  assert.deepEqual(parseCsvObjects('﻿Company, Channel \nkonghq.com, SDR\n'), [{ Company: 'konghq.com', Channel: 'SDR' }]);
});

test('domains: normalized from URLs, junk rejected, freemail ignored', () => {
  assert.equal(normalizeDomain('https://www.Trychroma.com/about'), 'trychroma.com');
  assert.equal(normalizeDomain('[object Object]'), null);
  assert.equal(normalizeDomain('not a domain'), null);
  assert.equal(domainFromEmail('someone@deepset.ai'), 'deepset.ai');
  assert.equal(domainFromEmail('someone@gmail.com'), null);
});

test('meetings sheet: day-month takes the year from the DD/MM/YYYY Month column', () => {
  assert.equal(iso(meetingDate({ 'Meeting Date': '9-Jan', Month: '01/01/2026' })), '2026-01-09');
  assert.equal(iso(meetingDate({ 'Meeting Date': '14-Jul', Month: '01/07/2026' })), '2026-07-14');
});

test('meetings sheet: a December meeting in January\'s bucket belongs to the previous year', () => {
  assert.equal(iso(meetingDate({ 'Meeting Date': '30-Dec', Month: '01/01/2026' })), '2025-12-30');
});

test('meetings sheet: falls back to the Week label and corrects year typos', () => {
  assert.equal(iso(meetingDate({ 'Meeting Date': '', Week: 'ws 5 Jan 2028', Month: '01/01/2026' })), '2026-01-05');
});
