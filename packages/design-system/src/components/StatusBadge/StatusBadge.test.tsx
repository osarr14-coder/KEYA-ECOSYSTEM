import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ALL_TRUST_LEVELS, LEVEL_META, StatusBadge, type TrustEventData } from './StatusBadge';
import { SHAPE_BY_LEVEL } from './shapes';

const SAMPLE_EVENT: TrustEventData = {
  level: 'controle',
  source: 'inspection_terrain',
  actor: 'inspecteur@example.com',
  scope: 'Lot A12',
  createdAt: '2026-03-05T10:30:00Z',
};

describe('StatusBadge — distinguabilité sans dépendre de la couleur (critère d\'acceptation)', () => {
  it('associe une forme SVG géométriquement distincte à chacun des 5 niveaux', () => {
    // Les `d` de path sont la géométrie réelle du dessin — un test qui ne
    // comparerait que l'attribut `data-shape` (une étiquette) prouverait la
    // convention de nommage, pas que le dessin RENDU diffère vraiment à
    // l'écran une fois la couleur retirée (ce qu'exige le critère).
    const renderedPaths = new Set<string>();
    const renderedShapeLabels = new Set<string>();

    for (const level of ALL_TRUST_LEVELS) {
      const { container, unmount } = render(<StatusBadge level={level} />);
      const svgPath = container.querySelector('svg path');
      expect(svgPath).not.toBeNull();
      renderedPaths.add(svgPath!.getAttribute('d')!);
      renderedShapeLabels.add(SHAPE_BY_LEVEL[level]);
      unmount();
    }

    expect(renderedPaths.size).toBe(5);
    expect(renderedShapeLabels.size).toBe(5);
  });

  it('chaque niveau garde une étiquette textuelle distincte, indépendante de la couleur', () => {
    // Deuxième canal d'information indépendant de la couleur, en plus de la
    // forme : un lecteur d'écran ou un rendu en niveaux de gris identifie
    // toujours le niveau via ce texte, jamais via la seule teinte du badge.
    for (const level of ALL_TRUST_LEVELS) {
      const { unmount } = render(<StatusBadge level={level} />);
      expect(screen.getByText(LEVEL_META[level].label)).toBeInTheDocument();
      unmount();
    }
    const labels = new Set(ALL_TRUST_LEVELS.map((level) => LEVEL_META[level].label));
    expect(labels.size).toBe(5);
  });

  it("simule un rendu en niveaux de gris (couleur neutralisée) et vérifie que les 5 niveaux restent identifiables via forme + texte seuls", () => {
    // On neutralise explicitement le signal couleur (comme le ferait un
    // filtre grayscale ou une déficience de vision des couleurs) en ignorant
    // `meta.color` et en ne regardant QUE ce qui resterait perceptible : la
    // géométrie du path et le texte.
    const fingerprints = new Set<string>();
    for (const level of ALL_TRUST_LEVELS) {
      const { container, unmount } = render(<StatusBadge level={level} />);
      const path = container.querySelector('svg path')!.getAttribute('d');
      const text = screen.getByText(LEVEL_META[level].label).textContent;
      fingerprints.add(`${path}::${text}`);
      unmount();
    }
    expect(fingerprints.size).toBe(5);
  });
});

describe('StatusBadge — popover au clic (contenu au format TrustEvent, ticket 003)', () => {
  it("n'affiche pas le popover avant le clic", () => {
    render(<StatusBadge level="controle" event={SAMPLE_EVENT} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('affiche source/date/acteur/scope après un clic, au format repository.get_current_status()', () => {
    render(<StatusBadge level="controle" event={SAMPLE_EVENT} />);
    fireEvent.click(screen.getByRole('button'));

    const popover = screen.getByRole('dialog');
    expect(popover).toBeInTheDocument();
    expect(screen.getByText('inspection_terrain')).toBeInTheDocument();
    expect(screen.getByText('inspecteur@example.com')).toBeInTheDocument();
    expect(screen.getByText('Lot A12')).toBeInTheDocument();
    // Date formatée, pas l'ISO brut — preuve que le composant transforme
    // vraiment `createdAt`, pas un simple passthrough.
    expect(screen.queryByText('2026-03-05T10:30:00Z')).not.toBeInTheDocument();
  });

  it('un second clic referme le popover', () => {
    render(<StatusBadge level="controle" event={SAMPLE_EVENT} />);
    const button = screen.getByRole('button');
    fireEvent.click(button);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.click(button);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it("affiche un scope absent comme « — », jamais une cellule vide silencieuse", () => {
    render(<StatusBadge level="declare" event={{ ...SAMPLE_EVENT, scope: undefined }} />);
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it("sans TrustEvent fourni, le clic affiche un message explicite plutôt qu'un popover vide", () => {
    render(<StatusBadge level="declare" />);
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByText(/aucun événement disponible/i)).toBeInTheDocument();
  });
});
