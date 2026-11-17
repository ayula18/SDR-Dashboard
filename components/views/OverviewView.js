'use client';

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
import { DEFS } from './definitions';
import { fmtRate, metricLabel, rateFormulas } from './funnel';
import { useOutcomes } from './outcomes';
import {
  PEOPLE, PageControls, andList, channelMetrics, columnKinds, columnName, columnsPhrase, funnelQuery, heading, shadeScale,
  usePageSettings, useScrollToLatest,
} from './periods';

// Every meeting the people booked, whatever the channel: `meetings` on a funnel row (withRates).
const MEETINGS = { key: 'meetings', label: 'Meetings booked', note: 'every channel', hint: DEFS.meetingsAll, outcome: 'meetings' };

/**
 * The manager's SDR output sheet, section by section (Ayush, 2026-11-17: "delete the current
 * overview section entirely and that section should have this kind of a view sdr wise and
 * WOW should be default"): meetings on every channel, then Email, LinkedIn and Call.
 */
const SECTIONS = [
  { channel: 'all', title: 'Meetings booked', metrics: [MEETINGS], footnote: DEFS.meetingsAll },
  { channel: 'email', title: 'Email', metrics: channelMetrics('email') },
  { channel: 'linkedin', title: 'LinkedIn', metrics: channelMetrics('linkedin') },
  { channel: 'call', title: 'Call', metrics: channelMetrics('call') },
];

// A number's block starts with its Total row; a line above it keeps the blocks apart.
const BLOCK = 'inset 0 2px 0 var(--border)';
const RUNNING_EDGE = 'inset 1px 0 0 var(--border)';

/**
 * One section: for each number a Total row (the people added together, rates from the
 * sums) and a row per person under it, a column per working day, week or month, as in the
 * sheet. Every row is shaded on its own scale, whole periods only.
 */
function MetricsSection({ section, settings, openOutcomes }) {
  const { channel, title, metrics } = section;
  const query = useMemo(() => funnelQuery(settings, channel), [settings, channel]);
  const { data, error, loading, refreshing, reload } = useApi('/api/metrics/funnel', query);
  // Labels follow the numbers on screen: the last answer stays, dimmed, until the next one arrives.
  const grain = data?.grain || settings.grain;
  const people = data?.sdrs || [];
  const names = people.map(p => p.name);
  const who = settings.sdr ? andList(names) : `The ${fmtInt(names.length)} ${PEOPLE[channel].many}`;
  const scroller = useScrollToLatest(data);
  const columns = data?.columns || [];
  const { running } = columnKinds(columns);

  const rows = useMemo(() => {
    if (!data) return [];
    const full = columnKinds(data.columns).whole;
    const list = metrics.flatMap(m => [
      { id: m.key, metric: m, person: null, numbers: data.team },
      ...data.sdrs.map(p => ({ id: `${m.key}|${p.name}`, metric: m, person: p, numbers: p.rows })),
    ]);
    return list.map(r => ({ ...r, shade: shadeScale(full.map(i => r.numbers[i][r.metric.key])) }));
  }, [data, metrics]);

  const cell = (r, i) => {
    const m = r.metric;
    const numbers = r.numbers[i];
    let shown;
    if (m.rate) shown = fmtRate(m, numbers);
    else if (!m.outcome) shown = fmtInt(numbers[m.key]);
    else {
      const whose = r.person ? r.person.name : who;
      const titleText = `${m.label}: ${whose}, ${title}, ${columnName(grain, columns[i])}`;
      shown = (
        <CountButton
          value={numbers[m.key]}
          label={`See who: ${titleText}`}
          onClick={() => openOutcomes({
            kind: m.outcome,
            channel: channel === 'all' ? null : channel,
            sdr: r.person ? r.person.name : names.join(','),
            from: columns[i].from,
            to: columns[i].to,
            title: titleText,
          })}
        />
      );
    }
    return r.person ? shown : <strong>{shown}</strong>;
  };
  const style = (r, extra) => {
    const shadows = [r.person ? null : BLOCK, extra].filter(Boolean);
    return shadows.length ? { boxShadow: shadows.join(', ') } : undefined;
  };

  const tableColumns = data ? [
    {
      key: 'label',
      label: 'Number',
      sortable: false,
      csv: r => `${metricLabel(r.metric)}: ${r.person ? r.person.name : 'Total'}`,
      render: r => (r.person
        ? <span style={{ paddingLeft: 16 }}>{r.person.name}</span>
        : <span className="dt-hint" title={r.metric.hint}><strong>{metricLabel(r.metric)}</strong> <span className="muted">· Total</span></span>),
      cellStyle: r => style(r),
    },
    ...columns.map((c, i) => {
      const { label, hint } = heading(grain, c, data.readAt);
      return {
        key: `${c.kind}-${c.period}`,
        label,
        hint,
        align: 'right',
        sortable: false,
        csv: r => r.numbers[i][r.metric.key],
        render: r => cell(r, i),
        cellStyle: r => {
          const shade = c.kind === 'full' ? r.shade(r.numbers[i][r.metric.key]) : undefined;
          return { ...shade, ...style(r, i === running ? RUNNING_EDGE : null) };
        },
      };
    }),
  ] : [];

  return (
    <Card
      className={`flush${refreshing ? ' is-refreshing' : ''}`}
      title={title}
      subtitle={data ? `${who} and their total, ${columnsPhrase({ grain, columns, picked: settings.picked, readAt: data.readAt })}` : null}
      footnote={data && (
        <>
          <span className="heat-key">Lowest <span className="heat-key-bar" aria-hidden="true" /> highest, each row on its own scale, whole periods only.</span>
          <br />
          {section.footnote || rateFormulas(channel)}
        </>
      )}
    >
      {error && <ErrorState error={error} onRetry={reload} />}
      {loading && <LoadingBlock />}
      {data && (
        <div className="period-table" ref={scroller}>
          <DataTable
            key={`${channel}-${grain}`}
            columns={tableColumns}
            rows={rows}
            rowKey={r => r.id}
            pageSize={1000}
            exportName={`overview-${channel}-${grain}`}
          />
        </div>
      )}
    </Card>
  );
}

/**
 * The Overview, the home page (Ayush, 2026-11-17: first named "SDRs - Metrics", then "rename
 * this page to overview only"), in place of the old Overview's tiles and cards: every
 * number per SDR with the team total above, section by section, WoW by default, under the
 * same controls as the SDR page.
 */
export default function OverviewView() {
  const settings = usePageSettings('week');
  const { openOutcomes, outcomesPanel } = useOutcomes();
  return (
    <div className="page">
      <PageHeader
        title="Overview"
        description="Every number for each SDR and caller, with their total above, channel by channel: a column per week, day or month, as in the SDR output sheet."
        meta={<SyncStatus />}
      />
      <PageControls settings={settings} />
      <WarningsBanner />
      {SECTIONS.map(section => <MetricsSection key={section.channel} section={section} settings={settings} openOutcomes={openOutcomes} />)}
      {outcomesPanel}
    </div>
  );
}
