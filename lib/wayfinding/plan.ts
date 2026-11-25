/* eslint-disable @typescript-eslint/no-explicit-any */
import { findPath, pickStartNode, type GEdge, type GNode } from './graph';
import { buildLegs, localGuidance, type Leg, type RouteStop } from './describe';

/**
 * The AI "route briefing".
 * The route is analysed first (points → legs → distance, turns, pace), then the AI writes what to SAY for each
 * leg, sized to how long that leg takes to walk. The home screen speaks the overview before launching the 3D
 * view; the 3D view speaks each step while the visitor walks that leg.
 */

const GROQ_MODEL_ID = 'openai/gpt-oss-120b';
const PLAN_KEY = 'navi-plan-v1';
export const SPEECH_WORDS_PER_SECOND = 2.5;
const DEFAULT_GUIDE_SPEED = 1.7;

export interface AnalysedLeg extends Leg {
  /** 0..1 along the route where this leg ends */
  endFrac: number;
  /** seconds to walk this leg at the guide's normal pace */
  seconds: number;
  /** how many words fit in that time when spoken */
  maxWords: number;
}

export interface RouteAnalysis {
  destination: string;
  stops: RouteStop[];
  legs: AnalysedLeg[];
  totalMetres: number;
  totalSeconds: number;
  /** metres per second the guided walk moves at */
  pace: number;
}

export interface GuidancePlan {
  destination: string;
  overview: string;
  steps: string[];
  arrival: string;
  source: 'ai' | 'local';
  /** the home screen already said the overview, so the 3D view must not repeat it */
  overviewSpoken: boolean;
  createdAt: number;
}

export const normName = (s: string) => (s || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();

export function findDestination(mapData: any, query: string) {
  const q = normName(query);
  if (!q) return null;
  const list: any[] = mapData?.destinations ?? [];
  return (
    list.find((d) => normName(d.name) === q) ??
    list.find((d) => [d.name, ...(d.aliases ?? [])].some((a: string) => { const na = normName(a); return na && (na.includes(q) || q.includes(na)); })) ??
    null
  );
}

/** Words that can be spoken in `seconds`, never fewer than a short sentence. */
const budgetWords = (seconds: number) => Math.max(8, Math.min(42, Math.round(seconds * SPEECH_WORDS_PER_SECOND)));
/** How long a line takes to say (used to match the walking pace to the voice). */
export const speechSeconds = (text: string) => text.trim().split(/\s+/).filter(Boolean).length / SPEECH_WORDS_PER_SECOND + 0.6;

export function analyseStops(destination: string, stops: RouteStop[], pace: number): RouteAnalysis | null {
  const legs = buildLegs(stops);
  const total = legs.reduce((a, l) => a + l.distance, 0);
  if (!legs.length || total <= 0) return null;
  let acc = 0;
  const analysed: AnalysedLeg[] = legs.map((l) => {
    acc += l.distance;
    const seconds = l.distance / pace;
    return { ...l, endFrac: acc / total, seconds, maxWords: budgetWords(seconds) };
  });
  return { destination, stops, legs: analysed, totalMetres: total, totalSeconds: total / pace, pace };
}

/** Route from the entrance (where every visit starts) to the named destination, straight from the map data. */
export function analyseRouteFromMap(mapData: any, destinationName: string): RouteAnalysis | null {
  const dest = findDestination(mapData, destinationName);
  if (!dest || !mapData?.nodes?.length) return null;
  const ns: GNode[] = mapData.nodes.map((n: any) => ({ id: n._id, label: n.label, position: n.position }));
  const es: GEdge[] = (mapData.connections ?? []).map((c: any) => ({ from: c.fromNodeId, to: c.toNodeId }));
  const startId = pickStartNode(ns);
  const path = startId ? findPath(ns, es, startId, dest.targetNodeId) : null;
  if (!path || path.length < 2) return null;
  const stops: RouteStop[] = path.map((id) => { const n = ns.find((x) => x.id === id)!; return { label: n.label, position: n.position }; });
  // the 3D view stands the visitor on the configured start position; if that is off the first node, the line begins there
  const sp = mapData.viewSettings?.startPosition;
  if (sp && Math.hypot(stops[0].position.x - sp.x, stops[0].position.z - sp.z) > 1.2) {
    stops.unshift({ label: '', position: { x: sp.x, y: stops[0].position.y, z: sp.z } });
  }
  return analyseStops(dest.name, stops, mapData.viewSettings?.guideSpeed ?? DEFAULT_GUIDE_SPEED);
}

const turnWord = (t: string) => (t === 'left' ? 'left' : t === 'right' ? 'right' : t === 'uturn' ? 'turn around (U-turn)' : 'none — the line ends here');

/** Ask the AI to write the spoken briefing for an analysed route. Falls back to the local wording on any failure. */
export async function requestGuidance(analysis: RouteAnalysis, opts: { userText?: string; apiKey: string }): Promise<GuidancePlan> {
  const local = localGuidance(analysis.destination, analysis.stops);
  const fallback: GuidancePlan = { destination: analysis.destination, ...local, source: 'local', overviewSpoken: false, createdAt: Date.now() };
  if (!opts.apiKey) return fallback;

  const facts = {
    visitorSaid: opts.userText || '',
    destination: analysis.destination,
    walkingPaceMetresPerSecond: Number(analysis.pace.toFixed(2)),
    totalMetres: Math.round(analysis.totalMetres),
    totalSeconds: Math.round(analysis.totalSeconds),
    numberOfTurns: analysis.legs.filter((l) => l.turnAfter !== 'straight').length,
    legs: analysis.legs.map((l, i) => ({
      leg: i + 1,
      startsAt: l.startLabel ?? (i === 0 ? 'where the visitor is standing' : 'the previous bend'),
      metres: Math.round(l.distance),
      secondsToWalk: Math.round(l.seconds),
      maxWords: l.maxWords,
      thenAtTheEnd: turnWord(l.turnAfter),
      landmarkAtTheEnd: l.landmark,
      isLastLeg: i === analysis.legs.length - 1,
    })),
  };

  const system = `You are NaviSense, a warm spoken indoor-navigation guide. A visitor will follow a GREEN LINE drawn on the floor in a 3D view; a glowing dot moves along it. You are given the analysed route (legs, metres, walking time, turns). Write what you will SAY.

Return ONLY JSON: {"overview": string, "steps": string[], "arrival": string}

RULES
- "overview": at most 2 short sentences (max 45 words), said BEFORE the 3D view opens. Give the rough distance and walking time, how many turns, and tell them to follow the green line on the floor. Do NOT greet or confirm the request again (that was already said).
- "steps": EXACTLY one string per leg, in order. Each is spoken at the moment the visitor starts that leg, while they walk it, so it must be finished within the leg's secondsToWalk: never exceed that leg's maxWords. Say how far to follow the green line and what to do at the end of the leg (turn left/right/around — left and right are from the visitor's own walking direction). Mention the landmarkAtTheEnd only if it is not null. For the last leg, say to keep following the line to the red marker. Never invent places, doors or landmarks that are not given.
- "arrival": one short sentence said when they arrive at the destination.
- Use the SAME LANGUAGE as visitorSaid (English, or Chichewa/Chewa/Nyanja if they spoke it). Plain spoken words, no markdown, no lists, no emojis, numbers as words people say ("about twenty metres").`;

  const body = (extra: object) => JSON.stringify({
    model: GROQ_MODEL_ID,
    messages: [{ role: 'system', content: system }, { role: 'user', content: JSON.stringify(facts) }],
    temperature: 0.4,
    max_tokens: 900,
    ...extra,
  });
  const call = (extra: object) => fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${opts.apiKey}`, 'Content-Type': 'application/json' },
    body: body(extra),
  });

  try {
    let res = await call({ response_format: { type: 'json_object' }, reasoning_format: 'hidden' });
    if (!res.ok && res.status === 400) res = await call({});
    if (!res.ok) throw new Error(`Groq ${res.status}`);
    const data = await res.json();
    const content: string = data.choices?.[0]?.message?.content ?? '';
    const json = JSON.parse(content.slice(content.indexOf('{'), content.lastIndexOf('}') + 1));
    const steps: unknown = json.steps;
    if (
      typeof json.overview !== 'string' || !json.overview.trim() ||
      !Array.isArray(steps) || steps.length !== analysis.legs.length ||
      steps.some((x) => typeof x !== 'string' || !x.trim())
    ) throw new Error('AI answer had the wrong shape');
    return {
      destination: analysis.destination,
      overview: json.overview.trim(),
      steps: (steps as string[]).map((x) => x.trim()),
      arrival: typeof json.arrival === 'string' && json.arrival.trim() ? json.arrival.trim() : fallback.arrival,
      source: 'ai',
      overviewSpoken: false,
      createdAt: Date.now(),
    };
  } catch (err) {
    console.warn('AI route briefing failed; using the built-in wording.', err);
    return fallback;
  }
}

/* hand-over between the home screen and the 3D screen */
export function savePlan(plan: GuidancePlan) {
  try { window.sessionStorage.setItem(PLAN_KEY, JSON.stringify(plan)); } catch { /* storage unavailable */ }
}
export function takePlan(destination: string, legCount: number): GuidancePlan | null {
  try {
    const raw = window.sessionStorage.getItem(PLAN_KEY);
    window.sessionStorage.removeItem(PLAN_KEY);
    if (!raw) return null;
    const plan = JSON.parse(raw) as GuidancePlan;
    if (normName(plan.destination) !== normName(destination)) return null;
    if (!Array.isArray(plan.steps) || plan.steps.length !== legCount) return null;
    if (Date.now() - plan.createdAt > 5 * 60_000) return null;
    return plan;
  } catch { return null; }
}
