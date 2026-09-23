'use client';

import { useTeamColor } from '@/lib/client/dashboard-context';
import { fmtInt, fmtMoney, fmtPct, fmtPeriod } from '@/lib/client/format';
import { useApi } from '@/lib/client/use-api';
import { useFilters, useLinkWithFilters } from '@/lib/client/use-filters';
import BarChart from '../charts/BarChart';
import ChartTable from '../charts/ChartTable';
import HBarList from '../charts/HBarList';
import Card from '../ui/Card';
import DataTable from '../ui/DataTable';
import FilterBar from '../ui/FilterBar';
import PageHeader from '../ui/PageHeader';
import StatTile from '../ui/StatTile';
import { ErrorState, LoadingBlock } from '../ui/States';
import { SERIES, SyncStatus, meetingColumns, sdrHref, useProgramName } from './common';

const SIZE_ORDER = ['1-10', '11-25', '26-50', '51-100', '101-200', '201-500', '501+', 'Unknown'];

function MeetingBars({ title, subtitle, rows, label, href }) {
  return (
    <Card title={title} subtitle={subtitle}>
      <HBarList rows={rows} label={label} value="meetings" detail={r => `${fmtPct(r.heldRate, 0)} held`} href={href} emptyText="No meetings in this range." />
    </Card>
  );
}

export default function MeetingsView() {
  const { apiParams, values, get, setParams } = useFilters();
  const withFilters = useLinkWithFilters();
  const teamColor = useTeamColor();
  const programName = useProgramName();
  const channel = get('channel');
  const { data, error, loading, refreshing, reload } = useApi('/api/metrics/meetings', { ...apiParams, channel });
  const grain = data?.range?.grain || values.grain || 'week';
  const totals = data?.totals;
  const channels = data?.channels || (channel ? [channel] : []);
  const series = [
    { key: 'meetings', label: 'Meetings', color: SERIES[0] },
    { key: 'held', label: 'Held', color: SERIES[1] },
  ];
  const x = r => fmtPeriod(grain, r.period);
  const tip = r => fmtPeriod(grain, r.period, { long: true });

  return (
    <div className="page">
      <PageHeader
        title="Meetings"
        description="Every meeting booked, by the date it was held, inbound, referral and ads included, with the SDR and campaign it's credited to. Bookings come from the Slack alert the day they happen; the audit sheet adds qualified and deal value."
        meta={<SyncStatus />}
      />
      <FilterBar range={data?.range}>
        <select aria-label="Meeting channel" className="select-trigger" value={channel} onChange={e => setParams({ channel: e.target.value })}>
          <option value="">All channels</option>
          {channels.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </FilterBar>
      {error && <ErrorState error={error} onRetry={reload} />}
      {loading && <LoadingBlock />}

      {data && (
        <div className={`page${refreshing ? ' is-refreshing' : ''}`}>
          <div className="tiles">
            <StatTile label="Meetings" value={fmtInt(totals.meetings)} change={totals.change.meetings} previous={fmtInt(totals.previous.meetings)} />
            <StatTile label="Held" value={fmtInt(totals.held)} change={totals.change.held} note={`${fmtPct(totals.heldRate)} of meetings`} />
            <StatTile label="Qualified" value={fmtInt(totals.qualified)} change={totals.change.qualified} />
            <StatTile
              label="Qualified pipeline"
              value={fmtMoney(totals.pipelineValue)}
              change={totals.change.pipelineValue}
              note={totals.avgDealValue ? `${fmtMoney(totals.avgDealValue)} average deal` : undefined}
            />
            <StatTile label="Senior champion" value={fmtPct(totals.seniorChampionRate)} note={`${fmtInt(totals.seniorChampion)} meetings`} />
            <StatTile label="Not confirmed yet" value={fmtInt(totals.pendingReview)} note={`${fmtInt(totals.noShow)} no-shows`} />
          </div>

          <Card
            title={`Meetings per ${grain === 'month' ? 'month' : 'week'}`}
            subtitle="The last 12 periods, all channels in the filter."
            table={() => <ChartTable rows={data.trend} x={tip} xLabel={grain === 'month' ? 'Month' : 'Week'} series={series} />}
          >
            <BarChart data={data.trend} x={x} tooltipLabel={tip} series={series} label="Meetings per period" />
          </Card>

          <div className="grid-3">
            <MeetingBars title="Channel" rows={data.byChannel} label="key" />
            <MeetingBars
              title="SDR"
              subtitle="Named in the sheet, or the SDR whose campaign reached the company."
              rows={data.bySdr}
              label="key"
              href={r => (r.key === 'Unattributed' ? undefined : withFilters(sdrHref(r.key)))}
            />
            <MeetingBars title="Program" rows={data.byProgram} label={r => (r.key === 'none' ? 'No program' : programName(r.key))} />
            <MeetingBars title="Segment" rows={data.bySegment} label="key" />
            <MeetingBars
              title="Company size"
              rows={[...data.byEmployees].sort((a, b) => SIZE_ORDER.indexOf(a.key) - SIZE_ORDER.indexOf(b.key))}
              label="key"
            />
            <MeetingBars title="Open source" rows={data.byOssType} label="key" />
          </div>

          <Card className="flush" title="All meetings" subtitle="Most recent first.">
            <DataTable
              columns={meetingColumns({ teamColor, withFilters })}
              rows={data.meetings}
              rowKey={r => r.id}
              searchable
              searchPlaceholder="Search companies, channels, SDRs"
              exportName="meetings"
              pageSize={50}
            />
          </Card>
        </div>
      )}
    </div>
  );
}
