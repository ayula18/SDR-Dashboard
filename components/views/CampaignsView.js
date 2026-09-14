'use client';

import { useMemo } from 'react';
import { useTeamColor } from '@/lib/client/dashboard-context';
import { fmtInt } from '@/lib/client/format';
import { useApi } from '@/lib/client/use-api';
import { useFilters, useLinkWithFilters } from '@/lib/client/use-filters';
import Card from '../ui/Card';
import DataTable from '../ui/DataTable';
import FilterBar from '../ui/FilterBar';
import PageHeader from '../ui/PageHeader';
import StatTile from '../ui/StatTile';
import { ErrorState, LoadingBlock } from '../ui/States';
import WarningsBanner from '../ui/WarningsBanner';
import { SyncStatus, campaignColumns, campaignResults, periodPhrase, useProgramName } from './common';

const SHOW = [
  ['current', 'Running or active in range'],
  ['running', 'Running now'],
  ['all', 'Every campaign'],
];

export default function CampaignsView() {
  const { apiParams, get, setParams } = useFilters();
  const withFilters = useLinkWithFilters();
  const teamColor = useTeamColor();
  const programName = useProgramName();
  const show = SHOW.some(([value]) => value === get('show')) ? get('show') : 'current';
  const platform = get('platform');
  const { data, error, loading, refreshing, reload } = useApi('/api/metrics/campaigns', { ...apiParams, show, platform });
  const campaigns = useMemo(() => data?.campaigns || [], [data]);

  const totals = useMemo(() => campaigns.reduce((t, c) => {
    const r = campaignResults(c);
    return {
      email: t.email + (c.linkedin ? 0 : 1),
      linkedin: t.linkedin + (c.linkedin ? 1 : 0),
      running: t.running + (c.status === 'active' ? 1 : 0),
      emailsSent: t.emailsSent + c.period.sent,
      invitesSent: t.invitesSent + c.period.linkedinInvitesSent,
      messagesSent: t.messagesSent + c.period.linkedinMessagesSent,
      replied: t.replied + r.replied,
      positive: t.positive + r.positive,
      unattributed: t.unattributed + (c.sdr ? 0 : 1),
    };
  }, { email: 0, linkedin: 0, running: 0, emailsSent: 0, invitesSent: 0, messagesSent: 0, replied: 0, positive: 0, unattributed: 0 }), [campaigns]);

  return (
    <div className="page">
      <PageHeader
        title="Campaigns"
        description="Every Instantly and HeyReach campaign in one list, with the companies each one reached. SDR, program and message angle come from the campaign name; admins can correct them on a campaign's page."
        meta={<SyncStatus />}
      />
      <FilterBar range={data?.range} showGrain={false}>
        <select aria-label="Which campaigns" className="select-trigger" value={show} onChange={e => setParams({ show: e.target.value === 'current' ? null : e.target.value })}>
          {SHOW.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <select aria-label="Channel" className="select-trigger" value={platform} onChange={e => setParams({ platform: e.target.value })}>
          <option value="">Email and LinkedIn</option>
          <option value="instantly">Email (Instantly)</option>
          <option value="heyreach">LinkedIn (HeyReach)</option>
        </select>
      </FilterBar>
      <WarningsBanner />
      {error && <ErrorState error={error} onRetry={reload} />}
      {loading && <LoadingBlock />}

      {data && (
        <div className={`page${refreshing ? ' is-refreshing' : ''}`}>
          <div className="tiles">
            <StatTile compact label="Campaigns" value={fmtInt(campaigns.length)} note={`${fmtInt(totals.email)} email, ${fmtInt(totals.linkedin)} LinkedIn, ${fmtInt(totals.running)} running`} />
            <StatTile compact label="Emails sent" value={fmtInt(totals.emailsSent)} note={periodPhrase(data.range)} />
            <StatTile compact label="LinkedIn invites" value={fmtInt(totals.invitesSent)} note={`${fmtInt(totals.messagesSent)} messages ${periodPhrase(data.range)}`} />
            <StatTile compact label="People who replied" value={fmtInt(totals.replied)} note="Whole campaigns, both channels" />
            <StatTile compact label="Positive replies" value={fmtInt(totals.positive)} note="Whole campaigns, both channels" />
          </div>

          <Card
            className="flush"
            title="Campaigns"
            subtitle="Companies, people, replies and meetings cover each whole campaign. Reached is leads contacted for email and people invited or messaged for LinkedIn. Sent in range is what went out in the selected dates."
            footnote={totals.unattributed ? `${fmtInt(totals.unattributed)} of these campaigns have no SDR in their name. Assign them from Data health.` : undefined}
          >
            <DataTable
              columns={campaignColumns({ teamColor, withFilters, programName })}
              rows={campaigns}
              rowKey={r => r.id}
              searchable
              searchPlaceholder="Search campaigns, SDRs, companies"
              exportName="campaigns"
              initialSort={{ key: 'sent', dir: 'desc' }}
              pageSize={50}
            />
          </Card>
        </div>
      )}
    </div>
  );
}
