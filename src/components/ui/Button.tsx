import type { ButtonHTMLAttributes } from "react";
import { cx } from "../../lib/cx";

// The one button. Wraps the global `button {}` base style (index.css) and adds
// the two variants the app actually uses: `active` (selected/toggled) and
// `trace` (the accent-tinted "jump into the graph" affordance). Reach for this
// instead of a raw <button> so the whole app toggles/styles consistently.

type ButtonVariant = "default" | "trace";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  active?: boolean;
}

export function Button({
  variant = "default",
  active = false,
  className,
  ...rest
}: ButtonProps) {
  return (
    <button
      className={cx(
        variant === "trace" && "gn-trace-btn",
        active && "active",
        className,
      )}
      {...rest}
    />
  );
}
