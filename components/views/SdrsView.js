'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import { fmtInt } from '@/lib/client/format';
import { useApi } from '@/lib/client/use-api';
import Card from '../ui/Card';
import CountButton from '../ui/CountButton';
import DataTable from '../ui/DataTable';
import PageHeader from '../ui/PageHeader';
import { ErrorState, LoadingBlock } from '../ui/States';
import WarningsBanner from '../ui/WarningsBanner';
import { SyncStatus } from './common';
import { CHANNEL_NAMES, fmtRate, metricLabel, rateFormulas } from './funnel';
import { useOutcomes } from './outcomes';
import {
  PEOPLE, PageControls, andList, channelMetrics, columnKinds, columnName, columnsPhrase, funnelQuery, heading, shadeScale,
  usePageSettings, useScrollToLatest,
} from './periods';

// A box per channel, Call first (Ayush, 2026-11-17: "a box below this for email and again
// one box for Li"), all three on the page's one set of controls.
const BOXES = ['call', 'email', 'linkedin'];
const sum = (rows, key) => rows.reduce((total, r) => total + r[key], 0);
const plural = (n, one, many = `${one}s`) => `${fmtInt(n)} ${n === 1 ? one : many}`;
// What the footnote reconciles: everyone's outreach less the people shown.
const OTHERS = ['emailsSent', 'invitesSent', 'callsMade', 'emailPositive', 'linkedinPositive', 'callPositive', 'emailMeetings', 'linkedinMeetings', 'callMeetings'];
// Each channel's volume, positives and meetings, and who is outside the box.
const OUTSIDE = {
  email: { sent: 'emailsSent', unit: 'email', positive: 'emailPositive', meetings: 'emailMeetings', who: 'Campaigns outside these SDRs (AI SDR and others)' },
  linkedin: { sent: 'invitesSent', unit: 'invite', positive: 'linkedinPositive', meetings: 'linkedinMeetings', who: 'Campaigns outside these SDRs (AI SDR and others)' },
  call: { sent: 'callsMade', unit: 'call', positive: 'callPositive', meetings: 'callMeetings', who: 'Calls by people not on this list (not on the roster, or since removed from Nooks)' },
};

/** What the box leaves out, so it can be reconciled with the Overview and the program pages. */
function boardFootnote(view, channel, openOutcomes) {
  const keys = OUTSIDE[channel];
  const unplaced = view.sdrs.filter(s => s.unplacedMeetings > 0);
  const o = view.others;
  const sent = o[keys.sent];
  const positive = o[keys.positive];
  const meetings = o[keys.meetings];
  const outside = sent + positive + meetings > 0;
  if (!outside && !unplaced.length) return null;
  const count = sum(unplaced, 'unplacedMeetings');
  return (
    <>
      {outside && `${keys.who} add ${plural(sent, keys.unit)}, ${plural(positive, 'positive response')} and ${plural(meetings, 'meeting')}. The totals elsewhere count them. Pick them beside the buttons to see them here. `}
      {unplaced.length > 0 && (
        <>
          <CountButton
            value={count}
            label="See these meetings"
            onClick={() => openOutcomes({
              kind: 'meetings',
              channel: 'none',
              sdr: view.sdrs.map(s => s.name).join(','),
              from: view.from,
              to: view.to,
              title: 'Meetings with no channel yet',
            })}
          />
          {` ${count === 1 ? 'meeting' : 'meetings'} booked in these dates ${count === 1 ? 'has' : 'have'} no channel yet, so no channel counts ${count === 1 ? 'it' : 'them'}: ${unplaced.map(s => `${s.name} ${fmtInt(s.unplacedMeetings)}`).join(', ')}. Set ${count === 1 ? 'its' : 'their'} channel on `}
          <Link href="/checks">Meeting checks</Link>.
        </>
      )}
    </>
  );
}

/**
 * One channel as the manager's SDR output sheet lays it out (Ayush, 2026-11-10: "the
 * columns represent DOD or WOW and all the numbers... keep sdr as a variable so i can
 * select the sdr mix by myself"): a row per number, counts then rates, and a column per
 * working day, week or month, oldest on the left, each the sum of the people picked (the
 * SDRs, or on Call the callers, until someone is picked: then the same people in every box).
 * With no dates picked, the last full periods; with dates, the periods inside them (Ayush,
 * 2026-11-17: "if i choose a custom range for july it should show me july's DOD or WOW").
 * The running day, week or month so far closes it: Today, WTD or MTD, the view's own only.
 */
function ChannelBox({ channel, settings, openOutcomes }) {
  const query = useMemo(() => funnelQuery(settings, channel), [settings, channel]);
  const { data, error, loading, refreshing, reload } = useApi('/api/metrics/funnel', query);
  // Labels follow the numbers on screen: the last answer stays, dimmed, until the next one arrives.
  const grain = data?.grain || settings.grain;
  const channelName = CHANNEL_NAMES[channel];
  const metrics = channelMetrics(channel);
  const names = data ? data.sdrs.map(s => s.name) : [];
  const who = settings.sdr ? andList(names) : `All ${names.length} ${PEOPLE[channel].many}`;
  const scroller = useScrollToLatest(data);

  const columns = data?.columns || [];
  const { whole, periods, running } = columnKinds(columns);

  const cell = (m, numbers, c) => {
    if (m.rate) return fmtRate(m, numbers);
    if (!m.outcome) return fmtInt(numbers[m.key]);
    const title = `${m.label}: ${who}, ${channelName}, ${columnName(grain, c)}`;
    return (
      <CountButton
        value={numbers[m.key]}
        label={`See who: ${title}`}
        onClick={() => openOutcomes({ kind: m.outcome, channel, sdr: names.join(','), from: c.from, to: c.to, title })}
      />
    );
  };
  const shade = data ? Object.fromEntries(metrics.map(m => [m.key, shadeScale(whole.map(i => data.team[i][m.key]))])) : {};
  const tableColumns = data ? [
    { key: 'label', label: 'Number', sortable: false, csv: m => metricLabel(m), render: m => <span className="dt-hint" title={m.hint}>{metricLabel(m)}</span> },
    ...columns.map((c, i) => {
      const { label, hint } = heading(grain, c, data.readAt);
      return {
        key: `${c.kind}-${c.period}`,
        label,
        hint,
        align: 'right',
        sortable: false,
        csv: m => data.team[i][m.key],
        render: m => cell(m, data.team[i], c),
        cellStyle: m => (c.kind === 'full'
          ? shade[m.key](data.team[i][m.key])
          : i === running ? { boxShadow: 'inset 1px 0 0 var(--border)' } : undefined),
      };
    }),
  ] : [];

  // What the columns leave out, over the periods (the running column can overlap them), else the running one.
  const counted = periods.length ? periods : [running].filter(i => i >= 0);
  const outside = counted.length > 0 && boardFootnote({
    sdrs: data.sdrs.map(s => ({ name: s.name, unplacedMeetings: sum(counted.map(i => s.rows[i]), 'unplacedMeetings') })),
    others: Object.fromEntries(OTHERS.map(key => [key, sum(counted.map(i => data.everyone[i]), key) - sum(counted.map(i => data.team[i]), key)])),
    from: columns[counted[0]].from,
    to: columns[counted[counted.length - 1]].to,
  }, channel, openOutcomes);

  return (
    <Card
      className={`flush${refreshing ? ' is-refreshing' : ''}`}
      title={channelName}
      subtitle={data ? `${names.length === 1 ? who : `${who} added together`}, ${columnsPhrase({ grain, columns, picked: settings.picked, readAt: data.readAt })}` : null}
      footnote={data && (
        <>
          <span className="heat-key">Lowest <span className="heat-key-bar" aria-hidden="true" /> highest, each row on its own scale, whole periods only.</span>
          <br />
          {rateFormulas(channel)}
          {outside && <><br />{outside}</>}
        </>
      )}
    >
      {error && <ErrorState error={error} onRetry={reload} />}
      {loading && <LoadingBlock />}
      {data && (
        <div className="period-table" ref={scroller}>
          <DataTable key={`${channel}-${grain}`} columns={tableColumns} rows={metrics} rowKey={m => m.key} exportName={`sdr-${channel}-${grain}`} />
        </div>
      )}
    </Card>
  );
}

/**
 * The SDR page (Ayush, 2026-11-17): Call, Email and LinkedIn, a box each, stacked, under one
 * set of controls, DoD / WoW / MoM, who, and dates, so the three always show the same days
 * and people side by side. The one-row-per-SDR dates table and the charts are gone.
 */
export default function SdrsView() {
  const settings = usePageSettings('day');
  const { openOutcomes, outcomesPanel } = useOutcomes();
  return (
    <div className="page">
      <PageHeader
        title="SDRs"
        description="Calls on Nooks, email and LinkedIn, a box each, for the same days and people: a column per working day, week or month, then today, this week or this month so far."
        meta={<SyncStatus />}
      />
      <PageControls settings={settings} />
      <WarningsBanner />
      {BOXES.map(channel => <ChannelBox key={channel} channel={channel} settings={settings} openOutcomes={openOutcomes} />)}
      {outcomesPanel}
    </div>
  );
}
