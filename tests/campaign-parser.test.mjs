import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCampaignParser } from '../lib/outreach/campaign-parser.js';

const parse = buildCampaignParser({
  team: ['Rama', 'Akhil', 'Dheeraj', 'Sanika', 'Ahmed', 'Muni', 'Suman', 'Muskan', 'Aman', 'Ayush']
    .map(name => ({ name }))
    .concat([{ name: 'Harshini', aliases: ['harishni'] }]),
  programs: [
    { slug: 'huggingface', match_pattern: 'hugging|(^|[^a-z])hf([^a-z]|$)', sort_order: 10 },
    { slug: 'common-room', match_pattern: 'common ?room|cr ?replacement|(^|[^a-z])cr([^a-z]|$)', sort_order: 20 },
    { slug: 'website-deanon', match_pattern: 'de-?anon|deano|website.?visitor|rb2b|vector|koala|warmly', sort_order: 30 },
    { slug: 'events', match_pattern: 'kubecon|cncf|(^|[^a-z])events?([^a-z]|$)', sort_order: 40 },
    { slug: 'agents-playground', match_pattern: 'playground', sort_order: 50 },
    { slug: 'cto-outreach', match_pattern: '(^|[^a-z])cto([^a-z]|$)', sort_order: 60 },
  ],
});

// Real campaign names from the Instantly workspace.
const CASES = [
  ['Akhil_ShortOSS-June2026', { sdr: 'Akhil', program: null, theme: 'Short OSS', segment: 'OSS' }],
  ['Rama_Hybrid(set2)_31aug2026', { sdr: 'Rama', theme: 'Hybrid', segment: 'Hybrid' }],
  ['Akhil_NonOSS-V2-16January2026', { theme: 'Non-OSS', segment: 'Non-OSS' }],
  ['Suman_CR_starting31Aug', { sdr: 'Suman', program: 'common-room', theme: 'Common Room' }],
  ['Suman_CR Replacement_Drip1', { sdr: 'Suman', program: 'common-room' }],
  ['sanikasonar_Using_CR_not_Scarf_1', { sdr: 'Sanika', program: 'common-room' }],
  ['Ayush_Hugging_Face_11_aug', { sdr: 'Ayush', program: 'huggingface', theme: 'HuggingFace' }],
  ['Dheeraj-Mistral-HF', { sdr: 'Dheeraj', program: 'huggingface' }],
  ['Muni_Kubecon_4Mar', { sdr: 'Muni', program: 'events', theme: 'KubeCon / Events' }],
  ['Muni-Cncf-partnerhip', { sdr: 'Muni', program: 'events' }],
  ['Muskan-Agents-Playground-Old-Users', { sdr: 'Muskan', program: 'agents-playground', theme: 'Agents Playground' }],
  ['Aman - CTO Reachouts', { sdr: 'Aman', program: 'cto-outreach', theme: 'CTO' }],
  ['Akhil_Koala_OSS_(after announcement)_20250717', { sdr: 'Akhil', program: 'website-deanon' }],
  ['Ahmed_agentsv3(US)_WS-16-06-26', { sdr: 'Ahmed', theme: 'Agents', region: 'US' }],
  ['Harshini_Europe2_7thSep2026', { sdr: 'Harshini', region: 'EU' }],
  ['Thesys_Ahmed', { sdr: 'Ahmed' }],
  ['Ramanujan_campaign', { sdr: null }],
  ['Webhook-test', { sdr: null, program: null }],
];

for (const [name, expected] of CASES) {
  test(`parses "${name}"`, () => {
    const parsed = parse(name);
    for (const [key, value] of Object.entries(expected)) assert.equal(parsed[key], value, `${key} of "${name}"`);
  });
}

test('an alias maps to the canonical name', () => {
  assert.equal(parse('harishni_CR_Checkly').sdr, 'Harshini');
});
