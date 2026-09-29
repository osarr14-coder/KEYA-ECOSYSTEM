-- PO-2026-09-29-10 (T16, CDC §10) — le compte applicatif ne dispose plus
-- d'aucun moyen de modifier ou de supprimer le journal. Voir
-- docs/adr/0005-journal-hors-de-portee-du-compte-applicatif.md.
--
-- Constat de la revue assistée (docs/recette/REVUE_ASSISTEE_R1.md) : le
-- compte applicatif, propriétaire de la base, du schéma `public` et des
-- tables `audit_event`/`trust_event`, pouvait les vider (TRUNCATE), les
-- supprimer (propriété du schéma), désactiver leurs triggers, lever
-- FORCE ROW LEVEL SECURITY ou réécrire leurs fonctions de trigger.
--
-- Ce script transfère ces propriétés à un rôle propriétaire SANS
-- connexion (`keya_ecosystem_owner`) dont le compte applicatif n'est PAS
-- membre, puis ne rend au compte applicatif que ce dont il a besoin :
-- lire et ajouter au journal, créer et faire évoluer SES tables (métier).
--
-- À exécuter par un administrateur Postgres (jamais par le compte
-- applicatif, qui n'en a pas le droit), APRÈS les migrations :
--   psql -d <base> -v app_role=keya_ecosystem_app -f scripts/sql/protect_journal.sql
-- Idempotent : relançable sans effet de bord.

\set ON_ERROR_STOP on
\if :{?app_role}
\else
  \set app_role keya_ecosystem_app
\endif

BEGIN;
SELECT set_config('keya.app_role', :'app_role', true) AS app_role_set \gset

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'keya_ecosystem_owner') THEN
    CREATE ROLE keya_ecosystem_owner NOLOGIN;
  END IF;
END
$$;

-- Base et schéma : le propriétaire d'un schéma peut supprimer toute table
-- qui s'y trouve ; le compte applicatif ne doit plus l'être.
SELECT format('ALTER DATABASE %I OWNER TO keya_ecosystem_owner', current_database()) \gexec
ALTER SCHEMA public OWNER TO keya_ecosystem_owner;
SELECT format('GRANT CONNECT, TEMPORARY ON DATABASE %I TO %I', current_database(), :'app_role') \gexec
GRANT USAGE, CREATE ON SCHEMA public TO :"app_role";

-- Journal : tables (leurs séquences suivent), fonctions de trigger.
ALTER TABLE audit_event OWNER TO keya_ecosystem_owner;
ALTER TABLE trust_event OWNER TO keya_ecosystem_owner;
ALTER FUNCTION audit_event_reject_mutation() OWNER TO keya_ecosystem_owner;
ALTER FUNCTION trust_event_reject_mutation() OWNER TO keya_ecosystem_owner;
-- Séquence non rattachée à une colonne (elle ne suit pas la table) : transfert explicite.
DO $$
DECLARE seq text;
BEGIN
  FOREACH seq IN ARRAY ARRAY['audit_event_id_seq', 'trust_event_sequence_seq'] LOOP
    IF (SELECT pg_get_userbyid(relowner) FROM pg_class WHERE relname = seq) <> 'keya_ecosystem_owner' THEN
      EXECUTE format('ALTER SEQUENCE %I OWNER TO keya_ecosystem_owner', seq);
    END IF;
  END LOOP;
END
$$;

-- Le compte applicatif lit et ajoute ; rien d'autre (ni UPDATE, ni DELETE,
-- ni TRUNCATE, ni TRIGGER, ni REFERENCES).
REVOKE ALL ON audit_event, trust_event FROM PUBLIC, :"app_role";
GRANT SELECT, INSERT ON audit_event, trust_event TO :"app_role";
GRANT USAGE, SELECT ON SEQUENCE audit_event_id_seq, trust_event_sequence_seq TO :"app_role";

-- Garde-fou : le script échoue (et n'applique rien) si le compte applicatif
-- pouvait encore agir en propriétaire.
DO $$
DECLARE
  app text := current_setting('keya.app_role');
BEGIN
  IF pg_has_role(app, 'keya_ecosystem_owner', 'MEMBER') THEN
    RAISE EXCEPTION 'Le compte applicatif % est membre de keya_ecosystem_owner : protection impossible.', app;
  END IF;
END
$$;

COMMIT;
