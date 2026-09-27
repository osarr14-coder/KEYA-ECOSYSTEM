import { semanticColors } from '../../tokens/colors';
import { Icon } from '../Icon/Icon';

/**
 * Ticket F-074 — suite d'étapes horizontale (parcours d'acquisition HOME,
 * avancement des jalons BUILD). L'état de chaque étape est porté par le
 * texte (« fait », « en cours ») ET par la forme (coche, pastille pleine),
 * jamais par la couleur seule. Aucune logique métier : l'appelant calcule
 * l'état de chaque étape.
 */
export type StepState = 'done' | 'current' | 'upcoming';

export interface StepperStep {
  id: string;
  label: string;
  state: StepState;
  /** Précision optionnelle sous le libellé (date, montant…). */
  caption?: string;
}

export interface StepperProps {
  steps: StepperStep[];
  'aria-label': string;
}

const STATE_TEXT: Record<StepState, string> = {
  done: 'fait',
  current: 'en cours',
  upcoming: 'à venir',
};

export function Stepper({ steps, 'aria-label': ariaLabel }: StepperProps) {
  return (
    <ol
      aria-label={ariaLabel}
      style={{
        listStyle: 'none',
        margin: 0,
        padding: 0,
        display: 'grid',
        gridTemplateColumns: `repeat(auto-fit, minmax(120px, 1fr))`,
        gap: '12px 8px',
      }}
    >
      {steps.map((step, index) => {
        const barColor = step.state === 'done'
          ? semanticColors.progress.fill
          : step.state === 'current' ? semanticColors.neutral.heading : semanticColors.neutral.border;
        return (
          <li
            key={step.id}
            data-testid={`step-${step.id}`}
            data-state={step.state}
            aria-current={step.state === 'current' ? 'step' : undefined}
            style={{ display: 'flex', flexDirection: 'column', gap: '8px', minWidth: 0 }}
          >
            <span aria-hidden="true" style={{ height: '4px', borderRadius: '2px', background: barColor }} />
            <span
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                fontSize: '12px',
                fontWeight: step.state === 'current' ? 700 : 500,
                color: step.state === 'current' ? semanticColors.neutral.heading : semanticColors.neutral.textMuted,
              }}
            >
              {step.state === 'done' && <Icon name="check-circle" size={14} color={semanticColors.progress.fill} />}
              {`Étape ${index + 1} · ${STATE_TEXT[step.state]}`}
            </span>
            <span
              style={{
                fontWeight: step.state === 'upcoming' ? 500 : 700,
                color: step.state === 'upcoming' ? semanticColors.neutral.textMuted : semanticColors.neutral.heading,
              }}
            >
              {step.label}
            </span>
            {step.caption && (
              <span style={{ fontSize: '13px', color: semanticColors.neutral.textMuted }}>{step.caption}</span>
            )}
          </li>
        );
      })}
    </ol>
  );
}
