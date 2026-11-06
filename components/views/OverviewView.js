'use client';

import Link from 'next/link';
import { useCallback, useMemo, useState } from 'react';
import { useTeamColor } from '@/lib/client/dashboard-context';
import { fmtInt } from '@/lib/client/format';
import { useApi } from '@/lib/client/use-api';
import { useFilters, useLinkWithFilters } from '@/lib/client/use-filters';
import Card from '../ui/Card';
import DataTable from '../ui/DataTable';
import FilterBar from '../ui/FilterBar';
import PageHeader from '../ui/PageHeader';
import { EmptyState, ErrorState, LoadingBlock } from '../ui/States';
import WarningsBanner from '../ui/WarningsBanner';
import ConversationPanel from './ConversationPanel';
import { PositiveResponses, ReplyFeed, SyncStatus, useProgramName } from './common';
import { DEFS } from './definitions';
import { OverviewComparison } from './funnel';
import { useOutcomes } from './outcomes';
import { OverviewLead, OverviewTiles, programColumns } from './overview';
import { ChannelCards, ChannelToggle, bySdrColumns, unresolvedNote } from './program';

/** What the SDR list leaves out, so it still reconciles with the rest of the page. */
function outsideNote({ emailsSent, invitesSent, positive, meetings }) {
  const parts = [
    emailsSent > 0 && `${fmtInt(emailsSent)} first emails`,
    invitesSent > 0 && `${fmtInt(invitesSent)} invites`,
    positive > 0 && `${fmtInt(positive)} positive`,
    meetings > 0 && `${fmtInt(meetings)} ${meetings === 1 ? 'meeting' : 'meetings'}`,
  ].filter(Boolean);
  return parts.length ? `Outside these SDRs (AI SDR and other campaigns): ${parts.join(', ')}. Pick someone in the SDR filter to see them here.` : undefined;
}

/**
 * Everything the team sent and everything that came back, for a range and a
 * channel (both | email | linkedin), counted the way a program page counts it:
 * companies first, then each channel, then who it came from and what they said.
 */
export default function OverviewView() {
  const { apiParams, get, setParams } = useFilters();
  const withFilters = useLinkWithFilters();
  const teamColor = useTeamColor();
  const programName = useProgramName();
  const channel = ['email', 'linkedin'].includes(get('channel')) ? get('channel') : 'both';
  const params = useMemo(() => ({ ...apiParams, channel }), [apiParams, channel]);
  const { data, error, loading, refreshing, reload } = useApi('/api/metrics/overview', params);

  const [panel, setPanel] = useState(null);
  const closePanel = useCallback(() => setPanel(null), []);
  const openCompany = useCallback(company => setPanel({
    type: 'company',
    target: { key: company.key, name: company.company, domain: company.domain },
  }), []);

  const view = data?.channel || channel;
  const summary = data?.companySummary;
  const empty = data && summary.total === 0 && data.tiles.meetings.value === 0;

  const { openOutcomes, outcomesPanel } = useOutcomes();
  const inRange = (kind, on, title, narrowed = {}) => openOutcomes({
    kind,
    channel: on,
    sdr: apiParams.sdr,
    program: apiParams.program,
    theme: apiParams.theme,
    ...narrowed,
    from: data.range.from,
    to: data.range.to,
    title,
  });
  const channelOfView = view === 'both' ? null : view;

  return (
    <div className="page">
      <PageHeader
        title="Overview"
        description="Every company the team reached on Instantly and HeyReach in this range, what came back, and the meetings that came of it."
        meta={<SyncStatus />}
      />
      <FilterBar
        range={data?.range}
        leading={<ChannelToggle value={channel} onChange={value => setParams({ channel: value === 'both' ? null : value })} />}
      />
      <WarningsBanner />
      {error && <ErrorState error={error} onRetry={reload} />}
      {loading && <LoadingBlock />}

      {empty && (
        <EmptyState title="No outreach in this range" action={<Link className="btn btn-small" href="/health">Open data health</Link>}>
          Nothing went out {view === 'both' ? '' : `on ${view === 'email' ? 'email' : 'LinkedIn'} `}in these dates. Pick a longer range, or
          check that the sync has run.
        </EmptyState>
      )}

      {data && !empty && (
        <div className={`page${refreshing ? ' is-refreshing' : ''}`}>
          <OverviewLead summary={summary} tiles={data.tiles} range={data.range} channel={view} />
          <OverviewTiles tiles={data.tiles} onOpen={(kind, title) => inRange(kind, channelOfView, title)} />
          {unresolvedNote(summary) && <p className="card-sub">{unresolvedNote(summary)}</p>}

          <ChannelCards
            view={view}
            data={data}
            onOpen={(kind, on, label) => inRange(kind, on, `${label}: ${on === 'email' ? 'Email' : 'LinkedIn'}`)}
          />

          <OverviewComparison channel={view} openOutcomes={openOutcomes} />

          <div className="grid-2">
            <Card
              className="flush"
              title={<Link href={withFilters('/sdrs')}>SDRs</Link>}
              subtitle="What each SDR sent in this range and what came back."
              footnote={outsideNote(data.outsideSdrs)}
            >
              <DataTable
                columns={bySdrColumns({
                  channel: view,
                  teamColor,
                  withFilters,
                  withCompanies: false,
                  withMeetings: true,
                  onOpen: (kind, on, sdr, title) => inRange(kind, on, title, { sdr }),
                })}
                rows={data.bySdr}
                rowKey={r => r.sdr}
                dense
                exportName="by-sdr"
              />
            </Card>
            <Card className="flush" title={<Link href={withFilters('/programs')}>Programs</Link>} subtitle="Specialised outreach in this range.">
              <DataTable
                columns={programColumns({
                  channel: view,
                  withFilters,
                  programName,
                  onOpen: (kind, program, title) => inRange(kind, channelOfView, title, { program }),
                })}
                rows={data.byProgram}
                rowKey={r => r.program}
                dense
                exportName="by-program"
              />
            </Card>
          </div>

          <Card className="flush" title="Positive responses" subtitle={DEFS.positiveList}>
            <PositiveResponses
              rows={data.positives}
              onOpen={r => openCompany({ key: r.companyKey, company: r.company, domain: r.domain })}
            />
          </Card>

          <Card title="Latest replies" subtitle="What people wrote back in this range, as our labels read it. Open one to read the whole conversation.">
            <ReplyFeed
              replies={data.replies.slice(0, 10)}
              onOpen={r => openCompany({ key: r.companyKey, company: r.domain || r.name, domain: r.domain })}
            />
          </Card>
        </div>
      )}

      <ConversationPanel
        target={panel?.type === 'company' ? panel.target : null}
        channel={view}
        onClose={closePanel}
      />
      {outcomesPanel}
    </div>
  );
}
