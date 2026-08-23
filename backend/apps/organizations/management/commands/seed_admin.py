"""Déploiement (Render, voir DEPLOY_RENDER.md) — amorce un environnement
vierge : aucune fixture/seed n'existait avant cette commande (vérifié :
aucun Role n'est créé par une migration, seul CountryPack Sénégal l'est,
voir apps/organizations/migrations/0003_seed_senegal_country_pack.py).
Sans elle, un déploiement neuf n'a ni les 5 rôles (client/sponsor/
constructeur/inspecteur/admin_keyimmo — codes/labels repris tels quels des
appels Role.objects.get_or_create déjà dispersés dans les tests de ce
projet, jamais inventés), ni aucun utilisateur pour se connecter.

Idempotente (get_or_create partout, mot de passe RÉINITIALISÉ à chaque
exécution si ADMIN_PASSWORD change) — relançable sans risque après un
redéploiement.
"""
from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from apps.core.rls import set_rls_context
from apps.organizations.models import CountryPack, Membership, Organization, Role

ROLES = [
    ('client', 'Client'),
    ('sponsor', 'Sponsor'),
    ('constructeur', 'Constructeur'),
    ('inspecteur', 'Inspecteur'),
    ('admin_keyimmo', 'Admin KEYIMMO'),
]


class Command(BaseCommand):
    help = (
        "Amorce un déploiement vierge : les 5 rôles du MVP, une organisation "
        "de démonstration, et un utilisateur admin_keyimmo pour s'y connecter "
        "(ADMIN_EMAIL/ADMIN_PASSWORD, variables d'environnement)."
    )

    def handle(self, *args, **options):
        admin_email = _require_env('ADMIN_EMAIL')
        admin_password = _require_env('ADMIN_PASSWORD')

        with transaction.atomic():
            for code, label in ROLES:
                Role.objects.get_or_create(code=code, defaults={'label': label})
            self.stdout.write(self.style.SUCCESS(f'{len(ROLES)} rôles présents.'))

            country_pack = CountryPack.objects.filter(code='SN').first()
            if country_pack is None:
                raise CommandError(
                    "CountryPack 'SN' introuvable — la migration "
                    "0003_seed_senegal_country_pack n'a pas été appliquée. "
                    "Lancer `manage.py migrate` avant cette commande."
                )

            organization, created = Organization.objects.get_or_create(
                name='KEYIMMO AFRIC (démo)',
                defaults={'country_pack': country_pack},
            )
            self.stdout.write(self.style.SUCCESS(
                f'Organisation "{organization.name}" '
                f'{"créée" if created else "déjà présente"}.'
            ))

            User = get_user_model()
            user, user_created = User.objects.get_or_create(
                email=admin_email,
                defaults={'is_staff': True, 'is_superuser': True},
            )
            user.set_password(admin_password)
            user.is_staff = True
            user.save(update_fields=['password', 'is_staff'])
            self.stdout.write(self.style.SUCCESS(
                f'Utilisateur "{admin_email}" '
                f'{"créé" if user_created else "déjà présent, mot de passe réinitialisé"}.'
            ))

            admin_role = Role.objects.get(code='admin_keyimmo')
            # organizations_membership est en RLS (FORCE, ticket 001) — le
            # SELECT de get_or_create exige app.current_user_id (policy
            # membership_select : USING (user_id = current_user_id), JAMAIS
            # via organization_id — ticket 001, voir la migration) et
            # l'INSERT exige app.current_organization_id (policy
            # membership_insert). Hors de tout contexte HTTP ici (le
            # middleware qui pose normalement les deux ne tourne jamais
            # pour une management command) — posés explicitement tous les
            # deux. Trouvé en testant RÉELLEMENT l'idempotence de cette
            # commande (deux exécutions de suite) contre une vraie base
            # RLS : sans user_id, le SELECT ne voit jamais la ligne
            # existante (current_user_id absent), get_or_create tente un
            # second INSERT, et l'UNIQUE constraint échoue — jamais
            # supposé, reproduit puis corrigé.
            set_rls_context(user_id=user.id, organization_id=organization.id)
            Membership.objects.get_or_create(
                user=user, organization=organization, defaults={'role': admin_role},
            )
            self.stdout.write(self.style.SUCCESS(
                f'Membership admin_keyimmo confirmé pour "{admin_email}".'
            ))

        self.stdout.write(self.style.SUCCESS(
            f'Prêt — connexion possible avec {admin_email} sur apps/web (écran de connexion).'
        ))


def _require_env(name: str) -> str:
    from decouple import config

    value = config(name, default='')
    if not value:
        raise CommandError(f'Variable d\'environnement {name} manquante — voir DEPLOY_RENDER.md.')
    return value
