import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { densityTokens } from '../../tokens/density';
import { AppShell, type AppModule } from './AppShell';

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
