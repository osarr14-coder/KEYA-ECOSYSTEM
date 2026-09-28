import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { DateInput } from './DateInput';

function Harness({ initial, onChange }: { initial: string; onChange: (value: string) => void }) {
  const [value, setValue] = useState(initial);
  return <DateInput label="Reçu le" value={value} onChange={(next) => { setValue(next); onChange(next); }} />;
}

describe('DateInput — saisie au format F06 (PO-2026-09-28-11)', () => {
  it('affiche jour, mois abrégé et année, jamais le format du navigateur', () => {
    render(<DateInput label="Reçu le" value="2026-09-28" onChange={() => {}} />);
    expect(screen.getByRole('group', { name: 'Reçu le' })).toBeInTheDocument();
    expect(screen.getByLabelText('Reçu le — jour')).toHaveDisplayValue('28');
    expect(screen.getByLabelText('Reçu le — mois')).toHaveDisplayValue('sept.');
    expect(screen.getByLabelText('Reçu le — année')).toHaveDisplayValue('2026');
    expect(document.querySelector('input[type="date"]')).toBeNull();
  });

  it('renvoie une date ISO et borne le jour au mois choisi', () => {
    const onChange = vi.fn();
    render(<Harness initial="2026-01-31" onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('Reçu le — mois'), { target: { value: '2' } });
    expect(onChange).toHaveBeenLastCalledWith('2026-02-28');
    fireEvent.change(screen.getByLabelText('Reçu le — jour'), { target: { value: '3' } });
    expect(onChange).toHaveBeenLastCalledWith('2026-02-03');
  });
});
