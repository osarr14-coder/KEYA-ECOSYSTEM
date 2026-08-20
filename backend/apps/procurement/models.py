import uuid

from django.conf import settings
from django.db import models

from apps.inspections.models import InspectionMission
from apps.organizations.models import Organization
from apps.programs.models import Lot


class Devis(models.Model):
    """Une offre chiffrée d'une organisation constructeur CANDIDATE sur un
    `Lot` mis en concurrence — ticket 022. Création exclusive par
    `admin_keyimmo` (voir `apps/procurement/views.py`), même restriction
    que `InspectionMission` (ticket 012) : aucun endpoint d'écriture pour
    le rôle constructeur — décision de conception validée avant
    implémentation (voir `022-verrouillage-devis-mise-en-concurrence.md`).

    Une ligne `Devis` PAR couple (lot, organisation candidate) — plusieurs
    lignes pour un même lot sont attendues, c'est la mise en concurrence
    elle-même (voir le ticket, section « Note de conception — un seul
    modèle Devis, fusion volontaire avec la notion de candidature »).

    `organization` = organisation du LOT (le programme/sponsor), PAS celle
    du candidat — même convention que `Inspection.organization`/
    `InspectionMission.organization` (tickets 005/012).
    `candidate_organization` = l'organisation constructeur qui a soumis ce
    devis — jamais nécessairement membre de `organization` (pas de règle
    d'indépendance ici, contrairement à l'inspecteur, ticket 005 — hors
    scope de ce ticket).

    Aucun champ statut stocké : le statut (`candidat`/`verrouille`) se
    dérive du dernier `TrustEvent` de ce sujet (voir
    `apps/procurement/services.py::get_devis_status`), doctrine Visible
    Trust appliquée sans exception, comme `InspectionMission`.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    organization = models.ForeignKey(
        Organization, on_delete=models.CASCADE, related_name='devis_received',
    )
    candidate_organization = models.ForeignKey(
        Organization, on_delete=models.PROTECT, related_name='devis_submitted',
    )
    lot = models.ForeignKey(Lot, on_delete=models.PROTECT, related_name='devis_set')
    amount = models.DecimalField(max_digits=14, decimal_places=2)
    # Ticket 023 : marge estimée par l'admin pour CE devis, saisie au même
    # moment que `amount`, jamais dérivée d'un budget externe (aucun champ
    # budget n'existe sur `Lot`) — donnée distincte, jamais noyée dans
    # `amount` (voir 023-reconciliation-devis-ajustement.md, décision 1).
    # Sert de référence de marge disponible pour `DevisAjustement`.
    marge_estimee = models.DecimalField(max_digits=14, decimal_places=2)
    logged_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name='devis_logged',
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'procurement_devis'

    def __str__(self):
        return f'Devis — {self.candidate_organization} → {self.lot}'


class DevisAjustement(models.Model):
    """Ajustement de coût (écart signé) sur le devis VERROUILLÉ d'un lot —
    ticket 023. Enregistrement de fait séparé, jamais une modification de
    `Devis` (`amount`/`marge_estimee` d'origine intouchables — voir le
    ticket, critère d'acceptation dédié, même rigueur que l'append-only
    `TrustEvent`, ticket 003). Un ajustement REFUSÉ (écart au-delà de la
    marge disponible courante) ne crée AUCUNE ligne — même discipline que
    `Devis` lui-même sur un lot déjà verrouillé (ticket 022) : rien n'est
    écrit avant l'exception.

    `ecart` est SIGNÉ : positif = défavorable (surcoût, réduit la marge
    disponible pour le prochain ajustement), négatif = favorable (économie,
    l'augmente). La marge disponible au moment d'un ajustement est
    `devis.marge_estimee` moins la SOMME SIGNÉE de tous les
    `DevisAjustement` déjà acceptés sur ce devis (voir
    `apps/procurement/services.py::available_margin`) — jamais une somme de
    valeurs absolues.

    `organization` dénormalisée depuis `devis.organization` (l'organisation
    du LOT) — même convention que `Devis` lui-même, RLS standard (voir
    migration RLS), pas de branche candidate : aucune lecture candidate de
    ce modèle dans ce ticket (décision de conception, point C).
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    organization = models.ForeignKey(
        Organization, on_delete=models.CASCADE, related_name='devis_ajustements',
    )
    devis = models.ForeignKey(Devis, on_delete=models.PROTECT, related_name='ajustements')
    ecart = models.DecimalField(max_digits=14, decimal_places=2)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name='devis_ajustements_created',
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'procurement_devis_ajustement'

    def __str__(self):
        return f'Ajustement {self.ecart} — {self.devis}'


class LotLedger(models.Model):
    """Grand-livre de coûts par lot (canal 1) — ticket B-035, première
    partie (le grand-livre lui-même, SANS les charges bureau de contrôle,
    voir ticket B-036 à venir).

    Un grand-livre VIVANT, pas un instantané figé (décision utilisateur) :
    la marge disponible se recalcule À LA VOLÉE (voir
    `apps.procurement.services.get_lot_ledger_margin`), jamais stockée.
    Seuls `foncier_alloue`/`be_alloue` sont figés une fois pour toutes, au
    moment de la création de CE grand-livre — un snapshot depuis
    `apps.programs.services.compute_lot_repartition` (ticket B-033), jamais
    recalculé après, même si `ProgramCost` change ensuite (nouvelle
    révision).

    `lot` en `OneToOneField`, pas une simple FK — au plus UN grand-livre par
    lot, garanti par une contrainte `UNIQUE` réelle en base (même principe
    que `ActiveLegalPaymentTierTemplate.country_pack`, ticket B-027) — pas
    seulement une vérification applicative. Voir
    `apps.procurement.services.create_lot_ledger` pour la garantie
    anti-course (même discipline EXPLICITE que `_get_or_create_task`,
    ticket 017 / `_upsert_active_pointer`, ticket B-027) — DIFFÉRENCE
    IMPORTANTE avec ces deux précédents : ici, une course détectée
    (`IntegrityError`) ne bascule JAMAIS vers une mise à jour de la ligne
    existante — `LotLedger` est immuable, la course se conclut par un rejet
    explicite (`LotLedgerAlreadyExistsError`), jamais un `UPDATE`.

    Aucune colonne `sequence` (contrairement à `PricingConfig`/
    `ProgramCost`/`ControlOfficeRate`, entités VERSIONNÉES) : par
    construction, une seule ligne par lot (garantie ci-dessus) — aucune
    ambiguïté de tri à départager, le tie-break `sequence` n'a pas de sens
    ici.

    Précondition de création (voir `create_lot_ledger`) : le `Devis` du lot
    doit déjà être VERROUILLÉ — cohérent avec la logique VEFA, voir le
    ticket. `organization` dénormalisée depuis `lot.organization`, même
    pattern RLS que `Devis`/`ProgramCost`. Immuable après création : RLS
    `SELECT`/`INSERT` scopés organisation, **aucune policy `UPDATE`/
    `DELETE`** (voir migration RLS dédiée) — même niveau que `Devis`/
    `ProgramCost`.

    **Message adressé à B-036** : la formule de marge de ce ticket
    (`get_lot_ledger_margin`) est VOLONTAIREMENT INCOMPLÈTE — elle
    n'inclut PAS encore le terme bureau de contrôle (`LotBcCharge`,
    futur). Voir le TODO explicite dans `get_lot_ledger_margin`.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    organization = models.ForeignKey(
        Organization, on_delete=models.CASCADE, related_name='lot_ledgers',
    )
    lot = models.OneToOneField(Lot, on_delete=models.PROTECT, related_name='ledger')
    prix_client = models.DecimalField(max_digits=16, decimal_places=2)
    foncier_alloue = models.DecimalField(max_digits=16, decimal_places=2)
    be_alloue = models.DecimalField(max_digits=16, decimal_places=2)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name='lot_ledgers_created',
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'procurement_lot_ledger'

    def __str__(self):
        return f'Grand-livre — {self.lot}'


class LotBcCharge(models.Model):
    """Charge bureau de contrôle (BC) — ticket B-036, effet de bord de
    chaque `InspectionMission` (ticket 012) créée sur un lot. S'accumule
    PROGRESSIVEMENT au fil du chantier (contrairement à foncier/BE, figés
    une fois pour toutes par `LotLedger` — B-035, décision utilisateur).

    `lot` en FK DIRECTE, PAS vers `LotLedger` : une charge BC doit
    TOUJOURS pouvoir être enregistrée (indépendance du contrôle — décision
    3 du ticket), y compris pour un lot dont le grand-livre n'existe pas
    ENCORE (`prix_client` est posé manuellement par `admin_keyimmo`, un
    geste distinct du verrouillage du devis construction, B-035). La marge
    (`apps.procurement.services.get_lot_ledger_margin`) reste indéfinie
    tant qu'aucun `LotLedger` n'existe, mais les charges, elles,
    s'accumulent dès la première mission, quel que soit l'état du
    grand-livre.

    `mission` en `OneToOneField` : au plus une charge par mission, garantie
    DB (bien qu'aucune course réelle ne soit attendue ici — chaque charge
    provient d'un seul appel synchrone à la création de la mission). Une
    mission peut simplement n'avoir AUCUNE ligne associée (accessoire
    `mission.bc_charge` lève alors `DoesNotExist`) — voir
    `record_bc_charge_for_mission` : aucune entrée de barème applicable
    (ni fixe pour ce jalon, ni globale disponible), ou entrée globale déjà
    consommée pour ce lot, ou devis du lot pas encore verrouillé au moment
    du mode global — trois cas où aucune ligne n'est créée, jamais une
    erreur.

    `jalon_type` — snapshot du jalon de la mission au moment de la charge,
    `CharField` LIBRE, jamais une FK — même raisonnement que
    `ControlOfficeRate.jalon_type` (B-034) : ce champ ne sert qu'à
    l'audit, jamais à une relecture du taux appliqué (le taux lui-même
    n'est jamais référencé, seul le montant qui en a résulté est figé ici,
    même doctrine append-only que `DevisAjustement`/`ProgramCost`).

    `is_global_reference` distingue une charge issue du mode
    `percentage`/« global » (générée AU PLUS UNE FOIS PAR LOT) d'une
    charge issue d'un tarif `fixed_amount` réel (cumulative, une par
    mission qui y correspond). Sert de trace de consommation du mode
    global pour CE lot — `LotBcCharge.objects.filter(lot=lot,
    is_global_reference=True).exists()`, interrogée plutôt que stockée sur
    un champ séparé de `Lot`/`LotLedger` (choix d'implémentation,
    décision E du ticket) : la trace elle-même EST la preuve de
    consommation, jamais un pointeur mutable supplémentaire.

    Append-only, immuable après création — RLS `SELECT`/`INSERT` scopés
    organisation, aucune policy `UPDATE`/`DELETE` (voir migration RLS
    dédiée), même niveau que `DevisAjustement`/`LotLedger`.

    `sequence` construit DÈS LA CONCEPTION (leçon B-031/B-033/B-034) — une
    vraie collision est peu probable ici (chaque charge provient d'une
    requête HTTP distincte de création de mission, jamais deux écritures
    dans la MÊME transaction comme le flake originel de `PricingConfig`),
    mais la discipline du projet est de ne jamais s'appuyer sur
    `-created_at` seul dès qu'un tri chronologique existe (liste des
    charges d'un lot, `list_bc_charges_for_lot`).
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    organization = models.ForeignKey(
        Organization, on_delete=models.CASCADE, related_name='lot_bc_charges',
    )
    lot = models.ForeignKey(Lot, on_delete=models.PROTECT, related_name='bc_charges')
    mission = models.OneToOneField(InspectionMission, on_delete=models.PROTECT, related_name='bc_charge')
    jalon_type = models.CharField(max_length=50)
    montant = models.DecimalField(max_digits=16, decimal_places=2)
    is_global_reference = models.BooleanField(default=False)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name='lot_bc_charges_created',
    )
    created_at = models.DateTimeField(auto_now_add=True)
    sequence = models.BigIntegerField(unique=True, editable=False)

    class Meta:
        db_table = 'procurement_lot_bc_charge'

    def save(self, *args, **kwargs):
        if self.sequence is None:
            # `nextval()` explicite plutôt que de compter sur le DEFAULT
            # côté DB — même raison que `ProgramCost.save()`/
            # `ControlOfficeRate.save()` : `sequence` n'est pas un
            # `AutoField` (impossible avec la pk UUID de ce modèle), Django
            # envoie donc TOUJOURS une valeur explicite pour ce champ à
            # l'INSERT ; ne pas la poser ici enverrait NULL et écraserait
            # silencieusement le DEFAULT côté DB.
            from django.db import connection

            with connection.cursor() as cursor:
                cursor.execute("SELECT nextval('procurement_lot_bc_charge_sequence_seq')")
                self.sequence = cursor.fetchone()[0]
        super().save(*args, **kwargs)

    def __str__(self):
        return f'Charge BC {self.montant} — {self.lot}'
