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
import { DEFS } from './definitions';

const plural = (n, one, many = `${one}s`) => `${fmtInt(n)} ${n === 1 ? one : many}`;

const MOVERS = [
  ['replies', 'replies'],
  ['positive', 'positive replies'],
  ['meetings', 'meetings'],
  ['companies', 'companies reached'],
];

/**
 * The page's answer in two sentences — how many companies the whole team
 * reached and what came of them — then whatever moved by 10% or more.
 */
export function OverviewLead({ summary, tiles, range, channel }) {
  const when = range.preset === 'custom' ? `From ${fmtDateRange(range.from, range.to)}` : `${periodPhrase(range)[0].toUpperCase()}${periodPhrase(range).slice(1)}`;
  // The same open counts as the tiles below: whatever came in during the range,
  // whenever those people were reached.
  const replies = tiles.replies.value;
  const positive = tiles.positive.value;
  const meetings = tiles.meetings.value;
  const outcome = replies
    ? `${plural(replies, 'reply', 'replies')} came in${positive ? `, ${fmtInt(positive)} of them positive` : ', none positive'}`
    : 'No replies came in';
  const met = meetings ? `, and ${plural(meetings, 'meeting')} took place.` : ', and no meetings took place.';

  const movers = MOVERS
    .map(([key, noun]) => ({ key, noun, ...tiles[key] }))
    .filter(k => k.change != null && k.previous >= 5 && Math.abs(k.change) >= 10)
    .sort((a, b) => Math.abs(b.change) - Math.abs(a.change))
    .slice(0, 4);

  return (
    <section className="changes" aria-label="What changed">
      <p className="program-lead">
        {when}, outreach reached {plural(summary.total, 'company', 'companies')} {CHANNEL_PHRASE[channel]}.{' '}
        <span className="program-lead-rest">{outcome}{met}</span>
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


/** The headline row, in the unit the channel is counted in. */
export function OverviewTiles({ tiles, channel }) {
  return (
    <div className="tiles">
      <KpiTile label="Companies reached" kpi={tiles.companies} note={DEFS.companies} />
      <KpiTile label="Replies" kpi={tiles.replies} note={DEFS.replied} />
      <KpiTile label="Positive replies" kpi={tiles.positive} note={DEFS.positive} />
      <KpiTile label="Meetings" kpi={tiles.meetings} note={DEFS.meetings} />
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
        href={href}
        emptyText="No meetings in this range."
      />
    </Card>
  );
}

const CHANNEL_MEETING_NOTE = {
  both: 'Only meetings SDR outreach booked; AE, inbound and referral meetings are not counted.',
  email: 'Meetings SDRs booked from an Instantly campaign. A meeting with no campaign match is not counted here.',
  linkedin: 'Meetings SDRs booked from a HeyReach campaign. A meeting with no campaign match is not counted here.',
};

const RESCHEDULE_NOTE = `${DEFS.meetings}. A booking that moved counts once, at its later slot.`;

/**
 * What was booked in the range: the totals, the shape of it per period, and
 * which channel, SDR and program it came from.
 */
export function MeetingsPanel({ meetings, grain, channel, withFilters, programName }) {
  const totals = meetings.totals;
  const unit = grain === 'month' ? 'month' : 'week';
  const series = [{ key: 'meetings', label: 'Booked', color: SERIES[0] }];
  const x = r => fmtPeriod(grain, r.period);
  const tip = r => fmtPeriod(grain, r.period, { long: true });

  return (
    <>
      <div className="section-header">
        <div>
          <h2 className="section-title">Meetings</h2>
          <p className="card-sub">{CHANNEL_MEETING_NOTE[channel]} {RESCHEDULE_NOTE}</p>
        </div>
        <Link className="btn btn-small" href={withFilters('/meetings')}>All SDR-booked meetings</Link>
      </div>

      <div className="tiles">
        <StatTile label="Meetings" value={fmtInt(totals.meetings)} change={totals.change.meetings} previous={fmtInt(totals.previous.meetings)} />
        <StatTile label="Qualified" value={fmtInt(totals.qualified)} change={totals.change.qualified} note={`${fmtPct(totals.qualifiedRate)} of meetings`} />
        <StatTile
          label="Qualified pipeline"
          value={fmtMoney(totals.pipelineValue)}
          change={totals.change.pipelineValue}
          note={totals.avgDealValue ? `${fmtMoney(totals.avgDealValue)} average deal` : undefined}
        />
        <StatTile label="Rescheduled" value={fmtInt(totals.rescheduled)} note={totals.upcoming ? `${fmtInt(totals.upcoming)} still ahead` : 'Moved to a later slot'} />
      </div>

      <Card
        title={`Booked per ${unit}`}
        subtitle="The last 12 periods, by meeting date."
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
    email && { key: 'emailsSent', label: 'First emails', hint: DEFS.firstEmails, align: 'right', csv: r => r.emailsSent, render: r => fmtInt(r.emailsSent) },
    linkedin && { key: 'invitesSent', label: 'Invites sent', hint: DEFS.invites, align: 'right', csv: r => r.invitesSent, render: r => stack(fmtInt(r.invitesSent), `${fmtInt(r.invitesAccepted)} accepted`) },
    linkedin && { key: 'messagesSent', label: 'First messages', hint: DEFS.firstMessages, align: 'right', csv: r => r.messagesSent, render: r => fmtInt(r.messagesSent) },
    { key: 'replies', label: 'Replies', hint: DEFS.replied, align: 'right', csv: r => r.replies, render: r => fmtInt(r.replies) },
    { key: 'positive', label: 'Positive', hint: DEFS.positive, align: 'right', csv: r => r.positive, render: r => fmtInt(r.positive) },
    { key: 'meetings', label: 'Meetings', hint: DEFS.meetings, align: 'right', csv: r => r.meetings, render: r => fmtInt(r.meetings) },
  ].filter(Boolean);
}
