import {
  fireEvent, render, screen, within,
} from '@testing-library/react';
import {
  afterEach, describe, expect, it, vi,
} from 'vitest';

import { brandColors, semanticColors } from '../../tokens/colors';
import { densityTokens } from '../../tokens/density';
import { AppShell, type AppModule } from './AppShell';

/**
 * Ticket F-050 — `jsdom` n'implémente pas `window.matchMedia` (voir
 * `useIsMobile.ts`) : mock minimal pour simuler un viewport déjà mobile au
 * montage, même esprit que `useIsMobile.test.ts`. Les tests EXISTANTS de ce
 * fichier (ci-dessus/ci-dessous, hors ce describe) ne mockent rien —
 * `useIsMobile` y retourne `false` par défaut, comportement desktop
 * strictement inchangé, aucune modification nécessaire de leur côté.
 */
function mockMatchMediaMobile() {
  window.matchMedia = vi.fn().mockReturnValue({
    matches: true,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
}

const MODULES: AppModule[] = [
  { id: 'home', label: 'Accueil', href: '/' },
  { id: 'tasks', label: 'Tâches', href: '/tasks' },
  { id: 'build', label: 'BUILD', href: '/build', requiredRoles: ['constructeur', 'inspecteur'] },
  { id: 'finance', label: 'FINANCE', href: '/finance', requiredRoles: ['sponsor'] },
  { id: 'notary', label: 'NOTARY', href: '/notary', requiredRoles: ['notaire'] },
];

describe('AppShell — un seul composant, prop de densité (critère d\'acceptation)', () => {
  it('expose la densité reçue sur le DOM (pas deux implémentations séparées)', () => {
    const { rerender } = render(
      <AppShell density="dense" modules={MODULES} userRoles={[]} />,
    );
    expect(screen.getByTestId('app-shell')).toHaveAttribute('data-density', 'dense');

    rerender(<AppShell density="confortable" modules={MODULES} userRoles={[]} />);
    expect(screen.getByTestId('app-shell')).toHaveAttribute('data-density', 'confortable');
  });

  it('applique les tokens de densité partagés (pas des valeurs redéfinies localement)', () => {
    render(<AppShell density="dense" modules={MODULES} userRoles={[]} />);
    expect(screen.getByTestId('app-shell')).toHaveStyle({ fontSize: densityTokens.dense.fontSize });
  });
});

describe('AppShell — modules professionnels masqués sans le rôle (critère d\'acceptation)', () => {
  it("en variante HOME (confortable), n'affiche aucun module professionnel sans rôle correspondant", () => {
    render(<AppShell density="confortable" modules={MODULES} userRoles={['client']} />);

    expect(screen.getByText('Accueil')).toBeInTheDocument();
    expect(screen.getByText('Tâches')).toBeInTheDocument();
    expect(screen.queryByText('BUILD')).not.toBeInTheDocument();
    expect(screen.queryByText('FINANCE')).not.toBeInTheDocument();
    expect(screen.queryByText('NOTARY')).not.toBeInTheDocument();
  });

  it('un module professionnel apparaît dès que le rôle correspondant est présent', () => {
    render(<AppShell density="confortable" modules={MODULES} userRoles={['constructeur']} />);

    expect(screen.getByText('BUILD')).toBeInTheDocument();
    expect(screen.queryByText('FINANCE')).not.toBeInTheDocument();
    expect(screen.queryByText('NOTARY')).not.toBeInTheDocument();
  });

  it('même en variante dense (BUILD/FINANCE), un module professionnel sans rôle reste masqué', () => {
    // Le filtrage par rôle n'est pas une particularité de la variante HOME —
    // c'est une règle générale du composant, testée ici aussi pour ne pas
    // laisser croire qu'elle ne s'applique qu'à une seule densité.
    render(<AppShell density="dense" modules={MODULES} userRoles={['constructeur']} />);
    expect(screen.getByText('BUILD')).toBeInTheDocument();
    expect(screen.queryByText('NOTARY')).not.toBeInTheDocument();
  });

  it('un utilisateur avec plusieurs rôles voit tous les modules professionnels correspondants', () => {
    render(<AppShell density="confortable" modules={MODULES} userRoles={['sponsor', 'notaire']} />);
    expect(screen.getByText('FINANCE')).toBeInTheDocument();
    expect(screen.getByText('NOTARY')).toBeInTheDocument();
    expect(screen.queryByText('BUILD')).not.toBeInTheDocument();
  });
});

describe('AppShell — sidebar repliable', () => {
  it('replie puis déplie la sidebar au clic sur le bouton dédié', () => {
    render(<AppShell density="dense" modules={MODULES} userRoles={[]} />);
    const toggle = screen.getByRole('button', { name: /replier la navigation/i });

    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(toggle);

    const expandButton = screen.getByRole('button', { name: /déplier la navigation/i });
    expect(expandButton).toHaveAttribute('aria-expanded', 'false');
  });
});

describe('AppShell — topbar (recherche, sélecteurs, Task Inbox, avatar)', () => {
  it('affiche le compteur Task Inbox', () => {
    render(<AppShell density="dense" modules={MODULES} userRoles={[]} taskInboxCount={7} />);
    expect(screen.getByTestId('task-inbox-count')).toHaveTextContent('7');
  });

  it('déclenche onSearch avec la requête saisie', () => {
    let submittedQuery: string | undefined;
    render(
      <AppShell
        density="dense"
        modules={MODULES}
        userRoles={[]}
        onSearch={(query) => { submittedQuery = query; }}
      />,
    );
    const input = screen.getByRole('searchbox', { name: /rechercher/i });
    fireEvent.change(input, { target: { value: 'lot A12' } });
    fireEvent.submit(screen.getByRole('search'));
    expect(submittedQuery).toBe('lot A12');
  });

  it('affiche le sélecteur organisation et déclenche onOrganizationChange', () => {
    let selected: string | undefined;
    render(
      <AppShell
        density="dense"
        modules={MODULES}
        userRoles={[]}
        organizationOptions={[{ id: 'org-1', label: 'Org 1' }, { id: 'org-2', label: 'Org 2' }]}
        activeOrganizationId="org-1"
        onOrganizationChange={(id) => { selected = id; }}
      />,
    );
    fireEvent.change(screen.getByRole('combobox', { name: /organisation active/i }), { target: { value: 'org-2' } });
    expect(selected).toBe('org-2');
  });

  it('affiche le nom de l\'utilisateur connecté', () => {
    render(<AppShell density="dense" modules={MODULES} userRoles={[]} user={{ name: 'Awa Diop' }} />);
    expect(screen.getByLabelText('Connecté comme Awa Diop')).toBeInTheDocument();
  });
});

describe('AppShell — identité de marque KEYIMMO AFRIC (ticket F-039, prop brand)', () => {
  it('sans brand (défaut) : en-tête neutre, aucun repère de marque — comportement BUILD/CONTROL/apps/web inchangé', () => {
    render(<AppShell density="dense" modules={MODULES} userRoles={[]} />);
    expect(screen.queryByTestId('brand-mark')).not.toBeInTheDocument();
    expect(screen.getByTestId('app-shell-header')).not.toHaveStyle({ background: brandColors.navy });
  });

  it('avec brand : en-tête en navy, bordure or, repère de marque affiché', () => {
    render(<AppShell density="confortable" brand modules={MODULES} userRoles={[]} />);
    const header = screen.getByTestId('app-shell-header');
    expect(header).toHaveStyle({ background: brandColors.navy, color: '#FFFFFF' });
    expect(header).toHaveStyle({ borderBottom: `2px solid ${brandColors.gold}` });
    expect(screen.getByTestId('brand-mark')).toBeInTheDocument();
    // Ticket F-048 — requête scopée au bandeau <header> : le bloc sidebar
    // (toujours rendu, indépendamment de `brand`) affiche AUSSI ce texte
    // désormais, `getByText` global serait ambigu (2 correspondances).
    expect(within(header).getByText('KEYIMMO AFRIC')).toBeInTheDocument();
  });

  it('brand=false explicite se comporte comme l\'absence du prop', () => {
    render(<AppShell density="confortable" brand={false} modules={MODULES} userRoles={[]} />);
    expect(screen.queryByTestId('brand-mark')).not.toBeInTheDocument();
  });
});

describe('AppShell — bloc navy de sidebar, révision limitée de la doctrine 17.3 (ticket F-048)', () => {
  it('le bloc sidebar est TOUJOURS rendu, indépendamment de brand (contrairement au bandeau <header>)', () => {
    render(<AppShell density="dense" modules={MODULES} userRoles={[]} />);
    const block = screen.getByTestId('sidebar-brand-block');
    expect(block).toBeInTheDocument();
    expect(block).toHaveStyle({ background: brandColors.navy, color: '#FFFFFF' });
    expect(within(block).getByText('K+')).toBeInTheDocument();
    expect(within(block).getByText('KEYIMMO AFRIC')).toBeInTheDocument();
    // Le bandeau <header>, lui, reste HOME-only (F-039, intouché) : sans
    // `brand`, aucun repère de marque n'y apparaît, même avec le bloc
    // sidebar désormais toujours présent.
    expect(screen.queryByTestId('brand-mark')).not.toBeInTheDocument();
  });

  it('appLabel absent : aucune ligne vide, seule "KEYIMMO AFRIC" s\'affiche', () => {
    render(<AppShell density="dense" modules={MODULES} userRoles={[]} />);
    const block = screen.getByTestId('sidebar-brand-block');
    expect(within(block).getByText('KEYIMMO AFRIC')).toBeInTheDocument();
    expect(within(block).queryByText('BUILD Control Tower')).not.toBeInTheDocument();
  });

  it('appLabel fourni : affiché comme ligne secondaire dans le bloc sidebar', () => {
    render(<AppShell density="dense" appLabel="BUILD" modules={MODULES} userRoles={[]} />);
    const block = screen.getByTestId('sidebar-brand-block');
    expect(within(block).getByText('BUILD')).toBeInTheDocument();
  });

  it('mode replié : le bloc se réduit à "K+" seul, appLabel/KEYIMMO AFRIC masqués', () => {
    render(<AppShell density="dense" appLabel="BUILD" modules={MODULES} userRoles={[]} />);
    fireEvent.click(screen.getByRole('button', { name: /replier la navigation/i }));
    const block = screen.getByTestId('sidebar-brand-block');
    expect(within(block).getByText('K+')).toBeInTheDocument();
    expect(within(block).queryByText('KEYIMMO AFRIC')).not.toBeInTheDocument();
    expect(within(block).queryByText('BUILD')).not.toBeInTheDocument();
  });

  it('item de navigation actif : bordure gauche or, fond/texte inchangés (décision D)', () => {
    render(<AppShell density="dense" modules={MODULES} userRoles={[]} activeModuleId="home" />);
    const active = screen.getByText('Accueil').closest('a');
    expect(active).toHaveStyle({
      borderLeft: `3px solid ${brandColors.gold}`,
      background: semanticColors.neutral.background,
      color: semanticColors.neutral.text,
    });
  });

  it('item de navigation INACTIF ne reçoit jamais brandColors (garde contre la dérive de portée)', () => {
    render(<AppShell density="dense" modules={MODULES} userRoles={[]} activeModuleId="home" />);
    const inactive = screen.getByText('Tâches').closest('a');
    expect(inactive).not.toHaveStyle({ borderLeft: `3px solid ${brandColors.gold}` });
    expect(inactive).not.toHaveStyle({ background: brandColors.navy });
    expect(inactive).not.toHaveStyle({ color: brandColors.gold });
  });

  it('la zone de contenu (<main>) ne reçoit jamais brandColors (garde contre la dérive de portée)', () => {
    render(<AppShell density="dense" modules={MODULES} userRoles={[]}>Contenu</AppShell>);
    const main = screen.getByText('Contenu').closest('main');
    expect(main).not.toHaveStyle({ background: brandColors.navy });
    expect(main).not.toHaveStyle({ color: brandColors.gold });
  });
});

describe('AppShell — fil d\'Ariane', () => {
  it('affiche la trace de navigation avec le dernier élément non cliquable', () => {
    render(
      <AppShell
        density="dense"
        modules={MODULES}
        userRoles={[]}
        breadcrumbs={[{ label: 'Programmes', href: '/programs' }, { label: 'Programme A' }]}
      />,
    );
    expect(screen.getByRole('link', { name: 'Programmes' })).toBeInTheDocument();
    const current = screen.getByText('Programme A');
    expect(current).toHaveAttribute('aria-current', 'page');
  });
});

describe('AppShell — responsive mobile, dette de F-039 (ticket F-050)', () => {
  afterEach(() => {
    // @ts-expect-error — retire le mock, jsdom n'a pas matchMedia nativement.
    delete window.matchMedia;
  });

  it('en dessous du seuil mobile, la grille reste le rail compact même sans avoir cliqué "Replier"', () => {
    mockMatchMediaMobile();
    render(<AppShell density="confortable" modules={MODULES} userRoles={[]} />);

    expect(screen.getByTestId('app-shell')).toHaveStyle({ gridTemplateColumns: '56px 1fr' });
  });

  it('en dessous du seuil mobile, les libellés de module sont masqués (rail icônes seules)', () => {
    mockMatchMediaMobile();
    render(<AppShell density="confortable" modules={MODULES} userRoles={[]} />);

    expect(screen.queryByText('Accueil')).not.toBeInTheDocument();
  });

  it('en dessous du seuil mobile, le bouton replier/déplier n\'est pas rendu (rien à basculer)', () => {
    mockMatchMediaMobile();
    render(<AppShell density="confortable" modules={MODULES} userRoles={[]} />);

    expect(screen.queryByRole('button', { name: /replier la navigation/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /déplier la navigation/i })).not.toBeInTheDocument();
  });

  it('au-dessus du seuil (comportement par défaut de ce projet de test, matchMedia absent), rien ne change', () => {
    render(<AppShell density="confortable" modules={MODULES} userRoles={[]} />);

    expect(screen.getByTestId('app-shell')).toHaveStyle({ gridTemplateColumns: '220px 1fr' });
    expect(screen.getByText('Accueil')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /replier la navigation/i })).toBeInTheDocument();
  });
});
