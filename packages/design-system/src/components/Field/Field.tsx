import { cloneElement, type ReactElement } from 'react';

/**
 * Ticket F-051 — audit UX : chaque formulaire de ce projet (Devis, Pricing,
 * Programmes, Paliers légaux) réécrivait le même schéma `<label>{texte}
 * <Input aria-label={MÊME texte} .../></label>` — pas une duplication de
 * TOKENS (les valeurs de style sont déjà correctes, voir tokens/spacing.ts),
 * une duplication de STRUCTURE. Deux effets de bord réels de cette
 * répétition, tous deux corrigés ici :
 * - le libellé visible et `aria-label` divergent silencieusement si l'un
 *   des deux est édité sans l'autre (aucun garde-fou existant) — `Field`
 *   dérive `aria-label` du MÊME texte que le libellé visible, une seule
 *   source.
 * - `style={{ marginTop: '4px', width: 'Npx' }}` recopié sur chaque champ
 *   — centralisé ici (`gap` sur le conteneur flex, largeur sur le
 *   conteneur, jamais sur l'enfant qui s'étire par défaut, comportement
 *   flexbox standard `align-items: stretch`).
 *
 * Migration délibérément SÉQUENCÉE, pas d'un seul coup — même précédent
 * que F-038 (« migration séquencée du reste du projet, ordre suggéré,
 * jamais imposée en un seul ticket ») : seul `PricingView.tsx` migré ici en
 * preuve, les autres formulaires restent inchangés pour l'instant (voir
 * F-051-audit-ux-modernisation.md).
 */
export interface FieldProps {
  label: string;
  width?: string;
  children: ReactElement<{ 'aria-label'?: string }>;
}

export function Field({ label, width, children }: FieldProps) {
  return (
    <label style={{
      display: 'inline-flex', flexDirection: 'column', gap: '4px', width,
    }}
    >
      {label}
      {cloneElement(children, { 'aria-label': label })}
    </label>
  );
}
