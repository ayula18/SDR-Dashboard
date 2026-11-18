'use client';

import { useMemo } from 'react';
import { fmtDateRange, fmtInt } from '@/lib/client/format';
import { useApi } from '@/lib/client/use-api';
import { isoDay, weekStart } from '@/lib/outreach/dates';
import Card from '../ui/Card';
import DataTable from '../ui/DataTable';
import PageHeader from '../ui/PageHeader';
import { ErrorState, LoadingBlock } from '../ui/States';
import WarningsBanner from '../ui/WarningsBanner';
import { SyncStatus } from './common';
import { PageControls, usePageSettings } from './periods';

/** Whose outreach the "new" columns mean, in the words of the dates picked: a week reads as one. */
function outreachWord(range) {
  if (!range || range.preset === 'this-week') return "this week's";
  if (range.preset === 'last-week') return "last week's";
  if (range.preset === 'yesterday') return "yesterday's";
  if (isoDay(weekStart(range.from)) === isoDay(weekStart(range.to))) return range.inProgress ? "this week's" : "that week's";
  return "these dates'";
}

/**
 * The columns, in reading order (Ayush, 2026-11-17: the 13 Nov SDR weekly report without
 * LinkedIn messages, calls added, meetings last; no segments, no calls connected): what went
 * out on each channel, then what came back, positives before meetings, each split by whether
 * the outreach began in the dates or before. Every heading's hint says how it is counted.
 */
function snapshotColumns(word) {
  const n = (key, label, hint) => ({
    key,
    label,
    hint,
    align: 'right',
    sortable: false,
    csv: r => r[key],
    render: r => (r.total ? <strong>{fmtInt(r[key])}</strong> : fmtInt(r[key])),
  });
  return [
    { key: 'person', label: 'SDR', sortable: false, csv: r => r.person, render: r => (r.total ? <strong>{r.person}</strong> : r.person) },
    n('emails', 'Emails sent', 'First emails (step 1 only), one per person, as Instantly counts new leads contacted'),
    n('invites', 'LinkedIn invites sent', "HeyReach's own count, as every page shows it"),
    n('callsMade', 'Calls made', 'Every call dialed on Nooks'),
    n('conversations', 'Conversations (60+ s)', 'Calls connected that stayed on the line 60 seconds or more'),
    n('positiveNew', `Positive replies | ${word} outreach`, 'Positive replies that came in these dates from companies first reached in these dates. A call positive counts here unless the company was emailed or invited before'),
    n('positiveOld', 'Positive replies | old outreach', 'Positive replies that came in these dates from companies reached before them'),
    n('meetingsNew', `Meetings booked | ${word} outreach`, 'Meetings booked in these dates at companies first reached in these dates. A call meeting counts here unless the company was emailed or invited before'),
    n('meetingsOld', 'Meetings booked | old outreach', 'Meetings booked in these dates at companies reached before them'),
  ];
}

// A line above the total, as the sheet's gap.
const TOTAL_EDGE = 'inset 0 2px 0 var(--border)';

/** Snapshot View: one table, a row per person and segment, for the dates picked (this week so far by default). */
export default function SnapshotView() {
  const settings = usePageSettings('week');
  const query = useMemo(() => ({
    ...(settings.sdr ? { sdr: settings.sdr } : {}),
    ...(settings.dates.from ? { from: settings.dates.from, to: settings.dates.to } : settings.dates.range ? { range: settings.dates.range } : {}),
  }), [settings.sdr, settings.dates.from, settings.dates.to, settings.dates.range]);
  const { data, error, loading, refreshing, reload } = useApi('/api/metrics/snapshot', query);

  const columns = useMemo(() => {
    const cols = snapshotColumns(outreachWord(data?.range));
    return cols.map(c => ({
      ...c,
      cellStyle: r => (r.total ? { boxShadow: TOTAL_EDGE } : undefined),
    }));
  }, [data?.range]);
  const rows = data?.rows || [];

  return (
    <div className="page">
      <PageHeader
        title="Snapshot View"
        description="For each SDR and caller: what went out in the dates, and what came back, from that outreach or from older outreach."
        meta={<SyncStatus />}
      />
      <PageControls settings={settings} withGrain={false} emptyLabel="This week so far" />
      <WarningsBanner />
      <Card
        className={`flush${refreshing ? ' is-refreshing' : ''}`}
        title={data ? fmtDateRange(data.range.from, data.range.to) + (data.range.inProgress ? ' so far' : '') : 'Snapshot'}
        subtitle={data ? `${fmtInt(data.people.length)} people, then everyone together. Hover a heading for how it is counted.` : null}
        footnote={data && 'New or old outreach goes by when the credited person first reached that company, by email or LinkedIn; a call result is new unless the company was emailed or invited before. Meetings count on the day they were booked.'}
      >
        {error && <ErrorState error={error} onRetry={reload} />}
        {loading && <LoadingBlock />}
        {data && (
          <div className="period-table">
            <DataTable columns={columns} rows={rows} rowKey={r => r.person} pageSize={1000} exportName="snapshot" />
          </div>
        )}
      </Card>
    </div>
  );
}
