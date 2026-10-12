'use client';

import Link from 'next/link';
import { useCallback, useMemo, useState } from 'react';
import { useTeamColor } from '@/lib/client/dashboard-context';
import { fmtInt } from '@/lib/client/format';
import { useApi } from '@/lib/client/use-api';
import { useFilters, useLinkWithFilters } from '@/lib/client/use-filters';
import Card from '../ui/Card';
import DataTable from '../ui/DataTable';
import FilterBar from '../ui/FilterBar';
import PageHeader from '../ui/PageHeader';
import { EmptyState, ErrorState, LoadingBlock } from '../ui/States';
import WarningsBanner from '../ui/WarningsBanner';
import ConversationPanel from './ConversationPanel';
import { ReplyFeed, SyncStatus, useProgramName } from './common';
import { MeetingsPanel, OverviewLead, OverviewTiles, programColumns } from './overview';
import {
  ChannelCard, ChannelToggle, CompanyFunnel, CompanyListPanel, ProgramTrend, bySdrColumns, programCompanyColumns,
} from './program';

// The overview lists the companies that replied or took a meeting, not every
// company touched, so only those funnel steps open a list.
const OPEN_LISTS = ['replied', 'positive', 'meeting'];

/**
 * Everything the team sent and everything that came back, for a range and a
 * channel (both | email | linkedin), counted the way a program page counts it:
 * companies first, then each channel, then the meetings that came of it.
 */
export default function OverviewView() {
  const { apiParams, values, get, setParams } = useFilters();
  const withFilters = useLinkWithFilters();
  const teamColor = useTeamColor();
  const programName = useProgramName();
  const channel = ['email', 'linkedin'].includes(get('channel')) ? get('channel') : 'both';
  const params = useMemo(() => ({ ...apiParams, channel }), [apiParams, channel]);
  const { data, error, loading, refreshing, reload } = useApi('/api/metrics/overview', params);

  const [panel, setPanel] = useState(null);
  const closePanel = useCallback(() => setPanel(null), []);
  const openList = useCallback(list => setPanel({ type: 'list', list }), []);
  const openCompany = useCallback((company, fromList = null) => setPanel({
    type: 'company',
    target: { key: company.key, name: company.company, domain: company.domain },
    fromList,
  }), []);

  const grain = data?.range?.grain || values.grain || 'week';
  const view = data?.channel || channel;
  const summary = data?.companySummary;
  const empty = data && summary.total === 0 && data.meetings.totals.meetings === 0;

  return (
    <div className="page">
      <PageHeader
        title="Overview"
        description="Every company the team reached on Instantly and HeyReach in this range, what came back, and the meetings that came of it."
        meta={<SyncStatus />}
      />
      <FilterBar
        range={data?.range}
        leading={<ChannelToggle value={channel} onChange={value => setParams({ channel: value === 'both' ? null : value })} />}
      />
      <WarningsBanner />
      {error && <ErrorState error={error} onRetry={reload} />}
      {loading && <LoadingBlock />}

      {empty && (
        <EmptyState title="No outreach in this range" action={<Link className="btn btn-small" href="/health">Open data health</Link>}>
          Nothing went out {view === 'both' ? '' : `on ${view === 'email' ? 'email' : 'LinkedIn'} `}in these dates. Pick a longer range, or
          check that the sync has run.
        </EmptyState>
      )}

      {data && !empty && (
        <div className={`page${refreshing ? ' is-refreshing' : ''}`}>
          <OverviewLead summary={summary} tiles={data.tiles} range={data.range} channel={view} companies={data.companies} />
          <OverviewTiles tiles={data.tiles} channel={view} />

          <CompanyFunnel
            summary={summary}
            channel={view}
            range={data.range}
            email={data.email}
            linkedin={data.linkedin}
            onOpenList={openList}
            openLists={OPEN_LISTS}
            subtitle="Touches sent in this range, the unique companies they reached, and how far each has got since. The last two steps count meetings at those companies, whenever they happened; the Meetings section counts what was held in this range."
          />

          {view === 'both' ? (
            <div className="grid-2">
              <ChannelCard channel="email" numbers={data.email} change={data.change?.email} />
              <ChannelCard channel="linkedin" numbers={data.linkedin} change={data.change?.linkedin} />
            </div>
          ) : (
            <ChannelCard channel={view} numbers={data[view]} change={data.change?.[view]} />
          )}

          <ProgramTrend rows={data.trend} grain={grain} channel={view} />

          <MeetingsPanel
            meetings={data.meetings}
            grain={grain}
            channel={view}
            withFilters={withFilters}
            programName={programName}
          />

          <Card
            className="flush"
            title="Companies that came back"
            subtitle="Every company that replied or took a meeting after being touched in this range, furthest stage first. Open one to read the conversation."
            footnote={[
              data.companiesCapped ? 'Only the first 1,000 are listed.' : null,
              summary.withoutDomain
                ? `${fmtInt(summary.withoutDomain)} LinkedIn ${summary.withoutDomain === 1 ? 'company has' : 'companies have'} no matching domain yet, so email outreach and meetings can't be joined to ${summary.withoutDomain === 1 ? 'it' : 'them'}. Admins can map them in Data health.`
                : null,
            ].filter(Boolean).join(' ') || undefined}
          >
            <DataTable
              columns={programCompanyColumns(view)}
              rows={data.companies}
              rowKey={r => r.key}
              onRowClick={openCompany}
              rowLabel={r => `Open the conversation with ${r.company}`}
              activeKey={panel?.type === 'company' ? panel.target.key : null}
              searchable
              searchPlaceholder="Search companies"
              exportName="companies-that-replied"
              pageSize={25}
              empty="Nobody has replied in this range yet."
            />
          </Card>

          <div className="grid-2">
            <Card className="flush" title={<Link href={withFilters('/sdrs')}>SDRs</Link>} subtitle="What each SDR sent in this range and what came back.">
              <DataTable
                columns={bySdrColumns({ channel: view, teamColor, withFilters, withCompanies: false, withMeetings: true })}
                rows={data.bySdr}
                rowKey={r => r.sdr}
                dense
                exportName="by-sdr"
              />
            </Card>
            <Card className="flush" title={<Link href={withFilters('/programs')}>Programs</Link>} subtitle="Specialised outreach in this range.">
              <DataTable
                columns={programColumns({ channel: view, withFilters, programName })}
                rows={data.byProgram}
                rowKey={r => r.program}
                dense
                exportName="by-program"
              />
            </Card>
          </div>

          <Card title="Latest replies" subtitle="What people wrote back in this range. Open one to read the whole conversation.">
            <ReplyFeed
              replies={data.replies.slice(0, 10)}
              onOpen={r => openCompany({ key: r.companyKey, company: r.domain || r.name, domain: r.domain })}
            />
          </Card>
        </div>
      )}

      <ConversationPanel
        target={panel?.type === 'company' ? panel.target : null}
        channel={view}
        onClose={closePanel}
        onBack={panel?.type === 'company' && panel.fromList ? () => openList(panel.fromList) : null}
      />
      {data && (
        <CompanyListPanel
          list={panel?.type === 'list' ? panel.list : null}
          companies={data.companies}
          replies={data.replies}
          onClose={closePanel}
          onOpen={company => openCompany(company, panel?.list)}
        />
      )}
    </div>
  );
}
