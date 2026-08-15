import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getDraftForMission } from '../db/repository';
import { InspectionFormView } from './InspectionFormView';

beforeEach(async () => {
  const databases = await indexedDB.databases();
  for (const database of databases) {
    if (database.name) indexedDB.deleteDatabase(database.name);
  }
});

describe('InspectionFormView — chaque saisie est écrite immédiatement, jamais différée', () => {
  it('cocher un item de la checklist le persiste aussitôt en IndexedDB', async () => {
    render(<InspectionFormView missionId="mission-1" onBack={() => {}} />);

    const checkbox = await screen.findByLabelText('Sécurité du chantier');
    fireEvent.click(checkbox);

    await waitFor(async () => {
      const draft = await getDraftForMission('mission-1');
      expect(draft?.checklist.find((item) => item.id === 'securite')?.checked).toBe(true);
    });
  });

  it('le commentaire est persisté à la perte de focus (blur), pas à chaque frappe', async () => {
    render(<InspectionFormView missionId="mission-1" onBack={() => {}} />);

    const textarea = await screen.findByLabelText('Commentaire');
    fireEvent.change(textarea, { target: { value: 'Fissure visible' } });
    fireEvent.blur(textarea);

    await waitFor(async () => {
      const draft = await getDraftForMission('mission-1');
      expect(draft?.comment).toBe('Fissure visible');
    });
  });

  it('choisir une décision la persiste aussitôt', async () => {
    render(<InspectionFormView missionId="mission-1" onBack={() => {}} />);

    fireEvent.click(await screen.findByLabelText('Réserve'));

    await waitFor(async () => {
      const draft = await getDraftForMission('mission-1');
      expect(draft?.decision).toBe('reserve');
    });
  });

  it('ajouter une photo la persiste aussitôt, avec son contenu binaire', async () => {
    render(<InspectionFormView missionId="mission-1" onBack={() => {}} />);

    const file = new File(['contenu-photo'], 'photo.jpg', { type: 'image/jpeg' });
    const input = await screen.findByLabelText('Ajouter une photo');
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(async () => {
      const draft = await getDraftForMission('mission-1');
      expect(draft?.photos).toHaveLength(1);
      expect(draft?.photos[0].fileName).toBe('photo.jpg');
    });
    expect(await screen.findByText('photo.jpg')).toBeInTheDocument();
  });

  it('supprimer une photo la retire d\'IndexedDB', async () => {
    render(<InspectionFormView missionId="mission-1" onBack={() => {}} />);

    const file = new File(['contenu-photo'], 'photo.jpg', { type: 'image/jpeg' });
    fireEvent.change(await screen.findByLabelText('Ajouter une photo'), { target: { files: [file] } });
    await screen.findByText('photo.jpg');

    fireEvent.click(screen.getByLabelText('Supprimer photo.jpg'));

    expect(screen.queryByText('photo.jpg')).not.toBeInTheDocument();
    await waitFor(async () => {
      const draft = await getDraftForMission('mission-1');
      expect(draft?.photos).toHaveLength(0);
    });
  });

  it('rouvrir une mission déjà entamée recharge son brouillon existant, pas un formulaire vierge', async () => {
    const { unmount } = render(<InspectionFormView missionId="mission-1" onBack={() => {}} />);
    fireEvent.click(await screen.findByLabelText('Sécurité du chantier'));
    await waitFor(async () => {
      const draft = await getDraftForMission('mission-1');
      expect(draft?.checklist.find((item) => item.id === 'securite')?.checked).toBe(true);
    });
    unmount();

    render(<InspectionFormView missionId="mission-1" onBack={() => {}} />);
    const checkbox = await screen.findByLabelText('Sécurité du chantier') as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
  });

  it('le bouton retour appelle onBack', async () => {
    const onBack = vi.fn();
    render(<InspectionFormView missionId="mission-1" onBack={onBack} />);

    fireEvent.click(await screen.findByRole('button', { name: '← Missions' }));

    expect(onBack).toHaveBeenCalledOnce();
  });
});
