import type { Pos } from './graph';

/**
 * Turns a walking route into plain spoken English that explains how to FOLLOW THE GREEN LINE.
 * Built locally from the route geometry, so it is instant (no network call, no waiting after the request).
 */

export interface RouteStop { label: string; position: Pos }

type Turn = 'left' | 'right' | 'uturn' | 'straight';

const TURN_THRESHOLD = 0.6; // radians (~35°) — the same threshold the on-screen cue uses

const wrapPi = (a: number) => {
  let r = (a + Math.PI) % (Math.PI * 2);
  if (r < 0) r += Math.PI * 2;
  return r - Math.PI;
};
// same convention as the scene: 0 = looking toward -Z, positive = turning left
const heading = (a: Pos, b: Pos) => Math.atan2(-(b.x - a.x), -(b.z - a.z));
const flat = (a: Pos, b: Pos) => Math.hypot(a.x - b.x, a.z - b.z);

/** Generic names the admin may give to map nodes that mean nothing to a visitor. */
const GENERIC_LABEL = /^(node|point|junction|waypoint|corner|turn|path|wp|n)\s*[-_#]?\s*\d*$/i;
const usefulLabel = (label: string) => !!label && !GENERIC_LABEL.test(label.trim());

const metres = (m: number) => {
  const r = Math.max(1, Math.round(m / 5) * 5 || Math.round(m));
  return m < 8 ? `${Math.max(2, Math.round(m))} metres` : `${r} metres`;
};

export interface Leg { distance: number; turnAfter: Turn; landmark: string | null; startLabel: string | null }

export function buildLegs(stops: RouteStop[]): Leg[] {
  const legs: Leg[] = [];
  let acc = 0;
  let fromLabel: string | null = stops.length && usefulLabel(stops[0].label) ? stops[0].label : null;
  for (let i = 1; i < stops.length; i++) {
    acc += flat(stops[i - 1].position, stops[i].position);
    const last = i === stops.length - 1;
    let turn: Turn = 'straight';
    if (!last) {
      const diff = wrapPi(heading(stops[i].position, stops[i + 1].position) - heading(stops[i - 1].position, stops[i].position));
      if (Math.abs(diff) > TURN_THRESHOLD) turn = Math.abs(diff) > 2.4 ? 'uturn' : diff > 0 ? 'left' : 'right';
    }
    if (turn !== 'straight' || last) {
      const landmark = usefulLabel(stops[i].label) ? stops[i].label : null;
      legs.push({ distance: acc, turnAfter: turn, landmark, startLabel: fromLabel });
      fromLabel = landmark;
      acc = 0;
    }
  }
  return legs;
}

const TURN_WORDS: Record<Exclude<Turn, 'straight'>, string> = {
  left: 'turn left',
  right: 'turn right',
  uturn: 'turn around',
};

/** The full spoken briefing given when a route starts. */
export function describeRoute(destination: string, stops: RouteStop[]): { speech: string; steps: string[] } {
  const legs = buildLegs(stops);
  const steps: string[] = [];

  legs.forEach((leg, i) => {
    const first = i === 0;
    const last = i === legs.length - 1;
    const walk = leg.distance < 4 ? 'a few steps' : metres(leg.distance);
    if (last) {
      steps.push(`${first ? 'Follow the line' : 'Keep following it'} for ${walk} and you will reach ${destination}.`);
      return;
    }
    const where = leg.landmark ? ` At ${leg.landmark},` : ' Then,';
    const lead = first ? `Follow the line straight for ${walk}` : `Stay on the line for ${walk}`;
    steps.push(`${lead}.${where} the line bends — ${TURN_WORDS[leg.turnAfter as Exclude<Turn, 'straight'>]} and go with it.`);
  });

  const intro =
    `Okay, I'll take you to ${destination}. ` +
    `Follow the green line on the floor — the glowing dot shows which way it goes. ` +
    `I'll walk you along it; or use the joystick to walk yourself and keep to the line. Tap Pause any time, and Resume to rejoin it. `;
  const end = ` The red marker shows ${destination}.`;
  return { speech: (intro + steps.join(' ') + end).replace(/\s+/g, ' ').trim(), steps };
}

/** Offline fallback used only when the AI is unreachable: same shape as the AI's answer. */
export function localGuidance(destination: string, stops: RouteStop[]): { overview: string; steps: string[]; arrival: string } {
  const legs = buildLegs(stops);
  const total = legs.reduce((a, l) => a + l.distance, 0);
  const turns = legs.filter((l) => l.turnAfter !== 'straight').length;
  const overview =
    `${destination} is about ${metres(total)} away with ${turns === 0 ? 'no turns' : turns === 1 ? 'one turn' : `${turns} turns`}. ` +
    `Follow the green line on the floor — the glowing dot shows which way it goes.`;
  return { overview, steps: describeRoute(destination, stops).steps, arrival: ARRIVED_LINE(destination) };
}

/** Short heads-up spoken just before the line bends. */
export function describeUpcomingTurn(turn: 'left' | 'right' | 'uturn', metresAway: number): string {
  const d = metresAway <= 2.5 ? 'Now,' : `In about ${Math.max(2, Math.round(metresAway))} metres,`;
  if (turn === 'uturn') return `${d} the green line doubles back — turn around and follow it.`;
  return `${d} the green line bends ${turn}. Turn ${turn} with it and keep following it.`;
}

export const ARRIVED_LINE = (dest: string) => `You've arrived at ${dest}. The green line ends here.`;
export const PAUSED_LINE = `You're in control now. Keep to the green line, or tap Resume and I'll bring you back onto it.`;
