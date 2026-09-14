'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import { Clock } from 'lucide-react';
import { useDashboard } from '@/lib/client/dashboard-context';
import { fmtCompact, fmtDate, fmtInt, fmtMoney, fmtPct, fmtPeriod, fmtRelative, VERDICTS } from '@/lib/client/format';
import ChartTable from '../charts/ChartTable';
import LineChart from '../charts/LineChart';
import Badge from '../ui/Badge';
import Card from '../ui/Card';
import Delta from '../ui/Delta';
import { Person } from '../ui/Person';
import StatTile from '../ui/StatTile';
import { EmptyState } from '../ui/States';

export const SERIES = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)'];

export const campaignHref = id => `/campaigns/${encodeURIComponent(id)}`;
export const sdrHref = name => `/sdrs/${encodeURIComponent(name)}`;
export const programHref = slug => `/programs/${slug}`;

export const pctChange = (current, previous) =>
  (previous > 0 ? Math.round(((current - previous) / previous) * 1000) / 10 : null);

const PERIOD_PHRASES = {
  'this-week': 'this week so far',
  'last-week': 'last week',
  'last-4-weeks': 'in the last 4 weeks',
  'last-12-weeks': 'in the last 12 weeks',
  'this-month': 'this month so far',
  'last-month': 'last month',
  'last-3-months': 'in the last 3 months',
  ytd: 'so far this year',
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

export function SyncStatus() {
  const { meta } = useDashboard();
  if (!meta) return null;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <Clock size={13} aria-hidden="true" />
      {meta.lastSyncAt ? `Synced ${fmtRelative(meta.lastSyncAt)}` : 'Not synced yet'}
    </span>
  );
}

/** Stat tile from a KPI payload ({ value, previous, change | pointChange, trend }). */
export function KpiTile({ label, kpi, format = fmtCompact, rate = false, upIsGood = true, note }) {
  if (!kpi) return null;
  return (
    <StatTile
      label={label}
      value={format(kpi.value)}
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
      <KpiTile label="Leads contacted" kpi={kpis.leadsContacted} />
      <KpiTile label="Emails sent" kpi={kpis.emailsSent} />
      <KpiTile label="Replies" kpi={kpis.replies} />
      <KpiTile label="Positive replies" kpi={kpis.positive} />
      <KpiTile label="Positive rate" kpi={kpis.positiveRate} rate format={v => fmtPct(v)} />
      <KpiTile label="Meetings" kpi={kpis.meetings} />
      <KpiTile label="Meetings held" kpi={kpis.meetingsHeld} />
    </div>
  );
}

const MOVERS = [
  ['leadsContacted', 'leads contacted'],
  ['emailsSent', 'emails sent'],
  ['replies', 'replies'],
  ['positive', 'positive replies'],
  ['meetings', 'meetings'],
  ['meetingsHeld', 'meetings held'],
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
  const lead = `${fmtInt(positive.value)} positive ${positive.value === 1 ? 'reply' : 'replies'} from ${fmtInt(kpis.leadsContacted.value)} leads contacted ${periodPhrase(range)}${versus}.`;

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
  const volume = [
    { key: 'leadsContacted', label: 'Leads contacted', color: SERIES[0] },
    { key: 'sent', label: 'Emails sent', color: SERIES[1] },
  ];
  const outcomes = [
    { key: 'replies', label: 'Replies', color: SERIES[0] },
    { key: 'positive', label: 'Positive replies', color: SERIES[1] },
    { key: 'meetings', label: 'Meetings', color: SERIES[2] },
  ];
  const xLabel = unit === 'month' ? 'Month' : 'Week';

  return (
    <div className="grid-2">
      <Card
        title={`Outreach per ${unit}`}
        subtitle="New leads contacted and emails sent, from Instantly analytics."
        table={() => <ChartTable rows={rows} x={tip} xLabel={xLabel} series={volume} />}
      >
        <LineChart data={rows} x={x} tooltipLabel={tip} series={volume} label={`Outreach per ${unit}`} />
      </Card>
      <Card
        title={`Replies and meetings per ${unit}`}
        subtitle="Replies by the date they came in; meetings by the date they were held."
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
    ? [['Invites sent', linkedin.invitesSent], ['Invites accepted', linkedin.invitesAccepted], ['Messages sent', linkedin.messagesSent], ['Replies', linkedin.replies]]
    : [['Messages sent', linkedin.messagesSent], ['Replies', linkedin.replies], ['Positive replies', linkedin.positive]];

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

export function HeldBadge({ happened }) {
  const value = String(happened || '').toLowerCase();
  if (value === 'yes') return <Badge tone="good">Held</Badge>;
  if (value === 'no') return <Badge tone="bad">No-show</Badge>;
  if (value === 'not yet') return <Badge>Upcoming</Badge>;
  return <Badge tone="warn">Needs review</Badge>;
}

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
    reachedNote: `${fmtInt(r.lifetime.sent)} emails`,
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
      render: r => <>{r.channel || '–'}{r.source && r.source !== r.channel && <span className="cell-sub">{r.source}</span>}</>,
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
    { key: 'held', label: 'Held', sort: r => (r.held ? 1 : 0), csv: r => r.happened, render: r => <HeldBadge happened={r.happened} /> },
    { key: 'qualified', label: 'Qualified', sort: r => (r.qualified ? 1 : 0), csv: r => (r.qualified ? 'Yes' : 'No'), render: r => (r.qualified ? 'Yes' : 'No') },
    { key: 'dealValue', label: 'Deal value', align: 'right', sort: r => r.dealValue, csv: r => r.dealValue, render: r => fmtMoney(r.dealValue) },
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
      render: r => (r.meetings ? <span className="cell-stack">{fmtInt(r.meetings)}<span className="cell-sub">{fmtInt(r.meetingsHeld)} held</span></span> : '0'),
    },
    { key: 'firstLoadedAt', label: 'First loaded', sort: r => r.firstLoadedAt, csv: r => r.firstLoadedAt, render: r => <span className="nowrap">{fmtDate(r.firstLoadedAt, { year: true })}</span> },
  ];
}

export function ReplyFeed({ replies = [] }) {
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
        return (
          <li key={`${r.repliedAt}-${i}`}>
            <div className="feed-meta">
              <span>{fmtDate(r.repliedAt, { year: true })}</span>
              <Badge tone={verdict.tone} title={r.reason || undefined}>{verdict.label}</Badge>
            </div>
            <div>
              <div className="feed-quote">{r.quote ? `“${r.quote}”` : <span className="muted">No text in the reply</span>}</div>
              <div className="feed-sub">{[r.name, r.domain, r.campaign].filter(Boolean).join(', ')}</div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
