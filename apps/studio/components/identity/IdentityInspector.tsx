
"use client";

type Props = {
  characterName: string;
  continuityScore: number;
  hairState: string;
  wardrobeState: string;
};

export default function IdentityInspector({
  characterName,
  continuityScore,
  hairState,
  wardrobeState,
}: Props) {
  return (
    <div className="rounded-xl border border-white/10 bg-black/40 p-4">
      <div className="text-lg font-semibold">
        {characterName}
      </div>

      <div className="mt-3 text-sm opacity-70">
        Identity Lock Runtime
      </div>

      <div className="mt-4 grid gap-2 text-sm">
        <div>
          Continuity Score: {continuityScore}
        </div>

        <div>
          Hair State: {hairState}
        </div>

        <div>
          Wardrobe State: {wardrobeState}
        </div>
      </div>
    </div>
  );
}
