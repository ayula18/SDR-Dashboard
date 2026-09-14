'use client';

import { useMemo } from 'react';
import { useTeamColor } from '@/lib/client/dashboard-context';
import { fmtInt, fmtPct } from '@/lib/client/format';
import { useApi } from '@/lib/client/use-api';
import { useFilters, useLinkWithFilters } from '@/lib/client/use-filters';
import HBarList from '../charts/HBarList';
import Card from '../ui/Card';
import DataTable from '../ui/DataTable';
import FilterBar from '../ui/FilterBar';
import PageHeader from '../ui/PageHeader';
import { Avatar } from '../ui/Person';
import { ErrorState, LoadingBlock } from '../ui/States';
import {
  KpiTiles, SyncStatus, TrendCards, campaignColumns, meetingColumns, useProgramName,
} from './common';

export default function SdrDetailView({ name }) {
  const { apiParams, values } = useFilters();
  const withFilters = useLinkWithFilters();
  const teamColor = useTeamColor();
  const programName = useProgramName();
  const params = useMemo(() => {
    const { sdr, ...rest } = apiParams;
    return rest;
  }, [apiParams]);
  const { data, error, loading, refreshing, reload } = useApi(`/api/metrics/sdrs/${encodeURIComponent(name)}`, params);
  const grain = values.grain || data?.range?.grain || 'week';
  const works = data?.whatWorks;
  const rateDetail = r => `${fmtInt(r.positive)} of ${fmtInt(r.contacted)}`;

  return (
    <div className="page">
      <PageHeader
        back={{ href: withFilters('/sdrs'), label: 'All SDRs' }}
        title={<><Avatar name={name} color={teamColor(name)} size={32} />{name}</>}
        description={`Outreach, what works and meetings for ${name}.`}
        meta={<SyncStatus />}
      />
      <FilterBar range={data?.range} hide={['sdr']} />
      {error && <ErrorState error={error} onRetry={reload} title={error.status === 404 ? `No team member called ${name}` : undefined} />}
      {loading && <LoadingBlock />}

      {data && (
        <div className={`page${refreshing ? ' is-refreshing' : ''}`}>
          <KpiTiles kpis={data.kpis} />
          <TrendCards rows={data.trend} grain={grain} />

          <Card title={`What works for ${name}`} subtitle={works.basis}>
            <div className="grid-3">
              <div>
                <h3 className="card-sub" style={{ marginBottom: 8 }}>By message angle</h3>
                <HBarList rows={works.byTheme} label="theme" value="positiveRate" format={v => fmtPct(v)} detail={rateDetail} emphasis />
              </div>
              <div>
                <h3 className="card-sub" style={{ marginBottom: 8 }}>By program</h3>
                <HBarList rows={works.byProgram} label={r => (r.program === 'none' ? 'No program' : programName(r.program))} value="positiveRate" format={v => fmtPct(v)} detail={rateDetail} emphasis />
              </div>
              <div>
                <h3 className="card-sub" style={{ marginBottom: 8 }}>By company type</h3>
                <HBarList rows={works.byCompanyType} label="companyType" value="positiveRate" format={v => fmtPct(v)} detail={rateDetail} emphasis />
              </div>
            </div>
          </Card>

          <Card title="Which email gets the reply" subtitle="Positive replies by the sequence step people answered.">
            <HBarList
              rows={works.steps.filter(s => s.replied > 0 || s.sent > 0)}
              label={r => `Step ${r.step}`}
              value="positive"
              detail={r => `${fmtPct(r.stepReplyRate)} reply rate on ${fmtInt(r.sent)} sends`}
              emptyText="No replies with a known step in this range."
            />
          </Card>

          <Card className="flush" title="Campaigns" subtitle="Campaigns with activity in this range.">
            <DataTable
              columns={campaignColumns({ teamColor, withFilters, programName, withSdr: false })}
              rows={data.campaigns}
              rowKey={r => r.id}
              searchable
              searchPlaceholder="Search campaigns"
              exportName={`${name}-campaigns`}
              initialSort={{ key: 'sent', dir: 'desc' }}
            />
          </Card>

          <Card className="flush" title="Meetings" subtitle="Meetings credited to this SDR in this range.">
            <DataTable
              columns={meetingColumns({ teamColor, withFilters, withSdr: false })}
              rows={data.meetingsList}
              rowKey={r => r.id}
              exportName={`${name}-meetings`}
              empty="No meetings credited in this range."
            />
          </Card>
        </div>
      )}
    </div>
  );
}
