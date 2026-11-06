'use client';

import Link from 'next/link';
import { fmtDateRange, fmtInt } from '@/lib/client/format';
import CountButton from '../ui/CountButton';
import Delta from '../ui/Delta';
import { KpiTile, periodPhrase, programHref } from './common';
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
export function OverviewTiles({ tiles, onOpen }) {
  return (
    <div className="tiles">
      <KpiTile label="Companies reached" kpi={tiles.companies} note={DEFS.companies} />
      <KpiTile label="Replies" kpi={tiles.replies} note={DEFS.replied} />
      <KpiTile label="Positive replies" kpi={tiles.positive} note={DEFS.positive} onOpen={onOpen && (() => onOpen('positive', 'Positive responses'))} />
      <KpiTile label="Meetings" kpi={tiles.meetings} note={DEFS.meetings} onOpen={onOpen && (() => onOpen('meetings', 'Meetings booked'))} />
    </div>
  );
}

const stack = (value, sub) => <span className="cell-stack">{value}{sub && <span className="cell-sub">{sub}</span>}</span>;

/** The programs behind the range: what each sent on the channel in view, and what came back. */
export function programColumns({ channel, withFilters, programName, onOpen }) {
  const email = channel !== 'linkedin';
  const linkedin = channel !== 'email';
  // 'No program' is everything else, which no filter can ask for.
  const count = (r, kind, what) => (onOpen && r.program !== 'none'
    ? <CountButton value={r[kind === 'positive' ? 'positive' : 'meetings']} label={`See who: ${programName(r.program)}, ${what}`} onClick={() => onOpen(kind, r.program, `${what}: ${programName(r.program)}`)} />
    : fmtInt(r[kind === 'positive' ? 'positive' : 'meetings']));
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
    { key: 'positive', label: 'Positive', hint: DEFS.positive, align: 'right', csv: r => r.positive, render: r => count(r, 'positive', 'Positive responses') },
    { key: 'meetings', label: 'Meetings', hint: DEFS.meetings, align: 'right', csv: r => r.meetings, render: r => count(r, 'meetings', 'Meetings') },
  ].filter(Boolean);
}
