# ADR 0006 — Analyse des dépôts avant stockage

## Statut

**Acceptée par le Product Owner le 29 septembre 2026** (journal des décisions,
PO-2026-09-29-13 : « analyse les dépôts avant stockage »). Appliquée à la pile locale ;
**non appliquée à Render** (aucun déploiement sans accord du PO, voir « Conséquences »).

## Contexte

Le CDC R1 §10 demande d'« analyser les dépôts et ne pas rendre disponible un fichier en attente ou
rejeté » ; T15 attend « rejet ou quarantaine ». La revue assistée
(`docs/recette/REVUE_ASSISTEE_R1.md`) a confirmé le contrôle de format et de taille
(PO-2026-09-29-05), mais aucune analyse : un fichier au format conforme était enregistré et
disponible dès son dépôt.

Deux chemins HTTP mènent au stockage : `POST /api/documents/` (BUILD) et
`POST /api/control/sync/documents/` (app Contrôle, coupé dans le MVP, K04). Les deux aboutissent à
`apps.evidence.services.create_document`.

## Décision

**Analyse synchrone, pendant la requête de dépôt, avant toute écriture** — pas de quarantaine :
un fichier n'est jamais « en attente ». Il est analysé puis accepté, ou refusé sans que rien ne soit
écrit (ni fichier, ni `Document`). Module `apps/evidence/scanning.py`, après le contrôle de format :

1. **Analyse du contenu PDF** (sans dépendance externe). Refus d'un PDF portant du contenu actif :
   `/JavaScript`, `/JS`, `/Launch`, `/EmbeddedFile(s)`, `/RichMedia`, `/XFA`, `/GoToE`. Les noms
   sont cherchés dans les dictionnaires, noms encodés compris (`/J#61vaScript`), et dans les flux
   d'objets compressés. Le contenu binaire des flux (images, pages) n'est pas examiné, pour éviter
   qu'une suite d'octets au hasard ne produise un faux `/JS`. Un **PDF chiffré** est refusé, car
   son contenu ne peut pas être analysé ; le message demande une version non protégée. Un flux
   d'objets illisible, trop volumineux (plus de 16 Mo décompressés) ou à filtre non pris en charge
   est refusé comme non analysable. Les liens `/URI` et l'`/OpenAction` de zoom restent admis.
   Les images sont déjà décodées en entier (`validators.py`) puis ré-encodées (`tasks.py`).
2. **Antivirus ClamAV** : le fichier est transmis au démon `clamd` (commande INSTREAM) à l'adresse
   `KEYA_CLAMD_ADDRESS` (`unix:/chemin` ou `hôte:port`).
3. **Fermeture par défaut** : si le moteur est non configuré, injoignable, en erreur ou renvoie une
   réponse illisible, le dépôt est refusé (**503**, « Analyse des fichiers momentanément
   indisponible… rien n'a été enregistré ») et l'incident est inscrit au journal technique.
   Aucun réglage d'environnement ne désactive l'analyse : `KEYA_UPLOAD_ANTIVIRUS` est fixé dans
   `config/settings.py`. Seul `settings_test.py` le remplace, par un moteur de test qui ne connaît
   que le fichier EICAR.
4. **Trace** : tout refus d'analyse est inscrit au journal d'audit de l'organisation du déposant,
   action `document.upload_rejected`, libellé « Dépôt refusé à l'analyse (fichier non enregistré) ».
   Il enregistre l'acteur, le motif, la signature ou les noms détectés, l'empreinte sha256, la
   taille, le type et la route, **sans rien du contenu**.
5. **Garde du service** : `create_document` analyse lui-même tout fichier qui n'est pas passé par
   un chemin de dépôt HTTP (appel direct).
6. **Contrôle d'exploitation** : `manage.py check_upload_scan` vérifie que le moteur est joignable,
   qu'un fichier sain est accepté et que le fichier EICAR est détecté. Il est exécuté par
   `reset_demo_local.sh`, dans les deux modes.

## Conséquences

- **Temps de dépôt** : l'analyse s'ajoute à chaque dépôt, qui fait au plus 10 Mo. Le délai d'attente
  du moteur est réglable (`KEYA_CLAMD_TIMEOUT_SECONDS`, 30 s par défaut).
- **Pile locale** : `apt install clamav-daemon`, puis `.env`
  `KEYA_CLAMD_ADDRESS=unix:/var/run/clamav/clamd.ctl`. **Signatures** : `freshclam` télécharge la
  base officielle. Dans la session de développement du 29/09, ce téléchargement était bloqué par le
  réseau (403). La pile locale a donc tourné avec le vrai moteur `clamd`, mais avec une base réduite
  à la signature de test EICAR (`/var/lib/clamav/keya-test.ndb`, hors dépôt). Cela prouve la chaîne
  complète (dépôt → moteur → refus → journal), **pas la couverture virale**, qui dépend d'une base
  à jour.
- **Docker** : le `docker-compose.yml` n'a pas encore de service ClamAV. `.env.example` donne la
  commande (`clamav/clamav:stable`, port 3310). Non exécutée dans cette session.
- **Render (hébergement de démonstration)** : **non appliqué**. Sans service `clamd` joignable,
  **tout dépôt y serait refusé** après déploiement. Avant tout déploiement, et sur accord du PO,
  il faudra :
  - choisir un service ClamAV (service privé Render avec l'image officielle, à chiffrer) ;
  - fixer `KEYA_CLAMD_ADDRESS` ;
  - ou, à défaut, faire approuver un dispositif compensatoire (CDC §11).
- Ce que cet ADR ne promet pas : détecter une menace inconnue des signatures, ou un contenu actif
  hors de la liste ci-dessus. Les PDF sont servis en téléchargement (`as_attachment`), jamais rendus
  par l'application.

## Avenant du 30 septembre 2026 — dérogation de la DÉMO (PO-2026-09-30-07)

Dérogation écrite du Product Owner (CDC §11) : sur Render, la démonstration fonctionne **sans moteur
antivirus** ; ClamAV sera branché au Projet 1, avant tout usage réel. Le point 3 ci-dessus (« aucun
réglage d'environnement ne désactive l'analyse ») connaît donc une exception, strictement bornée :

- **Conditions cumulatives** : environnement DÉMO (`KEYA_ENVIRONMENT`, obligatoire et sans valeur par
  défaut, PO-2026-09-30-08), réglage
  explicite `KEYA_DEMO_UPLOADS_WITHOUT_ANTIVIRUS`, **aucun** moteur configuré (`KEYA_CLAMD_ADDRESS`
  vide). Un moteur configuré est toujours utilisé, et son indisponibilité refuse le dépôt.
- **Refus de démarrer** : les réglages lèvent une erreur si ce réglage est posé en PILOTE ou en
  PRODUCTION, ou si `KEYA_ENVIRONMENT` est absent ou inconnu (serveur web et commandes).
- **Ce qui reste fait** : contrôles de format, analyse du contenu PDF (point 1), ré-encodage des images.
  Seule la recherche de signatures virales manque.
- **Trace** : chaque document porte un statut antivirus (`analyse`, `non_analyse`, `infecte`) ; les
  dépôts acceptés sans moteur sont « non analysés » et tracés au journal (« Dépôt accepté sans
  antivirus », empreinte sha256, taille, type). Les documents antérieurs à l'analyse des dépôts sont
  aussi « non analysés » (migration `evidence.0005`).
- **Retour à la règle** : dès le moteur branché, `manage.py rescan_unscanned_documents` repasse chaque
  document « non analysé » (analyse du contenu PDF puis antivirus, sur le fichier stocké — les images
  ont été ré-encodées au dépôt). Sain : « analysé » ; détecté : « détecté », **plus servi** (lien signé
  refusé), conservé pour l'enquête ; chaque résultat est tracé au journal. La commande refuse de tourner
  tant que la dérogation est active, et s'interrompt si le moteur tombe (les documents non traités
  restent « non analysés »). Retirer ensuite le réglage de la dérogation.
- **Limite assumée** : sous la dérogation, un fichier porteur d'une signature virale connue est
  accepté (il ne sera détecté qu'à l'analyse rétroactive). Acceptable pour une démonstration où seuls
  les comptes de démonstration, tenus par KEYIMMO, déposent des fichiers ; **jamais** en PILOTE ou
  en PRODUCTION.
