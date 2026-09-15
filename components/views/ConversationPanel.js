'use client';

import { ArrowLeft, ExternalLink, Mail, MessageSquare } from 'lucide-react';
import { fmtDateTime, fmtInt, VERDICTS } from '@/lib/client/format';
import { useApi } from '@/lib/client/use-api';
import Badge from '../ui/Badge';
import Drawer from '../ui/Drawer';
import { EmptyState, ErrorState, LoadingBlock } from '../ui/States';

const CHANNEL = {
  email: { label: 'Email', Icon: Mail },
  linkedin: { label: 'LinkedIn', Icon: MessageSquare },
};

function Verdict({ verdict, reason }) {
  if (!verdict) return null;
  const v = VERDICTS[verdict] || VERDICTS.unknown;
  return <Badge tone={v.tone} title={reason || undefined}>{v.label}</Badge>;
}

const plural = (n, one, many = `${one}s`) => `${fmtInt(n)} ${n === 1 ? one : many}`;

function Message({ event, person }) {
  const sent = event.direction === 'sent';
  const tone = sent ? '' : event.isPositive ? ' good' : event.isNegative ? ' bad' : '';
  const who = sent
    ? event.channel === 'email'
      ? `Sent from ${event.by || 'Instantly'}`
      : `Sent by ${event.by || 'HeyReach'}`
    : `${person.name} replied`;

  return (
    <li className={`convo-event ${sent ? 'sent' : 'received'}${tone}`}>
      <div className="convo-event-meta">
        <span className="convo-who">{who}</span>
        {event.step && <span>Step {event.step}</span>}
        {sent && event.manual && event.channel === 'email' && <span>Written in Instantly</span>}
        <time dateTime={event.at}>{fmtDateTime(event.at)}</time>
        {!sent && <Verdict verdict={event.verdict} reason={event.reason} />}
      </div>
      {event.subject && <div className="convo-subject">{event.subject}</div>}
      {event.text ? (
        <div className={`convo-text${event.kind === 'template' ? ' template' : ''}`}>
          {event.kind === 'template' && (
            <span className="convo-note">Sequence copy{event.truncated ? ', first 400 characters' : ''}</span>
          )}
          <p>{event.text}{event.truncated ? '…' : ''}</p>
        </div>
      ) : (
        <p className="convo-empty">
          {sent ? 'The archive keeps no text for this email.' : 'This reply has no words of its own.'}
        </p>
      )}
      {!sent && event.reason && <p className="convo-reason">Why this label: {event.reason}</p>}
    </li>
  );
}

function PersonThread({ person }) {
  const { label, Icon } = CHANNEL[person.channel];
  const context = [
    person.campaigns.length ? `${person.campaigns.length === 1 ? 'Campaign' : 'Campaigns'}: ${person.campaigns.join(', ')}` : null,
    person.senders.length ? `Sender: ${person.senders.join(', ')}` : null,
  ].filter(Boolean);

  return (
    <section className="convo-person" aria-label={person.name}>
      <header className="convo-person-head">
        <div className="convo-person-name">
          <Icon aria-hidden="true" />
          <div>
            <div className="convo-name">{person.name}</div>
            {person.title && <div className="cell-sub">{person.title}</div>}
          </div>
        </div>
        <div className="badges">
          <Badge>{label}</Badge>
          <Verdict verdict={person.verdict} />
        </div>
      </header>
      {(context.length > 0 || person.profileUrl) && (
        <p className="convo-person-meta">
          {context.map(text => <span key={text}>{text}</span>)}
          {person.profileUrl && (
            <a href={person.profileUrl} target="_blank" rel="noreferrer">
              LinkedIn profile<ExternalLink aria-hidden="true" />
            </a>
          )}
        </p>
      )}
      {person.events.length ? (
        <ol className="convo-timeline">
          {person.events.map(event => <Message key={event.id} event={event} person={person} />)}
        </ol>
      ) : (
        <p className="convo-empty">Nothing archived with this person yet.</p>
      )}
    </section>
  );
}

/**
 * Everything sent to and received from one company's people, on the channel
 * the page shows. `target` is { key, name, domain } or null when closed.
 */
export default function ConversationPanel({ target, program, channel = 'both', onClose, onBack }) {
  const open = Boolean(target?.key);
  const { data, error, reload } = useApi(
    '/api/metrics/conversations',
    open ? { company: target.key, program, channel } : null,
    { enabled: open }
  );
  // A cached answer for another company can arrive first; only show this company's.
  const current = open && data?.company?.key === String(target.key).toLowerCase() && data.channel === channel ? data : null;
  const totals = current?.totals;

  const subtitle = totals
    ? [target.domain, plural(totals.people, 'person', 'people'), plural(totals.sent, 'message sent', 'messages sent'), plural(totals.received, 'reply', 'replies')]
      .filter(Boolean).join(', ')
    : target?.domain;

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={current?.company?.name || target?.name || 'Conversation'}
      subtitle={subtitle}
      actions={onBack && (
        <button type="button" className="btn btn-small" onClick={onBack}>
          <ArrowLeft aria-hidden="true" />Back
        </button>
      )}
    >
      {error && <ErrorState error={error} onRetry={reload} title="This conversation could not be loaded" />}
      {!current && !error && <LoadingBlock label="Loading the conversation" height={200} />}
      {current && current.people.length === 0 && (
        <EmptyState inline title="Nobody to show">
          This program has no people at this company on this channel.
        </EmptyState>
      )}
      {current && current.people.length > 0 && (
        <>
          {current.people.map(person => <PersonThread key={person.key} person={person} />)}
          <p className="card-foot">
            From the AI SDR archive, which syncs once a day. Sequence emails are archived without their text, so each shows
            its step&apos;s copy from Instantly.
          </p>
        </>
      )}
    </Drawer>
  );
}
