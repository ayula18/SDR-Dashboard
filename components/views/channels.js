'use client';

import { fmtDate, fmtInt, fmtPeriod, VERDICTS } from '@/lib/client/format';
import ChartTable from '../charts/ChartTable';
import LineChart from '../charts/LineChart';
import Badge from '../ui/Badge';
import Card from '../ui/Card';
import { SERIES } from './common';

export const CHANNELS = {
  both: { label: 'Both', tone: 'accent' },
  email: { label: 'Email only', tone: 'neutral' },
  linkedin: { label: 'LinkedIn only', tone: 'neutral' },
};

export const STAGES = {
  meeting: { label: 'Meeting', tone: 'accent', rank: 7 },
  positive: { label: 'Positive reply', tone: 'good', rank: 6 },
  replied: { label: 'Replied', tone: 'neutral', rank: 5 },
  connected: { label: 'Connected', tone: 'neutral', rank: 4 },
  contacted: { label: 'Contacted', tone: 'neutral', rank: 3 },
  negative: { label: 'Said no', tone: 'bad', rank: 2 },
  loaded: { label: 'Not contacted', tone: 'neutral', rank: 1 },
};

const REPLY_ORDER = ['interested', 'deferred', 'not_the_person', 'unknown', 'declined', 'unsubscribed'];
export const replySort = verdict => (REPLY_ORDER.includes(verdict) ? REPLY_ORDER.length - REPLY_ORDER.indexOf(verdict) : null);

const none = () => <span className="muted">–</span>;
const stack = (value, sub) => <span className="cell-stack">{value}<span className="cell-sub">{sub}</span></span>;

export function VerdictBadge({ verdict }) {
  if (!verdict) return none();
  const v = VERDICTS[verdict] || VERDICTS.unknown;
  return <Badge tone={v.tone}>{v.label}</Badge>;
}

/** Columns for companiesAcrossChannels rows: one company, its email and LinkedIn outreach side by side. */
export function companyColumns() {
  return [
    {
      key: 'company',
      label: 'Company',
      sort: r => r.company,
      csv: r => r.domain || r.company,
      render: r => <><span>{r.company}</span><span className="cell-sub">{r.domain || 'No domain matched yet'}</span></>,
    },
    {
      key: 'channels',
      label: 'Channels',
      sort: r => r.channels,
      csv: r => CHANNELS[r.channels].label,
      render: r => <Badge tone={CHANNELS[r.channels].tone}>{CHANNELS[r.channels].label}</Badge>,
    },
    {
      key: 'stage',
      label: 'Furthest stage',
      sort: r => STAGES[r.stage].rank,
      csv: r => STAGES[r.stage].label,
      render: r => <Badge tone={STAGES[r.stage].tone}>{STAGES[r.stage].label}</Badge>,
    },
    { key: 'sdrs', label: 'SDRs', sort: r => r.sdrs.join(', '), csv: r => r.sdrs.join('; '), render: r => (r.sdrs.length ? r.sdrs.join(', ') : none()) },
    {
      key: 'emailPeople',
      label: 'Email',
      align: 'right',
      sort: r => r.email?.people,
      csv: r => r.email?.people ?? '',
      render: r => (r.email ? stack(fmtInt(r.email.people), `${fmtInt(r.email.contacted)} contacted`) : none()),
    },
    {
      key: 'emailReplied',
      label: 'Email replies',
      align: 'right',
      sort: r => r.email?.replied,
      csv: r => r.email?.replied ?? '',
      render: r => (r.email ? stack(fmtInt(r.email.replied), `${fmtInt(r.email.positive)} positive`) : none()),
    },
    {
      key: 'linkedinPeople',
      label: 'LinkedIn',
      align: 'right',
      sort: r => r.linkedin?.people,
      csv: r => r.linkedin?.people ?? '',
      render: r => (r.linkedin ? stack(fmtInt(r.linkedin.people), `${fmtInt(r.linkedin.accepted)} accepted`) : none()),
    },
    {
      key: 'linkedinReplied',
      label: 'LinkedIn replies',
      align: 'right',
      sort: r => r.linkedin?.replied,
      csv: r => r.linkedin?.replied ?? '',
      render: r => (r.linkedin ? stack(fmtInt(r.linkedin.replied), `${fmtInt(r.linkedin.positive)} positive`) : none()),
    },
    {
      key: 'bestVerdict',
      label: 'Best reply',
      sort: r => replySort(r.bestVerdict),
      csv: r => VERDICTS[r.bestVerdict]?.label || '',
      render: r => <VerdictBadge verdict={r.bestVerdict} />,
    },
    {
      key: 'meetings',
      label: 'Meetings',
      align: 'right',
      sort: r => r.meetings,
      csv: r => r.meetings,
      render: r => (r.meetings ? stack(fmtInt(r.meetings), `${fmtInt(r.meetingsHeld)} held`) : '0'),
    },
    {
      key: 'lastTouchAt',
      label: 'Last touch',
      sort: r => r.lastTouchAt,
      csv: r => r.lastTouchAt,
      render: r => <span className="nowrap">{fmtDate(r.lastTouchAt, { year: true })}</span>,
    },
  ];
}

/** Activity per week or month: email and LinkedIn each on their own chart, then replies. */
export function ChannelTrendCards({ rows, grain, email = true, linkedin = true }) {
  const unit = grain === 'month' ? 'month' : 'week';
  const xLabel = unit === 'month' ? 'Month' : 'Week';
  const x = row => fmtPeriod(grain, row.period);
  const tip = row => fmtPeriod(grain, row.period, { long: true });
  const chart = (title, subtitle, series) => (
    <Card key={title} title={title} subtitle={subtitle} table={() => <ChartTable rows={rows} x={tip} xLabel={xLabel} series={series} />}>
      <LineChart data={rows} x={x} tooltipLabel={tip} series={series} label={title} />
    </Card>
  );

  const replySeries = [
    email && { key: 'replies', label: 'Email replies' },
    linkedin && { key: 'linkedinReplies', label: 'LinkedIn replies' },
    email && { key: 'meetings', label: 'Meetings' },
  ].filter(Boolean).map((s, i) => ({ ...s, color: SERIES[i] }));

  const cards = [
    email && chart(`Email per ${unit}`, 'New leads contacted and emails sent, from Instantly analytics.', [
      { key: 'leadsContacted', label: 'Leads contacted', color: SERIES[0] },
      { key: 'sent', label: 'Emails sent', color: SERIES[1] },
    ]),
    linkedin && chart(`LinkedIn per ${unit}`, 'Invites sent and accepted, and messages sent, from HeyReach.', [
      { key: 'linkedinInvitesSent', label: 'Invites sent', color: SERIES[0] },
      { key: 'linkedinInvitesAccepted', label: 'Invites accepted', color: SERIES[1] },
      { key: 'linkedinMessagesSent', label: 'Messages sent', color: SERIES[2] },
    ]),
    chart(
      `Replies per ${unit}`,
      email ? 'Replies by the date they came in; meetings by the date they were held.' : 'LinkedIn replies by the date they came in, from HeyReach.',
      replySeries,
    ),
  ].filter(Boolean);

  return <div className={cards.length === 3 ? 'grid-3' : 'grid-2'}>{cards}</div>;
}
