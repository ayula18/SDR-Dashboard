'use client';

import Link from 'next/link';
import { fmtDateRange, fmtInt, fmtMoney, fmtPct, fmtPeriod } from '@/lib/client/format';
import BarChart from '../charts/BarChart';
import ChartTable from '../charts/ChartTable';
import HBarList from '../charts/HBarList';
import Card from '../ui/Card';
import Delta from '../ui/Delta';
import StatTile from '../ui/StatTile';
import { KpiTile, SERIES, periodPhrase, programHref, sdrHref } from './common';
import { CHANNEL_PHRASE } from './program';

const plural = (n, one, many = `${one}s`) => `${fmtInt(n)} ${n === 1 ? one : many}`;
const listNames = names => (names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`);

const MOVERS = [
  ['replies', 'replies'],
  ['positive', 'positive replies'],
  ['meetings', 'meetings'],
  ['meetingsHeld', 'meetings held'],
  ['companies', 'companies reached'],
];

/**
 * The page's answer in two sentences — how many companies the whole team
 * reached and what came of them — then whatever moved by 10% or more.
 */
export function OverviewLead({ summary, tiles, range, channel, companies }) {
  const when = range.preset === 'custom' ? `From ${fmtDateRange(range.from, range.to)}` : `${periodPhrase(range)[0].toUpperCase()}${periodPhrase(range).slice(1)}`;
  const positives = companies
    .filter(c => c.positive > 0)
    .sort((a, b) => new Date(b.lastTouchAt || 0) - new Date(a.lastTouchAt || 0))
    .map(c => c.company);
  const shown = positives.slice(0, 3);
  const more = positives.length - shown.length;

  const named = shown.length ? `: ${listNames(more > 0 ? [...shown, `${fmtInt(more)} more`] : shown)}` : '';
  const outcome = summary.replied
    ? `${plural(summary.replied, 'company', 'companies')} replied${summary.positive
      ? ` and ${fmtInt(summary.positive)} ${summary.positive === 1 ? 'was' : 'were'} positive${named}.`
      : ', none positive yet.'}`
    : 'No replies yet.';
  const meetings = summary.withMeeting
    ? ` ${plural(summary.withMeeting, 'company', 'companies')} took a meeting${summary.pipeline ? `, ${fmtMoney(summary.pipeline)} qualified pipeline` : ''}.`
    : ' No meetings at those companies yet.';

  const movers = MOVERS
    .map(([key, noun]) => ({ key, noun, ...tiles[key] }))
    .filter(k => k.change != null && k.previous >= 5 && Math.abs(k.change) >= 10)
    .sort((a, b) => Math.abs(b.change) - Math.abs(a.change))
    .slice(0, 4);

  return (
    <section className="changes" aria-label="What changed">
      <p className="program-lead">
        {when}, outreach reached {plural(summary.total, 'company', 'companies')} {CHANNEL_PHRASE[channel]}.{' '}
        <span className="program-lead-rest">{outcome}{meetings}</span>
      </p>
      <ul className="changes-list">
        {movers.map(m => (
          <li key={m.key}>
            <Delta change={m.change} />
            {m.noun}, {fmtInt(m.value)} against {fmtInt(m.previous)}
          </li>
        ))}
        {!movers.length && <li>Nothing moved by 10% or more against the period before.</li>}
      </ul>
    </section>
  );
}

const REPLY_NOTE = { both: 'People who replied on either channel', email: 'Leads who replied', linkedin: 'People who replied' };

/** The headline row, in the unit the channel is counted in. */
export function OverviewTiles({ tiles, channel }) {
  return (
    <div className="tiles">
      <KpiTile label="Companies reached" kpi={tiles.companies} note="Unique companies touched" />
      <KpiTile label="Replies" kpi={tiles.replies} note={REPLY_NOTE[channel]} />
      <KpiTile label="Positive replies" kpi={tiles.positive} />
      <KpiTile label="Meetings" kpi={tiles.meetings} note="By the date they were held" />
      <KpiTile label="Meetings held" kpi={tiles.meetingsHeld} />
    </div>
  );
}

function Bars({ title, subtitle, rows, label, href }) {
  return (
    <Card title={title} subtitle={subtitle}>
      <HBarList
        rows={rows}
        label={label}
        value="meetings"
        detail={r => `${fmtPct(r.heldRate, 0)} held`}
        href={href}
        emptyText="No meetings in this range."
      />
    </Card>
  );
}

const CHANNEL_MEETING_NOTE = {
  both: 'Outbound meetings, plus any meeting a campaign is credited with.',
  email: 'Meetings credited to an Instantly campaign. A meeting with no campaign match is not counted here.',
  linkedin: 'Meetings credited to a HeyReach campaign. A meeting with no campaign match is not counted here.',
};

const HELD_NOTE = 'Held means someone from the company turned up: the audit sheet says so, a call recording puts them '
  + 'in the room, or the pipeline moved afterwards. Anything unproven sits under "No show?" until a human confirms it, '
  + 'and a booking that moved counts once, at its later slot.';

/**
 * What was booked in the range and how much of it happened: the totals, the
 * shape of it per period, and which channel, SDR and program it came from.
 */
export function MeetingsPanel({ meetings, grain, channel, withFilters, programName }) {
  const totals = meetings.totals;
  const unit = grain === 'month' ? 'month' : 'week';
  const series = [
    { key: 'meetings', label: 'Booked', color: SERIES[0] },
    { key: 'held', label: 'Held', color: SERIES[1] },
  ];
  const x = r => fmtPeriod(grain, r.period);
  const tip = r => fmtPeriod(grain, r.period, { long: true });

  return (
    <>
      <div className="section-header">
        <div>
          <h2 className="section-title">Meetings</h2>
          <p className="card-sub">{CHANNEL_MEETING_NOTE[channel]} {HELD_NOTE}</p>
        </div>
        <Link className="btn btn-small" href={withFilters('/meetings')}>Every meeting, all sources</Link>
      </div>

      <div className="tiles">
        <StatTile label="Meetings" value={fmtInt(totals.meetings)} change={totals.change.meetings} previous={fmtInt(totals.previous.meetings)} />
        <StatTile label="Held" value={fmtInt(totals.held)} change={totals.change.held} note={`${fmtPct(totals.heldRate)} of the ones we can judge`} />
        <StatTile label="Qualified" value={fmtInt(totals.qualified)} change={totals.change.qualified} note={`${fmtPct(totals.qualifiedRate)} of meetings`} />
        <StatTile
          label="Qualified pipeline"
          value={fmtMoney(totals.pipelineValue)}
          change={totals.change.pipelineValue}
          note={totals.avgDealValue ? `${fmtMoney(totals.avgDealValue)} average deal` : undefined}
        />
        <StatTile label="No show?" value={fmtInt(totals.pendingReview)} note="Nothing proves they joined" upIsGood={false} />
        <StatTile label="Rescheduled" value={fmtInt(totals.rescheduled)} note={totals.upcoming ? `${fmtInt(totals.upcoming)} still ahead` : 'Moved to a later slot'} />
      </div>

      <Card
        title={`Booked and held per ${unit}`}
        subtitle="The last 12 periods, by the date each meeting was held."
        table={() => <ChartTable rows={meetings.trend} x={tip} xLabel={unit === 'month' ? 'Month' : 'Week'} series={series} />}
      >
        <BarChart data={meetings.trend} x={x} tooltipLabel={tip} series={series} label={`Meetings per ${unit}`} />
      </Card>

      <div className="grid-3">
        <Bars title="Where they came from" subtitle="The channel the sheet credits." rows={meetings.byChannel} label="key" />
        <Bars
          title="By SDR"
          subtitle="Named in the sheet, or the SDR whose campaign reached the company."
          rows={meetings.bySdr}
          label="key"
          href={r => (r.key === 'Unattributed' ? undefined : withFilters(sdrHref(r.key)))}
        />
        <Bars
          title="By program"
          subtitle="From the campaign the meeting is attributed to."
          rows={meetings.byProgram}
          label={r => (r.key === 'none' ? 'No program' : programName(r.key))}
          href={r => (r.key === 'none' ? undefined : withFilters(programHref(r.key)))}
        />
      </div>
    </>
  );
}

const stack = (value, sub) => <span className="cell-stack">{value}{sub && <span className="cell-sub">{sub}</span>}</span>;

/** The programs behind the range: what each sent on the channel in view, and what came back. */
export function programColumns({ channel, withFilters, programName }) {
  const email = channel !== 'linkedin';
  const linkedin = channel !== 'email';
  return [
    {
      key: 'program',
      label: 'Program',
      sort: r => r.program,
      csv: r => (r.program === 'none' ? 'No program' : programName(r.program)),
      render: r => (r.program === 'none'
        ? <span className="muted">No program</span>
        : <Link href={withFilters(programHref(r.program))}>{programName(r.program)}</Link>),
    },
    email && { key: 'emailsSent', label: 'Emails sent', align: 'right', csv: r => r.emailsSent, render: r => stack(fmtInt(r.emailsSent), `${fmtInt(r.peopleEmailed)} people`) },
    linkedin && { key: 'invitesSent', label: 'Invites sent', align: 'right', csv: r => r.invitesSent, render: r => stack(fmtInt(r.invitesSent), `${fmtInt(r.invitesAccepted)} accepted`) },
    linkedin && { key: 'messagesSent', label: 'Messages sent', align: 'right', csv: r => r.messagesSent, render: r => fmtInt(r.messagesSent) },
    { key: 'replies', label: 'Replies', align: 'right', csv: r => r.replies, render: r => fmtInt(r.replies) },
    { key: 'positive', label: 'Positive', align: 'right', csv: r => r.positive, render: r => fmtInt(r.positive) },
    { key: 'meetings', label: 'Meetings', align: 'right', csv: r => r.meetings, render: r => stack(fmtInt(r.meetings), `${fmtInt(r.meetingsHeld)} held`) },
  ].filter(Boolean);
}
