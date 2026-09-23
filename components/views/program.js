'use client';

import { ChevronRight } from 'lucide-react';
import { fmtDate, fmtDateRange, fmtInt, fmtMoney, fmtPct, fmtPeriod, VERDICTS } from '@/lib/client/format';
import ChartTable from '../charts/ChartTable';
import LineChart from '../charts/LineChart';
import Badge from '../ui/Badge';
import Card from '../ui/Card';
import Delta from '../ui/Delta';
import Drawer from '../ui/Drawer';
import { Person } from '../ui/Person';
import { CHANNELS, STAGES, VerdictBadge, replySort } from './channels';
import { SERIES, sdrHref } from './common';

const POSITIVE = ['interested', 'deferred'];
const none = () => <span className="muted">–</span>;
const stack = (value, sub) => <span className="cell-stack">{value}{sub && <span className="cell-sub">{sub}</span>}</span>;
const plural = (n, one, many = `${one}s`) => `${fmtInt(n)} ${n === 1 ? one : many}`;

export const CHANNEL_VIEWS = [['both', 'Both'], ['email', 'Email'], ['linkedin', 'LinkedIn']];
const CHANNEL_PHRASE = { both: 'on email and LinkedIn', email: 'by email', linkedin: 'on LinkedIn' };

/** Both, Email or LinkedIn. A channel the program has never used is shown but can't be picked. */
export function ChannelToggle({ value, onChange, available }) {
  return (
    <div className="segmented" role="group" aria-label="Channel">
      {CHANNEL_VIEWS.map(([key, label]) => {
        const missing = key !== 'both' && available && !available[key];
        return (
          <button
            key={key}
            type="button"
            aria-pressed={value === key}
            disabled={missing}
            title={missing ? `This program has no ${label} campaigns` : undefined}
            onClick={() => onChange(key)}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

const listNames = names => (names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`);

/** The page's answer in two sentences: how many companies, and what came of them. */
export function ProgramLead({ name, range, summary, channel, companies }) {
  const when = range.sinceStart ? `Since ${fmtDate(range.from)}` : `From ${fmtDateRange(range.from, range.to)}`;
  const positives = companies
    .filter(c => c.positive > 0)
    .sort((a, b) => new Date(b.lastTouchAt || 0) - new Date(a.lastTouchAt || 0))
    .map(c => c.company);
  const shown = positives.slice(0, 3);
  const more = positives.length - shown.length;

  const outcome = summary.replied
    ? `${plural(summary.replied, 'company', 'companies')} replied${summary.positive
      ? ` and ${fmtInt(summary.positive)} ${summary.positive === 1 ? 'was' : 'were'} positive: ${listNames(more > 0 ? [...shown, `${fmtInt(more)} more`] : shown)}.`
      : ', none positive yet.'}`
    : 'No replies yet.';
  const meetings = summary.withMeeting
    ? ` ${plural(summary.withMeeting, 'company', 'companies')} took a meeting${summary.pipeline ? `, ${fmtMoney(summary.pipeline)} qualified pipeline` : ''}.`
    : ' No meetings yet.';

  return (
    <p className="program-lead">
      {when}, {name} reached {plural(summary.total, 'company', 'companies')} {CHANNEL_PHRASE[channel]}.{' '}
      <span className="program-lead-rest">{outcome}{meetings}</span>
    </p>
  );
}

/**
 * Touchpoints → unique companies → replied → positive → meeting → pipeline.
 * Touchpoints count what went out (emails, invites, messages); every later step
 * counts companies. Steps with a list open it.
 */
export function CompanyFunnel({ summary, channel, range, email, linkedin, onOpenList }) {
  const both = channel === 'both';
  // Parts that add up to the step: email only, LinkedIn only and both, so a company on both channels counts once.
  const split = key => {
    // A response cached before `split` existed (an open tab across a deploy) has no parts; show no note until it refreshes.
    const m = summary.split?.[key];
    if (!both || !m) return null;
    return [[m.emailOnly, 'email only'], [m.linkedinOnly, 'LinkedIn only'], [m.both, 'both']]
      .filter(([n]) => n > 0)
      .map(([n, label]) => `${fmtInt(n)} ${label}`)
      .join(', ') || null;
  };
  const emails = email?.emailsSent || 0;
  const invites = linkedin?.invitesSent || 0;
  const messages = linkedin?.messagesSent || 0;
  const touchNote = [email && plural(emails, 'email'), linkedin && plural(invites, 'invite'), linkedin && plural(messages, 'message')].filter(Boolean).join(', ');
  const steps = [
    { key: 'touches', label: 'Touchpoints', value: emails + invites + messages, note: touchNote },
    { key: 'companies', label: 'Unique companies', value: summary.total, count: summary.total, note: split('touched'), list: 'companies' },
    { key: 'replied', label: 'Replied', value: summary.replied, count: summary.replied, note: split('replied'), list: 'replied', converts: true },
    { key: 'positive', label: 'Positive', value: summary.positive, count: summary.positive, note: split('positive'), list: 'positive', converts: true },
    {
      key: 'meeting', label: 'Meeting', value: summary.withMeeting, count: summary.withMeeting, list: 'meeting', converts: true,
      note: summary.meetings ? `${plural(summary.meetings, 'meeting')}, ${fmtInt(summary.held)} held` : null,
    },
    {
      key: 'pipeline', label: 'Qualified pipeline', value: summary.pipeline, money: true,
      note: summary.qualified ? plural(summary.qualified, 'qualified meeting') : 'From qualified meetings',
    },
  ];

  return (
    <Card
      title="Funnel"
      subtitle={range.sinceStart
        ? 'Every touch this program has sent, the unique companies it reached, and how far each has got. Open a step to see which companies.'
        : 'Touches sent in this range, the unique companies they reached, and how far each has got since. Open a step to see which companies.'}
    >
      <ol className="stepper">
        {steps.map((step, i) => {
          const previous = step.converts ? steps[i - 1].count : null;
          const conversion = previous ? (step.count / previous) * 100 : null;
          const clickable = step.list && step.count > 0;
          const body = (
            <>
              <span className="stepper-label">
                {step.label}
                {clickable && <ChevronRight aria-hidden="true" />}
              </span>
              <span className="stepper-value">{step.money ? fmtMoney(step.value) : fmtInt(step.value)}</span>
              {conversion != null && (
                <span className="stepper-conv">{fmtPct(conversion, conversion > 0 && conversion < 10 ? 1 : 0)} of {steps[i - 1].label.toLowerCase()}</span>
              )}
              {step.note && <span className="stepper-note">{step.note}</span>}
            </>
          );
          return (
            <li key={step.key} className="stepper-step">
              {clickable ? (
                <button type="button" className="stepper-body" onClick={() => onOpenList(step.list)}>{body}</button>
              ) : (
                <div className="stepper-body">{body}</div>
              )}
            </li>
          );
        })}
      </ol>
    </Card>
  );
}

/** One channel's activity in the range, in the same shape for email and LinkedIn. */
export function ChannelCard({ channel, numbers, change }) {
  if (!numbers) return null;
  const email = channel === 'email';
  const stats = email
    ? [
      { key: 'peopleEmailed', label: 'People emailed' },
      { key: 'emailsSent', label: 'Emails sent' },
      { key: 'bounced', label: 'Bounced', sub: numbers.bounceRate != null ? `${fmtPct(numbers.bounceRate)} of sent` : null, upIsGood: false },
      { key: 'replied', label: 'Replied', sub: numbers.replyRate != null ? `${fmtPct(numbers.replyRate)} of people emailed` : null },
      { key: 'positive', label: 'Positive' },
      { key: 'negative', label: 'Said no', upIsGood: false },
    ]
    : [
      { key: 'invitesSent', label: 'Invites sent' },
      { key: 'accepted', label: 'Accepted', sub: numbers.acceptanceRate != null ? `${fmtPct(numbers.acceptanceRate)} of invites` : null },
      { key: 'messagesSent', label: 'Messages sent' },
      { key: 'replied', label: 'Replied', sub: 'people' },
      { key: 'positive', label: 'Positive' },
      { key: 'negative', label: 'Said no', upIsGood: false },
    ];

  return (
    <Card
      title={email ? 'Email' : 'LinkedIn'}
      subtitle={email
        ? 'What went out on Instantly in this range, and the replies that came back.'
        : 'What went out on HeyReach in this range, and the replies that came back.'}
    >
      <div className="mini-stats">
        {stats.map(s => (
          <div key={s.key} className="mini-stat">
            <span className="mini-stat-label">{s.label}</span>
            <span className="mini-stat-value">
              {fmtInt(numbers[s.key])}
              {change && <Delta small change={change[s.key]} upIsGood={s.upIsGood !== false} />}
            </span>
            {s.sub && <span className="tile-foot-text">{s.sub}</span>}
          </div>
        ))}
      </div>
    </Card>
  );
}

/** Touches and replies per week or month, each series keeping its colour whichever channel is shown. */
export function ProgramTrend({ rows, grain, channel }) {
  const email = channel !== 'linkedin';
  const linkedin = channel !== 'email';
  const unit = grain === 'month' ? 'month' : 'week';
  const x = row => fmtPeriod(grain, row.period);
  const tip = row => fmtPeriod(grain, row.period, { long: true });
  const data = rows.map(r => ({ ...r, positiveShown: (email ? r.positive : 0) + (linkedin ? r.linkedinPositive : 0) }));

  const touches = [
    email && { key: 'sent', label: 'Emails sent', color: SERIES[0] },
    linkedin && { key: 'linkedinInvitesSent', label: 'Invites sent', color: SERIES[1] },
    linkedin && { key: 'linkedinMessagesSent', label: 'Messages sent', color: SERIES[2] },
  ].filter(Boolean);
  const replies = [
    email && { key: 'replies', label: 'Email replies', color: SERIES[0] },
    linkedin && { key: 'linkedinReplied', label: 'LinkedIn replies', color: SERIES[1] },
    { key: 'positiveShown', label: 'Positive', color: SERIES[2] },
  ].filter(Boolean);

  const chart = (title, subtitle, series) => (
    <Card title={title} subtitle={subtitle} table={() => <ChartTable rows={data} x={tip} xLabel={unit === 'month' ? 'Month' : 'Week'} series={series} />}>
      <LineChart data={data} x={x} tooltipLabel={tip} series={series} label={title} />
    </Card>
  );

  return (
    <div className="grid-2">
      {chart(`Touches per ${unit}`, 'Emails from Instantly; invites and messages from HeyReach.', touches)}
      {chart(`Replies per ${unit}`, 'People who replied, by the date the reply came in.', replies)}
    </div>
  );
}

function reachedNote(r, channel) {
  if (channel === 'email') return r.email ? plural(r.email.campaigns, 'campaign') : null;
  if (channel === 'linkedin') return r.linkedin ? `${fmtInt(r.linkedin.accepted)} accepted` : null;
  return [r.email && `${fmtInt(r.email.people)} emailed`, r.linkedin && `${fmtInt(r.linkedin.people)} on LinkedIn`].filter(Boolean).join(', ');
}

/** The program page's company table: seven columns, and a row opens the conversation. */
export function programCompanyColumns(channel) {
  return [
    {
      key: 'company',
      label: 'Company',
      sort: r => r.company,
      csv: r => r.domain || r.company,
      render: r => <><span className="company-name">{r.company}</span><span className="cell-sub">{r.domain || 'No domain matched yet'}</span></>,
    },
    {
      key: 'stage',
      label: 'Stage',
      sort: r => STAGES[r.stage].rank,
      csv: r => STAGES[r.stage].label,
      render: r => (
        <>
          <Badge tone={STAGES[r.stage].tone}>{STAGES[r.stage].label}</Badge>
          {r.meetings > 0 && <span className="cell-sub">{plural(r.meetings, 'meeting')}, {fmtInt(r.meetingsHeld)} held</span>}
        </>
      ),
    },
    channel === 'both' && {
      key: 'channels',
      label: 'Channels',
      sort: r => r.channels,
      csv: r => CHANNELS[r.channels].label,
      render: r => <Badge tone={CHANNELS[r.channels].tone}>{CHANNELS[r.channels].label}</Badge>,
    },
    {
      key: 'people',
      label: 'People reached',
      align: 'right',
      sort: r => r.people,
      csv: r => r.people,
      render: r => stack(fmtInt(r.people), reachedNote(r, channel)),
    },
    {
      key: 'replied',
      label: 'Replies',
      sort: r => (r.replied ? (replySort(r.bestVerdict) || 0) * 1000 + r.replied : null),
      csv: r => (r.replied ? `${r.replied}${r.bestVerdict ? ` (${VERDICTS[r.bestVerdict]?.label})` : ''}` : 0),
      render: r => (r.replied ? (
        <span className="reply-cell">
          <span className="reply-count">{fmtInt(r.replied)}</span>
          <VerdictBadge verdict={r.bestVerdict} />
        </span>
      ) : none()),
    },
    { key: 'sdrs', label: 'SDR', sort: r => r.sdrs.join(', '), csv: r => r.sdrs.join('; '), render: r => (r.sdrs.length ? r.sdrs.join(', ') : none()) },
    {
      key: 'lastTouchAt',
      label: 'Last activity',
      sort: r => r.lastTouchAt,
      csv: r => r.lastTouchAt,
      render: r => <span className="nowrap">{fmtDate(r.lastTouchAt, { year: true })}</span>,
    },
  ].filter(Boolean);
}

/** Per SDR in the range: companies touched, then each channel's volume and replies. */
export function bySdrColumns({ channel, teamColor, withFilters }) {
  const email = channel !== 'linkedin';
  const linkedin = channel !== 'email';
  return [
    {
      key: 'sdr',
      label: 'SDR',
      sort: r => r.sdr,
      csv: r => r.sdr,
      render: r => (r.sdr === 'Unattributed'
        ? <span className="muted">Unattributed</span>
        : <Person name={r.sdr} color={teamColor(r.sdr)} href={withFilters(sdrHref(r.sdr))} size={22} />),
    },
    { key: 'companies', label: 'Companies', align: 'right', csv: r => r.companies, render: r => stack(fmtInt(r.companies), `${fmtInt(r.positiveCompanies)} positive`) },
    email && { key: 'emailsSent', label: 'Emails sent', align: 'right', csv: r => r.emailsSent, render: r => stack(fmtInt(r.emailsSent), `${fmtInt(r.peopleEmailed)} people`) },
    email && { key: 'emailReplied', label: 'Email replies', align: 'right', csv: r => r.emailReplied, render: r => stack(fmtInt(r.emailReplied), `${fmtInt(r.emailPositive)} positive`) },
    linkedin && { key: 'invitesSent', label: 'Invites sent', align: 'right', csv: r => r.invitesSent, render: r => stack(fmtInt(r.invitesSent), `${fmtInt(r.invitesAccepted)} accepted`) },
    linkedin && { key: 'messagesSent', label: 'Messages sent', align: 'right', csv: r => r.messagesSent, render: r => fmtInt(r.messagesSent) },
    linkedin && { key: 'linkedinReplied', label: 'LinkedIn replies', align: 'right', csv: r => r.linkedinReplied, render: r => stack(fmtInt(r.linkedinReplied), `${fmtInt(r.linkedinPositive)} positive`) },
  ].filter(Boolean);
}

const LISTS = {
  companies: { title: 'Unique companies touched', test: () => true, quote: () => true },
  replied: { title: 'Companies that replied', test: c => c.replied > 0, quote: () => true },
  positive: { title: 'Companies with a positive reply', test: c => c.positive > 0, quote: r => POSITIVE.includes(r.verdict) },
  meeting: { title: 'Companies with a meeting', test: c => c.meetings > 0, quote: () => true },
};

/** The companies behind a funnel step, each opening its conversation. */
export function CompanyListPanel({ list, companies, replies, onClose, onOpen }) {
  const config = LISTS[list];
  const rows = config ? companies.filter(config.test) : [];

  return (
    <Drawer
      open={Boolean(config)}
      onClose={onClose}
      title={config?.title}
      subtitle={`${plural(rows.length, 'company', 'companies')}. Open one to read the conversation.`}
    >
      <ul className="company-list">
        {rows.map(c => {
          const reply = replies.find(r => r.companyKey === c.key && config.quote(r));
          return (
            <li key={c.key}>
              <button type="button" className="company-list-item" onClick={() => onOpen(c)}>
                <span className="company-list-head">
                  <span className="company-name">{c.company}</span>
                  <Badge tone={STAGES[c.stage].tone}>{STAGES[c.stage].label}</Badge>
                </span>
                <span className="cell-sub">{[c.domain, CHANNELS[c.channels].label, c.sdrs.join(', ')].filter(Boolean).join(', ')}</span>
                {reply?.quote && <span className="company-list-quote">“{reply.quote}”</span>}
              </button>
            </li>
          );
        })}
      </ul>
    </Drawer>
  );
}
