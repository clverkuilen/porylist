import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { PokeballMark } from "@/components/PokeballMark";

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  /** Optional supporting line. Can include links/JSX. */
  description?: ReactNode;
  /** Optional action element (e.g. a button), rendered centered below. */
  action?: ReactNode;
  className?: string;
}

/** Dashed-border placeholder for empty lists/sections (icon + title + optional description/action). */
export function EmptyState({ icon: Icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cn("relative overflow-hidden rounded-xl border border-dashed p-6 text-center", className)}>
      <PokeballMark className="absolute -bottom-8 -right-8 h-32 w-32 -rotate-12 text-primary opacity-[0.06]" />
      <div className="relative mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
        <Icon className="h-5 w-5 text-primary" />
      </div>
      <p className="text-sm font-medium">{title}</p>
      {description && <p className="mt-1 text-xs text-muted-foreground">{description}</p>}
      {action && <div className="mt-3 flex justify-center">{action}</div>}
    </div>
  );
}
