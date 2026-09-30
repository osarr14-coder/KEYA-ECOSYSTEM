"""PO-2026-09-30-12 — désactivation des comptes hors du jeu de démonstration.

La base Render garde des comptes d'anciennes démonstrations : ils ne voient
aucune donnée ancienne (constaté le 30/09), mais peuvent encore se connecter.
Ils sont DÉSACTIVÉS (connexion refusée, jetons en cours refusés), jamais
supprimés : le journal garde leur nom d'acteur.

Trois temps, sur accord du PO et après la sauvegarde C1 :

1. sans option : **liste**, sans rien écrire, les comptes actifs hors des
   sept comptes du jeu et de l'administrateur (`--admin-email`, défaut
   ADMIN_EMAIL), et affiche un **code** propre à cette liste ;
2. `--appliquer --code <code> --sauvegarde <fichier C1>` : désactive
   exactement la liste présentée (si elle a changé, le code ne correspond
   plus et rien n'est fait) ; chaque désactivation est inscrite au journal ;
3. retour arrière : `--reactiver <adresse> [--reactiver …]`, tracé aussi.
"""
import hashlib
import os
from pathlib import Path

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from apps.audit import services as audit
from apps.core.management.commands.check_out_of_instance import demo_emails
from apps.core.rls import set_rls_context
from apps.organizations.models import Organization
from apps.sales.management.commands.seed_demo_scenario import KEYIMMO_ORG


def out_of_set_accounts(admin_email):
    known = demo_emails(admin_email)
    return [
        user for user in get_user_model().objects.filter(is_active=True).order_by('email')
        if user.email.lower() not in known
    ]


def list_code(users):
    digest = hashlib.sha256('\n'.join(sorted(str(user.id) for user in users)).encode()).hexdigest()
    return digest[:10]


class Command(BaseCommand):
    help = 'Liste (par défaut) ou désactive les comptes hors du jeu de démonstration (PO-2026-09-30-12).'

    def add_arguments(self, parser):
        parser.add_argument('--admin-email', default=os.environ.get('ADMIN_EMAIL', ''),
                            help='Compte administrateur posé par seed_admin, jamais désactivé (défaut : ADMIN_EMAIL).')
        parser.add_argument('--appliquer', action='store_true', help='Désactive la liste présentée.')
        parser.add_argument('--code', help='Code affiché par la liste (exigé avec --appliquer).')
        parser.add_argument('--sauvegarde', help='Fichier de la sauvegarde C1 (exigé avec --appliquer).')
        parser.add_argument('--reactiver', action='append', default=[], metavar='ADRESSE',
                            help='Réactive ce compte (retour arrière), répétable.')

    def handle(self, *args, **options):
        if options['reactiver']:
            return self._reactivate(options['reactiver'])
        admin_email = (options['admin_email'] or '').strip()
        users = out_of_set_accounts(admin_email)
        code = list_code(users)
        self.stdout.write(f'Comptes actifs hors du jeu de démonstration : {len(users)}')
        for user in users:
            flags = ' (super-utilisateur)' if user.is_superuser else ''
            self.stdout.write(f'      {user.email}{flags}')
        if not admin_email:
            self.stdout.write('ATTENTION : --admin-email absent ; le compte administrateur figure peut-être dans la liste.')
        if not options['appliquer']:
            self.stdout.write(f'Code de cette liste : {code}')
            self.stdout.write('Rien n’a été modifié. Pour désactiver exactement cette liste, sur accord du PO, '
                              'après la sauvegarde C1 : --appliquer --code <code> --sauvegarde <fichier>.')
            return
        self._check_apply(options, admin_email, code)
        if not users:
            self.stdout.write('Aucun compte à désactiver.')
            return
        with transaction.atomic():
            organization = self._journal_organization()
            for user in users:
                user.is_active = False
                user.save(update_fields=['is_active'])
                audit.record(organization_id=organization.id, actor=None, action='account.deactivated', obj=user,
                             payload={'email': user.email, 'decision': 'PO-2026-09-30-12'})
                self.stdout.write(f'Désactivé : {user.email}')
        self.stdout.write(self.style.SUCCESS(f'{len(users)} compte(s) désactivé(s), aucun supprimé.'))

    def _check_apply(self, options, admin_email, code):
        if not admin_email:
            raise CommandError('Refus : --admin-email (ou ADMIN_EMAIL) est exigé pour appliquer.')
        if options['code'] != code:
            raise CommandError('Refus : le code ne correspond pas à la liste actuelle (relancer sans --appliquer).')
        backup = Path(options['sauvegarde'] or '')
        if not options['sauvegarde'] or not backup.is_file() or backup.stat().st_size == 0:
            raise CommandError('Refus : --sauvegarde doit désigner le fichier de la sauvegarde C1 (non vide).')

    def _journal_organization(self):
        organization = Organization.objects.filter(name=KEYIMMO_ORG).first()
        if organization is None:
            raise CommandError(f'Organisation « {KEYIMMO_ORG} » introuvable : journal impossible, rien n’est fait.')
        set_rls_context(organization_id=organization.id)
        return organization

    def _reactivate(self, emails):
        User = get_user_model()
        with transaction.atomic():
            organization = self._journal_organization()
            for email in emails:
                user = User.objects.filter(email__iexact=email.strip()).first()
                if user is None:
                    raise CommandError(f'Compte introuvable : {email} (rien n’est réactivé).')
                if user.is_active:
                    self.stdout.write(f'Déjà actif : {user.email}')
                    continue
                user.is_active = True
                user.save(update_fields=['is_active'])
                audit.record(organization_id=organization.id, actor=None, action='account.reactivated', obj=user,
                             payload={'email': user.email})
                self.stdout.write(f'Réactivé : {user.email}')
