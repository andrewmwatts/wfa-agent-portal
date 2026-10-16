-- Store lead phone numbers as ten bare digits ("6027746793"). The portal shows them as 602-774-6793.
-- New and edited leads are normalized by api/leads.js; this cleans up rows saved before that.
-- A leading US country code (+1 / 1) is dropped. Safe to re-run.

update leads
set phone = case
      when length(regexp_replace(phone, '\D', '', 'g')) = 11
       and left(regexp_replace(phone, '\D', '', 'g'), 1) = '1'
        then substr(regexp_replace(phone, '\D', '', 'g'), 2)
      else regexp_replace(phone, '\D', '', 'g')
    end
where phone is not null
  and phone <> ''
  and phone !~ '^\d{10}$';

-- Anything left that is not ten digits (extensions, partial numbers) — review by hand:
-- select id, sfg_id, name, phone from leads where phone is not null and phone !~ '^\d{10}$';
