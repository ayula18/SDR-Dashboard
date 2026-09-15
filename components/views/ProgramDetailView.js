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
import ConversationPanel from './ConversationPanel';
import { ReplyFeed, SyncStatus, campaignColumns, meetingColumns, useProgramName } from './common';
import {
  ChannelCard, ChannelToggle, CompanyFunnel, CompanyListPanel, ProgramLead, ProgramTrend, bySdrColumns, programCompanyColumns,
} from './program';

const SINCE_START = [{ value: 'since-start', label: 'Since start' }];

/**
 * One program across email and LinkedIn: what it reached and what came of it,
 * then the companies, campaigns, trend, SDRs and replies behind those numbers.
 * Any company, funnel step or reply opens the conversation behind it.
 */
export default function ProgramDetailView({ slug }) {
  const { apiParams, values, get, setParams } = useFilters({ defaultRange: 'since-start' });
  const withFilters = useLinkWithFilters();
  const teamColor = useTeamColor();
  const programName = useProgramName();
  const channel = ['email', 'linkedin'].includes(get('channel')) ? get('channel') : 'both';
  const params = useMemo(() => {
    const { program, ...rest } = apiParams;
    return { ...rest, channel };
  }, [apiParams, channel]);
  const { data, error, loading, refreshing, reload } = useApi(`/api/metrics/programs/${slug}`, params);

  const [panel, setPanel] = useState(null);
  const closePanel = useCallback(() => setPanel(null), []);
  const openList = useCallback(list => setPanel({ type: 'list', list }), []);
  const openCompany = useCallback((company, fromList = null) => setPanel({
    type: 'company',
    target: { key: company.key, name: company.company, domain: company.domain },
    fromList,
  }), []);

  const grain = values.grain || data?.range?.grain || 'week';
  const program = data?.program;
  const summary = data?.companySummary;
  const empty = data && data.companies.length === 0 && data.campaigns.length === 0;
  const view = data?.channel || channel;

  return (
    <div className="page">
      <PageHeader
        back={{ href: withFilters('/programs'), label: 'All programs' }}
        title={program?.name || programName(slug)}
        description={program ? [program.poc && `Run by ${program.poc}.`, program.description].filter(Boolean).join(' ') : undefined}
        meta={<SyncStatus />}
      />
      <FilterBar
        range={data?.range}
        hide={['program', 'theme']}
        defaultRange="since-start"
        extraRanges={SINCE_START}
        leading={<ChannelToggle value={channel} available={data?.channels} onChange={value => setParams({ channel: value === 'both' ? null : value })} />}
      />
      {error && <ErrorState error={error} onRetry={reload} title={error.status === 404 ? `There is no ${slug} program` : undefined} />}
      {loading && <LoadingBlock />}

      {empty && (
        <EmptyState title="No outreach in this range" action={<Link className="btn btn-small" href="/health">Open data health</Link>}>
          Nothing in this program was sent {view === 'both' ? '' : `on ${view === 'email' ? 'email' : 'LinkedIn'} `}in these dates. Pick a longer
          range, or check that campaign names match the program&apos;s rule ({program.matchPattern}).
        </EmptyState>
      )}

      {data && !empty && (
        <div className={`page${refreshing ? ' is-refreshing' : ''}`}>
          <ProgramLead name={program.name} range={data.range} summary={summary} channel={view} companies={data.companies} />

          <CompanyFunnel summary={summary} channel={view} range={data.range} onOpenList={openList} />

          {view === 'both' ? (
            <div className="grid-2">
              <ChannelCard channel="email" numbers={data.email} change={data.change?.email} />
              <ChannelCard channel="linkedin" numbers={data.linkedin} change={data.change?.linkedin} />
            </div>
          ) : (
            <ChannelCard channel={view} numbers={data[view]} change={data.change?.[view]} />
          )}

          <Card
            className="flush"
            title="Companies"
            subtitle={`${data.range.sinceStart ? 'Every company this program touched' : 'Companies touched in this range'}, furthest stage first. Open a company to read the conversation.`}
            footnote={summary.withoutDomain
              ? `${fmtInt(summary.withoutDomain)} LinkedIn ${summary.withoutDomain === 1 ? 'company has' : 'companies have'} no matching domain yet, so email outreach and meetings can't be joined to ${summary.withoutDomain === 1 ? 'it' : 'them'}. Admins can map them in Data health.`
              : undefined}
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
              exportName={`${slug}-companies`}
              empty="No companies touched in this range."
            />
          </Card>

          <Card
            className="flush"
            title="Campaigns"
            subtitle="Campaigns running now or active in this range. Results cover each whole campaign; Sent in range is what went out in these dates."
          >
            <DataTable
              columns={campaignColumns({ teamColor, withFilters, programName, withProgram: false })}
              rows={data.campaigns}
              rowKey={r => r.id}
              searchable
              searchPlaceholder="Search campaigns or companies"
              exportName={`${slug}-campaigns`}
              initialSort={{ key: 'sent', dir: 'desc' }}
              empty="No campaigns ran in this range."
            />
          </Card>

          <ProgramTrend rows={data.trend} grain={grain} channel={view} />

          <Card className="flush" title="By SDR" subtitle="Companies each SDR's campaigns touched in this range, and what went out and came back on each channel.">
            <DataTable columns={bySdrColumns({ channel: view, teamColor, withFilters })} rows={data.bySdr} rowKey={r => r.sdr} dense exportName={`${slug}-by-sdr`} />
          </Card>

          <div className="grid-2">
            <Card className="flush" title="Meetings" subtitle="Meetings at these companies after the first touch, from the audit sheet.">
              <DataTable
                columns={meetingColumns({ teamColor, withFilters }).filter(c => ['date', 'company', 'sdr', 'held', 'dealValue'].includes(c.key))}
                rows={data.meetings}
                rowKey={r => r.id}
                dense
                pageSize={10}
                empty="No meetings at these companies yet."
              />
            </Card>
            <Card title="Latest replies" subtitle="What people wrote back in this range. Open one to read the whole conversation.">
              <ReplyFeed
                replies={data.replies.slice(0, 10)}
                onOpen={r => openCompany({ key: r.companyKey, company: r.domain || r.name, domain: r.domain })}
              />
            </Card>
          </div>
        </div>
      )}

      <ConversationPanel
        target={panel?.type === 'company' ? panel.target : null}
        program={slug}
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
