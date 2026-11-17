import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { OPEN_PAGES, canSeePage, isSuperAdmin } from '../lib/access.js';

const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');

// Ayush, 2026-11-17: "hide all the other tabs except that these 3 for other people. and only
// i the superadmin ... will be able to see those extra tabs".
test('everyone sees the three open pages; only the super admin sees the rest', () => {
  assert.deepEqual(OPEN_PAGES, ['/', '/sdr-metrics', '/snapshot']);
  for (const page of OPEN_PAGES) assert.ok(canSeePage(page, 'akhil@reo.dev'), page);
  for (const page of ['/campaigns', '/campaigns/abc', '/programs/wvi', '/meetings', '/checks', '/health', '/trends', '/sdrs/Akhil']) {
    assert.ok(!canSeePage(page, 'akhil@reo.dev'), `${page} is hidden from a team member`);
    assert.ok(canSeePage(page, 'ayushlahoti@reo.dev'), `${page} is open to the super admin`);
  }
  assert.ok(isSuperAdmin(' AyushLahoti@reo.dev '), 'email case and spaces do not matter');
  assert.ok(!isSuperAdmin('ayushlahoti@reo.dev.evil.com') && !isSuperAdmin(null) && !isSuperAdmin(''));
});

test('the proxy and the sidebar hold pages to that one rule', () => {
  assert.match(read('proxy.js'), /canSeePage\(pathname, req\.auth\.user\.email\)/);
  assert.match(read('components/Sidebar.js'), /canSeePage\(item\.href, user\?\.email\)/);
  assert.match(read('next.config.mjs'), /source: '\/sdrs', destination: '\/'/, 'old links to the SDR page land on the Overview');
});
