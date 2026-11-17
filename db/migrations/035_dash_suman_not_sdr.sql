-- Suman is no longer one of the SDRs (Ayush, 2026-11-17: "lets just remove suman from sdrs").
-- She becomes sdr_extra, as Aarsh, Akash, Ayush, Muni and Sanika did in 030: off the SDR lists
-- until picked by name, still in the people filter, and her campaigns, positives and meetings
-- still count in every total and stay credited to her (sdr_extra is an outreach role,
-- lib/outreach/roles.js). Touches one row; checked read-only before writing this.
UPDATE dash_team SET role = 'sdr_extra', updated_at = NOW()
 WHERE role = 'sdr' AND name = 'Suman';
