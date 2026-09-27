#!/usr/bin/env bash
# Audit UI R1 (étape 0) — réinitialisation LOCALE de la démonstration à partir
# du jeu initial versionné (migrations + `seed_demo_scenario`, DEMO-CI-v1).
#
# Garde-fous :
#   - refuse toute base qui n'est pas locale (DB_HOST localhost/127.0.0.1) :
#     jamais utilisable contre Render ;
#   - exige --confirm et DEMO_PASSWORD (choisi par l'exploitant, jamais dans
#     le dépôt) ;
#   - SAUVEGARDE d'abord base (pg_dump -Fc) ET fichiers déposés (media), puis
#     vérifie que la sauvegarde est relisible avant toute suppression.
#
# Usage (depuis backend/, variables lues dans .env) :
#   DEMO_PASSWORD='...' scripts/reset_demo_local.sh --confirm
# Restauration : voir la commande affichée en fin de sauvegarde.
set -euo pipefail

cd "$(dirname "$0")/.."
[ "${1:-}" = "--confirm" ] || { echo "Refus : ajoutez --confirm (opération destructive, locale uniquement)."; exit 2; }
[ -n "${DEMO_PASSWORD:-}" ] || { echo "Refus : DEMO_PASSWORD absent."; exit 2; }

env_value() { grep -E "^$1=" .env 2>/dev/null | tail -1 | cut -d= -f2-; }
DB_NAME="${DB_NAME:-$(env_value DB_NAME)}"
DB_USER="${DB_USER:-$(env_value DB_USER)}"
DB_HOST="${DB_HOST:-$(env_value DB_HOST)}"
DB_PORT="${DB_PORT:-$(env_value DB_PORT)}"
MEDIA_DIR="${MEDIA_ROOT:-media}"
PYTHON="${PYTHON:-python}"
# Commande administrateur Postgres locale (suppression/recréation de la base).
PG_ADMIN="${PG_ADMIN:-sudo -n -u postgres}"

case "$DB_HOST" in
  localhost|127.0.0.1) ;;
  *) echo "Refus : base non locale ($DB_HOST). Ce script ne s'exécute jamais hors poste de développement."; exit 3 ;;
esac

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP_DIR="${BACKUP_DIR:-$HOME/keya-backups}/$STAMP"
mkdir -p "$BACKUP_DIR"

echo "1/4 Sauvegarde de la base $DB_NAME → $BACKUP_DIR/base.dump"
$PG_ADMIN pg_dump -Fc -d "$DB_NAME" -f /tmp/keya_base_$STAMP.dump
cp /tmp/keya_base_$STAMP.dump "$BACKUP_DIR/base.dump" && rm -f /tmp/keya_base_$STAMP.dump
echo "    Sauvegarde des fichiers déposés ($MEDIA_DIR) → $BACKUP_DIR/media.tar.gz"
if [ -d "$MEDIA_DIR" ]; then tar -czf "$BACKUP_DIR/media.tar.gz" -C "$MEDIA_DIR" .; else echo "    (aucun dossier media)"; fi
# Vérification : la sauvegarde doit être relisible AVANT toute suppression.
pg_restore -l "$BACKUP_DIR/base.dump" > "$BACKUP_DIR/base.toc"
echo "    Sauvegarde vérifiée ($(wc -l < "$BACKUP_DIR/base.toc") entrées)."

echo "2/4 Recréation de la base $DB_NAME (propriétaire $DB_USER)"
$PG_ADMIN dropdb --if-exists --force "$DB_NAME"
$PG_ADMIN createdb -O "$DB_USER" "$DB_NAME"
if [ -d "$MEDIA_DIR" ]; then find "$MEDIA_DIR" -mindepth 1 -delete; fi

echo "3/4 Migrations et cache"
$PYTHON manage.py migrate --no-input
$PYTHON manage.py createcachetable

echo "4/4 Jeu initial versionné (Country Pack CI, jalons, comptes, programme)"
$PYTHON manage.py seed_demo_scenario

cat <<MSG

Réinitialisation terminée. Sauvegarde : $BACKUP_DIR
Restauration :
  $PG_ADMIN dropdb $DB_NAME && $PG_ADMIN createdb -O $DB_USER $DB_NAME
  $PG_ADMIN pg_restore -d $DB_NAME < $BACKUP_DIR/base.dump
  tar -xzf $BACKUP_DIR/media.tar.gz -C $MEDIA_DIR
MSG
