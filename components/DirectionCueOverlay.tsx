import { ArrowUp, CornerUpLeft, CornerUpRight, RotateCcw } from 'lucide-react';

type Maneuver = 'left' | 'right' | 'straight' | 'uturn';

function getManeuver(direction: string): Maneuver | null {
  const text = direction.toLowerCase();

  if (/\b(u[ -]?turn|turn around|turn back)\b/.test(text)) return 'uturn';
  if (/\b(?:turn|take|bear|keep|veer|go|head|continue)\s+(?:to\s+the\s+)?left\b|\bleft\s+(?:turn|corridor|hallway)\b|\bkumanzere\b/.test(text)) return 'left';
  if (/\b(?:turn|take|bear|keep|veer|go|head|continue)\s+(?:to\s+the\s+)?right\b|\bright\s+(?:turn|corridor|hallway)\b|\bkumanja\b/.test(text)) return 'right';
  if (/\b(?:straight|continue ahead|go ahead|keep going|proceed straight)\b|\bmolunjika\b/.test(text)) return 'straight';
  return null;
}

const maneuverDetails = {
  left: { label: 'TURN LEFT', Icon: CornerUpLeft },
  right: { label: 'TURN RIGHT', Icon: CornerUpRight },
  straight: { label: 'GO STRAIGHT', Icon: ArrowUp },
  uturn: { label: 'TURN AROUND', Icon: RotateCcw },
} satisfies Record<Maneuver, { label: string; Icon: typeof ArrowUp }>;

export default function DirectionCueOverlay({
  direction,
  positionClassName = 'bottom-5',
}: {
  direction: string;
  positionClassName?: string;
}) {
  const maneuver = getManeuver(direction);
  if (!maneuver) return null;

  const { label, Icon } = maneuverDetails[maneuver];

  return (
    <div role="img" aria-label={label} className={`pointer-events-none absolute ${positionClassName} left-1/2 z-20 -translate-x-1/2`}>
      <div className="flex items-center gap-3 rounded-full border border-amber-200/70 bg-zinc-950/90 px-4 py-2.5 text-amber-200 shadow-lg shadow-black/40 backdrop-blur-sm">
        <Icon className="size-8 shrink-0 animate-pulse stroke-[2.5]" />
        <span className="whitespace-nowrap font-mono text-xs font-bold tracking-wider">{label}</span>
      </div>
    </div>
  );
}