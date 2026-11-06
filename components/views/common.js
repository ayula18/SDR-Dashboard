'use client';

import CountButton from '../ui/CountButton';
import Link from 'next/link';
import { useMemo } from 'react';
import { Clock } from 'lucide-react';
import { useDashboard } from '@/lib/client/dashboard-context';
import { fmtCompact, fmtDate, fmtInt, fmtPct, fmtPeriod, fmtRelative, VERDICTS } from '@/lib/client/format';
import ChartTable from '../charts/ChartTable';
import LineChart from '../charts/LineChart';
import Badge from '../ui/Badge';
import Card from '../ui/Card';
import DataTable from '../ui/DataTable';
import Delta from '../ui/Delta';
import { Person } from '../ui/Person';
import StatTile from '../ui/StatTile';
import { EmptyState } from '../ui/States';
import { DEFS } from './definitions';

export const SERIES = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)'];

export const campaignHref = id => `/campaigns/${encodeURIComponent(id)}`;
export const sdrHref = name => `/sdrs/${encodeURIComponent(name)}`;
export const programHref = slug => `/programs/${slug}`;

export const pctChange = (current, previous) =>
  (previous > 0 ? Math.round(((current - previous) / previous) * 1000) / 10 : null);

const PERIOD_PHRASES = {
  yesterday: 'yesterday',
  'this-week': 'this week so far',
  'last-week': 'last week',
  'last-4-weeks': 'in the last 4 weeks',
  'last-12-weeks': 'in the last 12 weeks',
  'this-month': 'this month so far',
  'last-month': 'last month',
  'last-3-months': 'in the last 3 months',
  ytd: 'so far this year',
  'since-start': 'since the first campaign',
};
export const periodPhrase = range => PERIOD_PHRASES[range?.preset] || 'in this range';

const STATUS_LABELS = { active: 'Active', paused: 'Paused', completed: 'Completed', draft: 'Draft', deleted: 'Deleted', other: 'Other' };
export const statusLabel = status => STATUS_LABELS[status] || status || '';

/** Mirrors dash_v_campaigns: campaigns named like tests never count, whatever an admin sets. */
export const isTestName = name => /(^|[^a-z])(test+|webhook|deliverability)([^a-z]|$)/i.test(name || '');

/** slug → program name from the shared filter options. */
export function useProgramName() {
  const { meta } = useDashboard();
  return useMemo(() => {
    const names = new Map((meta?.programs || []).map(p => [p.slug, p.name]));
    return slug => names.get(slug) || slug;
  }, [meta]);
}

/**
 * When the sync last got somewhere. The hover carries the stalest input, because
 * the newest job alone would advertise a freshness the rest of the page does not
 * have; anything past its own refresh window is also named in the warnings.
 */
export function SyncStatus() {
  const { meta } = useDashboard();
  if (!meta) return null;
  const behind = meta.oldestSyncAt && meta.oldestSyncAt !== meta.lastSyncAt;
  return (
    <span
      style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
      title={behind ? `Every number is at least this fresh: ${fmtRelative(meta.oldestSyncAt)}` : undefined}
    >
      <Clock size={13} aria-hidden="true" />
      {meta.lastSyncAt ? `Synced ${fmtRelative(meta.lastSyncAt)}` : 'Not synced yet'}
    </span>
  );
}

/** Stat tile from a KPI payload ({ value, previous, change | pointChange, trend }). */
export function KpiTile({ label, kpi, format = fmtCompact, rate = false, upIsGood = true, note, onOpen }) {
  if (!kpi) return null;
  return (
    <StatTile
      label={label}
      value={<CountButton value={kpi.value} format={format} label={`See who: ${label}`} onClick={onOpen} />}
      previous={kpi.previous != null ? format(kpi.previous) : null}
      change={rate ? undefined : kpi.change}
      points={rate ? kpi.pointChange : undefined}
      upIsGood={upIsGood}
      trend={kpi.trend}
      note={note}
    />
  );
}

export function KpiTiles({ kpis }) {
  return (
    <div className="tiles">
      <KpiTile label="First emails sent" kpi={kpis.emailsSent} note={DEFS.firstEmails} />
      <KpiTile label="Replies" kpi={kpis.replies} note={DEFS.repliedBoth} />
      <KpiTile label="Positive replies" kpi={kpis.positive} note={DEFS.positiveSdr} />
      <KpiTile label="Positive rate" kpi={kpis.positiveRate} rate format={v => fmtPct(v)} note={DEFS.positiveRate} />
      <KpiTile label="Meetings" kpi={kpis.meetings} note={DEFS.meetings} />
    </div>
  );
}

const MOVERS = [
  ['emailsSent', 'first emails sent'],
  ['replies', 'replies'],
  ['positive', 'positive replies'],
  ['meetings', 'meetings'],
];

/** The overview's lead: what happened, in a sentence, then the biggest moves. */
export function WhatChanged({ data, topSdr }) {
  const { kpis, range } = data;
  const positive = kpis.positive;
  const versus = positive.previous == null
    ? ''
    : positive.value > positive.previous
      ? `, up from ${fmtInt(positive.previous)}`
      : positive.value < positive.previous
        ? `, down from ${fmtInt(positive.previous)}`
        : ', the same as the period before';
  const lead = `${fmtInt(positive.value)} positive ${positive.value === 1 ? 'reply' : 'replies'} came in ${periodPhrase(range)}${versus}, with ${fmtInt(kpis.emailsSent.value)} first emails sent.`;

  const movers = MOVERS
    .map(([key, noun]) => ({ key, noun, ...kpis[key] }))
    .filter(k => k.change != null && k.previous >= 5 && Math.abs(k.change) >= 10)
    .sort((a, b) => Math.abs(b.change) - Math.abs(a.change))
    .slice(0, 4);

  return (
    <section className="changes" aria-label="What changed">
      <p className="changes-lead">{lead}</p>
      <ul className="changes-list">
        {movers.map(m => (
          <li key={m.key}>
            <Delta change={m.change} />
            {m.noun}, {fmtInt(m.value)} against {fmtInt(m.previous)}
          </li>
        ))}
        {!movers.length && <li>Nothing else moved by 10% or more against the period before.</li>}
        {topSdr?.positive > 0 && (
          <li>{topSdr.name} leads with {fmtInt(topSdr.positive)} positive {topSdr.positive === 1 ? 'reply' : 'replies'}.</li>
        )}
      </ul>
    </section>
  );
}

/** Outreach volume and outcomes per period: two charts, because they sit on different scales. */
export function TrendCards({ rows, grain }) {
  const unit = grain === 'month' ? 'month' : 'week';
  const x = row => fmtPeriod(grain, row.period);
  const tip = row => fmtPeriod(grain, row.period, { long: true });
  const volume = [{ key: 'sent', label: 'First emails', color: SERIES[0] }];
  const outcomes = [
    { key: 'allReplies', label: 'Replies', color: SERIES[0] },
    { key: 'allPositive', label: 'Positive replies', color: SERIES[1] },
    { key: 'meetings', label: 'Meetings', color: SERIES[2] },
  ];
  const xLabel = unit === 'month' ? 'Month' : 'Week';

  return (
    <div className="grid-2">
      <Card
        title={`Outreach per ${unit}`}
        subtitle="First emails from Instantly analytics; follow-ups are not counted."
        table={() => <ChartTable rows={rows} x={tip} xLabel={xLabel} series={volume} />}
      >
        <LineChart data={rows} x={x} tooltipLabel={tip} series={volume} label={`Outreach per ${unit}`} />
      </Card>
      <Card
        title={`Replies and meetings per ${unit}`}
        subtitle={`Replies: ${DEFS.replied.toLowerCase()}. Meetings: ${DEFS.meetings.toLowerCase()}.`}
        table={() => <ChartTable rows={rows} x={tip} xLabel={xLabel} series={outcomes} />}
      >
        <LineChart data={rows} x={x} tooltipLabel={tip} series={outcomes} label={`Replies and meetings per ${unit}`} />
      </Card>
    </div>
  );
}

export function LinkedinBlock({ linkedin }) {
  if (!linkedin || linkedin.source === 'none') {
    return <EmptyState inline title="Not available with these filters">{linkedin?.note}</EmptyState>;
  }
  const stats = linkedin.source === 'heyreach'
    ? [['Invites sent', linkedin.invitesSent], ['Invites accepted', linkedin.invitesAccepted], ['First messages', linkedin.messagesSent], ['Replies', linkedin.replies]]
    : [['First messages', linkedin.messagesSent], ['Replies', linkedin.replies], ['Positive replies', linkedin.positive]];

  return (
    <>
      <div className="mini-stats">
        {stats.map(([label, kpi]) => (
          <div key={label} className="mini-stat">
            <span className="mini-stat-label">{label}</span>
            <span className="mini-stat-value">{fmtInt(kpi?.value)}<Delta small change={kpi?.change} /></span>
          </div>
        ))}
        {linkedin.source === 'heyreach' && (
          <div className="mini-stat">
            <span className="mini-stat-label">Acceptance rate</span>
            <span className="mini-stat-value">{fmtPct(linkedin.acceptanceRate)}</span>
          </div>
        )}
      </div>
      {linkedin.note && <p className="card-foot">{linkedin.note}</p>}
    </>
  );
}

export function MiniStat({ label, value, change, sub }) {
  return (
    <div className="mini-stat">
      <span className="mini-stat-label">{label}</span>
      <span className="mini-stat-value">{value}{change !== undefined && <Delta small change={change} />}</span>
      {sub && <span className="tile-foot-text">{sub}</span>}
    </div>
  );
}

/** A number with its change underneath, for table cells. */
export function withDelta(value, change, { format = fmtInt, points = false, upIsGood = true } = {}) {
  return (
    <span className="cell-stack">
      {format(value)}
      {points ? <Delta small points={change} upIsGood={upIsGood} /> : <Delta small change={change} upIsGood={upIsGood} />}
    </span>
  );
}

export function rateCell(rate, lowSample, detail) {
  return (
    <span className="cell-stack">
      {fmtPct(rate)}
      {lowSample ? <span className="cell-sub">small sample</span> : detail ? <span className="cell-sub">{detail}</span> : null}
    </span>
  );
}

/**
 * Whether a booking is still ahead or moved to a later slot. Whether a past
 * meeting was held is deliberately not shown anywhere (Ayush, 2026-11-03).
 */
export const MEETING_STATUS = {
  rescheduled: 'Rescheduled',
  upcoming: 'Upcoming',
};

// Which rung of the booking waterfall this meeting came from.
export const BOOKED_VIA = {
  sheet: 'Audit sheet',
  slack: 'Slack alert',
  hubspot: 'HubSpot',
};

const ACCOUNT_STATUS = {
  meeting: { label: 'Meeting', tone: 'accent', rank: 6 },
  positive: { label: 'Positive reply', tone: 'good', rank: 5 },
  replied: { label: 'Replied', tone: 'neutral', rank: 4 },
  contacted: { label: 'Contacted', tone: 'neutral', rank: 3 },
  negative: { label: 'Said no', tone: 'bad', rank: 2 },
  loaded: { label: 'Not contacted', tone: 'neutral', rank: 1 },
};

export function campaignColumns({ teamColor, withFilters, programName, withSdr = true, withProgram = false }) {
  return [
    {
      key: 'name',
      label: 'Campaign',
      sort: r => r.name,
      csv: r => r.name,
      render: r => (
        <>
          <Link href={withFilters(campaignHref(r.id))} className="truncate" title={r.name}>{r.name}</Link>
          <span className="cell-sub">
            {[
              r.platform === 'heyreach' ? 'LinkedIn' : 'Email',
              statusLabel(r.status),
              r.program ? programName(r.program) : r.theme !== 'Other' ? r.theme : null,
            ].filter(Boolean).join(', ')}
          </span>
        </>
      ),
    },
    withSdr && {
      key: 'sdr',
      label: 'SDR',
      sort: r => r.sdr,
      csv: r => r.sdr,
      render: r => (r.sdr ? <Person name={r.sdr} color={teamColor(r.sdr)} href={withFilters(sdrHref(r.sdr))} size={22} /> : <span className="muted">Unattributed</span>),
    },
    withProgram && {
      key: 'program',
      label: 'Program',
      sort: r => r.program,
      csv: r => r.program && programName(r.program),
      render: r => (r.program ? <Link href={withFilters(programHref(r.program))}>{programName(r.program)}</Link> : <span className="muted">–</span>),
    },
    {
      key: 'companies',
      label: 'Companies',
      sort: r => r.companies.count,
      csv: r => `${r.companies.count}: ${r.companies.top.join('; ')}`,
      render: r => (r.companies.count ? (
        <>
          <span className="truncate" style={{ maxWidth: 200 }} title={r.companies.top.join(', ')}>{r.companies.top.join(', ')}</span>
          <span className="cell-sub">{fmtInt(r.companies.count)} {r.companies.count === 1 ? 'company' : 'companies'}</span>
        </>
      ) : <span className="muted">–</span>),
    },
    { key: 'people', label: 'People', align: 'right', sort: r => campaignResults(r).people, csv: r => campaignResults(r).people, render: r => fmtInt(campaignResults(r).people) },
    {
      key: 'reached',
      label: 'Reached',
      align: 'right',
      sort: r => campaignResults(r).reached,
      csv: r => campaignResults(r).reached,
      render: r => cellStack(fmtInt(campaignResults(r).reached), campaignResults(r).reachedNote),
    },
    {
      key: 'replied',
      label: 'Replied',
      align: 'right',
      sort: r => campaignResults(r).replied,
      csv: r => campaignResults(r).replied,
      render: r => cellStack(fmtInt(campaignResults(r).replied), fmtPct(campaignResults(r).replyRate)),
    },
    {
      key: 'positive',
      label: 'Positive',
      align: 'right',
      sort: r => campaignResults(r).positive,
      csv: r => campaignResults(r).positive,
      render: r => cellStack(fmtInt(campaignResults(r).positive), fmtPct(campaignResults(r).positiveRate)),
    },
    { key: 'meetings', label: 'Meetings', align: 'right', sort: r => campaignResults(r).meetings, csv: r => campaignResults(r).meetings, render: r => fmtInt(campaignResults(r).meetings) },
    {
      key: 'sent',
      label: 'Sent in range',
      hint: 'First emails, or invites and first messages, in the selected dates; follow-ups not counted',
      align: 'right',
      sort: r => campaignResults(r).sentInRange,
      csv: r => campaignResults(r).sentInRange,
      render: r => cellStack(fmtInt(campaignResults(r).sentInRange), r.lastActivityAt ? `last ${fmtDate(r.lastActivityAt)}` : null),
    },
  ].filter(Boolean);
}

const cellStack = (value, sub) => <span className="cell-stack">{value}{sub && <span className="cell-sub">{sub}</span>}</span>;

/**
 * Whole-campaign results in one shape for either channel. Reached is leads
 * contacted for email, and people invited or messaged for LinkedIn; the reply
 * rate is per contacted lead for email and per messaged person for LinkedIn.
 */
export function campaignResults(r) {
  if (r.linkedin) {
    return {
      people: r.linkedin.people,
      reached: r.linkedin.reached,
      reachedNote: `${fmtInt(r.linkedin.accepted)} accepted`,
      replied: r.linkedin.replied,
      replyRate: r.linkedin.replyRate,
      positive: r.linkedin.positive,
      positiveRate: r.linkedin.positiveRate,
      meetings: r.linkedin.meetings,
      sentInRange: r.period.linkedinInvitesSent + r.period.linkedinMessagesSent,
    };
  }
  return {
    people: r.lifetime.leads,
    reached: r.lifetime.contacted,
    reachedNote: `${fmtInt(r.lifetime.sent)} first emails`,
    replied: r.lifetime.replied,
    replyRate: r.lifetime.replyRate,
    positive: r.lifetime.positive,
    positiveRate: r.lifetime.positiveRate,
    meetings: r.lifetime.meetings,
    sentInRange: r.period.sent,
  };
}

export function meetingColumns({ teamColor, withFilters, withSdr = true }) {
  return [
    { key: 'date', label: 'Date', sort: r => r.date, csv: r => r.date, render: r => <span className="nowrap">{fmtDate(r.date, { year: true })}</span> },
    {
      key: 'company',
      label: 'Company',
      sort: r => r.domain || r.company,
      csv: r => r.domain || r.company,
      render: r => (
        <>
          <span>{r.domain || r.company}</span>
          {r.championTitle && r.championTitle !== '-' && (
            <span className="cell-sub">{r.championTitle}{String(r.seniorChampion).toLowerCase() === 'yes' ? ', senior champion' : ''}</span>
          )}
        </>
      ),
    },
    {
      key: 'channel',
      label: 'Channel',
      sort: r => r.channel,
      csv: r => r.channel,
      render: r => <>{r.channel || <span className="muted">Not stated</span>}{r.source && r.source !== r.channel && <span className="cell-sub">{r.source}</span>}</>,
    },
    {
      key: 'bookedVia',
      label: 'Booked via',
      sort: r => r.bookedVia,
      csv: r => BOOKED_VIA[r.bookedVia] || r.bookedVia,
      render: r => <span className="cell-sub">{BOOKED_VIA[r.bookedVia] || r.bookedVia || '–'}</span>,
    },
    withSdr && {
      key: 'sdr',
      label: 'SDR',
      sort: r => r.sdr,
      csv: r => r.sdr,
      render: r => (r.sdr ? <Person name={r.sdr} color={teamColor(r.sdr)} href={withFilters(sdrHref(r.sdr))} size={22} /> : <span className="muted">–</span>),
    },
    {
      key: 'campaign',
      label: 'Campaign',
      sort: r => r.campaign,
      csv: r => r.campaign,
      render: r => (r.campaignId
        ? <Link className="truncate" href={withFilters(campaignHref(r.campaignId))} title={r.campaign}>{r.campaign}</Link>
        : <span className="muted">No campaign match</span>),
    },
    {
      key: 'status',
      label: 'Status',
      sort: r => MEETING_STATUS[r.outcome] || '',
      csv: r => MEETING_STATUS[r.outcome] || '',
      render: r => (MEETING_STATUS[r.outcome] ? <Badge tone="neutral">{MEETING_STATUS[r.outcome]}</Badge> : <span className="muted">–</span>),
    },
    { key: 'segment', label: 'Segment', sort: r => r.segment, csv: r => r.segment, render: r => r.segment || '–' },
  ].filter(Boolean);
}

export function accountColumns() {
  return [
    {
      key: 'company',
      label: 'Account',
      sort: r => r.company || r.domain,
      csv: r => r.domain,
      render: r => <><span>{r.company || r.domain}</span><span className="cell-sub">{r.domain}{r.category ? `, ${r.category}` : ''}</span></>,
    },
    {
      key: 'status',
      label: 'Furthest stage',
      sort: r => ACCOUNT_STATUS[r.status]?.rank,
      csv: r => ACCOUNT_STATUS[r.status]?.label,
      render: r => <Badge tone={ACCOUNT_STATUS[r.status]?.tone}>{ACCOUNT_STATUS[r.status]?.label || r.status}</Badge>,
    },
    { key: 'sdrs', label: 'SDRs', sort: r => r.sdrs.join(', '), csv: r => r.sdrs.join('; '), render: r => (r.sdrs.length ? r.sdrs.join(', ') : '–') },
    { key: 'companyType', label: 'Type', sort: r => r.companyType, csv: r => r.companyType, render: r => r.companyType || '–' },
    { key: 'employees', label: 'Employees', align: 'right', sort: r => r.employees, csv: r => r.employees, render: r => fmtInt(r.employees) },
    { key: 'leads', label: 'Leads', align: 'right', sort: r => r.leads, csv: r => r.leads, render: r => fmtInt(r.leads) },
    { key: 'contacted', label: 'Contacted', align: 'right', sort: r => r.contacted, csv: r => r.contacted, render: r => fmtInt(r.contacted) },
    { key: 'replied', label: 'Replied', align: 'right', sort: r => r.replied, csv: r => r.replied, render: r => fmtInt(r.replied) },
    { key: 'positive', label: 'Positive', align: 'right', sort: r => r.positive, csv: r => r.positive, render: r => fmtInt(r.positive) },
    {
      key: 'meetings',
      label: 'Meetings',
      align: 'right',
      sort: r => r.meetings,
      csv: r => r.meetings,
      render: r => fmtInt(r.meetings),
    },
    { key: 'firstLoadedAt', label: 'First loaded', sort: r => r.firstLoadedAt, csv: r => r.firstLoadedAt, render: r => <span className="nowrap">{fmtDate(r.firstLoadedAt, { year: true })}</span> },
  ];
}

export const POSITIVE_SOURCE = { sheet: 'Sheet', booked: 'Booked meeting', labels: 'Reply label' };

/**
 * The positive responses behind a range and what each person said. SDR rows are
 * from the positive response sheet, which holds no reply text: it is matched from
 * our conversations, and where we hold no reply the SDR's own note stands in. A
 * booking nobody logged shows the reply that led to it, or the meeting.
 */
export function PositiveResponses({ rows = [], onOpen, exportName = 'positive-responses', withSdr = true }) {
  const columns = [
    { key: 'at', label: 'Date', sort: r => r.at, csv: r => String(r.at).slice(0, 10), render: r => <span className="nowrap">{fmtDate(r.at, { year: true })}</span> },
    { key: 'name', label: 'Person', sort: r => r.name, csv: r => r.name, render: r => <span className="cell-stack start">{r.name || '-'}{r.company && <span className="cell-sub">{r.company}</span>}</span> },
    withSdr && { key: 'sdr', label: 'SDR', sort: r => r.sdr || '', csv: r => r.sdr || '', render: r => r.sdr || <span className="muted">-</span> },
    { key: 'channel', label: 'Channel', sort: r => r.channel, csv: r => r.channel, render: r => (r.channel === 'email' ? 'Email' : 'LinkedIn') },
    {
      key: 'said',
      label: 'What they said',
      csv: r => r.quote || r.note || '',
      render: r => (r.quote
        ? <span className="positive-said">“{r.quote}”</span>
        : <span className="positive-said muted">{r.note ? (r.source === 'booked' ? r.note : `SDR note: ${r.note}`) : 'Reply not in our conversations'}</span>),
    },
    { key: 'status', label: 'Status', sort: r => r.status || '', csv: r => r.status || '', render: r => r.status || <span className="muted">-</span> },
    { key: 'source', label: 'From', sort: r => r.source, csv: r => r.source, render: r => <span className="muted nowrap">{POSITIVE_SOURCE[r.source]}</span> },
  ].filter(Boolean);
  return (
    <DataTable
      columns={columns}
      rows={rows}
      rowKey={(r, i) => `${r.at}-${r.name}-${i}`}
      dense
      pageSize={10}
      searchable
      searchPlaceholder="Search people and companies"
      exportName={exportName}
      initialSort={{ key: 'at', dir: 'desc' }}
      empty="No positive responses in this range."
      onRowClick={onOpen ? r => r.companyKey && onOpen(r) : undefined}
      rowLabel={r => `Open the conversation with ${r.company || r.name}`}
    />
  );
}

/** Replies with what they said. With `onOpen`, a reply whose company is known opens that company's conversation. */
export function ReplyFeed({ replies = [], onOpen }) {
  if (!replies.length) {
    return (
      <EmptyState inline title="No replies yet">
        Replies show here with what they said once the daily sync picks them up.
      </EmptyState>
    );
  }
  return (
    <ul className="feed">
      {replies.map((r, i) => {
        const verdict = VERDICTS[r.verdict] || VERDICTS.unknown;
        const quote = <span className="feed-quote">{r.quote ? `“${r.quote}”` : <span className="muted">No text in the reply</span>}</span>;
        const sub = <span className="feed-sub">{[r.name, r.domain, r.campaign].filter(Boolean).join(', ')}</span>;
        return (
          <li key={`${r.repliedAt}-${i}`}>
            <div className="feed-meta">
              <span>{fmtDate(r.repliedAt, { year: true })}</span>
              <Badge tone={verdict.tone} title={r.reason || undefined}>{verdict.label}</Badge>
            </div>
            {onOpen && r.companyKey ? (
              <button type="button" className="feed-open" onClick={() => onOpen(r)} aria-label={`Open the conversation with ${r.domain || r.name}`}>
                {quote}{sub}
              </button>
            ) : (
              <div className="feed-body">{quote}{sub}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
