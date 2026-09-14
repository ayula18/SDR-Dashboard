const FREEMAIL = new Set([
  'gmail.com', 'googlemail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'live.com', 'icloud.com',
  'me.com', 'aol.com', 'proton.me', 'protonmail.com', 'gmx.com', 'mail.com', 'yandex.com', 'qq.com', '163.com',
]);

/** 'https://www.Trychroma.com/about' → 'trychroma.com'. Null for anything that isn't a domain. */
export function normalizeDomain(value) {
  let s = String(value ?? '').trim().toLowerCase();
  if (!s || s === '[object object]') return null;
  s = s.replace(/^[a-z]+:\/\//, '').replace(/^www\./, '').split(/[/?#\s]/)[0].replace(/\.$/, '');
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(s) ? s : null;
}

/** Company domain from a work email; null for freemail addresses. */
export function domainFromEmail(email) {
  const domain = normalizeDomain(String(email ?? '').split('@')[1]);
  return domain && !FREEMAIL.has(domain) ? domain : null;
}
