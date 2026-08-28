/*
 * PURPOSE: Toggle switch component — on/off state with animated knob
 *
 * CONSUMERS: settings/ThemeSettings.tsx
 */

interface ToggleProps {
  on: boolean;
  onChange: (on: boolean) => void;
}

export function Toggle({ on, onChange }: ToggleProps) {
  return (
    <div
      className={`toggle ${on ? "on" : ""}`}
      onClick={() => onChange(!on)}
      role="switch"
      aria-checked={on}
      tabIndex={0}
    >
      <div className="toggle-knob" />
    </div>
  );
}
