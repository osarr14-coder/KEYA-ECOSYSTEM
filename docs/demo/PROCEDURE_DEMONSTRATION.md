# Procédure de démonstration — une fenêtre par rôle

> Décisions PO-2026-09-28-45 et PO-2026-09-28-54 (A5). La limite de connexion est
> conservée (CDC §10 : 5 tentatives par minute et par poste) ; la démonstration se
> prépare avant la présentation, pour ne jamais se reconnecter devant l'auditoire.

## 1. Avant la présentation (10 minutes)

1. **Base neuve** : réinitialiser la démonstration selon
   `docs/exploitation/PROCEDURE_REINITIALISATION_DEMO.md` (sauvegarde préalable),
   puis vérifier « Base conforme au jeu initial DEMO-CI-v2 ».
2. **Un profil de navigateur par rôle.** Le gestionnaire, Finance et
   l'administrateur utilisent la même application (back-office) ; les deux clients
   aussi (espace client). Une application garde **une seule session par profil
   de navigateur** : deux onglets du même profil se déconnectent l'un l'autre.
   Créer donc un profil (ou un navigateur) distinct par rôle, nommé d'après lui.
3. **Ouvrir les fenêtres à 15 s d'intervalle**, chacune sur la page de connexion
   `…/connexion` du back-office, dans cet ordre :

   | Ordre | Profil | Compte | Arrive sur |
   |---|---|---|---|
   | 1 | Gestionnaire | `adv.demo@keya.test` | Back-office, « À faire » |
   | 2 | Finance | `finance.demo@keya.test` | Back-office, « À faire » |
   | 3 | Cliente (Awa) | `client1.demo@keya.test` | Espace client, « Mon acquisition » |
   | 4 | Constructeur | `constructeur.demo@keya.test` | BUILD, « À traiter » |
   | 5 | Contrôleur | `inspecteur.demo@keya.test` | App Contrôle, « Mes missions » |
   | 6 | Client (Yao), facultatif | `client2.demo@keya.test` | Espace client |

   15 s entre deux connexions gardent le poste sous la limite de 5 par minute.
   Six connexions prennent donc environ une minute et demie.
4. **Disposer les fenêtres** (écran partagé ou bureaux virtuels) et vérifier dans
   chacune le bandeau « DÉMONSTRATION — DONNÉES FICTIVES » et la cloche « Tâches —
   0 en attente » (l'app Contrôle n'a pas de cloche : sa liste « Mes missions »
   en tient lieu).
5. **Une session dure une heure** après la connexion (jeton d'accès d'1 h ; les
   applications ne le renouvellent pas encore automatiquement) : se connecter
   **moins de 30 minutes avant** le début d'une présentation de 15 minutes, et ne
   pas se déconnecter. Passé une heure, l'application renvoie à l'écran de
   connexion : reprendre l'étape 3 pour la fenêtre concernée.

## 2. Pendant la présentation

- **Passer d'un rôle à l'autre = changer de fenêtre**, jamais se reconnecter.
  Chaque fenêtre se met à jour au retour sur elle (et toutes les 15 s) :
  inutile de recharger la page (PO-2026-09-28-51).
- Chaque rôle trouve son action dans « À faire » (cloche) : l'entrée ouvre l'écran
  où agir et disparaît une fois l'action faite (PO-2026-09-28-44).
- Montrer au passage les marqueurs « SIMULÉ » : paiements, signature, décaissement.

## 3. En cas d'incident

| Situation | Ce qui s'affiche | Que faire |
|---|---|---|
| Trop de connexions en une minute | « Trop de tentatives de connexion depuis ce poste. Réessayez dans N s. », décompte, bouton « Se connecter (dans N s) » | Attendre la fin du décompte (« Vous pouvez réessayer maintenant. »), puis se connecter ; au besoin, dire que la limite protège les comptes (CDC §10). |
| Une fenêtre semble en retard | Ancien état affiché | Cliquer dans la fenêtre (retour sur la fenêtre = mise à jour immédiate). |
| Deux rôles dans le même profil | L'un se retrouve déconnecté | Utiliser le profil dédié au rôle (étape 1.2). |
| Serveur endormi (hébergement gratuit) | « Serveur injoignable… » ou attente longue | Réveiller le serveur avant la présentation en ouvrant une page 1 à 2 minutes plus tôt. |

## 4. Après la présentation

Réinitialiser la base pour la présentation suivante (étape 1.1). Ne jamais
réutiliser une base déjà « jouée » devant un nouvel auditoire.
