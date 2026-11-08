import crypto from 'crypto';

/**
 * Reads a tab of a Google Sheet with the ICP dashboard's service account, the
 * bot the SDR sheets are shared with. Read-only scope: the sheets stay where
 * people edit, and nothing here can change them.
 */
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SHEETS_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';
const SCOPE = 'https://www.googleapis.com/auth/spreadsheets.readonly';

export const googleSheetsConfigured = () => Boolean(process.env.GOOGLE_SERVICE_ACCOUNT_B64 || process.env.GOOGLE_SERVICE_ACCOUNT_JSON);

const b64url = input => Buffer.from(input).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

async function accessToken() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_B64
    ? Buffer.from(process.env.GOOGLE_SERVICE_ACCOUNT_B64, 'base64').toString('utf8')
    : process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw Object.assign(new Error('GOOGLE_SERVICE_ACCOUNT_B64 is not set'), { code: 'not_configured' });
  const account = JSON.parse(raw);

  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64url(JSON.stringify({ iss: account.client_email, scope: SCOPE, aud: TOKEN_URL, iat: now, exp: now + 3600 }));
  const signature = crypto.createSign('RSA-SHA256').update(`${header}.${claims}`).sign(account.private_key, 'base64')
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${header}.${claims}.${signature}` }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Google token error: ${data.error_description || data.error}`);
  return data.access_token;
}

/**
 * A tab's name from its id, the `gid` in the sheet's link, which survives the tab
 * being renamed. One metadata read, titles only.
 */
export async function tabTitle(spreadsheetId, gid) {
  const token = await accessToken();
  const res = await fetch(`${SHEETS_BASE}/${spreadsheetId}?fields=sheets.properties(sheetId,title)`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Could not open spreadsheet ${spreadsheetId}: ${data.error?.message || res.status}`);
  const tab = (data.sheets || []).find(s => String(s.properties?.sheetId) === String(gid));
  if (!tab) throw new Error(`Spreadsheet ${spreadsheetId} has no tab with id ${gid}`);
  return tab.properties.title;
}

/** Every row of a tab as text, the way the sheet shows it. */
export async function readTab(spreadsheetId, tab) {
  const token = await accessToken();
  const range = encodeURIComponent(`'${tab}'`);
  const res = await fetch(`${SHEETS_BASE}/${spreadsheetId}/values/${range}?valueRenderOption=FORMATTED_VALUE`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Could not read "${tab}": ${data.error?.message || res.status}`);
  return data.values || [];
}
