'use client';

import Link from 'next/link';
import { Info } from 'lucide-react';
import { fmtInt, fmtPct } from '@/lib/client/format';
import { useApi } from '@/lib/client/use-api';
import { useFilters, useLinkWithFilters } from '@/lib/client/use-filters';
import HBarList from '../charts/HBarList';
import Heatmap from '../charts/Heatmap';
import Card from '../ui/Card';
import DataTable from '../ui/DataTable';
import FilterBar from '../ui/FilterBar';
import PageHeader from '../ui/PageHeader';
import { ErrorState, LoadingBlock } from '../ui/States';
import WarningsBanner from '../ui/WarningsBanner';
import { SyncStatus, campaignHref, useProgramName } from './common';

const DEFAULT_RANGE = 'last-3-months';
const SIZE_ORDER = ['1-10', '11-25', '26-50', '51-100', '101-200', '201-500', '501+', 'Unknown'];
const variantLetter = v => String.fromCharCode(65 + (Number(v) || 0));

/** Highest rate first; small samples after everything with enough leads. */
const byRate = rows => [...rows].sort((a, b) => (a.lowSample - b.lowSample) || ((b.positiveRate ?? -1) - (a.positiveRate ?? -1)));

function Breakdown({ title, subtitle, rows, label }) {
  return (
    <Card title={title} subtitle={subtitle}>
      <HBarList
        rows={rows}
        label={label}
        value="positiveRate"
        format={v => fmtPct(v)}
        detail={r => `${fmtInt(r.positive)} of ${fmtInt(r.contacted)}`}
        emphasis
      />
    </Card>
  );
}

export default function InsightsView() {
  const { apiParams } = useFilters({ defaultRange: DEFAULT_RANGE });
  const withFilters = useLinkWithFilters();
  const programName = useProgramName();
  const { data, error, loading, refreshing, reload } = useApi('/api/metrics/insights', apiParams);

  const copyColumns = [
    {
      key: 'campaign',
      label: 'Campaign',
      sort: r => r.campaign,
      csv: r => r.campaign,
      render: r => (
        <>
          <Link className="truncate" href={withFilters(campaignHref(r.campaignId))} title={r.campaign}>{r.campaign}</Link>
          <span className="cell-sub">{[r.sdr, r.theme].filter(Boolean).join(', ')}</span>
        </>
      ),
    },
    { key: 'step', label: 'Step', sort: r => r.step * 10 + r.variant, csv: r => `${r.step}${variantLetter(r.variant)}`, render: r => `${r.step}${variantLetter(r.variant)}` },
    {
      key: 'subject',
      label: 'Subject and opening',
      sortable: false,
      csv: r => r.subject,
      render: r => (
        <div className="wrap-text">
          <span style={{ fontWeight: 500 }}>{r.subject || <span className="muted">Same thread as the step before</span>}</span>
          {r.preview && <span className="cell-sub">{r.preview}</span>}
        </div>
      ),
    },
    { key: 'sent', label: 'Sent', align: 'right', csv: r => r.sent, render: r => fmtInt(r.sent) },
    { key: 'replies', label: 'Replies', align: 'right', csv: r => r.replies, render: r => fmtInt(r.replies) },
    { key: 'replyRate', label: 'Reply rate', align: 'right', csv: r => r.replyRate, render: r => fmtPct(r.replyRate, 2) },
  ];

  const senderColumns = [
    { key: 'sender', label: 'Sender', sort: r => r.sender, csv: r => r.sender },
    { key: 'messagesSent', label: 'Messages', align: 'right', csv: r => r.messagesSent, render: r => fmtInt(r.messagesSent) },
    { key: 'conversations', label: 'Conversations', align: 'right', csv: r => r.conversations, render: r => fmtInt(r.conversations) },
    { key: 'replies', label: 'Replied', align: 'right', csv: r => r.replies, render: r => fmtInt(r.replies) },
    { key: 'positive', label: 'Positive', align: 'right', csv: r => r.positive, render: r => fmtInt(r.positive) },
  ];

  return (
    <div className="page">
      <PageHeader
        title="What's working"
        description="Which SDRs, message angles, company types and sequence steps turn contacted leads into positive replies."
        meta={<SyncStatus />}
      />
      <FilterBar range={data?.range} defaultRange={DEFAULT_RANGE} showGrain={false} />
      <WarningsBanner />
      {error && <ErrorState error={error} onRetry={reload} />}
      {loading && <LoadingBlock />}

      {data && (
        <div className={`page${refreshing ? ' is-refreshing' : ''}`}>
          <div className="notice info" role="note">
            <Info aria-hidden="true" />
            <span>
              {data.basis} Groups with fewer than {data.minSample} contacted leads are grey and never marked best or worst.
              Recent weeks read low because some replies haven&apos;t arrived yet.
            </span>
          </div>

          <Card title="SDR by message angle" subtitle="Positive rate for the leads each SDR loaded with each angle.">
            <Heatmap rows={data.sdrTheme.sdrs} columns={data.sdrTheme.themes} cells={data.sdrTheme.cells} minSample={data.minSample} />
          </Card>

          <div className="grid-3">
            <Breakdown title="Message angle" subtitle="Read from campaign names." rows={byRate(data.byTheme)} label="theme" />
            <Breakdown title="Program" rows={byRate(data.byProgram)} label={r => (r.program === 'none' ? 'No program' : programName(r.program))} />
            <Breakdown title="SDR" rows={byRate(data.bySdr)} label="sdr" />
            <Breakdown title="Company type" subtitle="Open source status from the ICP database." rows={byRate(data.byCompanyType)} label="companyType" />
            <Breakdown
              title="Company size"
              subtitle="Employees, smallest first."
              rows={[...data.byEmployees].sort((a, b) => SIZE_ORDER.indexOf(a.employees) - SIZE_ORDER.indexOf(b.employees))}
              label="employees"
            />
            <Breakdown title="ICP fit" rows={byRate(data.byIcp)} label="icp" />
          </div>

          <div className="grid-2">
            <Card title="Which email gets the reply" subtitle="Positive replies by the sequence step people answered, with each step's reply rate per send.">
              <HBarList
                rows={data.steps}
                label={r => `Step ${r.step}`}
                value="positive"
                detail={r => `${fmtPct(r.shareOfPositive, 0)} of positive, ${fmtPct(r.stepReplyRate)} reply rate`}
                emptyText="No replies with a known step in this range."
              />
            </Card>
            <Breakdown title="Category" subtitle="Top categories from the ICP database." rows={byRate(data.byCategory)} label="category" />
          </div>

          <Card className="flush" title="Best-performing copy" subtitle="Steps with at least 100 sends in campaigns active in this range, ranked by lifetime reply rate.">
            <DataTable columns={copyColumns} rows={data.topCopy} rowKey={r => `${r.campaignId}-${r.step}-${r.variant}`} exportName="best-copy" empty="No step had 100 or more sends in this range." />
          </Card>

          <Card
            className="flush"
            title="LinkedIn senders"
            subtitle="HeyReach conversations archived by the AI SDR app. Senders are the people whose LinkedIn accounts send, not the SDRs. Replies count by the date they came in, so some belong to conversations started before this range."
          >
            <DataTable columns={senderColumns} rows={data.linkedinBySender} rowKey={r => r.sender} dense empty="No LinkedIn messages in this range." exportName="linkedin-senders" />
          </Card>
        </div>
      )}
    </div>
  );
}
