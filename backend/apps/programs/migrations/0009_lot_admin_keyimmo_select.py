from django.db import migrations

# Ticket B-041 — bug réel rencontré en écrivant `LitigeListView` (admin
# transverse, apps/support) : `Litige.objects.select_related('lot', ...)`
# revenait VIDE pour un litige pourtant visible (policy support_litige OK),
# parce que la JOINTURE vers programs_lot est silencieusement éliminée par
# SA PROPRE policy (`programs_lot_scope`, ticket 002 — organisation active
# seule, aucune branche admin_keyimmo) : un admin qui n'est membre d'aucune
# ligne Membership de l'organisation du lot ne peut littéralement PAS
# joindre ce lot, même si la ligne Litige elle-même lui est accordée. Piège
# RLS classique (INNER JOIN vers une table dont la policy exclut la ligne
# = ligne éliminée du résultat, pas d'erreur visible).
#
# PREMIÈRE VERSION DE CE CORRECTIF (abandonnée avant commit, jamais
# poussée) : une branche `admin_keyimmo` transverse SANS condition sur
# `support_litige` — accordait à tort une visibilité GLOBALE de TOUT `Lot`
# à tout `admin_keyimmo`, y compris sans aucun litige. Régression réelle
# détectée par la suite complète existante :
# `apps.procurement.tests.TestAdminLotSearch::
# test_rls_context_is_restored_even_when_an_exception_interrupts_the_loop`
# suppose explicitement (ticket B-037/B-039 : « la lecture reste scopée à
# l'organisation active ») qu'un `admin_keyimmo` SANS bascule RLS explicite
# ne voit PAS le `Lot` d'une autre organisation — la version large de cette
# policy cassait cette garantie PARTOUT dans le projet (recherche de lot,
# etc.), pas seulement pour `Litige`. Corrigé en scopant la branche
# admin_keyimmo à « ce Lot a au moins un Litige » : exactement le besoin
# réel (afficher le lot d'un litige déjà visible), rien de plus large.
#
# Correctif strictement ADDITIF : une SECONDE policy PERMISSIVE, SELECT
# uniquement, à côté de `programs_lot_scope` (FOR ALL, inchangée) — Postgres
# combine plusieurs policies PERMISSIVE pour une même commande avec OR
# (voir doc Postgres CREATE POLICY). Aucun risque sur les policies
# INSERT/UPDATE/DELETE de programs_lot (le gatekeeper `admin_keyimmo`
# explicite en payload du ticket B-039 reste intact), ni sur une recherche
# de lot admin ordinaire (`apps.procurement.services.search_lots_as_admin`,
# qui bascule le contexte RLS explicitement organisation par organisation —
# reste le SEUL chemin pour une recherche transverse générale).
#
# Pas de récursion : cette policy interroge `support_litige`, dont la
# propre policy (apps/support/migrations/0002_rls.py) ne référence jamais
# `programs_lot` en retour — pas de cycle.
CURRENT_USER_EXPR = "current_setting('app.current_user_id', true)::uuid"

IS_ADMIN_KEYIMMO_EXPR = f"""EXISTS (
        SELECT 1 FROM organizations_membership
        JOIN organizations_role ON organizations_role.id = organizations_membership.role_id
        WHERE organizations_membership.user_id = {CURRENT_USER_EXPR}
          AND organizations_role.code = 'admin_keyimmo'
    )"""

ENABLE_SQL = f"""
CREATE POLICY programs_lot_admin_keyimmo_litige_select ON programs_lot
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM support_litige
            WHERE support_litige.lot_id = programs_lot.id
        )
        AND {IS_ADMIN_KEYIMMO_EXPR}
    );
"""

DISABLE_SQL = """
DROP POLICY IF EXISTS programs_lot_admin_keyimmo_litige_select ON programs_lot;
"""


class Migration(migrations.Migration):

    dependencies = [
        ('programs', '0008_programcost_sequence_and_rls'),
        ('support', '0002_rls'),
    ]

    operations = [
        migrations.RunSQL(sql=ENABLE_SQL, reverse_sql=DISABLE_SQL),
    ]
