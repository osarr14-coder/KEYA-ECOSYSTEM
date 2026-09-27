# B-047 — Durcissement sécurité suite à la revue indépendante de B-046

## Contexte

Revue sécurité indépendante du commit `edfbc5e` (B-046), demandée par l'utilisateur
(« Lance l'agent relecteur sur B-046 »). Neuf constats, dont quatre graves et confirmés
par reproduction. Le constat principal (throttle contournable via `X-Forwarded-For`) a
été revérifié dans le source DRF installé (`rest_framework/throttling.py:40` : sans
`NUM_PROXIES`, l'en-tête ENTIER fourni par le client sert d'identifiant).

Décision utilisateur sur le constat 5 : « l'ADV est dans l'équipe de KEYIMMO » — la
portée transverse (toutes organisations) de `gestionnaire_adv` est donc VOULUE et
conservée. Seuls deux pouvoirs lui sont retirés (voir Scope, volet 3).

## Scope

### 1. Connexion et inscription

- **`NUM_PROXIES`** (`config/settings.py`, variable d'environnement, défaut `1` = le
  proxy Render) : DRF prend alors la DERNIÈRE adresse de `X-Forwarded-For`, celle ajoutée
  par le proxy, jamais une valeur choisie par le client.
- **Throttle sur `/api/auth/register/`** (scope `register`, 20/heure par IP) : l'endpoint
  révèle l'existence d'un compte (« Un compte existe déjà avec cet email. ») et
  permettait d'énumérer les emails sans limite.
- **Cache partagé en base** (`DatabaseCache`, table `keya_cache`) : le cache mémoire
  local par défaut rendait le compteur propre à chaque processus gunicorn et le remettait
  à zéro à chaque mise en veille de l'instance Render free. `createcachetable` ajouté au
  `buildCommand` de `render.yaml`.

### 2. Upload de documents

- **Plafond de pixels**, vérifié sur l'en-tête avant tout décodage : 50 Mpx pour JPEG,
  25 Mpx pour PNG. Un PNG de 17 Ko annonçant 144 Mpx passait la validation et faisait
  monter le traitement de miniature à 1,2 Go (instance Render free : 512 Mo).
- **Décodage réel complet** des images dans le validateur (`load()`, plus seulement
  `verify()`, qui ne vérifie rien pour un JPEG) : un flux interrompu est rejeté. JPEG
  décodé en mode réduit (`draft`), sans allouer la pleine résolution. Même `draft` ajouté
  au traitement de miniature (`tasks.py`).
  **Limite constatée en écrivant les tests** : libjpeg décode n'importe quel flux
  compressé assez long (comme du bruit) — un en-tête JPEG valide suivi d'octets
  arbitraires reste accepté, aucune validation ne peut l'empêcher. La garantie réelle est
  le ré-encodage systématique des images détectées : le fichier stocké ne contient plus
  les octets envoyés (prouvé par test).
- **Toute exception Pillow → 400**, jamais 500 (`SyntaxError` sur CRC invalide,
  `DecompressionBombError`, etc. n'étaient pas interceptées).
- **Extension stockée = type détecté** (`.pdf`/`.jpg`/`.png`), jamais celle du nom
  fourni : un fichier `facture.bat` commençant par `%PDF-` était stocké et téléchargé en
  `.bat`.
- **Traitement média déclenché par le type détecté**, plus par le `Content-Type` déclaré :
  une photo déclarée `application/pdf` échappait au ré-encodage (métadonnées EXIF/GPS
  conservées).
- **JPEG « MPO »** (photos multi-images de smartphones récents) acceptés comme JPEG.
- **Limite de taille appliquée pendant la réception** (`MaxSizeUploadHandler`, premier
  gestionnaire de `FILE_UPLOAD_HANDLERS`) : au-delà de 10 Mo, le reste du fichier est lu
  et jeté, jamais écrit sur disque ; la réponse reste un 400 explicite.

### 3. Rôle `gestionnaire_adv`

- **Suppression** de programme/bien/lot réservée à `admin_keyimmo` (une suppression de
  programme emporte les affectations client des lots en cascade).
- **Prix de vente** (`sale_price`) réservé à `admin_keyimmo` : c'est du pricing, que B-046
  avait explicitement laissé à l'admin. Le **statut commercial** reste ouvert à l'ADV
  (suivi des ventes, cœur du métier ADV).

### 4. Tests

Refus de l'ADV sur coûts programme, pricing, back-office, procurement, suppression et
prix ; contournement `X-Forwarded-For` ; throttle d'inscription ; chaque cas d'upload
ci-dessus. Commentaire obsolète de `settings_test.py` corrigé.

## Hors scope

- **Réponse neutre de l'inscription** : sans vérification d'email (aucune infrastructure
  d'envoi dans ce projet), l'existence d'un compte reste déductible (une inscription qui
  réussit prouve que l'email était libre). Le throttle est la mitigation réelle.
- **Validation structurelle profonde des PDF** (nouvelle dépendance) : le risque d'un
  contenu arbitraire derrière `%PDF-` est neutralisé par l'extension forcée à `.pdf` et
  le téléchargement déjà forcé en pièce jointe (`as_attachment=True`, `nosniff`).
- **Données ajoutées après la fin d'une image** (image valide suivie d'octets
  arbitraires) : acceptées par le validateur (vérifié). Neutralisé en aval : toute image
  détectée est ré-encodée par le traitement média, qui ne conserve que les pixels.
- **Message d'une image de plus de ~179 Mpx** : Pillow refuse même d'en lire l'en-tête,
  le rejet (400) indique alors « format non supporté » plutôt que « image trop grande ».
- **Risque résiduel PWA CONTROL** (retry infini sur un 400) — déjà noté dans B-046.
- `assign_organization` n'exige qu'`IsAuthenticated` (signalé par la revue, antérieur à
  B-046, limité à l'organisation active) — à examiner séparément.

## À confirmer au déploiement

`NUM_PROXIES = 1` suppose un seul proxy devant gunicorn. À vérifier sur Render en
journalisant `X-Forwarded-For` d'une vraie requête : si l'en-tête contient plusieurs
adresses ajoutées par l'infrastructure, ajuster la variable d'environnement
`NUM_PROXIES`, sinon tous les utilisateurs pourraient partager un même compteur.

## Critères d'acceptation

- Changer `X-Forwarded-For` à chaque tentative ne contourne plus le throttle de connexion.
- L'inscription est limitée par IP.
- Un PNG annonçant plus de 25 Mpx, un PNG au CRC invalide, un JPEG tronqué : 400, jamais
  500, rien d'écrit.
- Des octets arbitraires placés derrière un en-tête JPEG ne se retrouvent jamais dans le
  fichier stocké.
- Un fichier `.bat` au contenu `%PDF-` est stocké avec l'extension `.pdf`.
- Une image PNG déclarée `application/pdf` est ré-encodée (miniature générée).
- Une photo MPO est acceptée.
- Un envoi de plus de 10 Mo reçoit un 400 explicite.
- L'ADV reçoit 403 sur suppression, prix de vente, coûts, pricing, back-office,
  procurement ; conserve création, modification (hors prix), statut commercial et
  décision des demandes.
- Suite backend complète verte.
