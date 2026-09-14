'use client';

import Link from 'next/link';
import { useState } from 'react';
import { AlertTriangle, CheckCircle2, LoaderCircle, RefreshCw, Upload } from 'lucide-react';
import { useDashboard } from '@/lib/client/dashboard-context';
import { fmtDate, fmtDateRange, fmtInt, fmtPct, fmtRelative } from '@/lib/client/format';
import { apiFetch, clearApiCache, useApi } from '@/lib/client/use-api';
import Badge from '../ui/Badge';
import Card from '../ui/Card';
import DataTable from '../ui/DataTable';
import PageHeader from '../ui/PageHeader';
import { ErrorState, LoadingBlock } from '../ui/States';
import { MiniStat, campaignHref, isTestName } from './common';

const RUN_TONES = { complete: 'good', partial: 'warn', blocked: 'warn', skipped: 'neutral', failed: 'bad', running: 'accent' };
const RUN_LABELS = { complete: 'Complete', partial: 'Partly done', blocked: 'Blocked', skipped: 'Skipped', failed: 'Failed', running: 'Running' };
const excludedWhy = r => (isTestName(r.name) ? 'The name marks it as a test' : 'Left out by an admin');
const newestCreated = campaigns => campaigns.map(c => c.createdAt).filter(Boolean).sort().pop() || null;

function duration(run) {
  if (!run?.finishedAt || !run?.startedAt) return '–';
  const seconds = Math.round((new Date(run.finishedAt) - new Date(run.startedAt)) / 1000);
  return seconds < 60 ? `${seconds} s` : `${Math.round(seconds / 60)} min`;
}

function runDetail(run) {
  if (!run) return 'Never run';
  if (run.error) return run.error;
  if (run.stats?.reason) return run.stats.reason;
  return Object.entries(run.stats || {})
    .filter(([key, value]) => typeof value !== 'object' && key !== 'complete' && key !== 'status')
    .map(([key, value]) => `${key.replace(/([A-Z])/g, ' $1').toLowerCase()} ${typeof value === 'number' ? fmtInt(value) : value}`)
    .join(', ');
}

/** Admin-only PATCH on a campaign override, with inline feedback. */
function useCampaignPatch(onDone) {
  const [state, setState] = useState({ busy: null, error: null });
  const patch = async (id, body) => {
    setState({ busy: id, error: null });
    try {
      await apiFetch(`/api/admin/campaigns/${encodeURIComponent(id)}`, { method: 'PATCH', body });
      clearApiCache();
      setState({ busy: null, error: null });
      onDone();
    } catch (error) {
      setState({ busy: null, error });
    }
  };
  return [state, patch];
}

function RosterControls({ member, onSaved }) {
  const [aliases, setAliases] = useState((member.aliases || []).join(', '));
  const [state, setState] = useState({ busy: false, error: null });

  const save = async changes => {
    setState({ busy: true, error: null });
    try {
      await apiFetch('/api/admin/team', {
        method: 'POST',
        body: {
          name: member.name,
          role: member.role,
          aliases: aliases.split(',').map(a => a.trim()).filter(Boolean),
          color: member.color,
          isActive: member.isActive,
          ...changes,
        },
      });
      clearApiCache();
      setState({ busy: false, error: null });
      onSaved();
    } catch (error) {
      setState({ busy: false, error });
    }
  };

  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
      <select
        aria-label={`Role for ${member.name}`}
        className="select-trigger"
        value={member.role}
        disabled={state.busy}
        onChange={e => save({ role: e.target.value })}
      >
        <option value="sdr">SDR</option>
        <option value="other">Not an SDR</option>
      </select>
      <input
        aria-label={`Other spellings of ${member.name}`}
        className="input"
        value={aliases}
        placeholder="Other spellings, comma separated"
        disabled={state.busy}
        onChange={e => setAliases(e.target.value)}
        onBlur={() => {
          if (aliases !== (member.aliases || []).join(', ')) save({ aliases: aliases.split(',').map(a => a.trim()).filter(Boolean) });
        }}
      />
      {state.error && <span className="inline-error">{state.error.message}</span>}
    </div>
  );
}

function MeetingsImport({ onDone }) {
  const [state, setState] = useState({ busy: false, result: null, error: null });

  const onFile = async event => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setState({ busy: true, result: null, error: null });
    try {
      const result = await apiFetch('/api/admin/meetings/import', {
        method: 'POST',
        body: await file.text(),
        headers: { 'Content-Type': 'text/csv', 'X-File-Name': file.name },
      });
      clearApiCache();
      setState({ busy: false, result, error: null });
      onDone();
    } catch (error) {
      setState({ busy: false, result: null, error });
    }
  };

  return (
    <div>
      <label className="btn">
        {state.busy ? <LoaderCircle className="spin" aria-hidden="true" /> : <Upload aria-hidden="true" />}
        {state.busy ? 'Importing' : 'Upload the meetings CSV'}
        <input type="file" accept=".csv,text/csv" onChange={onFile} disabled={state.busy} className="sr-only" />
      </label>
      {state.result && (
        <p className="card-foot">
          Imported {fmtInt(state.result.imported)} meetings. {fmtInt(state.result.withoutDomain)} had no company domain and
          {' '}{fmtInt(state.result.withoutDate)} had no date.
        </p>
      )}
      {state.error && <p className="inline-error">{state.error.message}</p>}
    </div>
  );
}

/** Admin: say which domain a LinkedIn company name belongs to, or that it is not a company. */
function CompanyMapper({ row, onSaved }) {
  const [domain, setDomain] = useState('');
  const [state, setState] = useState({ busy: false, error: null });

  const save = async body => {
    setState({ busy: true, error: null });
    try {
      await apiFetch('/api/admin/company-aliases', { method: 'POST', body: { name: row.name, ...body } });
      clearApiCache();
      setState({ busy: false, error: null });
      onSaved();
    } catch (error) {
      setState({ busy: false, error });
    }
  };

  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
      {(row.candidates || []).map(candidate => (
        <button key={candidate} type="button" className="btn btn-small" disabled={state.busy} onClick={() => save({ domain: candidate })}>
          {candidate}
        </button>
      ))}
      <form
        style={{ display: 'flex', gap: 6 }}
        onSubmit={e => {
          e.preventDefault();
          if (domain.trim()) save({ domain: domain.trim() });
        }}
      >
        <input aria-label={`Domain for ${row.name}`} className="input" value={domain} placeholder="company.com" disabled={state.busy} onChange={e => setDomain(e.target.value)} />
        <button type="submit" className="btn btn-small" disabled={state.busy || !domain.trim()}>Save</button>
      </form>
      <button type="button" className="btn btn-small" disabled={state.busy} onClick={() => save({ notACompany: true })}>Not a company</button>
      {state.error && <span className="inline-error">{state.error.message}</span>}
    </div>
  );
}

function UndoMapping({ row, onDone }) {
  const [state, setState] = useState({ busy: false, error: null });
  const undo = async () => {
    setState({ busy: true, error: null });
    try {
      await apiFetch(`/api/admin/company-aliases?key=${encodeURIComponent(row.key)}`, { method: 'DELETE' });
      clearApiCache();
      setState({ busy: false, error: null });
      onDone();
    } catch (error) {
      setState({ busy: false, error });
    }
  };
  return (
    <>
      <button type="button" className="btn btn-small" disabled={state.busy} onClick={undo}>Undo</button>
      {state.error && <span className="inline-error">{state.error.message}</span>}
    </>
  );
}

export default function HealthView() {
  const { isAdmin, meta, reloadMeta } = useDashboard();
  const { data, error, loading, refreshing, reload } = useApi('/api/health');
  const [sync, setSync] = useState({ running: false, results: null, error: null });
  const refresh = () => { reload(); reloadMeta(); };
  const [patchState, patchCampaign] = useCampaignPatch(refresh);

  const runSync = async () => {
    setSync({ running: true, results: null, error: null });
    try {
      const { results } = await apiFetch('/api/sync', { method: 'POST', body: { mode: 'incremental' } });
      clearApiCache();
      setSync({ running: false, results, error: null });
      refresh();
    } catch (err) {
      setSync({ running: false, results: null, error: err });
    }
  };

  const team = meta?.team || [];

  const jobColumns = [
    { key: 'label', label: 'Job', sort: r => r.label, csv: r => r.label, render: r => <><span>{r.label}</span><span className="cell-sub">{r.key}</span></> },
    {
      key: 'status',
      label: 'Last run',
      sort: r => r.lastRun?.status,
      csv: r => r.lastRun?.status,
      render: r => (r.lastRun
        ? <span className="cell-stack" style={{ alignItems: 'flex-start' }}><Badge tone={RUN_TONES[r.lastRun.status]}>{RUN_LABELS[r.lastRun.status] || r.lastRun.status}</Badge><span className="cell-sub">{fmtRelative(r.lastRun.startedAt)}, {r.lastRun.triggeredBy}</span></span>
        : <Badge>Never run</Badge>),
    },
    { key: 'lastSuccessAt', label: 'Last success', sort: r => r.lastSuccessAt, csv: r => r.lastSuccessAt, render: r => fmtRelative(r.lastSuccessAt) },
    { key: 'duration', label: 'Took', sortable: false, csv: r => duration(r.lastRun), render: r => <span className="nowrap">{duration(r.lastRun)}</span> },
    { key: 'detail', label: 'Details', sortable: false, csv: r => runDetail(r.lastRun), render: r => <span className="wrap-text">{runDetail(r.lastRun)}</span> },
  ];

  const unmappedColumns = [
    { key: 'name', label: 'Campaign', sort: r => r.name, csv: r => r.name, render: r => <Link className="truncate" href={campaignHref(r.id)} title={r.name}>{r.name}</Link> },
    { key: 'platform', label: 'Channel', csv: r => r.platform, render: r => (r.platform === 'heyreach' ? 'LinkedIn' : 'Email') },
    { key: 'createdAt', label: 'Created', sort: r => r.createdAt, csv: r => r.createdAt, render: r => <span className="nowrap">{fmtDate(r.createdAt, { year: true })}</span> },
    isAdmin && {
      key: 'assign',
      label: 'Assign',
      sortable: false,
      csv: false,
      render: r => (
        <select
          aria-label={`Assign an SDR to ${r.name}`}
          className="select-trigger"
          defaultValue=""
          disabled={patchState.busy === r.id}
          onChange={e => e.target.value && patchCampaign(r.id, { sdr: e.target.value })}
        >
          <option value="">Choose SDR</option>
          {team.map(t => <option key={t.name} value={t.name}>{t.name}</option>)}
        </select>
      ),
    },
  ].filter(Boolean);

  const excludedColumns = [
    { key: 'name', label: 'Campaign', sort: r => r.name, csv: r => r.name, render: r => <Link className="truncate" href={campaignHref(r.id)} title={r.name}>{r.name}</Link> },
    { key: 'createdAt', label: 'Created', sort: r => r.createdAt, csv: r => r.createdAt, render: r => <span className="nowrap">{fmtDate(r.createdAt, { year: true })}</span> },
    { key: 'why', label: 'Why', sortable: false, csv: excludedWhy, render: excludedWhy },
  ];

  const memberColumns = [
    { key: 'name', label: 'Campaign', sort: r => r.name, csv: r => r.name, render: r => <Link className="truncate" href={campaignHref(r.id)} title={r.name}>{r.name}</Link> },
    { key: 'sdr', label: 'SDR', sort: r => r.sdr, csv: r => r.sdr, render: r => r.sdr || <span className="muted">–</span> },
    { key: 'createdAt', label: 'Created', sort: r => r.createdAt, csv: r => r.createdAt, render: r => <span className="nowrap">{fmtDate(r.createdAt, { year: true })}</span> },
    isAdmin && {
      key: 'remove',
      label: '',
      sortable: false,
      csv: false,
      render: r => (
        <button type="button" className="btn btn-small" disabled={patchState.busy === r.id} onClick={() => patchCampaign(r.id, { program: '' })}>
          Remove from program
        </button>
      ),
    },
  ].filter(Boolean);

  const rosterColumns = [
    { key: 'name', label: 'Name', sort: r => r.name, csv: r => r.name },
    isAdmin
      ? { key: 'role', label: 'Role and other spellings', sortable: false, csv: r => r.role, render: r => <RosterControls member={r} onSaved={refresh} /> }
      : { key: 'role', label: 'Role', csv: r => r.role, render: r => (r.role === 'sdr' ? 'SDR' : 'Not an SDR') },
    !isAdmin && { key: 'aliases', label: 'Other spellings', sortable: false, csv: r => (r.aliases || []).join('; '), render: r => (r.aliases || []).join(', ') || '–' },
    { key: 'campaignsLast90Days', label: 'Campaigns, last 90 days', align: 'right', csv: r => r.campaignsLast90Days, render: r => fmtInt(r.campaignsLast90Days) },
  ].filter(Boolean);

  const linkedinCompanyColumns = [
    { key: 'name', label: 'Company on LinkedIn', sort: r => r.name, csv: r => r.name },
    { key: 'people', label: 'People', align: 'right', csv: r => r.people, render: r => fmtInt(r.people) },
    { key: 'campaigns', label: 'Campaigns', align: 'right', csv: r => r.campaigns, render: r => fmtInt(r.campaigns) },
    { key: 'replied', label: 'Replied', sort: r => (r.replied ? 1 : 0), csv: r => (r.replied ? 'Yes' : 'No'), render: r => (r.replied ? <Badge tone="good">Yes</Badge> : <span className="muted">No</span>) },
    isAdmin
      ? { key: 'map', label: 'Belongs to', sortable: false, csv: false, render: r => <CompanyMapper row={r} onSaved={refresh} /> }
      : { key: 'candidates', label: 'Possible domains', sortable: false, csv: r => (r.candidates || []).join('; '), render: r => (r.candidates?.length ? r.candidates.join(', ') : '–') },
  ];

  const aliasColumns = [
    { key: 'name', label: 'Company on LinkedIn', sort: r => r.name, csv: r => r.name },
    { key: 'domain', label: 'Belongs to', sort: r => r.domain, csv: r => r.domain || 'Not a company', render: r => r.domain || <span className="muted">Not a company</span> },
    { key: 'updatedBy', label: 'By', csv: r => r.updatedBy },
    { key: 'updatedAt', label: 'When', sort: r => r.updatedAt, csv: r => r.updatedAt, render: r => fmtRelative(r.updatedAt) },
    isAdmin && { key: 'undo', label: '', sortable: false, csv: false, render: r => <UndoMapping row={r} onDone={refresh} /> },
  ].filter(Boolean);

  const campaignsByPlatform = platform => (data?.data.campaigns || []).filter(c => c.platform === platform).reduce((s, c) => s + c.campaigns, 0);
  const weekly = data?.data.periods.find(p => p.grain === 'week');
  const emailVerdicts = data?.data.replyVerdicts.find(v => v.platform === 'email');
  const linkedinPeople = data?.data.linkedinPeople;

  return (
    <div className="page">
      <PageHeader
        title="Data health"
        description="Where each number comes from, when it last synced, and what needs a person: missing keys, campaigns without an SDR, LinkedIn companies without a domain, program membership and the roster."
      />
      {error && <ErrorState error={error} onRetry={reload} />}
      {loading && <LoadingBlock />}

      {data && (
        <div className={`page${refreshing ? ' is-refreshing' : ''}`}>
          <div className="grid-2">
            <Card title="Setup" subtitle="Keys and access the numbers depend on.">
              <ul className="checklist">
                {data.setup.map(item => (
                  <li key={item.key} className={item.ok ? 'ok' : 'gap'}>
                    {item.ok ? <CheckCircle2 aria-label="Working" /> : <AlertTriangle aria-label="Needs attention" />}
                    <div>
                      <strong style={{ fontWeight: 500 }}>{item.label}</strong>
                      <p>{item.detail}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </Card>

            <Card title="What's in the database" subtitle="Freshness of each source.">
              <div className="mini-stats">
                <MiniStat label="Email campaigns" value={fmtInt(campaignsByPlatform('instantly'))} />
                <MiniStat label="LinkedIn campaigns" value={fmtInt(campaignsByPlatform('heyreach'))} />
                <MiniStat label="Leads" value={fmtInt(data.data.leads.total)} sub={`Latest loaded ${fmtRelative(data.data.leads.latestLoadedAt)}`} />
                <MiniStat
                  label="LinkedIn people"
                  value={fmtInt(linkedinPeople?.people)}
                  sub={linkedinPeople?.people
                    ? `${fmtPct((100 * linkedinPeople.matched) / linkedinPeople.people, 0)} matched to a company domain, synced ${fmtRelative(linkedinPeople.lastSyncedAt)}`
                    : 'Not synced yet'}
                />
                <MiniStat label="Weekly numbers" value={weekly ? fmtInt(weekly.rows) : '0'} sub={weekly ? fmtDateRange(weekly.first, weekly.last) : 'None yet'} />
                <MiniStat
                  label="Email replies"
                  value={fmtInt(emailVerdicts?.total)}
                  sub={emailVerdicts ? `${fmtInt(emailVerdicts.labelled)} labelled by GPT-4.1 mini, latest ${fmtDate(emailVerdicts.latestReplyAt, { year: true })}` : undefined}
                />
                <MiniStat label="Meetings" value={fmtInt(data.data.meetings.total)} sub={data.data.meetings.importedAt ? `Imported ${fmtRelative(data.data.meetings.importedAt)}` : 'Not imported'} />
              </div>
              {isAdmin && (
                <div style={{ marginTop: 16 }}>
                  <h3 className="subhead">Replace meetings with a new export of the audit sheet</h3>
                  <MeetingsImport onDone={refresh} />
                </div>
              )}
            </Card>
          </div>

          <Card
            className="flush"
            title="Sync"
            subtitle={isAdmin ? 'Runs every day at 08:00 IST. Sync now refreshes the last few weeks.' : 'Runs every day at 08:00 IST. Admins can start a sync from here.'}
            actions={isAdmin && (
              <button type="button" className="btn btn-primary" onClick={runSync} disabled={sync.running}>
                {sync.running ? <LoaderCircle className="spin" aria-hidden="true" /> : <RefreshCw aria-hidden="true" />}
                {sync.running ? 'Syncing, this takes a few minutes' : 'Sync now'}
              </button>
            )}
          >
            {sync.error && <div style={{ padding: '0 18px' }}><p className="inline-error">{sync.error.message}</p></div>}
            {sync.results && (
              <div style={{ padding: '0 18px 8px' }}>
                <p className="card-sub">
                  Sync finished: {sync.results.filter(r => r.status === 'complete').length} of {sync.results.length} jobs complete.
                  {sync.results.some(r => r.status === 'partial') ? ' Long jobs stopped at the time limit and continue on the next sync.' : ''}
                </p>
              </div>
            )}
            <DataTable columns={jobColumns} rows={data.jobs} rowKey={r => r.key} dense />
          </Card>

          {patchState.error && <ErrorState error={patchState.error} title="That change was not saved" />}

          <div className="grid-2">
            <Card className="flush" title="Campaigns without an SDR" subtitle="Created in the last 120 days, with no team member in the name.">
              <DataTable columns={unmappedColumns} rows={data.mapping.campaignsWithoutSdr} rowKey={r => r.id} dense pageSize={10} empty="Every recent campaign has an SDR." />
            </Card>
            <Card className="flush" title="Left out of totals" subtitle="Created in the last 120 days.">
              <DataTable columns={excludedColumns} rows={data.mapping.excludedCampaigns} rowKey={r => r.id} dense pageSize={10} empty="Nothing is excluded." />
            </Card>
          </div>

          <Card
            className="flush"
            title="LinkedIn companies without a domain"
            subtitle="Company names from LinkedIn profiles that matched no domain, or more than one. Until mapped, they can't be joined to email outreach or meetings. One mapping covers everyone at that company, including people added later."
          >
            <DataTable
              columns={linkedinCompanyColumns}
              rows={data.mapping.linkedinCompanies}
              rowKey={r => r.key}
              searchable
              searchPlaceholder="Search companies"
              dense
              pageSize={15}
              empty="Every LinkedIn company has a domain."
            />
          </Card>

          {data.mapping.companyAliases.length > 0 && (
            <Card className="flush" title="Company mappings" subtitle="What admins decided for LinkedIn company names.">
              <DataTable columns={aliasColumns} rows={data.mapping.companyAliases} rowKey={r => r.key} dense pageSize={10} />
            </Card>
          )}

          <Card title="Program membership" subtitle="Campaigns join a program when their name matches its rule. Open a program to check what's in it.">
            {data.mapping.programs.map(p => (
              <details key={p.slug} className="program-members">
                <summary>
                  <strong style={{ fontWeight: 500 }}>{p.name}</strong>
                  <span className="muted">
                    {fmtInt(p.campaigns.length)} campaigns{p.poc ? `, run by ${p.poc}` : ''}
                    {newestCreated(p.campaigns) ? `, newest created ${fmtDate(newestCreated(p.campaigns), { year: true })}` : ''}
                  </span>
                </summary>
                <p className="card-sub" style={{ marginBottom: 8 }}>Rule: <code>{p.matchPattern}</code></p>
                <DataTable columns={memberColumns} rows={p.campaigns} rowKey={r => r.id} dense pageSize={10} empty="No campaign matches this rule yet." />
              </details>
            ))}
          </Card>

          <Card className="flush" title="Team roster" subtitle="Who counts as an SDR, and other spellings used in campaign names. Changes re-read every campaign name.">
            <DataTable columns={rosterColumns} rows={data.mapping.team} rowKey={r => r.name} dense pageSize={30} />
          </Card>
        </div>
      )}
    </div>
  );
}
