'use client';

import { useTeamColor } from '@/lib/client/dashboard-context';
import { fmtDate, fmtInt, fmtPct, fmtPeriod } from '@/lib/client/format';
import { useApi } from '@/lib/client/use-api';
import { useFilters, useLinkWithFilters } from '@/lib/client/use-filters';
import BarChart from '../charts/BarChart';
import ChartTable from '../charts/ChartTable';
import LineChart from '../charts/LineChart';
import Card from '../ui/Card';
import DataTable from '../ui/DataTable';
import FilterBar from '../ui/FilterBar';
import PageHeader from '../ui/PageHeader';
import { Person } from '../ui/Person';
import StatTile from '../ui/StatTile';
import { ErrorState, LoadingBlock } from '../ui/States';
import { SERIES, SyncStatus, accountColumns, sdrHref } from './common';

const x = r => fmtPeriod('week', r.week);
const tip = r => fmtPeriod('week', r.week, { long: true });

export default function CoverageView() {
  const { apiParams } = useFilters();
  const withFilters = useLinkWithFilters();
  const teamColor = useTeamColor();
  const { data, error, loading, refreshing, reload } = useApi('/api/metrics/coverage', apiParams);

  const sum = key => (data?.bySdr || []).reduce((s, r) => s + (r[key] || 0), 0);
  const loaded = sum('accountsLoaded');
  const contacted = sum('accountsContacted');

  const loadedSeries = [{ key: 'accountsLoaded', label: 'Accounts loaded', color: SERIES[0] }];
  const outcomeSeries = [
    { key: 'accountsReplied', label: 'Replied', color: SERIES[0] },
    { key: 'accountsPositive', label: 'Positive reply', color: SERIES[1] },
    { key: 'accountsWithMeeting', label: 'Meeting', color: SERIES[2] },
  ];

  const sdrColumns = [
    {
      key: 'sdr',
      label: 'SDR',
      sort: r => r.sdr,
      csv: r => r.sdr,
      render: r => (r.sdr === 'Unattributed' ? <span className="muted">Unattributed</span> : <Person name={r.sdr} color={teamColor(r.sdr)} href={withFilters(sdrHref(r.sdr))} size={22} />),
    },
    { key: 'accountsLoaded', label: 'Accounts loaded', align: 'right', csv: r => r.accountsLoaded, render: r => fmtInt(r.accountsLoaded) },
    { key: 'leadsLoaded', label: 'Leads loaded', align: 'right', csv: r => r.leadsLoaded, render: r => fmtInt(r.leadsLoaded) },
    { key: 'accountsContacted', label: 'Contacted', align: 'right', csv: r => r.accountsContacted, render: r => <span className="cell-stack">{fmtInt(r.accountsContacted)}<span className="cell-sub">{fmtPct(r.contactRate, 0)}</span></span> },
    { key: 'accountsReplied', label: 'Replied', align: 'right', csv: r => r.accountsReplied, render: r => fmtInt(r.accountsReplied) },
    { key: 'accountsPositive', label: 'Positive', align: 'right', csv: r => r.accountsPositive, render: r => <span className="cell-stack">{fmtInt(r.accountsPositive)}<span className="cell-sub">{fmtPct(r.positiveAccountRate)}</span></span> },
    { key: 'accountsWithMeeting', label: 'Meeting', align: 'right', csv: r => r.accountsWithMeeting, render: r => <span className="cell-stack">{fmtInt(r.accountsWithMeeting)}<span className="cell-sub">{fmtPct(r.meetingAccountRate)}</span></span> },
  ];

  const reloadedColumns = [
    { key: 'domain', label: 'Account', csv: r => r.domain },
    { key: 'sdrs', label: 'Loaded now by', sort: r => (r.sdrs || []).join(', '), csv: r => (r.sdrs || []).join('; '), render: r => (r.sdrs || []).join(', ') || '–' },
    { key: 'prior_sdrs', label: 'Earlier by', sort: r => (r.prior_sdrs || []).join(', '), csv: r => (r.prior_sdrs || []).join('; '), render: r => (r.prior_sdrs || []).join(', ') || '–' },
    { key: 'last_loaded_at', label: 'Last earlier load', csv: r => r.last_loaded_at, render: r => <span className="nowrap">{fmtDate(r.last_loaded_at, { year: true })}</span> },
  ];

  const sharedColumns = [
    { key: 'domain', label: 'Account', csv: r => r.domain },
    { key: 'sdrs', label: 'SDRs', sort: r => r.sdrs.join(', '), csv: r => r.sdrs.join('; '), render: r => r.sdrs.join(', ') },
    { key: 'campaigns', label: 'Campaigns', align: 'right', csv: r => r.campaigns, render: r => fmtInt(r.campaigns) },
  ];

  return (
    <div className="page">
      <PageHeader
        title="Coverage"
        description="Which accounts were loaded into outreach, how far each one got, and where an account was loaded again or worked by two SDRs."
        meta={<SyncStatus />}
      />
      <FilterBar range={data?.range} showGrain={false} />
      {error && <ErrorState error={error} onRetry={reload} />}
      {loading && <LoadingBlock />}

      {data && (
        <div className={`page${refreshing ? ' is-refreshing' : ''}`}>
          <div className="tiles">
            <StatTile compact label="Accounts loaded" value={fmtInt(loaded)} note="Counted once per SDR" />
            <StatTile compact label="Contacted" value={fmtInt(contacted)} note={`${fmtPct(loaded ? (contacted / loaded) * 100 : null, 0)} of loaded`} />
            <StatTile compact label="With a positive reply" value={fmtInt(sum('accountsPositive'))} note={`${fmtPct(contacted ? (sum('accountsPositive') / contacted) * 100 : null)} of contacted`} />
            <StatTile compact label="With a meeting" value={fmtInt(sum('accountsWithMeeting'))} note="Within 180 days of loading" />
            <StatTile compact label="Loaded again" value={fmtInt(data.reloadedTotal)} note="30+ days after an earlier load" />
            <StatTile compact label="Worked by 2+ SDRs" value={fmtInt(data.sharedTotal)} />
          </div>

          <div className="grid-2">
            <Card
              title="Accounts loaded per week"
              subtitle="The last 12 weeks, by the week leads were loaded into Instantly."
              table={() => <ChartTable rows={data.weekly} x={tip} xLabel="Week" series={[...loadedSeries, { key: 'accountsContacted', label: 'Contacted' }, ...outcomeSeries]} />}
            >
              <BarChart data={data.weekly} x={x} tooltipLabel={tip} series={loadedSeries} label="Accounts loaded per week" />
            </Card>
            <Card
              title="How far each week's accounts got"
              subtitle="Accounts from each load week that replied, replied positively or took a meeting. Recent weeks are still maturing."
              table={() => <ChartTable rows={data.weekly} x={tip} xLabel="Week" series={outcomeSeries} />}
            >
              <LineChart data={data.weekly} x={x} tooltipLabel={tip} series={outcomeSeries} label="Outcomes by load week" />
            </Card>
          </div>

          <Card className="flush" title="By SDR" subtitle={data.basis}>
            <DataTable columns={sdrColumns} rows={data.bySdr} rowKey={r => r.sdr} dense exportName="coverage-by-sdr" />
          </Card>

          <Card className="flush" title="Accounts" subtitle="Up to 300 accounts loaded in this range, meetings and positive replies first.">
            <DataTable columns={accountColumns()} rows={data.accounts} rowKey={r => r.domain} searchable searchPlaceholder="Search accounts" exportName="coverage-accounts" />
          </Card>

          <div className="grid-2">
            <Card
              className="flush"
              title="Loaded again"
              subtitle={`Accounts in this range that were already loaded more than 30 days before.${data.reloadedTotal > data.reloadedAccounts.length ? ` Showing the latest ${fmtInt(data.reloadedAccounts.length)} of ${fmtInt(data.reloadedTotal)}.` : ''}`}
            >
              <DataTable columns={reloadedColumns} rows={data.reloadedAccounts} rowKey={r => r.domain} dense pageSize={10} empty="No account was loaded again." exportName="reloaded-accounts" />
            </Card>
            <Card className="flush" title="Worked by more than one SDR" subtitle="The same account loaded by different SDRs in this range.">
              <DataTable columns={sharedColumns} rows={data.sharedAccounts} rowKey={r => r.domain} dense pageSize={10} empty="No overlaps between SDRs." exportName="shared-accounts" />
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
