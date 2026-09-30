-- T16 (CDC §10, PO-2026-09-29-10) — TENTATIVES de modification ou de
-- suppression du journal, à exécuter AVEC LE COMPTE APPLICATIF. Chaque
-- tentative doit être REFUSÉE. Voir
-- docs/exploitation/PROCEDURE_VERIFICATION_RENDER_T15_T16.md.
--
--   psql "<url de connexion du compte applicatif>" -f scripts/sql/attempt_journal_bypass.sql
--
-- SANS EFFET PERMANENT, même si une tentative réussit :
--   - chaque tentative tourne dans un sous-bloc qui est TOUJOURS annulé
--     (une tentative acceptée lève aussitôt une erreur, ce qui l'annule) ;
--   - l'ensemble est dans une transaction terminée par ROLLBACK ;
--   - lock_timeout court : rien n'attend un verrou tenu par l'application.
-- Sortie : une ligne REFUSÉ, ÉCART ou NON CONCLUANT par tentative.

\set ON_ERROR_STOP on
-- Rôle propriétaire du journal : keya_ecosystem_owner (ADR 0005) par défaut ;
-- sur un hébergement à compte unique, le compte fourni (-v proprietaire=…).
\if :{?proprietaire}
\else
  \set proprietaire keya_ecosystem_owner
\endif
\set QUIET on
SET client_min_messages = notice;
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '20s';

CREATE FUNCTION pg_temp.tenter(libelle text, commande text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    -- Masque les notices de la commande (ex. « drop cascades to … ») ;
    -- le réglage est annulé avec le sous-bloc.
    PERFORM set_config('client_min_messages', 'warning', true);
    EXECUTE commande;
    RAISE EXCEPTION USING MESSAGE = '__accepte__';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = '__accepte__' THEN
      RAISE NOTICE 'ÉCART        % : ACCEPTÉ (annulé aussitôt)', libelle;
    ELSIF SQLSTATE = '55P03' OR SQLSTATE = '57014' THEN
      RAISE NOTICE 'NON CONCLUANT % : verrou ou délai dépassé (%), relancer hors activité', libelle, SQLSTATE;
    ELSE
      RAISE NOTICE 'REFUSÉ       % (% %)', libelle, SQLSTATE, left(SQLERRM, 90);
    END IF;
  END;
END $$;

-- UPDATE et DELETE : sous RLS sans policy d'écriture, ils touchent 0 ligne
-- sans erreur. Accepté = au moins une ligne touchée ; journal vide = non concluant.
CREATE FUNCTION pg_temp.tenter_lignes(libelle text, table_journal text, commande text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE touchees bigint; visibles bigint;
BEGIN
  EXECUTE format('SELECT count(*) FROM %I', table_journal) INTO visibles;
  BEGIN
    EXECUTE commande;
    GET DIAGNOSTICS touchees = ROW_COUNT;
    RAISE EXCEPTION USING MESSAGE = '__lignes__' || touchees;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '\_\_lignes\_\_%' THEN
      touchees := substr(SQLERRM, length('__lignes__') + 1)::bigint;
      IF touchees > 0 THEN
        RAISE NOTICE 'ÉCART        % : % ligne(s) touchée(s) (annulé aussitôt)', libelle, touchees;
      ELSIF visibles = 0 THEN
        RAISE NOTICE 'NON CONCLUANT % : 0 ligne visible dans %', libelle, table_journal;
      ELSE
        RAISE NOTICE 'REFUSÉ       % (0 ligne touchée sur % visibles)', libelle, visibles;
      END IF;
    ELSIF SQLSTATE = '55P03' OR SQLSTATE = '57014' THEN
      RAISE NOTICE 'NON CONCLUANT % : verrou ou délai dépassé (%), relancer hors activité', libelle, SQLSTATE;
    ELSE
      RAISE NOTICE 'REFUSÉ       % (% %)', libelle, SQLSTATE, left(SQLERRM, 90);
    END IF;
  END;
END $$;

-- La RLS ne montre au compte que les événements de l'organisation posée
-- dans `app.current_organization_id` (comme l'application le fait pour chaque
-- requête) : on pose celle qui a le plus d'événements, pour que UPDATE et
-- DELETE portent sur des lignes réellement visibles.
DO $$
DECLARE org uuid; meilleure uuid; nombre bigint; maximum bigint := -1;
BEGIN
  FOR org IN SELECT id FROM organizations_organization LOOP
    PERFORM set_config('app.current_organization_id', org::text, true);
    SELECT count(*) INTO nombre FROM audit_event;
    IF nombre > maximum THEN maximum := nombre; meilleure := org; END IF;
  END LOOP;
  IF meilleure IS NOT NULL THEN
    PERFORM set_config('app.current_organization_id', meilleure::text, true);
  END IF;
  RAISE NOTICE 'Contexte RLS : organisation % (% événement(s) d''audit visibles)', meilleure, greatest(maximum, 0);
END $$;

SELECT set_config('verif.proprietaire', :'proprietaire', true) AS proprietaire_pose \gset
\echo '== Tentatives du compte applicatif sur le journal (toutes doivent être REFUSÉ)'
SELECT current_user AS compte, current_database() AS base \gset
\echo 'compte :' :compte ' base :' :base

DO $$
BEGIN
  PERFORM pg_temp.tenter_lignes('UPDATE audit_event', 'audit_event', 'UPDATE audit_event SET justification = justification');
  PERFORM pg_temp.tenter_lignes('DELETE audit_event', 'audit_event', 'DELETE FROM audit_event');
  PERFORM pg_temp.tenter_lignes('UPDATE trust_event', 'trust_event', 'UPDATE trust_event SET source = source');
  PERFORM pg_temp.tenter_lignes('DELETE trust_event', 'trust_event', 'DELETE FROM trust_event');
  PERFORM pg_temp.tenter('TRUNCATE audit_event', 'TRUNCATE audit_event CASCADE');
  PERFORM pg_temp.tenter('TRUNCATE trust_event', 'TRUNCATE trust_event CASCADE');
  PERFORM pg_temp.tenter('DROP TABLE audit_event', 'DROP TABLE audit_event CASCADE');
  PERFORM pg_temp.tenter('DROP TABLE trust_event', 'DROP TABLE trust_event CASCADE');
  PERFORM pg_temp.tenter('Désactiver les triggers de audit_event', 'ALTER TABLE audit_event DISABLE TRIGGER USER');
  PERFORM pg_temp.tenter('Désactiver les triggers de trust_event', 'ALTER TABLE trust_event DISABLE TRIGGER USER');
  PERFORM pg_temp.tenter('Lever FORCE RLS sur audit_event', 'ALTER TABLE audit_event NO FORCE ROW LEVEL SECURITY');
  PERFORM pg_temp.tenter('Lever la RLS sur audit_event', 'ALTER TABLE audit_event DISABLE ROW LEVEL SECURITY');
  PERFORM pg_temp.tenter('Ajouter une policy d''écriture', 'CREATE POLICY verif_contournement ON audit_event FOR ALL USING (true) WITH CHECK (true)');
  PERFORM pg_temp.tenter('Réécrire audit_event_reject_mutation()',
    'CREATE OR REPLACE FUNCTION audit_event_reject_mutation() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN RETURN NULL; END $f$');
  PERFORM pg_temp.tenter('Réécrire trust_event_reject_mutation()',
    'CREATE OR REPLACE FUNCTION trust_event_reject_mutation() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN RETURN NULL; END $f$');
  PERFORM pg_temp.tenter('Se donner la propriété de audit_event', format('ALTER TABLE audit_event OWNER TO %I', current_user));
  PERFORM pg_temp.tenter('Prendre le rôle propriétaire (SET ROLE)', format('SET ROLE %I', current_setting('verif.proprietaire')));
  PERFORM pg_temp.tenter('S''attribuer le rôle propriétaire (GRANT)', format('GRANT %I TO %I', current_setting('verif.proprietaire'), current_user));
  PERFORM pg_temp.tenter('Reprendre la base', format('ALTER DATABASE %I OWNER TO %I', current_database(), current_user));
  PERFORM pg_temp.tenter('Supprimer le schéma public', 'DROP SCHEMA public CASCADE');
END $$;

\echo '== Contrôle positif : l''application doit pouvoir LIRE le journal'
SELECT (SELECT count(*) FROM audit_event) AS audit_event_visibles,
       (SELECT count(*) FROM trust_event) AS trust_event_visibles;

ROLLBACK;
\echo '== Fin : transaction annulée, aucune modification conservée.'
