import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { LotPlanA1, PLAN_CAPTION } from './LotPlanA1';

describe('LotPlanA1 — plan du lot A1', () => {
  it('vignette : SVG en ligne sur surface claire, mention « programme fictif » visible', () => {
    render(<LotPlanA1 />);
    const figure = screen.getByTestId('lot-plan-a1');
    const trigger = within(figure).getByRole('button', { name: 'Agrandir le plan du lot A1 (programme fictif)' });
    expect(trigger).toHaveClass('keya-light-surface');
    expect(trigger.querySelector('svg')).not.toBeNull();
    expect(figure.querySelector('img')).toBeNull();
    expect(screen.getByText(PLAN_CAPTION).tagName.toLowerCase()).toBe('figcaption');
    expect(PLAN_CAPTION).toMatch(/programme fictif/);
  });

  it('couleurs : uniquement des variables du thème', () => {
    render(<LotPlanA1 />);
    const markup = screen.getByTestId('lot-plan-a1').outerHTML;
    expect(markup).toContain('var(--keya-');
    expect(markup).not.toMatch(/(?<!url\()#[0-9a-f]{3,6}\b/i);
  });

  it('ouvre le plan en plein écran, zoome et se ferme avec Échap (focus rendu à la vignette)', () => {
    render(<LotPlanA1 />);
    const trigger = screen.getByRole('button', { name: /Agrandir le plan du lot A1/ });
    fireEvent.click(trigger);
    const dialog = screen.getByRole('dialog', { name: 'Plan du lot A1 (programme fictif)' });
    expect(within(dialog).getByRole('button', { name: 'Fermer' })).toHaveFocus();
    expect(within(dialog).getByTestId('plan-viewport')).toHaveClass('keya-light-surface');
    expect(within(dialog).getByText('100 %')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Zoomer' }));
    expect(within(dialog).getByText('125 %')).toBeInTheDocument();
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(trigger).toHaveFocus();
  });
});
