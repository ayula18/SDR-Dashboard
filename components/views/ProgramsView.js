'use client';

import Link from 'next/link';
import { useTeamColor } from '@/lib/client/dashboard-context';
import { fmtDate, fmtInt } from '@/lib/client/format';
import { useApi } from '@/lib/client/use-api';
import { useFilters, useLinkWithFilters } from '@/lib/client/use-filters';
import Funnel from '../charts/Funnel';
import Card from '../ui/Card';
import FilterBar from '../ui/FilterBar';
import PageHeader from '../ui/PageHeader';
import { Person } from '../ui/Person';
import { EmptyState, ErrorState, LoadingBlock } from '../ui/States';
import WarningsBanner from '../ui/WarningsBanner';
import { MiniStat, SyncStatus, programHref } from './common';

function ProgramCard({ program: p, since, href, teamColor }) {
  const invites = p.funnel.volume.linkedinInvitesSent > 0;
  return (
    <Card
      className="program-card"
      title={<Link href={href}>{p.name}</Link>}
      subtitle={[p.poc && `Run by ${p.poc}.`, p.description].filter(Boolean).join(' ')}
      actions={<Link className="btn btn-small" href={href}>Open</Link>}
    >
      {p.campaigns === 0 ? (
        <EmptyState inline title="No campaigns yet">
          No campaign names have matched this program since {fmtDate(since, { year: true })}. Name new campaigns so they mention it, or assign campaigns from Data health.
        </EmptyState>
      ) : (
        <>
          <div className="mini-stats">
            <MiniStat label="Emails sent" value={fmtInt(p.period.emailsSent)} change={p.change.emailsSent} />
            <MiniStat label="Leads contacted" value={fmtInt(p.period.leadsContacted)} change={p.change.leadsContacted} />
            {invites
              ? <MiniStat label="LinkedIn invites" value={fmtInt(p.period.linkedinInvitesSent)} change={p.change.linkedinInvitesSent} />
              : <MiniStat label="Replies" value={fmtInt(p.period.replies)} change={p.change.replies} />}
            <MiniStat label="Positive replies" value={fmtInt(p.period.positive)} change={p.change.positive} />
            <MiniStat label="Meetings" value={fmtInt(p.period.meetings)} change={p.change.meetings} />
            <MiniStat label="Campaigns" value={fmtInt(p.campaigns)} sub={`${fmtInt(p.activeCampaigns)} active`} />
          </div>
          <div>
            <h3 className="subhead">All leads since {fmtDate(since, { year: true })}</h3>
            <Funnel stages={p.funnel.leads} compact />
          </div>
          {p.sdrs.length > 0 && (
            <div className="badges">
              {p.sdrs.map(name => <Person key={name} name={name} color={teamColor(name)} size={20} />)}
            </div>
          )}
        </>
      )}
    </Card>
  );
}

export default function ProgramsView() {
  const { apiParams } = useFilters();
  const withFilters = useLinkWithFilters();
  const teamColor = useTeamColor();
  const { data, error, loading, refreshing, reload } = useApi('/api/metrics/programs', apiParams);

  return (
    <div className="page">
      <PageHeader
        title="Programs"
        description="Specialised outreach, each with its full funnel and how the selected range compares with the one before. Campaigns join a program by name."
        meta={<SyncStatus />}
      />
      <FilterBar range={data?.range} hide={['program']} showGrain={false} />
      <WarningsBanner />
      {error && <ErrorState error={error} onRetry={reload} />}
      {loading && <LoadingBlock />}

      {data && (
        <div className={`program-grid${refreshing ? ' is-refreshing' : ''}`}>
          {data.programs.map(p => (
            <ProgramCard key={p.slug} program={p} since={data.since} href={withFilters(programHref(p.slug))} teamColor={teamColor} />
          ))}
        </div>
      )}
    </div>
  );
}
