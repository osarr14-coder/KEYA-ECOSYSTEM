# F-079 — Page d'accueil publique KEYA

Inspirée de la vitrine `keya-frontend` (dépôt KEYA, `frontend/src/pages/public/Landing.jsx`),
adaptée au modèle d'ECOSYSTEM (programmes et lots, paiements par paliers) et alimentée par les
vraies données de la plateforme (B-057). Recommandations retenues avec l'utilisateur : page
centrée sur les programmes, **aucun faux témoignage**.

## Livré (apps/web, sans session)

- `/` — **page d'accueil** : bandeau « Démonstration — données fictives » ; en-tête (« Achetez
  votre logement en toute confiance », voir les programmes / simuler) avec les trois garanties ;
  **programmes** (disponibles d'abord, « Complet » sinon, lots avec surface et prix, « Réserver —
  créer mon espace ») ; **comment ça marche** (3 étapes) ; **garanties** (compte du programme,
  contrôle indépendant, aucun paiement sans preuve) ; **chantiers suivis** jalon par jalon ;
  **simulateur** de paiement (programme, lot ou prix libre → frais, complément à la signature,
  paliers après acceptation technique — même règle que le serveur) ; **FAQ** ; appel final.
- `/connexion` — l'écran de connexion existant, avec « Créer mon espace acquéreur ».
- `/inscription` — **création d'un espace acquéreur** (rôle client, libre-service existant),
  connexion immédiate et redirection vers HOME, où il réserve son lot.
- Navigation `pushState` (retour navigateur), sans routeur ajouté. Déconnexions (volontaire ou
  forcée, 4 apps) redirigées vers `/connexion` au lieu de l'accueil.

## Hors périmètre (suite possible)

Photos réelles des programmes, cartes Abidjan/Dakar du dépôt KEYA, demande de rappel/WhatsApp.

## Tests

- web 281 (dont page publique : sections et données, programme complet, ordre, navigation et
  retour navigateur, inscription réussie et refusée ; `paymentBreakdown` : règle des paliers,
  solde exact) ; design system 197 ; home 115 ; build 98.
- CONTROL : `InspectionFormView.test.tsx` échoue de façon intermittente (≈ 1 fois sur 6, fichier
  seul) : le brouillon en conflit écrit par le test n'est pas relu (IndexedDB de test), le
  formulaire démarre vide. Fichier non touché par ce ticket ; à corriger séparément.
- Captures vérifiées : accueil (bureau et mobile), inscription.
