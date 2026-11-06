'use client';

import { useCallback, useState } from 'react';
import { fmtDate, fmtDateRange, fmtInt } from '@/lib/client/format';
import { useApi } from '@/lib/client/use-api';
import Drawer from '../ui/Drawer';
import { EmptyState, ErrorState, LoadingBlock } from '../ui/States';
import { MEETING_STATUS, POSITIVE_SOURCE } from './common';
import ConversationPanel from './ConversationPanel';

const plural = (n, one, many = `${one}s`) => `${fmtInt(n)} ${n === 1 ? one : many}`;
const CHANNEL = { email: 'Email', linkedin: 'LinkedIn' };

function said(row) {
  if (row.quote) return <span className="company-list-quote">“{row.quote}”</span>;
  if (row.note) return <span className="company-list-quote muted">{row.source === 'booked' ? row.note : `SDR note: ${row.note}`}</span>;
  return <span className="company-list-quote muted">Reply not in our conversations</span>;
}

function PositiveRow({ row }) {
  return (
    <>
      <span className="company-list-head">
        <span className="company-name">{row.name || 'Name not logged'}</span>
        <span className="cell-sub nowrap">{fmtDate(row.at, { year: true })}</span>
      </span>
      <span className="cell-sub">{[row.company, row.sdr, CHANNEL[row.channel], POSITIVE_SOURCE[row.source]].filter(Boolean).join(', ')}</span>
      {said(row)}
    </>
  );
}

function MeetingRow({ row }) {
  return (
    <>
      <span className="company-list-head">
        <span className="company-name">{row.company || 'Company not named'}</span>
        <span className="cell-sub nowrap">{fmtDate(row.at, { year: true })}</span>
      </span>
      <span className="cell-sub">{[row.sdr, row.campaign || 'No campaign match', MEETING_STATUS[row.outcome]].filter(Boolean).join(', ')}</span>
      {row.name && <span className="cell-sub"><strong>{row.name}</strong></span>}
      {said(row)}
    </>
  );
}

function OutcomeList({ query, onOpen, onClose }) {
  const { title, ...params } = query;
  const { data, error, loading, reload } = useApi('/api/metrics/outcomes', params);
  const rows = data?.rows || [];
  const meetings = query.kind === 'meetings';
  const Row = meetings ? MeetingRow : PositiveRow;
  const count = meetings ? plural(rows.length, 'meeting') : plural(rows.length, 'person', 'people');
  return (
    <Drawer
      open
      onClose={onClose}
      title={title}
      subtitle={data ? `${count}, ${fmtDateRange(query.from, query.to)}. Open one to read the conversation.` : fmtDateRange(query.from, query.to)}
    >
      {error && <ErrorState error={error} onRetry={reload} />}
      {loading && <LoadingBlock label="Loading the names" height={200} />}
      {data && !rows.length && <EmptyState inline title="Nothing here">Nothing in these dates.</EmptyState>}
      <ul className="company-list">
        {rows.map((row, i) => (
          <li key={`${row.id ?? row.name}-${row.at}-${i}`}>
            {row.companyKey ? (
              <button type="button" className="company-list-item" onClick={() => onOpen(row)}><Row row={row} /></button>
            ) : (
              <div className="company-list-item static"><Row row={row} /></div>
            )}
          </li>
        ))}
      </ul>
    </Drawer>
  );
}

/**
 * What a Positive or Meetings number opens anywhere on the board: the names behind it,
 * then one company's actual conversation, with a way back. Call `openOutcomes` with
 * { kind, channel, sdr, program, theme, from, to, title } and render `outcomesPanel`.
 */
export function useOutcomes() {
  const [query, setQuery] = useState(null);
  const [company, setCompany] = useState(null);
  const openOutcomes = useCallback(next => {
    setCompany(null);
    setQuery(next);
  }, []);
  const close = useCallback(() => {
    setCompany(null);
    setQuery(null);
  }, []);
  const back = useCallback(() => setCompany(null), []);
  const open = useCallback(row => setCompany({ key: row.companyKey, name: row.company, domain: row.domain }), []);

  return {
    openOutcomes,
    outcomesPanel: query && (company
      ? <ConversationPanel target={company} channel="both" onClose={close} onBack={back} />
      : <OutcomeList query={query} onOpen={open} onClose={close} />),
  };
}

/**
 * For a list of meetings or positives that is already on the page: a row opens that
 * company's conversation. Spread `rowProps` on a DataTable and render `conversation`.
 */
export function useConversation() {
  const [target, setTarget] = useState(null);
  const close = useCallback(() => setTarget(null), []);
  return {
    openConversation: useCallback(row => {
      const key = row.companyKey || row.domain;
      if (key) setTarget({ key, name: row.company, domain: row.domain });
    }, []),
    conversation: <ConversationPanel target={target} channel="both" onClose={close} />,
  };
}
