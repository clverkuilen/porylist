import { cn } from "@/lib/utils";

/**
 * Decorative pokéball outline drawn in currentColor. Place absolutely inside a
 * relative/overflow-hidden container and tint via text color + opacity classes
 * (e.g. "text-primary opacity-[0.06]"). Purely decorative — hidden from AT.
 */
export function PokeballMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 100 100"
      aria-hidden="true"
      className={cn("pointer-events-none select-none", className)}
      fill="none"
      stroke="currentColor"
    >
      <circle cx="50" cy="50" r="46" strokeWidth="6" />
      <path d="M4 50h30" strokeWidth="6" />
      <path d="M66 50h30" strokeWidth="6" />
      <circle cx="50" cy="50" r="16" strokeWidth="6" />
      <circle cx="50" cy="50" r="6" fill="currentColor" stroke="none" />
    </svg>
  );
}
