-- T16 (CDC §10, PO-2026-09-29-10) — constat EN LECTURE SEULE de la
-- protection du journal, à exécuter AVEC LE COMPTE APPLICATIF (celui que
-- l'application utilise), sur n'importe quelle base : locale, copie, Render.
-- Voir docs/exploitation/PROCEDURE_VERIFICATION_RENDER_T15_T16.md.
--
--   psql "<url de connexion du compte applicatif>" -f scripts/sql/verify_journal_protection.sql
--
-- N'écrit rien : transaction en lecture seule, annulée à la fin. Complète
-- `manage.py check_journal_protection` sur les points qu'il ne couvre pas :
-- superutilisateur, BYPASSRLS, droit d'administrer le rôle propriétaire (un
-- compte qui peut se donner ce rôle peut à tout moment redevenir propriétaire).

\set ON_ERROR_STOP on
-- Rôle propriétaire du journal : keya_ecosystem_owner (ADR 0005) par défaut ;
-- sur un hébergement à compte unique, le compte fourni (-v proprietaire=…).
\if :{?proprietaire}
\else
  \set proprietaire keya_ecosystem_owner
\endif
\pset footer off
BEGIN READ ONLY;

\echo '== Contexte'
SELECT current_user AS compte, current_database() AS base,
       current_setting('server_version') AS version_postgres;

\echo '== Points de contrôle (OK = le compte ne peut ni modifier ni supprimer le journal)'
WITH app AS (SELECT * FROM pg_roles WHERE rolname = current_user),
owner_role AS (SELECT oid FROM pg_roles WHERE rolname = :'proprietaire'),
checks(ordre, point, conforme) AS (
  SELECT 1, 'compte non superutilisateur', NOT rolsuper FROM app
  UNION ALL SELECT 2, 'compte sans BYPASSRLS (ne contourne pas la RLS)', NOT rolbypassrls FROM app
  UNION ALL SELECT 3, 'rôle propriétaire ' || :'proprietaire' || ' présent et distinct du compte', EXISTS (SELECT 1 FROM owner_role) AND :'proprietaire' <> current_user
  UNION ALL SELECT 4, 'compte non membre du rôle propriétaire',
    NOT COALESCE((SELECT pg_has_role(current_user, oid, 'MEMBER') FROM owner_role), false)
  UNION ALL SELECT 5, 'compte sans droit d''administrer le rôle propriétaire (ne peut pas se l''attribuer)',
    NOT EXISTS (SELECT 1 FROM pg_auth_members m, owner_role o, app
                WHERE m.roleid = o.oid AND m.member = app.oid AND m.admin_option)
    AND NOT (current_setting('server_version_num')::int < 160000
             AND (SELECT rolcreaterole FROM app))
  UNION ALL SELECT 6, 'compte non propriétaire de la base',
    NOT (SELECT pg_has_role(current_user, datdba, 'MEMBER') FROM pg_database WHERE datname = current_database())
  UNION ALL SELECT 7, 'compte non propriétaire du schéma public',
    NOT (SELECT pg_has_role(current_user, nspowner, 'MEMBER') FROM pg_namespace WHERE nspname = 'public')
  UNION ALL SELECT 10 + i, t || ' : compte non propriétaire',
    NOT pg_has_role(current_user, (SELECT relowner FROM pg_class WHERE oid = t::regclass), 'MEMBER')
    FROM unnest(ARRAY['audit_event', 'trust_event']) WITH ORDINALITY AS x(t, i)
  UNION ALL SELECT 20 + i, t || ' : lecture et ajout accordés',
    has_table_privilege(t, 'SELECT') AND has_table_privilege(t, 'INSERT')
    FROM unnest(ARRAY['audit_event', 'trust_event']) WITH ORDINALITY AS x(t, i)
  UNION ALL SELECT 30 + i, t || ' : ni UPDATE, DELETE, TRUNCATE, TRIGGER, REFERENCES',
    NOT (has_table_privilege(t, 'UPDATE') OR has_table_privilege(t, 'DELETE') OR has_table_privilege(t, 'TRUNCATE')
         OR has_table_privilege(t, 'TRIGGER') OR has_table_privilege(t, 'REFERENCES'))
    FROM unnest(ARRAY['audit_event', 'trust_event']) WITH ORDINALITY AS x(t, i)
  UNION ALL SELECT 40 + i, t || ' : RLS active et forcée',
    (SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid = t::regclass)
    FROM unnest(ARRAY['audit_event', 'trust_event']) WITH ORDINALITY AS x(t, i)
  UNION ALL SELECT 50 + i, t || ' : triggers anti-modification actifs (2 au moins)',
    (SELECT count(*) >= 2 FROM pg_trigger WHERE tgrelid = t::regclass AND NOT tgisinternal AND tgenabled = 'O')
    FROM unnest(ARRAY['audit_event', 'trust_event']) WITH ORDINALITY AS x(t, i)
  UNION ALL SELECT 60 + i, f || '() : compte non propriétaire (ne peut pas la réécrire)',
    NOT COALESCE((SELECT pg_has_role(current_user, proowner, 'MEMBER') FROM pg_proc WHERE proname = f), true)
    FROM unnest(ARRAY['audit_event_reject_mutation', 'trust_event_reject_mutation']) WITH ORDINALITY AS x(f, i)
)
SELECT CASE WHEN conforme THEN 'OK' ELSE 'MANQUE' END AS resultat, point
FROM checks ORDER BY ordre;

\echo '== Faisabilité sur un hébergement sans superutilisateur (informatif)'
SELECT rolcreaterole AS peut_creer_des_roles, rolcreatedb AS peut_creer_des_bases,
       (SELECT count(*) FROM pg_roles WHERE rolname NOT LIKE 'pg\_%') AS roles_visibles
FROM pg_roles WHERE rolname = current_user;

ROLLBACK;
