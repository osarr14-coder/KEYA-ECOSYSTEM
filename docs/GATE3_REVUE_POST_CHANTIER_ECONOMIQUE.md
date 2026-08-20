# Revue Gate 3 — mise à jour post-chantier économique
### État de la checklist après les tickets 022 à B-035

---

## Rappel de la checklist originale (complément V4.0, section 8)

| # | Item | Statut avant ce chantier | Statut maintenant |
|---|---|---|---|
| 1 | Décision modèle économique validée par la direction | 🔴 Ouvert | 🟡 **Conçu et détaillé en interne, jamais validé formellement par une instance externe à cette conversation** |
| 2 | Classement MUST/SHOULD/LATER des angles morts | 🟢 Fait (docs/gate3-classement-angles-morts.md) | 🟢 Inchangé, toujours à jour |
| 3 | Architecture technique validée | 🟢 Fait (ADR 0003) | 🟢 Renforcé — modular monolith a bien tenu sur 15 tickets économiques supplémentaires sans dérive |
| 4 | Design system technique livré | 🟢 Fait | 🟢 Étendu (CountryPackSelector, navigation URL, export CSV, hook offline partagé) |
| 5 | Schéma de données noyau validé, TrustEvent append-only | 🟢 Fait | 🟢 Étendu et éprouvé — même discipline append-only appliquée à Devis, PricingConfig, LegalPaymentTierTemplate, ProgramCost, ControlOfficeRate, LotLedger |
| 6 | Politique RBAC/ABAC et RLS définie | 🟢 Fait | 🟢 Renforcé — plusieurs schémas RLS distincts maintenant éprouvés (standard, bascule explicite type Devis, sans RLS type PricingConfig) |
| 7 | Stratégie offline/sync CONTROL validée | 🟢 Fait | 🟢 Inchangé, plus deux bugs de robustesse supplémentaires corrigés (F-033) |
| 8 | Revue juridique préliminaire Sénégal | 🔴 Ouvert | 🔴 **Toujours ouvert — 6 nouvelles questions accumulées durant ce chantier, jamais envoyées** |
| 9 | Équipe de développement / plan validé | 🟡 Partiel | 🟡 Inchangé — toujours aucun audit de sécurité externe |
| 10 | Invariants intégrés à la doctrine | 🟢 Fait | 🟢 Étendu — 25.14 à 25.18 ajoutés, plus 5 décisions structurantes du grand-livre (B-035) |

---

## Ce qui a changé de fond en comble depuis la dernière revue

Le chantier économique (022 à B-035, plus le travail frontend F-027 à F-033) a transformé un modèle économique théorique en un système technique complet et testé : Devis verrouillés, mise en concurrence à l'aveugle, réconciliation post-appel d'offres, taux de marge configurables et audités, paliers légaux de paiement, répartition des coûts programme, barème sectoriel du bureau de contrôle, et un grand-livre par lot qui agrège tout ça en une marge disponible calculée en direct.

**C'est un accomplissement technique réel.** Mais il faut être honnête sur ce que ça ne change pas :

## Le vrai point de blocage n'a pas bougé

**L'item 1 (modèle économique validé) et l'item 8 (revue juridique) sont toujours à zéro validation externe**, malgré tout le travail de conception fait. Concrètement :

- Le taux de marge canal 1 (~18% dans l'exemple illustratif) n'a été confirmé par personne en dehors de cette conversation — ni par une analyse de marché réelle, ni par un partenaire bancaire, ni par une comparaison avec des marges pratiquées par des promoteurs réels au Sénégal.
- Le mécanisme de désistement symétrique, le contrat de réservation distinct, le régime de copropriété — tous conçus avec rigueur, mais aucun n'a été confronté à un vrai avocat OHADA/UMOA.
- Le risque de requalification en promoteur de fait (question 3 du document complémentaire) est potentiellement le point le plus structurant de tout le modèle — s'il se confirme, ça pourrait remettre en cause l'architecture de marge elle-même, pas juste un détail d'implémentation.

**Le risque concret** : chaque ticket supplémentaire construit sur ce modèle (B-036 et au-delà) est un investissement d'ingénierie sur des hypothèses non confirmées. Ce n'est pas nécessairement du temps perdu — le code est bien structuré et modulaire, donc probablement adaptable si une réponse juridique impose un ajustement — mais c'est un risque qui grandit à mesure qu'on empile les tickets sans validation externe.

## Recommandation concrète pour sortir de cette impasse

1. **Envoyer maintenant** le document `QUESTIONS_COMPLEMENTAIRES_SESSION_MODELE_ECONOMIQUE.md`, fusionné avec les 29 questions déjà rédigées, à l'avocat OHADA/UMOA — c'est l'action la plus urgente et la moins coûteuse pour débloquer la suite.
2. **Solliciter une validation, même informelle, du taux de marge cible** auprès d'au moins un partenaire potentiel (banque, ou un professionnel du secteur immobilier sénégalais) avant d'investir davantage dans le raffinement du modèle.
3. **Ne pas suspendre le développement technique**, mais le réorienter temporairement vers des chantiers qui ne dépendent d'aucune de ces validations — l'audit d'états système en cours (F-033) et les petites dettes techniques restent des investissements sûrs quel que soit le résultat de la revue juridique.

---

*Document de suivi Gate 3, généré à l'issue du chantier économique (tickets 022 à B-035). À revoir une fois les premières réponses juridiques obtenues.*
