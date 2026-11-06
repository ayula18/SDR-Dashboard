-- The SDRs are Akhil, Ahmed, Rama, Dheeraj, Harshini and Suman (Ayush, 2026-11-03:
-- "that's it"). Everyone else who has ever run SDR campaigns stays selectable in the SDR
-- filter but leaves the SDR page and the Overview's SDR list until picked by name (Ayush,
-- 2026-11-07: "only show data for normal sdrs until these people are selected
-- specifically"). Their campaigns, positives and meetings still count in every total, and
-- an admin can change a role in Data health.
UPDATE dash_team SET role = 'sdr_extra', updated_at = NOW()
 WHERE role = 'sdr' AND name IN ('Aarsh', 'Akash', 'Ayush', 'Muni', 'Sanika');
