'use client';

import { fmtInt, fmtPct } from '@/lib/client/format';
import { useApi } from '@/lib/client/use-api';
import { useFilters, useLinkWithFilters } from '@/lib/client/use-filters';
import HBarList from '../charts/HBarList';
import Card from '../ui/Card';
import DataTable from '../ui/DataTable';
import Delta from '../ui/Delta';
import FilterBar from '../ui/FilterBar';
import PageHeader from '../ui/PageHeader';
import { Person } from '../ui/Person';
import { ErrorState, LoadingBlock } from '../ui/States';
import WarningsBanner from '../ui/WarningsBanner';
import { SyncStatus, sdrHref, withDelta } from './common';

export default function SdrsView() {
  const { apiParams } = useFilters();
  const withFilters = useLinkWithFilters();
  const { data, error, loading, refreshing, reload } = useApi('/api/metrics/sdrs', apiParams);
  const sdrs = data?.sdrs || [];

  const byRate = sdrs
    .filter(s => s.leadsContacted > 0)
    .sort((a, b) => (a.lowSample - b.lowSample) || ((b.positiveRate ?? 0) - (a.positiveRate ?? 0)));
  const byMeetings = sdrs.filter(s => s.meetings > 0).sort((a, b) => b.meetings - a.meetings);

  const columns = [
    { key: 'name', label: 'SDR', sort: r => r.name, csv: r => r.name, render: r => <Person name={r.name} color={r.color} href={withFilters(sdrHref(r.name))} size={24} /> },
    { key: 'activeCampaigns', label: 'Campaigns', align: 'right', csv: r => r.activeCampaigns, render: r => fmtInt(r.activeCampaigns) },
    { key: 'accountsLoaded', label: 'Accounts loaded', align: 'right', csv: r => r.accountsLoaded, render: r => fmtInt(r.accountsLoaded) },
    { key: 'leadsContacted', label: 'Leads contacted', align: 'right', csv: r => r.leadsContacted, render: r => withDelta(r.leadsContacted, r.change.leadsContacted) },
    { key: 'replies', label: 'Replies', align: 'right', csv: r => r.replies, render: r => withDelta(r.replies, r.change.replies) },
    { key: 'positive', label: 'Positive', align: 'right', csv: r => r.positive, render: r => withDelta(r.positive, r.change.positive) },
    {
      key: 'positiveRate',
      label: 'Positive rate',
      align: 'right',
      sort: r => (r.lowSample ? -1 : r.positiveRate),
      csv: r => r.positiveRate,
      render: r => (
        <span className="cell-stack">
          {fmtPct(r.positiveRate)}
          {r.lowSample ? <span className="cell-sub">small sample</span> : <Delta small points={r.change.positiveRate} />}
        </span>
      ),
    },
    { key: 'meetings', label: 'Meetings', align: 'right', csv: r => r.meetings, render: r => withDelta(r.meetings, r.change.meetings) },
    { key: 'meetingsHeld', label: 'Held', align: 'right', csv: r => r.meetingsHeld, render: r => fmtInt(r.meetingsHeld) },
    { key: 'bounceRate', label: 'Bounce rate', align: 'right', csv: r => r.bounceRate, render: r => fmtPct(r.bounceRate) },
  ];

  return (
    <div className="page">
      <PageHeader
        title="SDRs"
        description="Everyone running outreach, side by side. Rates are per lead contacted, and anyone under 100 contacted leads is flagged as a small sample."
        meta={<SyncStatus />}
      />
      <FilterBar range={data?.range} hide={['sdr']} />
      <WarningsBanner />
      {error && <ErrorState error={error} onRetry={reload} />}
      {loading && <LoadingBlock />}

      {data && (
        <div className={`page${refreshing ? ' is-refreshing' : ''}`}>
          <div className="grid-2">
            <Card title="Positive rate" subtitle="Positive replies per lead contacted in this range.">
              <HBarList
                rows={byRate}
                label="name"
                value="positiveRate"
                format={v => fmtPct(v)}
                detail={r => `${fmtInt(r.positive)} of ${fmtInt(r.leadsContacted)}`}
                href={r => withFilters(sdrHref(r.name))}
                emphasis
                limit={12}
              />
            </Card>
            <Card title="Outbound meetings" subtitle="By meeting date, credited to the SDR named in the sheet or the campaign that reached the company.">
              <HBarList
                rows={byMeetings}
                label="name"
                value="meetings"
                detail={r => `${fmtInt(r.meetingsHeld)} held`}
                href={r => withFilters(sdrHref(r.name))}
                limit={12}
                emptyText="No outbound meetings in this range."
              />
            </Card>
          </div>

          <Card
            className="flush"
            title="Leaderboard"
            subtitle="Changes compare with the previous range; email volumes are pro-rated while a range is still running."
            footnote={data.unattributed ? `${fmtInt(data.unattributed.meetings)} outbound meetings and ${fmtInt(data.unattributed.replies)} replies in this range aren't tied to an SDR.` : undefined}
          >
            <DataTable columns={columns} rows={sdrs} rowKey={r => r.name} exportName="sdr-leaderboard" initialSort={{ key: 'positive', dir: 'desc' }} />
          </Card>
        </div>
      )}
    </div>
  );
}
