'use client';

import { useMemo, useState } from 'react';
import { fmtInt, fmtPeriod } from '@/lib/client/format';
import { useApi } from '@/lib/client/use-api';
import { useFilters } from '@/lib/client/use-filters';
import { isoDay, periodEnd } from '@/lib/outreach/dates';
import Card from '../ui/Card';
import CountButton from '../ui/CountButton';
import DataTable from '../ui/DataTable';
import Delta from '../ui/Delta';
import { ErrorState, LoadingBlock } from '../ui/States';
import { pctChange } from './common';
import { DEFS } from './definitions';

/**
 * Each channel's funnel in reading order. `board` marks the numbers the SDR page's
 * table and charts show (Ayush, 2026-11-06: the SDR output sheet's columns, with
 * both email counts); the Overview compares them all.
 */
export const FUNNEL = {
  email: [
    { key: 'emailsSent', label: 'Total emails', note: 'all steps', hint: DEFS.emailsSent, board: true },
    { key: 'firstEmails', label: 'First emails', note: 'step 1 only', hint: DEFS.firstEmails, board: true },
    { key: 'emailReplies', label: 'Replies', hint: DEFS.replied },
    { key: 'emailPositive', label: 'Positive responses', hint: DEFS.positive, board: true, outcome: 'positive' },
    { key: 'emailMeetings', label: 'Meetings booked', hint: DEFS.meetingsEmail, board: true, outcome: 'meetings' },
  ],
  linkedin: [
    { key: 'invitesSent', label: 'Invites sent', hint: DEFS.invites, board: true },
    { key: 'invitesAccepted', label: 'Invites accepted', hint: DEFS.accepted, board: true },
    { key: 'firstMessages', label: 'First messages', hint: DEFS.firstMessages },
    { key: 'linkedinReplies', label: 'Replies', hint: DEFS.replied },
    { key: 'linkedinPositive', label: 'Positive responses', hint: DEFS.positive, board: true, outcome: 'positive' },
    { key: 'linkedinMeetings', label: 'Meetings booked', hint: DEFS.meetingsLinkedin, board: true, outcome: 'meetings' },
  ],
};

/** A metric with what it counts in brackets, where the name alone could be misread. */
export const metricLabel = m => (m.note ? `${m.label} (${m.note})` : m.label);

/** The first and last day of a period, for opening the names behind it. */
export const periodDates = (grain, period) => ({ from: period, to: isoDay(periodEnd(grain, period)) });

export const COMPARISONS = [
  { key: 'day', label: 'DoD', title: 'day on day', last: 'the last two full working days', unit: 'working days' },
  { key: 'week', label: 'WoW', title: 'week on week', last: 'the last two full weeks', unit: 'weeks' },
  { key: 'month', label: 'MoM', title: 'month on month', last: 'the last two full months', unit: 'months' },
];

/** DoD, WoW or MoM. */
export function ComparisonButtons({ value, onChange }) {
  return (
    <div className="segmented" role="group" aria-label="Compare by">
      {COMPARISONS.map(c => (
        <button key={c.key} type="button" aria-pressed={value === c.key} title={`Compare ${c.title}`} onClick={() => onChange(c.key)}>
          {c.label}
        </button>
      ))}
    </div>
  );
}

/** "Week of 26 Oct against week of 19 Oct, the last two full weeks." */
export function comparedPhrase(grain, periods) {
  const [previous, current] = periods.slice(-2);
  if (!previous) return 'There are not two full periods to compare yet.';
  const name = period => fmtPeriod(grain, period, { long: true });
  const { last } = COMPARISONS.find(c => c.key === grain);
  return `${name(current)} against ${name(previous).replace('Week', 'week')}, ${last}.`;
}

const noMeetingCampaign = n => `${fmtInt(n)} ${n === 1 ? 'meeting' : 'meetings'} SDRs booked had no campaign behind ${n === 1 ? 'it' : 'them'}, so neither channel counts ${n === 1 ? 'it' : 'them'} here.`;

function ComparisonTable({ channel, grain, periods, previous, current, who, openOutcomes }) {
  const heading = period => fmtPeriod(grain, period, { long: true });
  const [before, latest] = periods.slice(-2);
  const channelName = channel === 'email' ? 'Email' : 'LinkedIn';
  const count = (r, numbers, period) => {
    if (!r.outcome || !openOutcomes) return fmtInt(numbers[r.key]);
    const title = `${r.label}: ${channelName}, ${heading(period)}`;
    return (
      <CountButton
        value={numbers[r.key]}
        label={`See who: ${title}`}
        onClick={() => openOutcomes({ kind: r.outcome, channel, ...who, ...periodDates(grain, period), title })}
      />
    );
  };
  const columns = [
    { key: 'label', label: 'Metric', sortable: false, render: r => <span className="dt-hint" title={r.hint}>{metricLabel(r)}</span> },
    { key: 'current', label: heading(latest), align: 'right', sortable: false, render: r => count(r, current, latest) },
    { key: 'previous', label: heading(before), align: 'right', sortable: false, render: r => count(r, previous, before) },
    { key: 'change', label: 'Change', align: 'right', sortable: false, render: r => <Delta small change={pctChange(current[r.key], previous[r.key])} /> },
  ];
  return (
    <Card className="flush" title={channelName}>
      <DataTable columns={columns} rows={FUNNEL[channel]} rowKey={r => r.key} dense />
    </Card>
  );
}

/** The channels' funnels, compared across the last two full days, weeks or months. It follows the channel and the who-filters, never the date range. */
export function OverviewComparison({ channel, openOutcomes }) {
  const { apiParams } = useFilters();
  const [grain, setGrain] = useState('week');
  const params = useMemo(() => {
    const { range, from, to, ...rest } = apiParams;
    return { ...rest, grain, count: 2 };
  }, [apiParams, grain]);
  const { data, error, loading, refreshing, reload } = useApi('/api/metrics/funnel', params);
  const channels = channel === 'both' ? ['email', 'linkedin'] : [channel];
  const who = { sdr: apiParams.sdr, program: apiParams.program, theme: apiParams.theme };
  // The last answer stays on screen, dimmed, until the next one arrives.
  const ready = data?.periods.length === 2;
  const unplaced = ready ? data.everyone[0].unplacedMeetings + data.everyone[1].unplacedMeetings : 0;

  return (
    <section className={refreshing ? 'is-refreshing' : undefined} aria-label="Day, week and month comparison">
      <div className="section-header">
        <div>
          <h2 className="section-title">Day, week and month comparison</h2>
          <p className="card-sub">{data ? comparedPhrase(data.grain, data.periods) : 'Last full periods only.'} {DEFS.compareDates}</p>
        </div>
        <ComparisonButtons value={grain} onChange={setGrain} />
      </div>
      {error && <ErrorState error={error} onRetry={reload} />}
      {loading && <LoadingBlock />}
      {ready && (
        <div className={channels.length === 2 ? 'grid-2' : undefined}>
          {channels.map(c => (
            <ComparisonTable key={c} channel={c} grain={data.grain} periods={data.periods} previous={data.everyone[0]} current={data.everyone[1]} who={who} openOutcomes={openOutcomes} />
          ))}
        </div>
      )}
      {unplaced > 0 && <p className="card-sub funnel-note">Across these two periods, {noMeetingCampaign(unplaced)}</p>}
    </section>
  );
}
