'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { fmtInt, fmtPct, fmtPeriod } from '@/lib/client/format';
import { pointChange } from '@/lib/metrics/format';
import { useApi } from '@/lib/client/use-api';
import { useFilters, useLinkWithFilters } from '@/lib/client/use-filters';
import BarChart from '../charts/BarChart';
import ChartTable from '../charts/ChartTable';
import Card, { ChartTableSwitch } from '../ui/Card';
import CountButton from '../ui/CountButton';
import DataTable from '../ui/DataTable';
import Delta from '../ui/Delta';
import FilterBar, { SdrFilter } from '../ui/FilterBar';
import PageHeader from '../ui/PageHeader';
import { Person } from '../ui/Person';
import { EmptyState, ErrorState, LoadingBlock } from '../ui/States';
import WarningsBanner from '../ui/WarningsBanner';
import { SERIES, SyncStatus, pctChange, sdrHref } from './common';
import { DEFS } from './definitions';
import { COMPARISONS, ComparisonButtons, FUNNEL, RATES, comparedPhrase, fmtRate, metricLabel, periodDates, rateFormulas } from './funnel';
import { useOutcomes } from './outcomes';
import { ChannelToggle } from './program';

// Call has no pipeline yet (Ayush, 2026-11-10): the button is there, its cards come later.
// Call meetings and positives already count in the Overview totals.
const CHANNELS = [['email', 'Email'], ['linkedin', 'LinkedIn'], ['call', 'Call']];
const TOTAL = 'Total';

const boardMetrics = channel => FUNNEL[channel].filter(m => m.board);
// The rows of the period table and what the charts can show: the counts, then the rates.
const chartMetrics = channel => [...boardMetrics(channel), ...RATES[channel]];
const sum = (rows, key) => rows.reduce((total, r) => total + r[key], 0);
const plural = (n, one, many = `${one}s`) => `${fmtInt(n)} ${n === 1 ? one : many}`;
// What the footnote reconciles against the Overview: everyone's outreach less the SDRs shown.
const OTHERS = ['emailsSent', 'invitesSent', 'emailPositive', 'linkedinPositive', 'emailMeetings', 'linkedinMeetings'];

/** What the table leaves out, so it can be reconciled with the Overview. */
function boardFootnote(view, channel, openOutcomes) {
  const email = channel === 'email';
  const unplaced = view.sdrs.filter(s => s.unplacedMeetings > 0);
  const o = view.others;
  const sent = email ? o.emailsSent : o.invitesSent;
  const positive = email ? o.emailPositive : o.linkedinPositive;
  const meetings = email ? o.emailMeetings : o.linkedinMeetings;
  const outside = sent + positive + meetings > 0;
  if (!outside && !unplaced.length) return null;
  const count = sum(unplaced, 'unplacedMeetings');
  return (
    <>
      {outside && `Campaigns outside these SDRs (AI SDR and others) add ${plural(sent, email ? 'email' : 'invite')}, ${plural(positive, 'positive response')} and ${plural(meetings, 'meeting')}. The Overview counts them. Pick someone in the SDR filter to see them here. `}
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
 * One card: who, the latest full period against the one before it, then the bars. A
 * Positive or Meetings number, or bar, opens its names; a rate moves in points.
 */
function TrendCard({ title, rows, metric, comparison, height, yMax, onOpen }) {
  const [before, latest] = rows.slice(-2);
  const grain = comparison.key;
  const openable = metric.outcome ? onOpen : null;
  const shown = row => (metric.rate ? fmtRate(metric, row) : (
    <CountButton
      value={row[metric.key]}
      label={`See who: ${fmtPeriod(grain, row.period, { long: true })}`}
      onClick={openable && (() => openable(row.period))}
    />
  ));
  return (
    <Card
      title={title}
      actions={latest && before && (
        <span className="trend-numbers">
          <strong>{shown(latest)}</strong>
          <span className="muted">vs {shown(before)}</span>
          {metric.rate
            ? <Delta small points={pointChange(latest[metric.key], before[metric.key])} />
            : <Delta small change={pctChange(latest[metric.key], before[metric.key])} />}
        </span>
      )}
    >
      {rows.every(r => !r[metric.key]) ? (
        <div className="trend-empty" style={{ height }}>None in these {fmtInt(rows.length)} {comparison.unit}</div>
      ) : (
        <BarChart
          data={rows}
          x={r => fmtPeriod(grain, r.period)}
          tooltipLabel={r => fmtPeriod(grain, r.period, { long: true })}
          series={[{ key: metric.key, label: metric.label, color: SERIES[0] }]}
          format={metric.rate ? v => fmtPct(v, metric.digits) : undefined}
          integer={!metric.rate}
          height={height}
          yMax={yMax}
          highlightLast={2}
          onSelect={openable ? r => openable(r.period) : undefined}
          label={`${metric.label} per period`}
        />
      )}
    </Card>
  );
}

/**
 * Day on day, week on week or month on month for one number at a time: the team across
 * the page, then each SDR in a card of their own, two to a row. SDR cards share one scale,
 * so the same height means the same number from card to card.
 */
function SdrTrend({ channel, params, withFilters, openOutcomes }) {
  const [wanted, setWanted] = useState('week');
  const [picked, setPicked] = useState(null);
  const [view, setView] = useState('chart');
  const metrics = chartMetrics(channel);
  const metric = metrics.find(m => m.key === picked) || metrics[0];
  const query = useMemo(() => {
    const { range, from, to, ...rest } = params;
    return { ...rest, grain: wanted };
  }, [params, wanted]);
  const { data, error, loading, refreshing, reload } = useApi('/api/metrics/funnel', query);
  // Labels follow the numbers on screen: the last answer stays, dimmed, until the next one arrives.
  const grain = data?.grain || wanted;
  const comparison = COMPARISONS.find(c => c.key === grain);
  const teamLabel = params.sdr ? 'Selected SDRs' : 'All SDRs';
  const yMax = data ? Math.max(0, ...data.sdrs.flatMap(s => s.rows.map(r => r[metric.key]))) : 0;
  const several = data?.sdrs.length > 1;
  const channelName = channel === 'email' ? 'Email' : 'LinkedIn';
  const opener = (sdr, who) => period => openOutcomes({
    kind: metric.outcome,
    channel,
    sdr,
    ...periodDates(grain, period),
    title: `${metric.label}: ${who}, ${channelName}, ${fmtPeriod(grain, period, { long: true })}`,
  });

  const asTable = () => {
    const series = [
      ...(several ? [{ key: 'team', label: teamLabel }] : []),
      ...data.sdrs.map(s => ({ key: s.name, label: s.name })),
    ];
    const rows = data.periods.map((period, i) => ({
      period,
      team: data.team[i][metric.key],
      ...Object.fromEntries(data.sdrs.map(s => [s.name, s.rows[i][metric.key]])),
    }));
    return (
      <ChartTable
        rows={rows}
        x={r => fmtPeriod(grain, r.period, { long: true })}
        xLabel={grain[0].toUpperCase() + grain.slice(1)}
        series={series}
        format={metric.rate ? v => fmtPct(v, metric.digits) : undefined}
      />
    );
  };

  return (
    <section className={`page${refreshing ? ' is-refreshing' : ''}`} aria-label="Day, week and month comparison">
      <div>
        <h2 className="section-title">{metricLabel(metric)}, {comparison.title}</h2>
        <p className="card-sub">
          {data ? `${comparedPhrase(grain, data.periods)} The darker bars are those two. Every SDR card uses the same scale.${metric.outcome ? ' Click a bar to see who.' : ''}` : 'Last full periods only.'}
          {metric.rate ? ` ${metric.label} = ${metric.hint[0].toLowerCase()}${metric.hint.slice(1)}, each period on its own.` : ''}
          {grain === 'day' ? ` ${DEFS.workingDays}` : ''}
        </p>
      </div>
      <div className="trend-controls">
        <ComparisonButtons value={wanted} onChange={setWanted} />
        <div className="segmented" role="group" aria-label="Number to chart">
          {metrics.map(m => (
            <button key={m.key} type="button" aria-pressed={metric.key === m.key} title={m.hint} onClick={() => setPicked(m.key)}>{m.label}</button>
          ))}
        </div>
        <span className="trend-controls-end"><ChartTableSwitch value={view} onChange={setView} /></span>
      </div>
      {error && <ErrorState error={error} onRetry={reload} />}
      {loading && <LoadingBlock />}
      {data && view === 'table' && <Card className="flush">{asTable()}</Card>}
      {data && view === 'chart' && (
        <>
          {several && (
            <TrendCard
              title={teamLabel}
              rows={data.team}
              metric={metric}
              comparison={comparison}
              height={200}
              onOpen={opener(data.sdrs.map(s => s.name).join(','), teamLabel)}
            />
          )}
          <div className={several ? 'grid-2' : undefined}>
            {data.sdrs.map(s => (
              <TrendCard
                key={s.name}
                title={<Person name={s.name} color={s.color} href={withFilters(sdrHref(s.name))} size={24} />}
                rows={s.rows}
                metric={metric}
                comparison={comparison}
                height={170}
                yMax={yMax}
                onOpen={opener(s.name, s.name)}
              />
            ))}
          </div>
        </>
      )}
    </section>
  );
}

/** Above either table: which SDRs, then the dates or a column per day, week or month. */
const TableControls = ({ mode, onMode }) => (
  <>
    <SdrFilter />
    <ComparisonButtons value={mode} onChange={onMode} withDates />
  </>
);

/**
 * Each number's row shaded on its own scale, as an Excel colour scale does it (Ayush,
 * 2026-11-10: "a heatmap sort of with soft pastel colors just like our excel"): the row's
 * lowest period lightest, its highest deepest. Rows never share a scale, since emails,
 * counts and rates are different sizes. A row with nothing to tell apart, or a missing
 * rate, stays unshaded.
 */
function rowShades(metrics, numbers) {
  return Object.fromEntries(metrics.map(m => {
    const values = numbers.map(r => r[m.key]).filter(v => v != null);
    const min = Math.min(...values);
    const max = Math.max(...values);
    return [m.key, v => (v == null || !(max > min) ? undefined : { '--heat': ((v - min) / (max - min)).toFixed(3) })];
  }));
}

const andList = names => (names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`);

/**
 * DoD, WoW or MoM as the manager's SDR output sheet lays them out (Ayush, 2026-11-10:
 * "the columns represent DOD or WOW and all the numbers... keep sdr as a variable so i
 * can select the sdr mix by myself"): a row per number, counts then rates, and a column
 * per full day, week or month, the periods the charts below show, oldest on the left.
 * Each column adds up the SDRs the SDR filter picks, the six until someone is picked.
 */
function PeriodTable({ channel, params, grain: wanted, onPick, openOutcomes }) {
  const query = useMemo(() => {
    const { range, from, to, ...rest } = params;
    return { ...rest, grain: wanted };
  }, [params, wanted]);
  const { data, error, loading, refreshing, reload } = useApi('/api/metrics/funnel', query);
  // Labels follow the numbers on screen: the last answer stays, dimmed, until the next one arrives.
  const grain = data?.grain || wanted;
  const comparison = COMPARISONS.find(c => c.key === grain);
  const channelName = channel === 'email' ? 'Email' : 'LinkedIn';
  const metrics = chartMetrics(channel);
  const names = data ? data.sdrs.map(s => s.name) : [];
  const who = params.sdr ? andList(names) : `All ${names.length} SDRs`;
  // Twenty working days run wider than the card: open on the latest, the names column held in place.
  const scroller = useRef(null);
  useEffect(() => {
    const el = scroller.current?.querySelector('.dt-scroll');
    if (el) el.scrollLeft = el.scrollWidth;
  }, [data]);

  const cell = (m, numbers, period) => {
    if (m.rate) return fmtRate(m, numbers);
    if (!m.outcome) return fmtInt(numbers[m.key]);
    const title = `${m.label}: ${who}, ${channelName}, ${fmtPeriod(grain, period, { long: true })}`;
    return (
      <CountButton
        value={numbers[m.key]}
        label={`See who: ${title}`}
        onClick={() => openOutcomes({ kind: m.outcome, channel, sdr: names.join(','), ...periodDates(grain, period), title })}
      />
    );
  };
  const shade = data ? rowShades(metrics, data.team) : {};
  const columns = data ? [
    { key: 'label', label: 'Number', sortable: false, csv: m => metricLabel(m), render: m => <span className="dt-hint" title={m.hint}>{metricLabel(m)}</span> },
    ...data.periods.map((period, i) => ({
      key: period,
      label: fmtPeriod(grain, period, { long: grain === 'day' }),
      align: 'right',
      sortable: false,
      csv: m => data.team[i][m.key],
      render: m => cell(m, data.team[i], period),
      cellStyle: m => shade[m.key](data.team[i][m.key]),
    })),
  ] : [];

  // What the columns leave out, over all of them, worded as under the dates table.
  const outside = data?.periods.length > 0 && boardFootnote({
    sdrs: data.sdrs.map(s => ({ name: s.name, unplacedMeetings: sum(s.rows, 'unplacedMeetings') })),
    others: Object.fromEntries(OTHERS.map(key => [key, sum(data.everyone, key) - sum(data.team, key)])),
    from: data.periods[0],
    to: periodDates(grain, data.periods[data.periods.length - 1]).to,
  }, channel, openOutcomes);

  return (
    <Card
      className={`flush${refreshing ? ' is-refreshing' : ''}`}
      title={channelName}
      subtitle={data
        ? `${names.length === 1 ? who : `${who} added together`}, a column per ${comparison.unit.replace(/s$/, '')}: the last ${fmtInt(data.periods.length)} full ${comparison.unit}, oldest on the left. Pick SDRs beside the buttons to see one or a mix. ${DEFS.compareDates}${grain === 'day' ? ` ${DEFS.workingDays}` : ''}`
        : 'Last full periods only.'}
      actions={<TableControls mode={wanted} onMode={onPick} />}
      footnote={data && (
        <>
          <span className="heat-key">Lowest <span className="heat-key-bar" aria-hidden="true" /> highest, each row on its own scale.</span>
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
          <DataTable key={`${channel}-${grain}`} columns={columns} rows={metrics} rowKey={m => m.key} exportName={`sdr-${channel}-${grain}`} />
        </div>
      )}
    </Card>
  );
}

/**
 * One SDR per row for the dates picked, one channel at a time, reading left to right as
 * the funnel and then its rates; or with DoD, WoW or MoM, the sheet's layout, a column per
 * period (PeriodTable). Below it the same numbers charted day on day, week on week and
 * month on month. Built for a manager to read and play with (Ayush, 2026-11-06: "no need
 * to fit everything together").
 */
export default function SdrsView() {
  const { apiParams, get, setParams } = useFilters();
  const withFilters = useLinkWithFilters();
  const channel = ['linkedin', 'call'].includes(get('channel')) ? get('channel') : 'email';
  const [mode, setMode] = useState('dates');
  const params = useMemo(() => {
    const { program, theme, ...rest } = apiParams;
    return rest;
  }, [apiParams]);
  const { data, error, loading, refreshing, reload } = useApi('/api/metrics/sdrs', params);
  const { openOutcomes, outcomesPanel } = useOutcomes();
  const byDates = mode === 'dates';

  const counts = channel === 'call' ? [] : boardMetrics(channel);
  const rates = channel === 'call' ? [] : RATES[channel];
  const channelName = channel === 'email' ? 'Email' : 'LinkedIn';
  const countCell = (r, m) => {
    const who = r.name === TOTAL ? `All ${data.sdrs.length} SDRs` : r.name;
    const title = `${m.label}: ${who}, ${channelName}`;
    if (!m.outcome) return fmtInt(r[m.key]);
    return (
      <CountButton
        value={r[m.key]}
        label={`See who: ${title}`}
        onClick={() => openOutcomes({
          kind: m.outcome,
          channel,
          sdr: r.name === TOTAL ? data.sdrs.map(s => s.name).join(',') : r.name,
          from: data.range.from,
          to: data.range.to,
          title,
        })}
      />
    );
  };
  const columns = [
    {
      key: 'name',
      label: 'SDR',
      sort: r => r.name,
      csv: r => r.name,
      render: r => (r.name === TOTAL ? TOTAL : <Person name={r.name} color={r.color} href={withFilters(sdrHref(r.name))} size={24} />),
    },
    ...counts.map(m => ({ key: m.key, label: metricLabel(m), hint: m.hint, align: 'right', csv: r => r[m.key], render: r => countCell(r, m) })),
    ...rates.map(m => ({ key: m.key, label: m.label, hint: m.hint, align: 'right', csv: r => r[m.key], render: r => fmtRate(m, r) })),
  ];
  const outside = data && boardFootnote({ sdrs: data.sdrs, others: data.others, from: data.range.from, to: data.range.to }, channel, openOutcomes);

  return (
    <div className="page">
      <PageHeader
        title="SDRs"
        description="What each SDR sent and what came back, with each channel's rates, for the dates you pick or a column per day, week or month, then the same numbers charted."
        meta={<SyncStatus />}
      />
      <FilterBar
        range={data?.range}
        hide={['program', 'theme']}
        compares={false}
        leading={<ChannelToggle views={CHANNELS} value={channel} onChange={value => setParams({ channel: value === 'email' ? null : value })} />}
      />
      <WarningsBanner />
      {byDates && error && <ErrorState error={error} onRetry={reload} />}
      {byDates && loading && channel !== 'call' && <LoadingBlock />}

      {channel === 'call' && (
        <Card title="Call" subtitle="Cold calling has no pipeline in the dashboard yet, so there are no call numbers to show here. Meetings booked on a call, and their positives, already count in the Overview's totals.">
          <EmptyState title="Coming soon">Call volumes, positives and meetings per SDR will appear here once cold calling is connected.</EmptyState>
        </Card>
      )}

      {byDates && data && channel !== 'call' && (
        <Card
          className={`flush${refreshing ? ' is-refreshing' : ''}`}
          title={channelName}
          subtitle={channel === 'email' ? DEFS.boardEmail : DEFS.boardLinkedin}
          actions={<TableControls mode={mode} onMode={setMode} />}
          footnote={(
            <>
              {rateFormulas(channel)}
              {outside && <><br />{outside}</>}
            </>
          )}
        >
          <DataTable
            key={channel}
            columns={columns}
            rows={data.sdrs}
            rowKey={r => r.name}
            footerRow={{ name: TOTAL, ...data.total }}
            exportName={`sdr-${channel}`}
            initialSort={{ key: counts[0].key, dir: 'desc' }}
          />
        </Card>
      )}

      {!byDates && channel !== 'call' && (
        <PeriodTable channel={channel} params={params} grain={mode} onPick={setMode} openOutcomes={openOutcomes} />
      )}

      {channel !== 'call' && <SdrTrend channel={channel} params={params} withFilters={withFilters} openOutcomes={openOutcomes} />}
      {outcomesPanel}
    </div>
  );
}
