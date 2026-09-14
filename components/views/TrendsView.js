'use client';

import { fmtInt, fmtPct, fmtPeriod } from '@/lib/client/format';
import { useApi } from '@/lib/client/use-api';
import { useFilters } from '@/lib/client/use-filters';
import BarChart from '../charts/BarChart';
import ChartTable from '../charts/ChartTable';
import LineChart from '../charts/LineChart';
import Card from '../ui/Card';
import DataTable from '../ui/DataTable';
import FilterBar from '../ui/FilterBar';
import PageHeader from '../ui/PageHeader';
import StatTile from '../ui/StatTile';
import { ErrorState, LoadingBlock } from '../ui/States';
import WarningsBanner from '../ui/WarningsBanner';
import { SERIES, SyncStatus } from './common';

const METRICS = [
  ['leadsContacted', 'Leads contacted'],
  ['sent', 'Emails sent'],
  ['replies', 'Replies'],
  ['positive', 'Positive replies'],
  ['negative', 'Negative replies'],
  ['meetings', 'Meetings'],
  ['meetingsHeld', 'Meetings held'],
  ['qualified', 'Qualified'],
  ['leadsLoaded', 'Leads loaded'],
  ['accountsLoaded', 'Accounts loaded'],
  ['linkedinMessagesSent', 'LinkedIn messages'],
  ['linkedinReplies', 'LinkedIn replies'],
];

export default function TrendsView() {
  const { apiParams, values, get, setParams } = useFilters();
  const count = get('count') || '12';
  const { data, error, loading, refreshing, reload } = useApi('/api/metrics/trends', { ...apiParams, count });
  const grain = data?.grain || values.grain || 'week';
  const unit = grain === 'month' ? 'month' : 'week';
  const rows = data?.rows || [];
  const x = row => fmtPeriod(grain, row.period);
  const tip = row => fmtPeriod(grain, row.period, { long: true });
  const xLabel = unit === 'month' ? 'Month' : 'Week';

  const complete = data?.inProgress ? rows.slice(0, -1) : rows;
  const current = complete[complete.length - 1];
  const previous = complete[complete.length - 2];
  const hasLinkedin = rows.some(r => r.linkedinMessagesSent || r.linkedinInvitesSent);
  const compared = [
    ['leadsContacted', 'Leads contacted'],
    ['sent', 'Emails sent'],
    ['replies', 'Replies'],
    ['positive', 'Positive replies'],
    ['meetings', 'Meetings'],
    ['meetingsHeld', 'Meetings held'],
    ...(hasLinkedin ? [['linkedinMessagesSent', 'LinkedIn messages']] : []),
  ];

  const series = {
    volume: [{ key: 'leadsContacted', label: 'Leads contacted', color: SERIES[0] }, { key: 'sent', label: 'Emails sent', color: SERIES[1] }],
    replies: [{ key: 'replies', label: 'Replies', color: SERIES[0] }, { key: 'positive', label: 'Positive replies', color: SERIES[1] }],
    meetings: [{ key: 'meetings', label: 'Meetings', color: SERIES[0] }, { key: 'meetingsHeld', label: 'Held', color: SERIES[1] }],
    linkedin: [{ key: 'linkedinMessagesSent', label: 'Messages sent', color: SERIES[0] }, { key: 'linkedinReplies', label: 'Replies', color: SERIES[1] }],
  };

  const columns = [
    { key: 'period', label: xLabel, sort: r => r.period, csv: r => r.period, render: r => <span className="nowrap">{tip(r)}</span> },
    ...METRICS.map(([key, label]) => ({ key, label, align: 'right', csv: r => r[key], render: r => fmtInt(r[key]) })),
    { key: 'positiveRate', label: 'Positive rate', align: 'right', csv: r => r.positiveRate, render: r => fmtPct(r.positiveRate) },
  ];

  return (
    <div className="page">
      <PageHeader
        title="Trends"
        description={`Every headline number ${unit} by ${unit}, and how the latest complete ${unit} compares with the one before.`}
        meta={<SyncStatus />}
      />
      <FilterBar range={data?.range}>
        <select aria-label="Periods shown" className="select-trigger" value={count} onChange={e => setParams({ count: e.target.value === '12' ? null : e.target.value })}>
          {[8, 12, 26, 52].map(n => <option key={n} value={n}>Last {n} {unit}s</option>)}
        </select>
      </FilterBar>
      <WarningsBanner />
      {error && <ErrorState error={error} onRetry={reload} />}
      {loading && <LoadingBlock />}

      {data && (
        <div className={`page${refreshing ? ' is-refreshing' : ''}`}>
          {current && previous && (
            <Card
              title={`${tip(current)} compared with ${fmtPeriod(grain, previous.period)}`}
              subtitle={data.inProgress ? `${tip(data.inProgress)} is still running, so it's left out of this comparison.` : undefined}
            >
              <div className="tiles">
                {compared.map(([key, label]) => (
                  <StatTile
                    key={key}
                    compact
                    label={label}
                    value={fmtInt(current[key])}
                    previous={fmtInt(previous[key])}
                    change={data.comparison?.metrics?.[key]?.change ?? null}
                  />
                ))}
              </div>
            </Card>
          )}

          <div className="grid-2">
            <Card title={`Outreach per ${unit}`} subtitle="From Instantly analytics." table={() => <ChartTable rows={rows} x={tip} xLabel={xLabel} series={series.volume} />}>
              <LineChart data={rows} x={x} tooltipLabel={tip} series={series.volume} label={`Outreach per ${unit}`} />
            </Card>
            <Card title={`Replies per ${unit}`} subtitle="Human replies, by the date they came in. Out-of-office replies are left out." table={() => <ChartTable rows={rows} x={tip} xLabel={xLabel} series={series.replies} />}>
              <LineChart data={rows} x={x} tooltipLabel={tip} series={series.replies} label={`Replies per ${unit}`} />
            </Card>
            <Card title={`Meetings per ${unit}`} subtitle="Outbound meetings from the audit sheet, by meeting date." table={() => <ChartTable rows={rows} x={tip} xLabel={xLabel} series={series.meetings} />}>
              <BarChart data={rows} x={x} tooltipLabel={tip} series={series.meetings} label={`Meetings per ${unit}`} />
            </Card>
            {hasLinkedin && (
              <Card title={`LinkedIn per ${unit}`} subtitle="HeyReach messages and replies." table={() => <ChartTable rows={rows} x={tip} xLabel={xLabel} series={series.linkedin} />}>
                <LineChart data={rows} x={x} tooltipLabel={tip} series={series.linkedin} label={`LinkedIn per ${unit}`} />
              </Card>
            )}
          </div>

          <Card className="flush" title="Every period" subtitle="The numbers behind the charts.">
            <DataTable columns={columns} rows={[...rows].reverse()} rowKey={r => r.period} exportName={`trends-by-${unit}`} dense pageSize={52} />
          </Card>
        </div>
      )}
    </div>
  );
}
