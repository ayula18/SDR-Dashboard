'use client';

import { useState } from 'react';
import { Check, LoaderCircle } from 'lucide-react';
import { useDashboard } from '@/lib/client/dashboard-context';
import { fmtDate } from '@/lib/client/format';
import { apiFetch, clearApiCache, useApi } from '@/lib/client/use-api';
import { useFilters } from '@/lib/client/use-filters';
import Card from '../ui/Card';
import FilterBar from '../ui/FilterBar';
import PageHeader from '../ui/PageHeader';
import { EmptyState, ErrorState, LoadingBlock } from '../ui/States';
import { SyncStatus } from './common';

/**
 * Meeting checks (Ayush, 2026-11-10: "a new section in the nav bar where we can manually
 * select the details and fill up such cases"). The meetings the credit could not settle,
 * each with why, and an answer that becomes the SDR's own word: the first rung of the
 * meeting credit, counted as soon as it is saved.
 */
const KINDS = [
  {
    key: 'nobody',
    title: 'Nobody named',
    subtitle: 'No HubSpot form or audit row says who booked these: only the SDR team\'s booking link or a HubSpot meeting with no owner. They count nowhere until someone names the SDR, or marks them not an SDR meeting.',
  },
  {
    key: 'channel',
    title: 'No channel',
    subtitle: 'SDR meetings that none of our outreach or the form\'s pasted conversation places. They count in totals but on no channel, and add no positive, until the channel is set.',
  },
  {
    key: 'source',
    title: 'Source unsure',
    subtitle: 'SDR meetings credited to a campaign only because it reached the company: no reply or logged positive backs it. Save to confirm the campaign, or pick another.',
  },
];
const CHANNELS = [['email', 'Email'], ['linkedin', 'LinkedIn'], ['call', 'Call']];
const CHANNEL_LABEL = Object.fromEntries(CHANNELS);
const CHANNEL_OF_PLATFORM = { instantly: 'email', heyreach: 'linkedin' };

export default function ChecksView() {
  const { apiParams } = useFilters();
  const { meta } = useDashboard();
  const { data, error, loading, refreshing, reload } = useApi('/api/meetings/checks', apiParams);
  const sdrs = (meta?.team || []).filter(t => t.role === 'sdr' || t.role === 'sdr_extra').map(t => t.name);
  const checks = data?.checks || [];

  return (
    <div className={`page${refreshing ? ' is-refreshing' : ''}`}>
      <PageHeader
        title="Meeting checks"
        description={'Meetings the dashboard could not settle on its own. Who booked a meeting comes from the HubSpot form first, then the meetings audit sheet; '
          + 'where it came from comes from the conversation pasted on the form, then replies and outreach. An answer here outranks all of them and counts at once.'}
        meta={<SyncStatus />}
      />
      <FilterBar range={data?.range} hide={['program', 'theme']} compares={false} />
      {error && <ErrorState error={error} onRetry={reload} />}
      {loading && <LoadingBlock />}
      {data && !checks.length && <EmptyState title="Nothing to check">Every meeting in these dates has who booked it and where it came from.</EmptyState>}
      {data && KINDS.map(kind => {
        const list = checks.filter(c => c.kind === kind.key);
        if (!list.length) return null;
        return (
          <Card key={kind.key} title={`${kind.title} (${list.length})`} subtitle={kind.subtitle}>
            <ul className="checks-list">
              {list.map(check => <CheckRow key={check.id} check={check} sdrs={sdrs} onSaved={reload} />)}
            </ul>
          </Card>
        );
      })}
    </div>
  );
}

function CheckRow({ check, sdrs, onSaved }) {
  const split = Boolean(check.sdr && check.sdr.includes('+'));
  const currentSdr = check.bookingBy === 'unknown' || split ? '' : check.sdr || '';
  const [sdr, setSdr] = useState(currentSdr);
  const [channel, setChannel] = useState(check.channel && check.channel !== 'unknown' ? check.channel : '');
  const [campaignId, setCampaignId] = useState(check.campaignId || '');
  const [state, setState] = useState({ busy: false, done: null, error: null });

  const campaigns = check.campaigns.filter(c => !channel || CHANNEL_OF_PLATFORM[c.platform] === channel);
  const pickCampaign = id => {
    setCampaignId(id);
    const c = check.campaigns.find(x => x.id === id);
    if (!c) return;
    setChannel(CHANNEL_OF_PLATFORM[c.platform]);
    if (!sdr && c.sdr && sdrs.includes(c.sdr)) setSdr(c.sdr);
  };
  const pickChannel = value => {
    setChannel(value);
    const c = check.campaigns.find(x => x.id === campaignId);
    if (c && CHANNEL_OF_PLATFORM[c.platform] !== value) setCampaignId('');
  };

  const send = async (body, done) => {
    setState({ busy: true, done: null, error: null });
    try {
      await apiFetch('/api/meetings/manual', { method: 'PATCH', body: { id: check.id, ...body } });
      clearApiCache();
      setState({ busy: false, done, error: null });
      onSaved?.();
    } catch (error) {
      setState({ busy: false, done: null, error });
    }
  };
  // Who booked it is only sent when it is the answer: naming the same SDR again would
  // turn the form's word into the dashboard's for nothing.
  const save = () => send({
    ...(sdr && sdr !== currentSdr ? { sdrName: sdr } : {}),
    channel: channel || null,
    campaignId: campaignId || null,
  }, 'Saved');
  const ready = check.kind === 'nobody' ? Boolean(sdr) : check.kind === 'channel' ? Boolean(channel || campaignId) : true;

  const now = check.bookingBy === 'unknown'
    ? 'Nobody named'
    : [check.sdr, check.campaign || 'no campaign', CHANNEL_LABEL[check.channel] || 'no channel'].filter(Boolean).join(' · ');

  return (
    <li>
      <span style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
        <span className="company-name">{check.company || check.domain || 'Company not named'}</span>
        <span className="cell-sub">{fmtDate(check.date, { year: true })}{check.domain && check.company !== check.domain ? ` · ${check.domain}` : ''}</span>
        <span className="cell-sub">Now: {now}</span>
      </span>
      {check.reason && <span className="cell-sub muted">Why: {check.reason}</span>}
      {state.done ? (
        <span className="tile-foot-text"><Check size={13} aria-hidden="true" /> {state.done}</span>
      ) : (
        <span className="checks-answer">
          <select className="select-trigger" aria-label="Who booked it" value={sdr} disabled={split} onChange={e => setSdr(e.target.value)}>
            <option value="">{split ? check.sdr : 'Who booked it?'}</option>
            {sdrs.map(name => <option key={name} value={name}>{name}</option>)}
          </select>
          <select className="select-trigger" aria-label="Channel" value={channel} onChange={e => pickChannel(e.target.value)}>
            <option value="">Channel?</option>
            {CHANNELS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          {channel !== 'call' && (
            <select className="select-trigger" aria-label="Campaign" value={campaignId} onChange={e => pickCampaign(e.target.value)} style={{ maxWidth: 320 }}>
              <option value="">{campaigns.length ? 'No campaign' : 'No campaign reached them'}</option>
              {campaigns.map(c => <option key={c.id} value={c.id}>{c.name}{c.sdr ? ` (${c.sdr})` : ''}</option>)}
            </select>
          )}
          <button type="button" className="btn btn-primary" onClick={save} disabled={state.busy || !ready}>
            {state.busy ? <LoaderCircle size={14} className="spin" aria-hidden="true" /> : 'Save'}
          </button>
          <button type="button" className="btn" onClick={() => send({ notSdr: true }, 'Marked not an SDR meeting')} disabled={state.busy}>
            Not an SDR meeting
          </button>
          {state.error && <span className="inline-error" role="alert">{state.error.message}</span>}
        </span>
      )}
    </li>
  );
}
