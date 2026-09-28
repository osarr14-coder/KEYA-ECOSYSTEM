"""Logique métier au-delà du simple CRUD de `apps/trust/repository.py`."""

# PO-2026-09-28-14 (CDC §1) : l'ancienne conversion d'un TrustLevel en
# « fraction de progression » (LEVEL_PROGRESS_FRACTION, tickets 008/009) est
# retirée. Aucun pourcentage ni score n'est dérivé des niveaux de confiance ;
# l'avancement se lit « n / N jalons acceptés techniquement »
# (`apps.inspections.services.accepted_milestone_counts`).
