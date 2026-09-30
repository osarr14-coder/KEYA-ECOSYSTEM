"""PO-2026-09-30-11 (C7) — données hors instance : présentes en base,
visibles ou non dans les applications.

Après la réinitialisation d'une base qui a déjà servi (Render), il reste des
données antérieures à l'instance active : anciens programmes sans instance
(B-047, chantiers de Dakar, lots A3/A4…), organisations en double, anciens
comptes, archives d'instances. Le filtrage par instance doit les tenir hors
de toute vue.

1. **Inventaire, en lecture seule** : chaque lecture a lieu dans une
   transaction annulée, sous le contexte RLS de chaque organisation.
2. **Avec `--api URL`** : connexion des 7 comptes de démonstration (mot de
   passe lu dans DEMO_PASSWORD, jamais affiché), puis lecture de chaque route
   `GET` sans paramètre de l'API (celles du code local, qui doit être le
   commit déployé), en anonyme et pour chaque compte. Toute réponse qui
   contient un identifiant, un nom de programme, d'organisation ou de compte
   de l'inventaire est un ÉCART ; le journal de l'administrateur ne doit
   montrer aucun événement antérieur à l'instance active. Les connexions sont
   espacées (`--pause`, 13 s) pour rester sous la limite de 5 par minute.

Code de sortie 1 s'il y a un écart visible (API), 0 sinon. L'inventaire seul
ne produit pas d'écart : des données hors instance en base sont attendues,
c'est leur visibilité qui compte. Ne vérifie pas le détail d'un objet par son
identifiant (routes paramétrées), ni l'affichage des écrans : la liste de
contrôle à l'écran de la procédure C7 le complète.
"""
import json
import os
import time
import urllib.error
import urllib.request

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.urls import get_resolver

from apps.audit.models import AuditEvent
from apps.core.demo import active_demo_instance
from apps.core.rls import set_rls_context
from apps.evidence.models import WorkDeclaration
from apps.inspections.models import Reserve
from apps.organizations.models import Organization
from apps.programs.models import Lot, Program
from apps.sales.management.commands.seed_demo_scenario import ACCOUNTS, CONTROL_ORG, KEYIMMO_ORG, PROMOTER_ORG
from apps.sales.models import CustomerReceipt, Disbursement, PaymentCall, Reservation
from apps.tasks.models import Task, TaskStatus

JOURNAL_ROUTE = '/api/admin/journal/'


class _Rollback(Exception):
    pass


def read_routes():
    """Routes `/api/…` sans paramètre, depuis la configuration d'URL locale."""
    found = []

    def walk(patterns, prefix):
        for pattern in patterns:
            raw = str(pattern.pattern).lstrip('^').rstrip('$')
            if hasattr(pattern, 'url_patterns'):
                if not any(char in raw for char in '<(\\'):
                    walk(pattern.url_patterns, prefix + raw)
                continue
            path = prefix + raw
            if path.startswith('api/') and not any(char in path for char in '<(\\['):
                found.append('/' + path)

    walk(get_resolver().url_patterns, '')
    return sorted(set(found))


def demo_emails(admin_email=None):
    emails = {email for email, *_ in ACCOUNTS}
    if admin_email:
        emails.add(admin_email.strip().lower())
    return emails


def demo_organization_names():
    names = {KEYIMMO_ORG, PROMOTER_ORG, CONTROL_ORG}
    names.update(f'Compte personnel — {email}' for email, _n, _r, organization in ACCOUNTS if organization is None)
    return names


def inventory(*, admin_email=None):
    """Données hors de l'instance active. Lecture seule (transaction annulée)."""
    result = {}
    try:
        with transaction.atomic():
            result = _read_inventory(admin_email)
            raise _Rollback
    except _Rollback:
        pass
    return result


def _read_inventory(admin_email):
    instance = active_demo_instance()
    if instance is None:
        raise CommandError('Aucune instance de démonstration active : lancer d’abord la réinitialisation.')
    inv = {
        'instance': instance.code, 'instance_created_at': instance.created_at,
        'programs': [], 'lots': [], 'objects': [], 'tasks': [], 'tasks_without_program': 0,
        'organizations': [], 'users': [], 'journal_before_instance': 0, 'active_program_names': set(),
    }
    known_organizations = demo_organization_names()
    active_programs = set(active_programs_all(instance))
    for organization in Organization.objects.order_by('name'):
        set_rls_context(organization_id=organization.id)
        if organization.name not in known_organizations:
            inv['organizations'].append({'id': str(organization.id), 'name': organization.name})
        for program in Program.objects.filter(organization=organization).select_related('demo_instance'):
            if program.demo_instance_id == instance.id:
                inv['active_program_names'].add(program.name)
                continue
            origin = 'hors instance' if program.demo_instance_id is None else f'archive {program.demo_instance.code}'
            inv['programs'].append({
                'id': str(program.id), 'name': program.name, 'organization': organization.name, 'origin': origin,
            })
        other_lots = Lot.objects.filter(organization=organization).exclude(asset__program_id__in=active_programs)
        for lot in other_lots:
            inv['lots'].append({'id': str(lot.id), 'name': lot.name, 'organization': organization.name})
        reservations = Reservation.objects.filter(lot__in=other_lots)
        related = {
            'réservation': reservations,
            'appel de fonds': PaymentCall.objects.filter(reservation__in=reservations),
            'encaissement': CustomerReceipt.objects.filter(reservation__in=reservations),
            'décaissement': Disbursement.objects.filter(lot__in=other_lots),
            'déclaration de travaux': WorkDeclaration.objects.filter(milestone__lot__in=other_lots),
            'réserve': Reserve.objects.filter(lot__in=other_lots),
        }
        for kind, queryset in related.items():
            inv['objects'].extend({'id': str(pk), 'kind': kind} for pk in queryset.values_list('id', flat=True))
        # Toutes les tâches, traitées comprises : `/api/tasks/` et « À faire »
        # listent aussi les tâches traitées.
        tasks = Task.objects.filter(organization=organization).select_related('assignee')
        inv['tasks_without_program'] += tasks.filter(program__isnull=True).count()
        for task in tasks.filter(program__isnull=False).exclude(program_id__in=active_programs):
            inv['tasks'].append({
                'id': str(task.id), 'label': task.label, 'organization': organization.name,
                'assignee': task.assignee.email, 'pending': task.status == TaskStatus.PENDING,
            })
        inv['journal_before_instance'] += AuditEvent.objects.filter(
            organization=organization, created_at__lt=instance.created_at,
        ).count()
    known_emails = demo_emails(admin_email)
    for user in get_user_model().objects.filter(is_active=True).order_by('email'):
        if user.email.lower() not in known_emails:
            inv['users'].append({'id': str(user.id), 'email': user.email})
    return inv


def active_programs_all(instance):
    """Programmes de l'instance active, toutes organisations (une tâche vit
    dans l'organisation de son sujet, pas forcément celle du programme)."""
    ids = []
    for organization_id in Organization.objects.values_list('id', flat=True):
        set_rls_context(organization_id=organization_id)
        ids.extend(Program.objects.filter(organization_id=organization_id, demo_instance=instance).values_list('id', flat=True))
    return ids


def needles(inv):
    """Chaînes qui ne doivent apparaître dans aucune réponse de l'API."""
    found = {}
    for key in ('programs', 'lots', 'objects', 'tasks', 'organizations', 'users'):
        for item in inv[key]:
            found[item['id']] = f"{key[:-1] if key != 'objects' else item['kind']} {item['id']}"
    for program in inv['programs']:
        # Une archive porte le même nom de programme que l'instance active.
        if program['name'] not in inv['active_program_names']:
            found[program['name']] = f"programme « {program['name']} »"
    for organization in inv['organizations']:
        found[organization['name']] = f"organisation « {organization['name']} »"
    for user in inv['users']:
        found[user['email']] = f"compte {user['email']}"
    return found


class Http:
    """Client HTTP minimal (bibliothèque standard) ; remplacé dans les tests."""

    def __init__(self, base):
        self.base = base.rstrip('/')

    def login(self, email, password):
        status, body = self._request('/api/auth/login/', data={'email': email, 'password': password})
        if status != 200:
            return None, status
        return json.loads(body).get('access'), status

    def get(self, path, token=None):
        return self._request(path, token=token)

    def _request(self, path, token=None, data=None):
        headers = {'Accept': 'application/json'}
        payload = None
        if data is not None:
            payload = json.dumps(data).encode()
            headers['Content-Type'] = 'application/json'
        if token:
            headers['Authorization'] = f'Bearer {token}'
        request = urllib.request.Request(self.base + path, data=payload, headers=headers)
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                return response.status, response.read().decode('utf-8', 'replace')
        except urllib.error.HTTPError as exc:
            return exc.code, ''


class Command(BaseCommand):
    help = 'Inventaire des données hors instance ; avec --api, vérifie qu’aucune n’est visible.'

    def add_arguments(self, parser):
        parser.add_argument('--api', help='URL du serveur à vérifier (ex. https://keya-ecosystem-backend.onrender.com).')
        parser.add_argument('--admin-email', default=os.environ.get('ADMIN_EMAIL', ''),
                            help='Compte administrateur posé par seed_admin (défaut : ADMIN_EMAIL).')
        parser.add_argument('--pause', type=float, default=13.0, help='Secondes entre deux connexions (défaut 13).')

    http_class = Http

    def handle(self, *args, **options):
        inv = inventory(admin_email=options['admin_email'])
        self._print_inventory(inv)
        if not options['api']:
            self.stdout.write('\nVisibilité non vérifiée : relancer avec --api URL (DEMO_PASSWORD requis).')
            return
        password = os.environ.get('DEMO_PASSWORD', '')
        if not password:
            raise CommandError('DEMO_PASSWORD absent : le mot de passe des comptes de démonstration est requis.')
        gaps = self._check_api(self.http_class(options['api']), password, inv, options['pause'])
        if gaps:
            raise CommandError(f'{gaps} écart(s) : des données hors instance sont visibles.')
        self.stdout.write(self.style.SUCCESS('Aucune donnée hors instance visible par l’API.'))

    def _print_inventory(self, inv):
        write = self.stdout.write
        write(f"Instance active : {inv['instance']} (créée le {inv['instance_created_at']:%Y-%m-%d %H:%M} UTC)")
        write('Inventaire (lecture seule) des données hors instance active :')
        write(f"  programmes            : {len(inv['programs'])}")
        self._list([f"{program['name']} — {program['organization']} — {program['origin']}" for program in inv['programs']])
        write(f"  lots                  : {len(inv['lots'])}")
        by_kind = {}
        for item in inv['objects']:
            by_kind[item['kind']] = by_kind.get(item['kind'], 0) + 1
        for kind, count in sorted(by_kind.items()):
            write(f'  {kind:22}: {count}')
        pending = sum(1 for task in inv['tasks'] if task['pending'])
        write(f"  tâches                : {len(inv['tasks'])} dont {pending} en attente (programmes hors instance)")
        self._list([f"{task['label'][:70]} — {task['assignee']}" for task in inv['tasks'] if task['pending']])
        write(f"  tâches sans programme : {inv['tasks_without_program']} (non rattachables à une instance)")
        write(f"  organisations         : {len(inv['organizations'])} (hors organisations du jeu)")
        self._list([organization['name'] for organization in inv['organizations']])
        write(f"  comptes actifs        : {len(inv['users'])} (hors 7 comptes du jeu et administrateur)")
        self._list([user['email'] for user in inv['users']])
        write(f"  journal               : {inv['journal_before_instance']} événement(s) antérieur(s) à l'instance")

    def _list(self, lines, limit=20):
        for line in lines[:limit]:
            self.stdout.write(f'      {line}')
        if len(lines) > limit:
            self.stdout.write(f'      … et {len(lines) - limit} autre(s)')

    def _check_api(self, http, password, inv, pause):
        search = needles(inv)
        routes = read_routes()
        self.stdout.write(f'\nVérification par l’API : {len(routes)} routes de lecture, anonyme + {len(ACCOUNTS)} comptes.')
        gaps = 0
        for index, who in enumerate([None] + [email for email, *_ in ACCOUNTS]):
            token = None
            if who is not None:
                if index > 1 and pause:
                    time.sleep(pause)
                token, status = http.login(who, password)
                if not token:
                    gaps += 1
                    self.stdout.write(f'ÉCART   {who} : connexion refusée ({status})')
                    continue
            readable = 0
            for route in routes:
                status, body = http.get(route, token)
                if status != 200:
                    continue
                readable += 1
                hits = sorted({label for needle, label in search.items() if needle in body})
                if route == JOURNAL_ROUTE:
                    hits += self._journal_hits(body, inv['instance_created_at'])
                if hits:
                    gaps += 1
                    shown = ', '.join(hits[:5]) + (f' (+{len(hits) - 5})' if len(hits) > 5 else '')
                    self.stdout.write(f"ÉCART   {who or 'anonyme'} {route} : {shown}")
            self.stdout.write(f"OK      {who or 'anonyme'} : {readable} route(s) lisible(s) contrôlée(s)")
        return gaps

    @staticmethod
    def _journal_hits(body, instance_created_at):
        from django.utils.dateparse import parse_datetime

        try:
            events = json.loads(body)
        except ValueError:
            return []
        earlier = [
            event for event in events
            if isinstance(event, dict) and event.get('created_at')
            and parse_datetime(event['created_at']) < instance_created_at
        ]
        return [f'{len(earlier)} événement(s) du journal antérieur(s) à l’instance'] if earlier else []
