'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Pencil } from 'lucide-react';
import { useDashboard, useTeamColor } from '@/lib/client/dashboard-context';
import { fmtDate, fmtInt, fmtPct, VERDICTS } from '@/lib/client/format';
import { apiFetch, clearApiCache, useApi } from '@/lib/client/use-api';
import { useLinkWithFilters } from '@/lib/client/use-filters';
import Funnel from '../charts/Funnel';
import HBarList from '../charts/HBarList';
import Badge from '../ui/Badge';
import Card from '../ui/Card';
import DataTable from '../ui/DataTable';
import PageHeader from '../ui/PageHeader';
import { Person } from '../ui/Person';
import StatTile from '../ui/StatTile';
import { ErrorState, LoadingBlock } from '../ui/States';
import { ChannelTrendCards, VerdictBadge, replySort } from './channels';
import {
  ReplyFeed, SyncStatus, TrendCards, accountColumns, isTestName, meetingColumns, programHref, sdrHref, statusLabel, useProgramName,
} from './common';

const variantLetter = v => String.fromCharCode(65 + (Number(v) || 0));
const share = (part, whole) => (whole ? (part / whole) * 100 : null);
const stack = (value, sub) => <span className="cell-stack">{value}<span className="cell-sub">{sub}</span></span>;

const EDITABLE = ['sdr', 'program', 'theme', 'excluded'];

function MappingEditor({ campaign, onSaved, onCancel }) {
  const { meta } = useDashboard();
  const [initial] = useState(() => ({
    sdr: campaign.sdr || '',
    program: campaign.program || '',
    theme: campaign.theme === 'Other' ? '' : campaign.theme || '',
    excluded: Boolean(campaign.excluded),
  }));
  const [form, setForm] = useState({ ...initial, note: '' });
  const [status, setStatus] = useState({ saving: false, error: null });
  const set = (key, value) => setForm(f => ({ ...f, [key]: value }));
  const url = `/api/admin/campaigns/${encodeURIComponent(campaign.id)}`;
  const namedTest = isTestName(campaign.name);

  const submit = async (method, body) => {
    setStatus({ saving: true, error: null });
    try {
      await apiFetch(url, { method, body });
      clearApiCache();
      onSaved();
    } catch (error) {
      setStatus({ saving: false, error });
    }
  };

  return (
    <form
      className="card"
      onSubmit={e => {
        e.preventDefault();
        // Only what changed, so untouched fields keep following the campaign name.
        const body = Object.fromEntries(EDITABLE
          .filter(key => form[key] !== initial[key])
          .map(key => [key, key === 'theme' ? form.theme.trim() || null : form[key]]));
        if (form.note.trim()) body.note = form.note.trim();
        if (!Object.keys(body).length) return onCancel();
        submit('PATCH', body);
      }}
    >
      <div className="card-head">
        <div>
          <h2 className="card-title">Correct this campaign</h2>
          <p className="card-sub">Overrides what was read from the name. Every total that includes this campaign updates straight away.</p>
        </div>
      </div>
      <div className="form-grid">
        <label>
          SDR
          <select className="select-trigger" value={form.sdr} onChange={e => set('sdr', e.target.value)}>
            <option value="">No SDR</option>
            {(meta?.team || []).map(t => <option key={t.name} value={t.name}>{t.name}</option>)}
          </select>
        </label>
        <label>
          Program
          <select className="select-trigger" value={form.program} onChange={e => set('program', e.target.value)}>
            <option value="">No program</option>
            {(meta?.programs || []).map(p => <option key={p.slug} value={p.slug}>{p.name}</option>)}
          </select>
        </label>
        <label>
          Message angle
          <input className="input" value={form.theme} placeholder="Read from the name" onChange={e => set('theme', e.target.value)} />
        </label>
        <label>
          Note for other admins
          <input className="input" value={form.note} placeholder="Why this was changed" onChange={e => set('note', e.target.value)} />
        </label>
        <label className="check">
          <input type="checkbox" checked={form.excluded} disabled={namedTest} onChange={e => set('excluded', e.target.checked)} />
          {namedTest ? 'Left out of all totals, because the name marks it as a test' : 'Leave out of all totals'}
        </label>
      </div>
      {status.error && <p className="inline-error">{status.error.message}</p>}
      <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
        <button type="submit" className="btn btn-primary" disabled={status.saving}>{status.saving ? 'Saving' : 'Save changes'}</button>
        {campaign.overridden && (
          <button type="button" className="btn" disabled={status.saving} onClick={() => submit('DELETE')}>
            Go back to what the name says
          </button>
        )}
      </div>
    </form>
  );
}

/** A HeyReach campaign: who it reached, at which companies, from which sender, and what came back. */
function LinkedinCampaign({ data }) {
  const li = data.linkedin;
  const companyCols = [
    {
      key: 'company',
      label: 'Company',
      sort: r => r.company,
      csv: r => r.domain || r.company,
      render: r => (
        <>
          <span>{r.company}</span>
          <span className="cell-sub">
            {r.domain || (r.ambiguous ? 'Several companies share this name' : 'No domain matched yet')}
            {r.titles.length ? `, ${r.titles.join(', ')}` : ''}
          </span>
        </>
      ),
    },
    { key: 'people', label: 'People', align: 'right', csv: r => r.people, render: r => fmtInt(r.people) },
    { key: 'invited', label: 'Invited', align: 'right', csv: r => r.invited, render: r => fmtInt(r.invited) },
    { key: 'accepted', label: 'Accepted', align: 'right', csv: r => r.accepted, render: r => fmtInt(r.accepted) },
    { key: 'replied', label: 'Replied', align: 'right', csv: r => r.replied, render: r => fmtInt(r.replied) },
    { key: 'positive', label: 'Positive', align: 'right', csv: r => r.positive, render: r => fmtInt(r.positive) },
    { key: 'bestVerdict', label: 'Best reply', sort: r => replySort(r.bestVerdict), csv: r => VERDICTS[r.bestVerdict]?.label || '', render: r => <VerdictBadge verdict={r.bestVerdict} /> },
    {
      key: 'emailPeople',
      label: 'Also emailed',
      align: 'right',
      csv: r => r.emailPeople,
      render: r => (r.emailPeople
        ? stack(fmtInt(r.emailPeople), `in ${fmtInt(r.emailCampaigns)} ${r.emailCampaigns === 1 ? 'campaign' : 'campaigns'}`)
        : <span className="muted">No</span>),
    },
    { key: 'meetings', label: 'Meetings', align: 'right', csv: r => r.meetings, render: r => (r.meetings ? stack(fmtInt(r.meetings), `${fmtInt(r.meetingsHeld)} held`) : '0') },
  ];
  const senderCols = [
    { key: 'key', label: 'Sender', sort: r => r.key, csv: r => r.key },
    { key: 'people', label: 'People', align: 'right', csv: r => r.people, render: r => fmtInt(r.people) },
    { key: 'accepted', label: 'Accepted', align: 'right', sort: r => r.acceptanceRate, csv: r => r.accepted, render: r => stack(fmtInt(r.accepted), `${fmtPct(r.acceptanceRate)} of ${fmtInt(r.invited)} invited`) },
    { key: 'replied', label: 'Replied', align: 'right', csv: r => r.replied, render: r => stack(fmtInt(r.replied), `${fmtPct(r.replyRate)} of messaged`) },
    { key: 'positive', label: 'Positive', align: 'right', csv: r => r.positive, render: r => fmtInt(r.positive) },
  ];

  return (
    <>
      <div className="tiles">
        <StatTile compact label="People" value={fmtInt(li.people)} note={`${fmtInt(li.inSequence)} in sequence, ${fmtInt(li.failed)} failed`} />
        <StatTile compact label="Invited" value={fmtInt(li.invited)} note={`${fmtInt(li.accepted)} accepted, ${fmtPct(li.acceptanceRate)}`} />
        <StatTile compact label="Messaged" value={fmtInt(li.messaged)} note="After acceptance or to existing connections" />
        <StatTile compact label="Replied" value={fmtInt(li.replied)} note={`${fmtPct(li.replyRate)} of messaged`} />
        <StatTile compact label="Positive replies" value={fmtInt(li.positive)} note={`${fmtInt(li.negative)} said no`} />
        <StatTile compact label="Companies" value={fmtInt(li.companies)} note={`${fmtInt(li.companiesMatched)} matched to a domain`} />
        <StatTile compact label="Meetings" value={fmtInt(li.meetings)} note={`At ${fmtInt(li.companiesWithMeeting)} ${li.companiesWithMeeting === 1 ? 'company' : 'companies'}, within 180 days`} />
      </div>

      <div className="grid-2">
        <Card title="People funnel" subtitle="Everyone added to this campaign; each person counts once.">
          <Funnel stages={data.peopleFunnel} />
        </Card>
        <Card title="Company funnel" subtitle="The same journey, counted by company. Meetings are any at the company within 180 days of the first person being added.">
          <Funnel stages={data.companyFunnel} />
        </Card>
      </div>

      <ChannelTrendCards rows={data.trend} grain="week" email={false} />

      <Card
        className="flush"
        title="Companies in this campaign"
        subtitle="Read from each person's LinkedIn profile. Also emailed shows whether email outreach worked the same company in any campaign."
      >
        <DataTable columns={companyCols} rows={data.companies} rowKey={r => r.key} searchable searchPlaceholder="Search companies" exportName={`${data.campaign.name}-companies`} />
      </Card>

      <div className="grid-2">
        <Card className="flush" title="By sender" subtitle="The LinkedIn account each person was contacted from.">
          <DataTable columns={senderCols} rows={data.senders} rowKey={r => r.key} dense empty="No people synced for this campaign yet." />
        </Card>
        <Card title="Latest replies" subtitle="What people wrote back, as classified.">
          <ReplyFeed replies={data.replies.slice(0, 12)} />
        </Card>
      </div>
    </>
  );
}

export default function CampaignDetailView({ id }) {
  const withFilters = useLinkWithFilters();
  const teamColor = useTeamColor();
  const programName = useProgramName();
  const { isAdmin } = useDashboard();
  const [editing, setEditing] = useState(false);
  const { data, error, loading, refreshing, reload } = useApi(`/api/metrics/campaigns/${encodeURIComponent(id)}`);

  const campaign = data?.campaign;
  const stats = campaign?.stats || {};
  const linkedin = campaign?.platform === 'heyreach';
  const life = data?.lifetime;

  const stepColumns = [
    { key: 'step', label: 'Step', sort: r => r.step * 10 + r.variant, csv: r => `${r.step}${variantLetter(r.variant)}`, render: r => `${r.step}${variantLetter(r.variant)}` },
    {
      key: 'subject',
      label: 'Subject and opening',
      sortable: false,
      csv: r => r.subject,
      render: r => (
        <div className="wrap-text">
          <span style={{ fontWeight: 500 }}>{r.subject || <span className="muted">Same thread as the step before</span>}</span>
          {r.preview && <span className="cell-sub">{r.preview.length > 220 ? `${r.preview.slice(0, 220)}…` : r.preview}</span>}
        </div>
      ),
    },
    { key: 'sent', label: 'Sent', align: 'right', csv: r => r.sent, render: r => fmtInt(r.sent) },
    { key: 'replies', label: 'Replies', align: 'right', csv: r => r.replies, render: r => fmtInt(r.replies) },
    { key: 'replyRate', label: 'Reply rate', align: 'right', csv: r => r.replyRate, render: r => fmtPct(r.replyRate, 2) },
  ];

  return (
    <div className="page">
      <PageHeader back={{ href: withFilters('/campaigns'), label: 'All campaigns' }} title={campaign?.name || 'Campaign'} meta={<SyncStatus />}>
        {campaign && (
          <div className="badges" style={{ marginTop: 10 }}>
            <Badge tone="accent">{linkedin ? 'LinkedIn' : 'Email'}</Badge>
            <Badge>{statusLabel(campaign.status)}</Badge>
            {campaign.sdr
              ? <Person name={campaign.sdr} color={teamColor(campaign.sdr)} href={withFilters(sdrHref(campaign.sdr))} size={20} />
              : <Badge tone="warn">No SDR</Badge>}
            {campaign.program && <Link className="badge accent" href={withFilters(programHref(campaign.program))}>{programName(campaign.program)}</Link>}
            {campaign.theme && campaign.theme !== 'Other' && campaign.theme !== programName(campaign.program) && <Badge>{campaign.theme}</Badge>}
            {campaign.segment && <Badge>{campaign.segment}</Badge>}
            {campaign.region && <Badge>{campaign.region}</Badge>}
            {campaign.excluded && <Badge tone="warn">Left out of totals</Badge>}
            {campaign.overridden && <Badge tone="accent">Corrected by an admin</Badge>}
            {campaign.isoCreated && <span className="muted" style={{ fontSize: 12 }}>Created {fmtDate(campaign.isoCreated, { year: true })}</span>}
            {isAdmin && (
              <button type="button" className="btn btn-small" onClick={() => setEditing(e => !e)}>
                <Pencil aria-hidden="true" />{editing ? 'Close' : 'Correct'}
              </button>
            )}
          </div>
        )}
        {linkedin && campaign?.senders?.length > 0 && <p>Sent from {campaign.senders.join(', ')}.</p>}
      </PageHeader>

      {error && <ErrorState error={error} onRetry={reload} title={error.status === 404 ? 'This campaign is not in the dashboard' : undefined} />}
      {loading && <LoadingBlock />}
      {editing && campaign && (
        <MappingEditor campaign={campaign} onCancel={() => setEditing(false)} onSaved={() => { setEditing(false); reload(); }} />
      )}

      {data && linkedin && (
        <div className={`page${refreshing ? ' is-refreshing' : ''}`}>
          <LinkedinCampaign data={data} />
        </div>
      )}

      {data && !linkedin && (
        <div className={`page${refreshing ? ' is-refreshing' : ''}`}>
          <div className="tiles">
            <StatTile compact label="Leads loaded" value={fmtInt(life.leadsLoaded)} note={`${fmtInt(life.accountsLoaded)} accounts`} />
            <StatTile compact label="Contacted" value={fmtInt(life.leadsContacted)} />
            <StatTile compact label="Emails sent" value={fmtInt(stats.sent)} note={`${fmtPct(share(stats.bounced, stats.sent))} bounced`} />
            <StatTile compact label="Replied" value={fmtInt(life.replied)} note={`${fmtPct(share(life.replied, life.leadsContacted))} of contacted`} />
            <StatTile compact label="Positive replies" value={fmtInt(life.positive)} note={`${fmtInt(life.negative)} said no`} />
            <StatTile compact label="Meetings" value={fmtInt(life.meetings)} note={`${fmtInt(life.held)} held, ${fmtInt(life.qualified)} qualified`} />
          </div>

          <div className="grid-2">
            <Card title="Lead funnel" subtitle="Every lead ever loaded into this campaign."><Funnel stages={data.funnel} /></Card>
            <Card title="Account funnel" subtitle="The same journey, counted by company."><Funnel stages={data.accountsFunnel} /></Card>
          </div>

          <TrendCards rows={data.trend} grain="week" />

          <Card className="flush" title="Sequence" subtitle="Lifetime results for each step and A/B variant. Variables such as {{subject_line}} are filled in per lead.">
            <DataTable columns={stepColumns} rows={data.steps} rowKey={r => `${r.step}-${r.variant}`} dense empty="No step results synced for this campaign yet." />
          </Card>

          <div className="grid-2">
            <Card title="Replies by step" subtitle="Which email in the sequence people answered.">
              <HBarList
                rows={data.repliesByStep}
                label={r => `Step ${r.step}`}
                value="replied"
                detail={r => `${fmtInt(r.positive)} positive, ${fmtInt(r.negative)} said no`}
                emptyText="No replies with a known step yet."
              />
            </Card>
            <Card title="Latest replies" subtitle="What people wrote back, as classified.">
              <ReplyFeed replies={data.replies.slice(0, 12)} />
            </Card>
          </div>

          <Card className="flush" title="Accounts" subtitle="Every company this campaign reached, furthest stage first.">
            <DataTable
              columns={accountColumns()}
              rows={data.accounts}
              rowKey={r => r.domain}
              searchable
              searchPlaceholder="Search accounts"
              exportName={`${campaign.name}-accounts`}
            />
          </Card>

          <Card className="flush" title="Meetings" subtitle="Meetings at companies this campaign loaded in the 180 days before.">
            <DataTable
              columns={meetingColumns({ teamColor, withFilters })}
              rows={data.meetings}
              rowKey={r => r.id}
              exportName={`${campaign.name}-meetings`}
              empty="No meetings traced back to this campaign."
            />
          </Card>
        </div>
      )}
    </div>
  );
}
