'use client';

import { useMemo, useState } from 'react';
import { fmtInt, fmtPeriod } from '@/lib/client/format';
import { useApi } from '@/lib/client/use-api';
import { useFilters, useLinkWithFilters } from '@/lib/client/use-filters';
import BarChart from '../charts/BarChart';
import ChartTable from '../charts/ChartTable';
import Card, { ChartTableSwitch } from '../ui/Card';
import CountButton from '../ui/CountButton';
import DataTable from '../ui/DataTable';
import Delta from '../ui/Delta';
import FilterBar from '../ui/FilterBar';
import PageHeader from '../ui/PageHeader';
import { Person } from '../ui/Person';
import { ErrorState, LoadingBlock } from '../ui/States';
import WarningsBanner from '../ui/WarningsBanner';
import { SERIES, SyncStatus, pctChange, sdrHref } from './common';
import { DEFS } from './definitions';
import { COMPARISONS, ComparisonButtons, FUNNEL, comparedPhrase, metricLabel, periodDates } from './funnel';
import { useOutcomes } from './outcomes';
import { ChannelToggle } from './program';

const CHANNELS = [['email', 'Email'], ['linkedin', 'LinkedIn']];
const TOTAL = 'Total';

const boardMetrics = channel => FUNNEL[channel].filter(m => m.board);
const sum = (rows, key) => rows.reduce((total, r) => total + r[key], 0);
const plural = (n, one, many = `${one}s`) => `${fmtInt(n)} ${n === 1 ? one : many}`;

/** What the table leaves out, so it can be reconciled with the Overview. */
function boardFootnote(data, channel, openOutcomes) {
  const email = channel === 'email';
  const unplaced = data.sdrs.filter(s => s.unplacedMeetings > 0);
  const o = data.others;
  const sent = email ? o.emailsSent : o.invitesSent;
  const positive = email ? o.emailPositive : o.linkedinPositive;
  const meetings = email ? o.emailMeetings : o.linkedinMeetings;
  const outside = sent + positive + meetings > 0;
  if (!outside && !unplaced.length) return undefined;
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
              sdr: data.sdrs.map(s => s.name).join(','),
              from: data.range.from,
              to: data.range.to,
              title: 'Meetings with no campaign behind them',
            })}
          />
          {` ${count === 1 ? 'meeting' : 'meetings'} booked in these dates had no campaign behind ${count === 1 ? 'it' : 'them'}, so neither channel counts ${count === 1 ? 'it' : 'them'}: ${unplaced.map(s => `${s.name} ${fmtInt(s.unplacedMeetings)}`).join(', ')}.`}
        </>
      )}
    </>
  );
}

/** One card: who, the latest full period against the one before it, then the bars. A Positive or Meetings number, or bar, opens its names. */
function TrendCard({ title, rows, metric, comparison, height, yMax, onOpen }) {
  const [before, latest] = rows.slice(-2);
  const grain = comparison.key;
  const openable = metric.outcome ? onOpen : null;
  const count = row => (
    <CountButton
      value={row[metric.key]}
      label={`See who: ${fmtPeriod(grain, row.period, { long: true })}`}
      onClick={openable && (() => openable(row.period))}
    />
  );
  return (
    <Card
      title={title}
      actions={latest && before && (
        <span className="trend-numbers">
          <strong>{count(latest)}</strong>
          <span className="muted">vs {count(before)}</span>
          <Delta small change={pctChange(latest[metric.key], before[metric.key])} />
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
  const metrics = boardMetrics(channel);
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
    return <ChartTable rows={rows} x={r => fmtPeriod(grain, r.period, { long: true })} xLabel={grain[0].toUpperCase() + grain.slice(1)} series={series} />;
  };

  return (
    <section className={`page${refreshing ? ' is-refreshing' : ''}`} aria-label="Day, week and month comparison">
      <div>
        <h2 className="section-title">{metricLabel(metric)}, {comparison.title}</h2>
        <p className="card-sub">
          {data ? `${comparedPhrase(grain, data.periods)} The darker bars are those two. Every SDR card uses the same scale.${metric.outcome ? ' Click a bar to see who.' : ''}` : 'Last full periods only.'}
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

/**
 * One SDR per row for the dates picked, one channel at a time, reading left to right
 * as the funnel; below it the same numbers day on day, week on week and month on month.
 * Built for a manager to read and play with (Ayush, 2026-11-06: "no need to fit
 * everything together").
 */
export default function SdrsView() {
  const { apiParams, get, setParams } = useFilters();
  const withFilters = useLinkWithFilters();
  const channel = get('channel') === 'linkedin' ? 'linkedin' : 'email';
  const params = useMemo(() => {
    const { program, theme, ...rest } = apiParams;
    return rest;
  }, [apiParams]);
  const { data, error, loading, refreshing, reload } = useApi('/api/metrics/sdrs', params);
  const { openOutcomes, outcomesPanel } = useOutcomes();

  const metrics = boardMetrics(channel);
  const channelName = channel === 'email' ? 'Email' : 'LinkedIn';
  const count = (r, m) => {
    const who = r.name === TOTAL ? `All ${data.sdrs.length} SDRs` : r.name;
    const title = `${m.label}: ${who}, ${channelName}`;
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
    ...metrics.map(m => ({
      key: m.key,
      label: metricLabel(m),
      hint: m.hint,
      align: 'right',
      csv: r => r[m.key],
      render: r => (m.outcome ? count(r, m) : fmtInt(r[m.key])),
    })),
  ];

  return (
    <div className="page">
      <PageHeader
        title="SDRs"
        description="What each SDR sent in the dates you pick and what came back, then how it moved day on day, week on week and month on month."
        meta={<SyncStatus />}
      />
      <FilterBar
        range={data?.range}
        hide={['program', 'theme']}
        compares={false}
        leading={<ChannelToggle views={CHANNELS} value={channel} onChange={value => setParams({ channel: value === 'email' ? null : value })} />}
      />
      <WarningsBanner />
      {error && <ErrorState error={error} onRetry={reload} />}
      {loading && <LoadingBlock />}

      {data && (
        <Card
          className={`flush${refreshing ? ' is-refreshing' : ''}`}
          title={channel === 'email' ? 'Email' : 'LinkedIn'}
          subtitle={channel === 'email' ? DEFS.boardEmail : DEFS.boardLinkedin}
          footnote={boardFootnote(data, channel, openOutcomes)}
        >
          <DataTable
            key={channel}
            columns={columns}
            rows={data.sdrs}
            rowKey={r => r.name}
            footerRow={{ name: TOTAL, ...data.total }}
            exportName={`sdr-${channel}`}
            initialSort={{ key: metrics[0].key, dir: 'desc' }}
          />
        </Card>
      )}

      <SdrTrend channel={channel} params={params} withFilters={withFilters} openOutcomes={openOutcomes} />
      {outcomesPanel}
    </div>
  );
}
