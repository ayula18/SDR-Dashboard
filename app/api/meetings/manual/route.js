import { handle } from '@/lib/api';
import { addManualMeeting, deleteManualMeeting, setMeetingCampaign } from '@/lib/admin';

/**
 * Meetings an SDR records or attributes themselves.
 *
 * Any signed-in person, not admins only: the person who booked the meeting is
 * the one who knows which campaign earned it, and 28 recent bookings have no
 * recorded outreach for the dashboard to infer it from. Every row keeps
 * created_by, so the entry is attributable.
 */

/** Body: { domain, meetingDate, campaignId?, sdrName?, channel?, direction?, company?, note? } */
export async function POST(request) {
  return handle(async user => addManualMeeting(await request.json().catch(() => ({})), user));
}

/** Body: { id, campaignId, sdrName?, note? } — works on a booking from any source. */
export async function PATCH(request) {
  return handle(async user => {
    const body = await request.json().catch(() => ({}));
    return setMeetingCampaign(body.id, body, user);
  });
}

/** Query param: id. Manual rows only. */
export async function DELETE(request) {
  return handle(() => deleteManualMeeting(request.nextUrl.searchParams.get('id')));
}
