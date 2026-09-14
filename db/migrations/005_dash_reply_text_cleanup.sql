-- Reply text lives only in the AI SDR archive (ctx_events), where the AI SDR app's
-- Instantly and HeyReach syncs store each reply once. The reply-classify job reads it
-- from there, so the copies 004 let the dashboard write are cleared. The columns stay
-- (migrations are additive) and are no longer written.

UPDATE dash_reply_verdicts
   SET subject = NULL, body = NULL
 WHERE subject IS NOT NULL OR body IS NOT NULL;

-- The dashboard's own Instantly /emails job was retired with this change.
DELETE FROM dash_sync_state WHERE job = 'instantly-replies';
