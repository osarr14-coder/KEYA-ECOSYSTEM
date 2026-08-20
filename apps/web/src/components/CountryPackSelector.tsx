import { type FormEvent, useState } from 'react';

import { AlertBanner } from '@keya/design-system';

/**
 * Sélecteur temporaire de `CountryPack` par saisie manuelle d'UUID — aucun
 * endpoint ne liste les `CountryPack` aujourd'hui (`apps/organizations/
 * urls.py` n'existe pas), trou découvert au ticket F-028 et transmis comme
 * prérequis à la session backend (recherche filtrée, même modèle que
 * B-028/ticket 011 — un seul `CountryPack` existe aujourd'hui, mais la
 * doctrine interdit de le coder en dur, CLAUDE.md section « Doctrine
 * produit »). Explicitement temporaire, jamais présenté comme une solution
 * définitive.
 *
 * Extrait de `PricingView.tsx` (ticket F-028) au ticket F-030, une fois
 * `LegalPaymentTiersView.tsx` devenu un second consommateur du même besoin
 * — même discipline anti-duplication qu'ailleurs dans ce projet.
 */
export function CountryPackSelector({
  onLoad, submitLabel,
}: { onLoad: (countryPackId: string) => void; submitLabel: string }) {
  const [countryPackId, setCountryPackId] = useState('');

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    onLoad(countryPackId.trim());
  }

  return (
    <section aria-label="Sélectionner un pays" style={{ marginBottom: '16px' }}>
      <AlertBanner title="Aucun sélecteur de pays disponible">
        Aucun endpoint ne permet aujourd&apos;hui de rechercher un Country Pack — dépendance
        transmise à la session backend (même modèle que la recherche Lot/Organisation, ticket
        B-028). Saisissez l&apos;identifiant UUID directement.
      </AlertBanner>
      <form
        onSubmit={handleSubmit}
        style={{ display: 'flex', gap: '8px', alignItems: 'flex-end', marginTop: '12px' }}
      >
        <label>
          Pays (Country Pack UUID)
          <input
            type="text"
            aria-label="Pays (Country Pack UUID)"
            value={countryPackId}
            onChange={(event) => setCountryPackId(event.target.value)}
            style={{ display: 'block', marginTop: '4px', width: '360px' }}
          />
        </label>
        <button type="submit" disabled={!countryPackId.trim()}>
          {submitLabel}
        </button>
      </form>
    </section>
  );
}
