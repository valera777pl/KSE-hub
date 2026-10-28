/**
 * One quiet glow per screen (DESIGN.md → Glow, the one exception to "no gradients"): a soft radial wash of
 * KSE blue behind the top of the screen. Colours come from the theme tokens --glow / --glow-mid.
 * Static on working screens; `drift` (Готово only) moves it slowly. Never on lists, sheets, cards, tab bar, buttons.
 * The parent gets `has-glow`, so the glow sits behind its content and never widens the page.
 */
export function Glow({ drift = false, center = false }: { drift?: boolean; center?: boolean }) {
  return <div className={`glow${drift ? ' glow--drift' : ''}${center ? ' glow--center' : ''}`} aria-hidden="true" />;
}
