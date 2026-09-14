/**
 * Who ran a campaign and what it was about, from its name alone.
 *
 * Instantly records neither. Every campaign sends from the same pool of
 * burner mailboxes, so the only attribution is the naming convention SDRs
 * follow: "<SDR>_<angle>_<date>", e.g. "Akhil_ShortOSS-June2026",
 * "Rama_Hybrid(set2)_31aug2026", "Suman_CR_starting31Aug". It is followed
 * loosely ("sanikasonar_Using_CR_not_Scarf", "Muni-Cncf-partnerhip"), so the
 * rules are tolerant, and anything they get wrong is fixed with a
 * dash_campaign_overrides row rather than a code change.
 */

// Message angles, most specific first, so a HuggingFace campaign is not
// reported as "OSS" just because its name also mentions OSS.
const THEMES = [
  ['HuggingFace', /hugging|(^|[^a-z])hf([^a-z]|$)/i],
  ['Common Room', /common ?room|cr ?replacement|(^|[^a-z])cr([^a-z]|$)|(^|[^a-z])crnot/i],
  ['KubeCon / Events', /kubecon|cncf|(^|[^a-z])events?([^a-z]|$)/i],
  ['Agents Playground', /playground/i],
  ['CTO', /(^|[^a-z])cto([^a-z]|$)/i],
  ['Website De-anon', /de-?anon|koala|rb2b|warmly|website.?visitor/i],
  ['Competitor', /competitor|not.?scarf/i],
  ['Hidden Dev Activity', /hidden.?dev/i],
  ['MCP', /(^|[^a-z])mcp([^a-z]|$)/i],
  ['Agents', /agent/i],
  ['Hybrid', /hybrid/i],
  ['Short OSS', /short.?-?oss/i],
  ['Non-OSS', /non.?-?oss/i],
  ['OSS', /(^|[^a-z])oss/i],
  ['Sample Template', /sample/i],
];

const SEGMENTS = [
  ['Hybrid', /hybrid/i],
  ['Non-OSS', /non.?-?oss/i],
  ['OSS', /(^|[^a-z])(short)?-?oss/i],
];

const REGIONS = [
  ['US', /(^|[^a-z])us([^a-z]|$)/i],
  ['EU', /europe|(^|[^a-z])eu([^a-z]|$)/i],
  ['India', /india/i],
];

const firstMatch = (rules, text) => rules.find(([, re]) => re.test(text))?.[0] || null;

/**
 * @param {{ team: {name: string, aliases?: string[]}[],
 *           programs: {slug: string, match_pattern: string, sort_order?: number, is_active?: boolean}[] }} config
 * @returns {(campaignName: string) => {sdr: string|null, program: string|null, theme: string|null, segment: string|null, region: string|null}}
 */
export function buildCampaignParser({ team = [], programs = [] }) {
  const aliases = team
    .flatMap(t => [t.name, ...(t.aliases || [])].map(alias => ({ alias: String(alias).toLowerCase(), name: t.name })))
    .filter(a => a.alias)
    .sort((a, b) => b.alias.length - a.alias.length)
    .map(a => ({ ...a, token: new RegExp(`(^|[^a-z])${a.alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z]|$)`) }));

  const programRules = programs
    .filter(p => p.is_active !== false)
    .sort((a, b) => (a.sort_order ?? 100) - (b.sort_order ?? 100))
    .map(p => {
      try {
        return { slug: p.slug, re: new RegExp(p.match_pattern, 'i') };
      } catch {
        return null; // a bad pattern disables that program rather than every campaign sync
      }
    })
    .filter(Boolean);

  function sdrFor(lowerName) {
    for (const { alias, name } of aliases) {
      if (!lowerName.startsWith(alias)) continue;
      const next = lowerName.charAt(alias.length);
      // Short names need a separator ("rama_", "muni-") or "ramanujan" would be
      // Rama. Longer ones may run straight on, as in "sanikasonar_…".
      if (!/[a-z]/.test(next) || alias.length >= 5) return name;
    }
    // Some names put the SDR last: "Thesys_Ahmed", "imply.io_ahmed_ws-24-02-26".
    return aliases.find(a => a.alias.length >= 4 && a.token.test(lowerName))?.name || null;
  }

  return function parseCampaignName(rawName) {
    const name = String(rawName ?? '').trim();
    return {
      sdr: sdrFor(name.toLowerCase()),
      program: programRules.find(p => p.re.test(name))?.slug || null,
      theme: firstMatch(THEMES, name),
      segment: firstMatch(SEGMENTS, name),
      region: firstMatch(REGIONS, name),
    };
  };
}
