import { qp } from '../db.js';
import { buildCampaignParser } from '../outreach/campaign-parser.js';

export async function loadCampaignParser() {
  const [team, programs] = await Promise.all([
    qp(`SELECT name, aliases FROM dash_team WHERE is_active`),
    qp(`SELECT slug, match_pattern, sort_order, is_active FROM dash_programs`),
  ]);
  return buildCampaignParser({ team, programs });
}

/** Re-applies the parser to every stored campaign, e.g. after the roster or a program pattern changes. */
export async function reparseCampaigns() {
  const parse = await loadCampaignParser();
  const campaigns = await qp(`SELECT id, name FROM dash_campaigns`);
  const cols = [[], [], [], [], [], []];
  for (const c of campaigns) {
    const p = parse(c.name);
    [c.id, p.sdr, p.program, p.theme, p.segment, p.region].forEach((v, i) => cols[i].push(v));
  }
  await qp(
    `UPDATE dash_campaigns c
        SET parsed_sdr = v.sdr, parsed_program = v.program, parsed_theme = v.theme,
            parsed_segment = v.segment, parsed_region = v.region
       FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[])
            AS v(id, sdr, program, theme, segment, region)
      WHERE c.id = v.id`,
    cols
  );
  return { reparsed: campaigns.length };
}
