'use client';

import Link from 'next/link';
import { useCallback, useState } from 'react';
import { Check, LoaderCircle, Plus } from 'lucide-react';
import { useDashboard } from '@/lib/client/dashboard-context';
import { fmtDate } from '@/lib/client/format';
import { apiFetch, clearApiCache } from '@/lib/client/use-api';
import Card from '../ui/Card';

const today = () => {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
};

const CHANNELS = ['SDR', 'AE', 'Referral', 'Marketing', 'Inbound', 'Ecosystem', 'Ads'];
const DIRECTIONS = ['Outbound', 'Inbound'];

/** Campaigns are only needed once someone opens the form, so they load on demand. */
function useCampaigns() {
  const [state, setState] = useState({ list: null, loading: false });
  const load = useCallback(() => {
    setState(s => (s.list || s.loading ? s : { list: null, loading: true }));
    if (state.list || state.loading) return;
    apiFetch('/api/metrics/campaigns?range=last-12-weeks')
      .then(d => setState({ list: d.campaigns || [], loading: false }))
      .catch(() => setState({ list: [], loading: false }));
  }, [state.list, state.loading]);
  return { campaigns: state.list, loadCampaigns: load };
}

function CampaignField({ value, onChange, campaigns, onFocus, id }) {
  return (
    <>
      <input
        id={id}
        className="date-input"
        list={`${id}-options`}
        placeholder="Campaign (optional)"
        value={value}
        onFocus={onFocus}
        onChange={e => onChange(e.target.value)}
        style={{ minWidth: 260 }}
      />
      <datalist id={`${id}-options`}>
        {(campaigns || []).map(c => (
          <option key={c.id} value={c.id}>{c.name}{c.sdr ? ` — ${c.sdr}` : ''}</option>
        ))}
      </datalist>
    </>
  );
}

/**
 * A meeting the automated sources never saw. Saved against the person's name, and the
 * first rung of the meeting credit. Answers about meetings the sources did see (who,
 * channel, campaign) are given on Meeting checks (ChecksView).
 */
export default function MeetingEntry({ onSaved }) {
  const { meta } = useDashboard();
  const { campaigns, loadCampaigns } = useCampaigns();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ domain: '', meetingDate: today(), campaignId: '', sdrName: '', channel: 'SDR', direction: 'Outbound', note: '' });
  const [state, setState] = useState({ busy: false, saved: null, error: null });
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const submit = async event => {
    event.preventDefault();
    setState({ busy: true, saved: null, error: null });
    try {
      const saved = await apiFetch('/api/meetings/manual', { method: 'POST', body: form });
      clearApiCache();
      setState({ busy: false, saved, error: null });
      setForm(f => ({ ...f, domain: '', campaignId: '', note: '' }));
      onSaved?.();
    } catch (error) {
      setState({ busy: false, saved: null, error });
    }
  };

  return (
    <>
      <Card
        title="Record a meeting"
        subtitle="For a booking the Slack alert and HubSpot both missed. Saved against your name."
        actions={<button type="button" className="btn" onClick={() => setOpen(o => !o)}>{open ? 'Close' : <><Plus size={14} aria-hidden="true" /> Add</>}</button>}
      >
        {open && (
          <form className="filters" onSubmit={submit} aria-label="Record a meeting">
            <input className="date-input" placeholder="company.com" aria-label="Company domain" required
              value={form.domain} onChange={e => set('domain', e.target.value)} style={{ minWidth: 180 }} />
            <input type="date" className="date-input" aria-label="Meeting date" required max={today()}
              value={form.meetingDate} onChange={e => set('meetingDate', e.target.value)} />
            <CampaignField id="manual-campaign" value={form.campaignId} onChange={v => set('campaignId', v)}
              campaigns={campaigns} onFocus={loadCampaigns} />
            <select className="select-trigger" aria-label="SDR" value={form.sdrName} onChange={e => set('sdrName', e.target.value)}>
              <option value="">No SDR</option>
              {(meta?.team || []).map(t => <option key={t.name} value={t.name}>{t.name}</option>)}
            </select>
            <select className="select-trigger" aria-label="Channel" value={form.channel} onChange={e => set('channel', e.target.value)}>
              {CHANNELS.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <select className="select-trigger" aria-label="Direction" value={form.direction} onChange={e => set('direction', e.target.value)}>
              {DIRECTIONS.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
            <input className="date-input" placeholder="Note (optional)" aria-label="Note"
              value={form.note} onChange={e => set('note', e.target.value)} style={{ minWidth: 180 }} />
            <button type="submit" className="btn btn-primary" disabled={state.busy || !form.domain}>
              {state.busy ? <LoaderCircle size={14} className="spin" aria-hidden="true" /> : 'Save'}
            </button>
            {state.error && <span className="inline-error" role="alert">{state.error.message}</span>}
            {state.saved && (
              <span className="tile-foot-text">
                <Check size={13} aria-hidden="true" /> Saved {state.saved.domain}
                {state.saved.alreadyTracked ? ' — another source already had a meeting there that week, so it is counted once.' : '.'}
              </span>
            )}
          </form>
        )}
      </Card>

      <p className="card-foot">
        A booking nobody is named on, or with no channel or an unsure campaign, is answered on <Link href="/checks">Meeting checks</Link>.
      </p>
    </>
  );
}

