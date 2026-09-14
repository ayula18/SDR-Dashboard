'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useTeamColor } from '@/lib/client/dashboard-context';
import { fmtDate, fmtInt, fmtMoney, fmtPct } from '@/lib/client/format';
import { useApi } from '@/lib/client/use-api';
import { useFilters, useLinkWithFilters } from '@/lib/client/use-filters';
import Funnel from '../charts/Funnel';
import Card from '../ui/Card';
import DataTable from '../ui/DataTable';
import FilterBar from '../ui/FilterBar';
import PageHeader from '../ui/PageHeader';
import { Person } from '../ui/Person';
import StatTile from '../ui/StatTile';
import { EmptyState, ErrorState, LoadingBlock } from '../ui/States';
import { ChannelTrendCards, companyColumns } from './channels';
import {
  ReplyFeed, SyncStatus, campaignColumns, meetingColumns, periodPhrase, rateCell, sdrHref, useProgramName,
} from './common';

const COVERAGE = [
  ['all', 'All'],
  ['both', 'Both channels'],
  ['email', 'Email only'],
  ['linkedin', 'LinkedIn only'],
];

const stack = (value, sub) => <span className="cell-stack">{value}<span className="cell-sub">{sub}</span></span>;

function CompaniesCard({ companies, summary, range, since, slug }) {
  const [coverage, setCoverage] = useState('all');
  const [inRange, setInRange] = useState(false);
  const counts = { all: summary.total, both: summary.both, email: summary.emailOnly, linkedin: summary.linkedinOnly };
  const rows = useMemo(() => companies.filter(c => {
    if (coverage !== 'all' && c.channels !== coverage) return false;
    if (!inRange) return true;
    const day = String(c.lastTouchAt || '').slice(0, 10);
    return day >= range.from && day <= range.to;
  }), [companies, coverage, inRange, range]);

  return (
    <Card
      className="flush"
      title="Companies across email and LinkedIn"
      subtitle={`Every company this program reached since ${fmtDate(since, { year: true })}, furthest stage first. People are counted per channel; meetings are any at the company after its first touch.`}
      footnote={summary.withoutDomain
        ? `${fmtInt(summary.withoutDomain)} LinkedIn ${summary.withoutDomain === 1 ? 'company has' : 'companies have'} no matching domain yet, so email outreach and meetings can't be joined to ${summary.withoutDomain === 1 ? 'it' : 'them'}. Admins can map them in Data health.`
        : undefined}
    >
      <DataTable
        columns={companyColumns()}
        rows={rows}
        rowKey={r => r.key}
        searchable
        searchPlaceholder="Search companies"
        exportName={`${slug}-companies`}
        empty="No companies match these filters."
        toolbar={(
          <>
            <div className="segmented" role="group" aria-label="Channels">
              {COVERAGE.map(([value, label]) => (
                <button key={value} type="button" aria-pressed={coverage === value} onClick={() => setCoverage(value)}>
                  {label} {fmtInt(counts[value])}
                </button>
              ))}
            </div>
            <label className="check">
              <input type="checkbox" checked={inRange} onChange={e => setInRange(e.target.checked)} />
              Touched {periodPhrase(range)}
            </label>
          </>
        )}
      />
    </Card>
  );
}

export default function ProgramDetailView({ slug }) {
  const { apiParams, values, get, setParams } = useFilters();
  const withFilters = useLinkWithFilters();
  const teamColor = useTeamColor();
  const programName = useProgramName();
  const since = get('since');
  const params = useMemo(() => {
    const { program, ...rest } = apiParams;
    return since ? { ...rest, since } : rest;
  }, [apiParams, since]);
  const { data, error, loading, refreshing, reload } = useApi(`/api/metrics/programs/${slug}`, params);
  const grain = values.grain || data?.range?.grain || 'week';

  const program = data?.program;
  const funnel = data?.funnel;
  const summary = data?.companySummary;
  const linkedin = data?.linkedin;
  const hasLinkedin = linkedin?.people > 0;
  const stage = key => funnel?.leads.find(s => s.key === key)?.value ?? 0;
  const empty = data && data.campaigns.length === 0;

  const sdrColumns = [
    {
      key: 'sdr',
      label: 'SDR',
      sort: r => r.sdr,
      csv: r => r.sdr,
      render: r => (r.sdr === 'Unattributed'
        ? <span className="muted">Unattributed</span>
        : <Person name={r.sdr} color={teamColor(r.sdr)} href={withFilters(sdrHref(r.sdr))} size={22} />),
    },
    { key: 'leadsContacted', label: 'Email contacted', align: 'right', csv: r => r.leadsContacted, render: r => fmtInt(r.leadsContacted) },
    { key: 'replied', label: 'Email replies', align: 'right', csv: r => r.replied, render: r => stack(fmtInt(r.replied), `${fmtInt(r.positive)} positive`) },
    { key: 'positiveRate', label: 'Email positive rate', align: 'right', sort: r => (r.lowSample ? -1 : r.positiveRate), csv: r => r.positiveRate, render: r => rateCell(r.positiveRate, r.lowSample) },
    hasLinkedin && { key: 'linkedinInvited', label: 'LinkedIn invited', align: 'right', csv: r => r.linkedinInvited, render: r => stack(fmtInt(r.linkedinInvited), `${fmtInt(r.linkedinAccepted)} accepted`) },
    hasLinkedin && { key: 'linkedinReplied', label: 'LinkedIn replies', align: 'right', csv: r => r.linkedinReplied, render: r => stack(fmtInt(r.linkedinReplied), `${fmtInt(r.linkedinPositive)} positive`) },
    { key: 'meetings', label: 'Meetings', align: 'right', csv: r => r.meetings, render: r => stack(fmtInt(r.meetings), `${fmtInt(r.held)} held`) },
  ].filter(Boolean);

  const linkedinFunnel = hasLinkedin ? [
    { key: 'people', label: 'People added', value: linkedin.people },
    { key: 'invited', label: 'Invited', value: linkedin.invited },
    { key: 'accepted', label: 'Accepted', value: linkedin.accepted },
    { key: 'replied', label: 'Replied', value: linkedin.replied },
    { key: 'positive', label: 'Positive', value: linkedin.positive },
  ] : [];

  return (
    <div className="page">
      <PageHeader
        back={{ href: withFilters('/programs'), label: 'All programs' }}
        title={program?.name || programName(slug)}
        description={program ? [program.poc && `Run by ${program.poc}.`, program.description].filter(Boolean).join(' ') : undefined}
        meta={<SyncStatus />}
      />
      <FilterBar range={data?.range} hide={['program']}>
        <label className="check">
          Since
          <input
            type="date"
            className="input"
            value={since || data?.since || ''}
            onChange={e => setParams({ since: e.target.value || null })}
          />
        </label>
      </FilterBar>
      {error && <ErrorState error={error} onRetry={reload} title={error.status === 404 ? `There is no ${slug} program` : undefined} />}
      {loading && <LoadingBlock />}

      {empty && (
        <EmptyState
          title="No campaigns in this program yet"
          action={<Link className="btn btn-small" href="/health">Open data health</Link>}
        >
          No campaign names since {fmtDate(data.since, { year: true })} match this program&apos;s rule ({program.matchPattern}). Include the program in new campaign names, or assign existing campaigns to it from Data health.
        </EmptyState>
      )}

      {data && !empty && (
        <div className={`page${refreshing ? ' is-refreshing' : ''}`}>
          <div className="tiles">
            <StatTile compact label="Companies reached" value={fmtInt(summary.total)} note={`${fmtInt(summary.both)} on email and LinkedIn`} />
            <StatTile compact label="Companies replied" value={fmtInt(summary.replied)} note={`${fmtInt(summary.positive)} with a positive reply`} />
            <StatTile compact label="With a meeting" value={fmtInt(summary.withMeeting)} note="Companies, after the first touch" />
            <StatTile compact label="Email contacted" value={fmtInt(stage('leadsContacted'))} note={`Leads, ${fmtInt(funnel.volume.emailsSent)} emails sent`} />
            {hasLinkedin && (
              <StatTile compact label="LinkedIn invited" value={fmtInt(linkedin.invited)} note={`People, ${fmtPct(linkedin.acceptanceRate)} accepted`} />
            )}
            <StatTile
              compact
              label="Positive replies"
              value={fmtInt(stage('positive') + (linkedin?.positive || 0))}
              note={hasLinkedin ? `${fmtInt(stage('positive'))} email, ${fmtInt(linkedin.positive)} LinkedIn` : `${fmtPct(funnel.rates.positiveRate)} of contacted`}
            />
            <StatTile compact label="Qualified pipeline" value={fmtMoney(funnel.rates.pipelineValue)} />
          </div>

          <CompaniesCard companies={data.companies} summary={summary} range={data.range} since={data.since} slug={slug} />

          <Card
            className="flush"
            title="Campaigns"
            subtitle={`Every email and LinkedIn campaign in this program since ${fmtDate(data.since, { year: true })}. Results cover each whole campaign; Sent in range is what went out in the selected dates.`}
          >
            <DataTable
              columns={campaignColumns({ teamColor, withFilters, programName, withProgram: false })}
              rows={data.campaigns}
              rowKey={r => r.id}
              searchable
              searchPlaceholder="Search campaigns or companies"
              exportName={`${slug}-campaigns`}
              initialSort={{ key: 'sent', dir: 'desc' }}
            />
          </Card>

          <div className="grid-2">
            <Card title="Email lead funnel" subtitle={`Every lead loaded since ${fmtDate(data.since, { year: true })}.`}>
              <Funnel stages={funnel.leads} />
            </Card>
            {hasLinkedin ? (
              <Card title="LinkedIn people funnel" subtitle={`Everyone added to a LinkedIn campaign since ${fmtDate(data.since, { year: true })}; each person counts once.`}>
                <Funnel stages={linkedinFunnel} />
              </Card>
            ) : (
              <Card title="Account funnel" subtitle="The email journey, counted by company.">
                <Funnel stages={funnel.accounts} />
              </Card>
            )}
          </div>

          <ChannelTrendCards rows={data.trend} grain={grain} linkedin={hasLinkedin} />

          <Card className="flush" title="By SDR" subtitle={`Everyone who ran campaigns in this program since ${fmtDate(data.since, { year: true })}.`}>
            <DataTable columns={sdrColumns} rows={data.bySdr} rowKey={r => r.sdr} dense exportName={`${slug}-by-sdr`} />
          </Card>

          <div className="grid-2">
            <Card className="flush" title="Meetings" subtitle="Meetings traced back to this program's email campaigns.">
              <DataTable
                columns={meetingColumns({ teamColor, withFilters }).filter(c => ['date', 'company', 'sdr', 'held', 'dealValue'].includes(c.key))}
                rows={data.meetings}
                rowKey={r => r.id}
                dense
                pageSize={10}
                empty="No meetings traced back to this program yet."
              />
            </Card>
            <Card title="Latest replies" subtitle="What people wrote back on email and LinkedIn, as classified.">
              <ReplyFeed replies={data.replies.slice(0, 10)} />
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
