'use client';

import Link from 'next/link';
import { useTeamColor } from '@/lib/client/dashboard-context';
import { fmtInt } from '@/lib/client/format';
import { useApi } from '@/lib/client/use-api';
import { useFilters, useLinkWithFilters } from '@/lib/client/use-filters';
import Funnel from '../charts/Funnel';
import Card from '../ui/Card';
import DataTable from '../ui/DataTable';
import FilterBar from '../ui/FilterBar';
import PageHeader from '../ui/PageHeader';
import { Person } from '../ui/Person';
import { ErrorState, LoadingBlock } from '../ui/States';
import WarningsBanner from '../ui/WarningsBanner';
import {
  KpiTiles, LinkedinBlock, SyncStatus, TrendCards, WhatChanged, programHref, rateCell, sdrHref, withDelta,
} from './common';

export default function OverviewView() {
  const { apiParams, values } = useFilters();
  const withFilters = useLinkWithFilters();
  const teamColor = useTeamColor();
  const overview = useApi('/api/metrics/overview', apiParams);
  const leaderboard = useApi('/api/metrics/sdrs', apiParams);
  const programs = useApi('/api/metrics/programs', apiParams);
  const data = overview.data;
  const grain = data?.range?.grain || values.grain || 'week';

  const sdrColumns = [
    { key: 'name', label: 'SDR', sort: r => r.name, render: r => <Person name={r.name} color={teamColor(r.name)} href={withFilters(sdrHref(r.name))} size={22} /> },
    { key: 'leadsContacted', label: 'Contacted', align: 'right', sort: r => r.leadsContacted, render: r => fmtInt(r.leadsContacted) },
    { key: 'positive', label: 'Positive', align: 'right', sort: r => r.positive, render: r => withDelta(r.positive, r.change.positive) },
    { key: 'positiveRate', label: 'Rate', align: 'right', sort: r => r.positiveRate, render: r => rateCell(r.positiveRate, r.lowSample) },
    { key: 'meetings', label: 'Meetings', align: 'right', sort: r => r.meetings, render: r => withDelta(r.meetings, r.change.meetings) },
  ];

  const programColumns = [
    {
      key: 'name',
      label: 'Program',
      sort: r => r.name,
      render: r => <><Link href={withFilters(programHref(r.slug))}>{r.name}</Link><span className="cell-sub">{r.poc ? `Run by ${r.poc}` : 'No owner set'}</span></>,
    },
    { key: 'emailsSent', label: 'Emails sent', align: 'right', sort: r => r.period.emailsSent, render: r => withDelta(r.period.emailsSent, r.change.emailsSent) },
    { key: 'replies', label: 'Replies', align: 'right', sort: r => r.period.replies, render: r => fmtInt(r.period.replies) },
    { key: 'positive', label: 'Positive', align: 'right', sort: r => r.period.positive, render: r => withDelta(r.period.positive, r.change.positive) },
    { key: 'meetings', label: 'Meetings', align: 'right', sort: r => r.period.meetings, render: r => fmtInt(r.period.meetings) },
  ];

  return (
    <div className="page">
      <PageHeader
        title="Overview"
        description="Outreach across Instantly and HeyReach for the selected range, compared with the range before it."
        meta={<SyncStatus />}
      />
      <FilterBar range={data?.range} />
      <WarningsBanner />
      {overview.error && <ErrorState error={overview.error} onRetry={overview.reload} />}
      {overview.loading && <LoadingBlock />}

      {data && (
        <div className={`page${overview.refreshing ? ' is-refreshing' : ''}`}>
          <WhatChanged data={data} topSdr={leaderboard.data?.sdrs?.[0]} />
          <KpiTiles kpis={data.kpis} />

          <div className="grid-2">
            <Card title="Outreach funnel" subtitle="Leads contacted in this range and what came back." footnote={data.funnelNote}>
              <Funnel stages={data.funnel} />
            </Card>
            <Card
              title="LinkedIn"
              subtitle={data.linkedin.source === 'heyreach' ? 'HeyReach invites, messages and replies.' : 'HeyReach conversations archived by the AI SDR app.'}
            >
              <LinkedinBlock linkedin={data.linkedin} />
            </Card>
          </div>

          <TrendCards rows={data.trend} grain={grain} />

          <div className="grid-2">
            <Card className="flush" title={<Link href={withFilters('/sdrs')}>SDRs</Link>} subtitle="Ranked by positive replies in this range.">
              {leaderboard.error ? <ErrorState error={leaderboard.error} onRetry={leaderboard.reload} />
                : leaderboard.data ? <DataTable dense columns={sdrColumns} rows={leaderboard.data.sdrs.slice(0, 8)} rowKey={r => r.name} />
                  : <LoadingBlock height={180} />}
            </Card>
            <Card className="flush" title={<Link href={withFilters('/programs')}>Programs</Link>} subtitle="Specialised outreach in this range.">
              {programs.error ? <ErrorState error={programs.error} onRetry={programs.reload} />
                : programs.data ? <DataTable dense columns={programColumns} rows={programs.data.programs} rowKey={r => r.slug} />
                  : <LoadingBlock height={180} />}
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
