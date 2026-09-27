# B-046 — Phase 1 de l'audit CDC V3 : rôle ADV distinct + sécurité upload/connexion

## Contexte

Suite de `docs/audit-cdc-v3-mvp-ecart-vefa.md` (Phase 1 du plan proposé), demande
explicite utilisateur : « Démarre la Phase 1 ». Trois sujets indépendants, chacun
corrige un écart précis identifié dans l'audit :

1. Séparation des pouvoirs — `admin_keyimmo` cumule aujourd'hui la création de
   programme et la décision sur les demandes de programme sur mesure, alors que le CDC
   V3 (§4) exige des comptes distincts pour des fonctions incompatibles.
2. Aucune validation de type/taille à l'upload de document (`apps/evidence/models.py`)
   — confirmé absent en code, écart de sécurité réel indépendant du reste du CDC.
3. Aucun throttling sur `/api/auth/login/` — confirmé absent dans
   `config/settings.py`, même nature d'écart.

## Ajustement de séquencement (par rapport au plan initial)

Le plan proposait aussi un rôle `finance` distinct. **Reporté à la Phase 3** (finance
simulée) : sans `PaymentCall`/`Disbursement` (pas encore construits), il n'y a
littéralement rien à protéger avec ce rôle aujourd'hui — le créer maintenant
produirait une classe de permission qui ne gate rien, code mort le temps de deux
phases. Le rôle `gestionnaire_adv`, lui, a un objet réel à protéger dès maintenant
(création de programme, décision sur les demandes) — décision prise en cours
d'implémentation, pas anticipée dans le document d'audit initial.

## Scope

- **`backend/apps/organizations/management/commands/seed_admin.py`** — ajoute
  `('gestionnaire_adv', 'Gestionnaire ADV')` à `ROLES` (idempotent, même mécanisme que
  les 5 rôles existants).
- **`backend/apps/backoffice/permissions.py`** — nouvelle permission
  `IsAdminKeyimmoOrGestionnaireADV` : vérifie le rôle dans N'IMPORTE LAQUELLE des
  organisations de l'appelant (même sémantique que `IsAdminKeyimmo`, jamais
  l'organisation active — une capacité ADV transverse, pas liée à un lieu). **Additive,
  jamais une restriction** : `admin_keyimmo` garde tous ses pouvoirs actuels, cette
  permission ouvre juste un second chemin d'accès pour un compte `gestionnaire_adv` qui
  n'a pas besoin d'être aussi `admin_keyimmo`.
- **`backend/apps/programs/views.py`** — `IsAdminKeyimmoOrGestionnaireADV` remplace
  `IsAdminKeyimmo` uniquement sur les actions qui correspondent à « préparer le
  scénario métier » au sens du CDC (§4) : création/modification/suppression de
  `Program`/`Asset`/`Lot` (`ProgramViewSet`/`AssetViewSet`/`LotViewSet`), listing et
  décision des `ProgramRequest` (`ProgramRequestListCreateView`/
  `ProgramRequestDecisionView`). Les endpoints de coût programme (`ProgramCost*`,
  foncier/BE — donnée financière interne sensible) et tout ce qui touche
  pricing/devis/back-office utilisateurs restent `admin_keyimmo` strict — hors du
  périmètre « ADV » décrit par le CDC, pas touchés ici.
- **`backend/apps/evidence/`** — validateur de fichier sur `DocumentUploadSerializer.
  file` : type autorisé (PDF/JPEG/PNG, vérifié par CONTENU — magic bytes `%PDF-` pour
  PDF, décodage Pillow pour les images, jamais seulement le `Content-Type` déclaré par
  le client, spoofable), taille maximale 10 Mo. Reprend telle quelle l'exigence CDC
  §10.
- **`backend/apps/accounts/`** — `ThrottledLoginView` (sous-classe de
  `TokenObtainPairView`, `ScopedRateThrottle`, scope `login`, même route/nom
  `login` — aucun changement de contrat pour les appelants). Taux choisi : 5/minute,
  par IP (comportement standard `ScopedRateThrottle` pour un endpoint anonyme).
- **`backend/config/settings.py`** — `DEFAULT_THROTTLE_RATES = {'login': '5/min'}`.
- **`backend/config/settings_test.py`** — désactive ce throttle pour la suite de
  tests (`'login': None`) : la suite complète appelle `login` des centaines de fois
  (quasi chaque test qui a besoin d'un client authentifié), le seuil de production
  serait atteint en quelques dizaines de tests et ferait échouer toute la suite avec
  des 429 sans rapport avec le code testé — même piège que
  `SECURE_SSL_REDIRECT`/`CELERY_TASK_ALWAYS_EAGER` déjà documentés dans ce fichier.
  Testé explicitement en réactivant un taux strict dans un test dédié, avec
  `cache.clear()` pour repartir d'un quota propre.

## Constat en cours d'implémentation — `override_settings` inopérant pour le throttle

Le plan initial prévoyait de réactiver le taux via `override_settings(REST_FRAMEWORK=…)`.
Reproduit réellement : la 6e tentative passait quand même en 200. Cause (lue dans le
source DRF installé) : `SimpleRateThrottle.THROTTLE_RATES = api_settings.
DEFAULT_THROTTLE_RATES` est un attribut de CLASSE évalué une seule fois à l'import de
`rest_framework.throttling` — un `override_settings` ultérieur ne l'atteint jamais. Le
test patche donc directement `ScopedRateThrottle.THROTTLE_RATES` (restauré en
`teardown_method`). Sans incidence en production : `settings.py` est chargé avant tout
import de ce module, le taux `5/min` y est bien celui figé.

Conséquence pratique à connaître : modifier `DEFAULT_THROTTLE_RATES` exige un
redémarrage du processus pour prendre effet.

## Validation d'upload — point d'application

Le validateur est posé sur `DocumentUploadSerializer.file` et NON sur `Document.file`
(modèle) : `services.create_document` passe par `Document.objects.create(...)`, qui
n'appelle jamais `full_clean()` — un validateur de champ modèle n'y serait jamais
exécuté et donnerait une fausse impression de protection.

Recherche de TOUS les appelants de `create_document` : un second chemin existait,
`apps/control/serializers.py::SyncDocumentSerializer` (synchronisation hors ligne de la
PWA CONTROL), sans aucun validateur — contournement direct du critère « rejeté avant
toute écriture ». Même validateur ajouté, avec son test dédié
(`apps/control/tests.py::TestSyncMediaQueue::test_a_file_that_is_not_really_an_image_is_rejected_before_any_write`).
Les autres appels à `create_document` (`apps/build/tests.py`, `apps/home/tests.py`)
sont des fixtures de test appelant le service directement, pas des chemins HTTP.

## Risque résiduel connu — PWA CONTROL

La PWA ré-encode chaque photo en JPEG via canvas avant envoi
(`apps/control-pwa/src/media/compressImage.ts`) : le chemin nominal passe toujours la
validation. Mais `compressImage` retombe silencieusement sur le fichier d'origine si le
navigateur ne sait pas le décoder (ex. HEIC hors Safari) ; ce fichier serait désormais
rejeté (400), et `syncEngine.ts` réessaie tout échec photo indéfiniment (backoff
plafonné à 60 s), sans distinguer un 400 définitif d'une panne réseau. Pas corrigé ici
(moteur de synchro frontend, hors périmètre de cette phase) — à traiter dans un ticket
F dédié : marquer un 400 comme échec définitif visible à l'inspecteur.

## Hors scope

- Rôle `finance` — reporté à la Phase 3 (voir Ajustement de séquencement ci-dessus).
- Aucune interface frontend pour attribuer le rôle `gestionnaire_adv` — comme
  `constructeur`/`inspecteur` aujourd'hui, l'attribution se fait par bascule directe en
  base (aucun flux d'invitation n'existe encore dans ce projet, ticket 001 hors scope).
- Aucun scan antivirus des fichiers déposés (CDC §10 : « analyser les dépôts ») — la
  vérification de contenu (magic bytes / décodage Pillow) est un contrôle de format,
  pas un scan de sécurité ; hors périmètre de cette phase.
- Aucune révocation de session (blacklist de refresh token) — écart identifié dans
  l'audit mais non demandé explicitement dans cette Phase 1, traité si redemandé.

## Critères d'acceptation

- Un compte `gestionnaire_adv` (sans `admin_keyimmo`) peut créer un programme/bien/lot
  et décider d'une demande de programme sur mesure.
- Un compte `admin_keyimmo` conserve exactement les mêmes pouvoirs qu'avant ce ticket
  (non-régression explicite).
- Un membre ordinaire (aucun des deux rôles) reçoit toujours 403 sur ces endpoints.
- Un upload de fichier hors PDF/JPEG/PNG, ou dont le contenu ne correspond pas au type
  déclaré, ou dépassant 10 Mo, est rejeté avant toute écriture.
- Après 5 tentatives de connexion en une minute depuis la même IP, la 6e reçoit 429.
- Suite backend verte, y compris un test dédié qui prouve le throttle (désactivé pour
  le reste de la suite) et un test qui prouve qu'`admin_keyimmo` n'a subi aucune
  régression de pouvoir.
