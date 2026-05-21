import { useEffect } from "react";
import { X } from "lucide-react";
import { useSingleAbilityDetail, type AbilityListEntry } from "@/lib/pokeapi";
import { bestFlavorText, type GameOption } from "@/lib/games";

const VERSION_GROUP_LABELS: Record<string, string> = {
  "ruby-sapphire":                       "Ruby/Sapphire",
  "emerald":                             "Emerald",
  "firered-leafgreen":                   "FireRed/LeafGreen",
  "diamond-pearl":                       "Diamond/Pearl",
  "platinum":                            "Platinum",
  "heartgold-soulsilver":                "HeartGold/SoulSilver",
  "black-white":                         "Black/White",
  "black-2-white-2":                     "Black 2/White 2",
  "x-y":                                 "X/Y",
  "omega-ruby-alpha-sapphire":           "Omega Ruby/Alpha Sapphire",
  "sun-moon":                            "Sun/Moon",
  "ultra-sun-ultra-moon":                "Ultra Sun/Ultra Moon",
  "lets-go-pikachu-lets-go-eevee":       "Let's Go",
  "sword-shield":                        "Sword/Shield",
  "brilliant-diamond-and-shining-pearl": "Brilliant Diamond/Shining Pearl",
  "legends-arceus":                      "Legends: Arceus",
  "scarlet-violet":                      "Scarlet/Violet",
};

interface AbilityModalProps {
  name: string;
  entry?: AbilityListEntry;
  game?: GameOption | null;
  onClose: () => void;
}

export function AbilityModal({ name, entry, game, onClose }: AbilityModalProps) {
  const { data: detail, isLoading } = useSingleAbilityDetail(name);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const displayName = entry?.displayName
    ?? name.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

  const shortEffect =
    detail?.effect_entries?.find((e) => e.language.name === "en")?.short_effect
    ?? entry?.shortEffect ?? "";

  const flavorEntry = detail
    ? bestFlavorText(detail.flavor_text_entries, game ?? null)
    : undefined;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-lg rounded-xl bg-background shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b px-5 py-4">
          <h2 className="text-xl font-bold">{displayName}</h2>
          <button
            className="shrink-0 rounded-full p-1 text-muted-foreground hover:text-foreground"
            onClick={onClose}
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-5 px-5 py-4">
          {isLoading ? (
            <div className="space-y-1.5">
              <div className="h-3.5 w-1/4 animate-pulse rounded bg-muted" />
              <div className="h-4 w-full animate-pulse rounded bg-muted" />
              <div className="h-4 w-3/4 animate-pulse rounded bg-muted" />
            </div>
          ) : shortEffect ? (
            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Effect
              </p>
              <p className="text-sm leading-relaxed">{shortEffect}</p>
            </div>
          ) : null}

          {flavorEntry && (
            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                In-game description
                <span className="ml-1.5 font-normal normal-case text-muted-foreground/70">
                  ({VERSION_GROUP_LABELS[flavorEntry.version_group.name] ?? flavorEntry.version_group.name})
                </span>
              </p>
              <p className="text-sm italic leading-relaxed text-muted-foreground">
                {flavorEntry.flavor_text.replace(/\n/g, " ")}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
