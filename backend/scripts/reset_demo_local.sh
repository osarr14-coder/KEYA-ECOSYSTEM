#!/usr/bin/env bash
# Audit UI R1 (étape 0, complété à l'étape 5 — PO-2026-09-28-19, T14) —
# réinitialisation LOCALE de la démonstration à partir du jeu initial
# versionné (migrations + `seed_demo_scenario`, DEMO-CI-v2), puis
# vérification (`check_demo_dataset`). Procédure complète :
# docs/exploitation/PROCEDURE_REINITIALISATION_DEMO.md
#
# Garde-fous :
#   - refuse toute base qui n'est pas locale (DB_HOST localhost/127.0.0.1) :
#     jamais utilisable contre Render ;
#   - `--dry-run` : contrôle les prérequis, décrit l'état actuel (lecture
#     seule) et affiche le plan, SANS RIEN ÉCRIRE (ni sauvegarde, ni base) ;
#   - `--confirm` exigé pour exécuter, avec DEMO_PASSWORD (choisi par
#     l'exploitant, jamais dans le dépôt) ;
#   - SAUVEGARDE d'abord base (pg_dump -Fc) ET fichiers déposés (media), puis
#     vérifie que la sauvegarde est relisible avant toute suppression ;
#   - PO-2026-09-29-10 (T16) : après les migrations, le journal est mis hors
#     de portée du compte applicatif (scripts/sql/protect_journal.sql, exécuté
#     en administrateur Postgres) puis contrôlé (check_journal_protection).
#
# Usage (depuis backend/, variables lues dans .env) :
#   PYTHON=/chemin/venv/bin/python scripts/reset_demo_local.sh --dry-run
#   DEMO_PASSWORD='...' PYTHON=/chemin/venv/bin/python scripts/reset_demo_local.sh --confirm
# Restauration : voir la commande affichée en fin de sauvegarde.
set -euo pipefail

cd "$(dirname "$0")/.."
MODE="${1:-}"
case "$MODE" in
  --confirm|--dry-run) ;;
  *) echo "Refus : ajoutez --dry-run (contrôle sans écriture) ou --confirm (opération destructive, locale uniquement)."; exit 2 ;;
esac

env_value() { { grep -E "^$1=" .env 2>/dev/null || true; } | tail -1 | cut -d= -f2-; }
DB_NAME="${DB_NAME:-$(env_value DB_NAME)}"
DB_USER="${DB_USER:-$(env_value DB_USER)}"
DB_HOST="${DB_HOST:-$(env_value DB_HOST)}"
DB_PORT="${DB_PORT:-$(env_value DB_PORT)}"
MEDIA_DIR="${MEDIA_ROOT:-$(env_value MEDIA_ROOT)}"
MEDIA_DIR="${MEDIA_DIR:-media}"
PYTHON="${PYTHON:-python}"
# Commande administrateur Postgres locale (suppression/recréation de la base).
PG_ADMIN="${PG_ADMIN:-sudo -n -u postgres}"
BACKUP_ROOT="${BACKUP_DIR:-$HOME/keya-backups}"

case "$DB_HOST" in
  localhost|127.0.0.1) ;;
  *) echo "Refus : base non locale ($DB_HOST). Ce script ne s'exécute jamais hors poste de développement."; exit 3 ;;
esac

if [ "$MODE" = "--dry-run" ]; then
  echo "Contrôle SANS ÉCRITURE — aucune sauvegarde, aucune base ni aucun fichier modifié."
  status=0
  check() { if eval "$2" >/dev/null 2>&1; then echo "  OK     $1"; else echo "  MANQUE $1"; status=1; fi; }
  echo "Prérequis :"
  echo "  INFO   Base locale : $DB_NAME sur $DB_HOST:${DB_PORT:-5432} (propriétaire $DB_USER)"
  check "Python du projet ($PYTHON)" "$PYTHON -c 'import django'"
  check "pg_dump, dropdb, createdb via « $PG_ADMIN » et pg_restore" \
    "$PG_ADMIN pg_dump --version && $PG_ADMIN dropdb --version && $PG_ADMIN createdb --version && pg_restore --version"
  check "Base joignable" "$PG_ADMIN psql -d '$DB_NAME' -Atc 'select 1'"
  check "Aucune migration en attente" "$PYTHON manage.py migrate --check"
  check "Journal hors de portée du compte applicatif (T16)" "$PYTHON manage.py check_journal_protection"
  if [ -n "${DEMO_PASSWORD:-}" ]; then echo "  OK     DEMO_PASSWORD fourni"; else echo "  MANQUE DEMO_PASSWORD (exigé à l'exécution, jamais dans le dépôt)"; status=1; fi
  check "Dossier de sauvegarde accessible en écriture ($BACKUP_ROOT)" \
    "{ [ -d '$BACKUP_ROOT' ] && [ -w '$BACKUP_ROOT' ]; } || [ -w '$(dirname "$BACKUP_ROOT")' ]"
  if [ -d "$MEDIA_DIR" ]; then
    echo "  INFO   Fichiers déposés : $(find "$MEDIA_DIR" -type f | wc -l) fichier(s), $(du -sh "$MEDIA_DIR" | cut -f1) ($MEDIA_DIR)"
  else
    echo "  INFO   Aucun dossier media ($MEDIA_DIR)"
  fi
  echo
  echo "État actuel de la base face au jeu initial (lecture seule) :"
  $PYTHON manage.py check_demo_dataset || true
  echo
  cat <<PLAN
Plan qui serait exécuté avec --confirm :
  1/6 Sauvegarde : pg_dump -Fc de $DB_NAME + archive de $MEDIA_DIR → $BACKUP_ROOT/<horodatage UTC>/, relue avant toute suppression
  2/6 Recréation de la base $DB_NAME (dropdb --force, createdb -O $DB_USER) et vidage de $MEDIA_DIR
  3/6 Migrations et table de cache
  4/6 Journal hors de portée du compte applicatif (protect_journal.sql en administrateur, puis check_journal_protection)
  5/6 Jeu initial versionné DEMO-CI-v2 (seed_demo_scenario : Country Pack CI, 2 jalons et leurs pièces exigées, 7 comptes, programme, 2 lots, barème)
  6/6 Vérification : check_demo_dataset (échoue s'il reste un écart)
PLAN
  exit $status
fi

[ -n "${DEMO_PASSWORD:-}" ] || { echo "Refus : DEMO_PASSWORD absent."; exit 2; }

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP_DIR="$BACKUP_ROOT/$STAMP"
mkdir -p "$BACKUP_DIR"

echo "1/6 Sauvegarde de la base $DB_NAME → $BACKUP_DIR/base.dump"
$PG_ADMIN pg_dump -Fc -d "$DB_NAME" -f /tmp/keya_base_$STAMP.dump
cp /tmp/keya_base_$STAMP.dump "$BACKUP_DIR/base.dump" && rm -f /tmp/keya_base_$STAMP.dump
echo "    Sauvegarde des fichiers déposés ($MEDIA_DIR) → $BACKUP_DIR/media.tar.gz"
if [ -d "$MEDIA_DIR" ]; then tar -czf "$BACKUP_DIR/media.tar.gz" -C "$MEDIA_DIR" .; else echo "    (aucun dossier media)"; fi
# Vérification : la sauvegarde doit être relisible AVANT toute suppression.
pg_restore -l "$BACKUP_DIR/base.dump" > "$BACKUP_DIR/base.toc"
echo "    Sauvegarde vérifiée ($(wc -l < "$BACKUP_DIR/base.toc") entrées)."

echo "2/6 Recréation de la base $DB_NAME (propriétaire $DB_USER)"
$PG_ADMIN dropdb --if-exists --force "$DB_NAME"
$PG_ADMIN createdb -O "$DB_USER" "$DB_NAME"
if [ -d "$MEDIA_DIR" ]; then find "$MEDIA_DIR" -mindepth 1 -delete; fi

echo "3/6 Migrations et cache"
$PYTHON manage.py migrate --no-input
$PYTHON manage.py createcachetable

echo "4/6 Journal hors de portée du compte applicatif (T16)"
$PG_ADMIN psql -q -d "$DB_NAME" -v app_role="$DB_USER" -f scripts/sql/protect_journal.sql
$PYTHON manage.py check_journal_protection

echo "5/6 Jeu initial versionné (Country Pack CI, jalons, comptes, programme)"
$PYTHON manage.py seed_demo_scenario

echo "6/6 Vérification du jeu initial"
$PYTHON manage.py check_demo_dataset

cat <<MSG

Réinitialisation terminée. Sauvegarde : $BACKUP_DIR
Restauration :
  $PG_ADMIN dropdb $DB_NAME && $PG_ADMIN createdb -O $DB_USER $DB_NAME
  $PG_ADMIN pg_restore -d $DB_NAME < $BACKUP_DIR/base.dump
  $PG_ADMIN psql -q -d $DB_NAME -v app_role=$DB_USER -f scripts/sql/protect_journal.sql
  tar -xzf $BACKUP_DIR/media.tar.gz -C $MEDIA_DIR
MSG
