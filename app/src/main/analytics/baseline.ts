/**
 * Personal baseline and fog index. Baseline = per-metric median and MAD over the 14 days before
 * a session (ready with ≥ 5 sessions). Robust z-scores, oriented so positive = "more effortful
 * than usual", are weighted, averaged and squashed with a logistic into 0–100.
 * Labels: steady < 40 ≤ a little foggy < 65 ≤ foggy. Not a diagnosis.
 */
import type { DynamicsSession, FogLabel, FogReading } from '../../shared/types';
import { MATTR_WINDOW } from './metrics';

export const BASELINE_DAYS = 14;
export const BASELINE_MIN_SESSIONS = 5;
export const STEADY_BELOW = 40;
export const FOGGY_FROM = 65;
const DAY_MS = 24 * 60 * 60 * 1000;
const MAD_SCALE = 1.4826;
const Z_LIMIT = 4;
const CONTRIBUTOR_Z = 1;
const MAX_CONTRIBUTORS = 3;
const LOGISTIC_SLOPE = 1.5;
const LOGISTIC_CENTER = 0.75;

export interface FogMetric {
  readonly key: keyof DynamicsSession;
  readonly weight: number;
  readonly worse: 'higher' | 'lower';
  /** Smallest spread used for z-scores, so a very consistent baseline doesn't explode them. */
  readonly floor: number;
  readonly value: (session: DynamicsSession) => number | null;
}

const perMinute = (count: number, ms: number): number | null => (ms >= 1000 ? count / (ms / 60_000) : null);

export const FOG_METRICS: readonly FogMetric[] = [
  { key: 'wpm', weight: 0.3, worse: 'lower', floor: 8, value: (s) => (s.wpm > 0 ? s.wpm : null) },
  { key: 'pauseCount', weight: 0.15, worse: 'higher', floor: 1.5, value: (s) => perMinute(s.pauseCount, s.durationMs) },
  { key: 'meanPauseMs', weight: 0.15, worse: 'higher', floor: 150, value: (s) => (s.pauseCount > 0 ? s.meanPauseMs : null) },
  { key: 'fillerRate', weight: 0.15, worse: 'higher', floor: 2, value: (s) => s.fillerRate },
  { key: 'selfCorrectionCount', weight: 0.1, worse: 'higher', floor: 1, value: (s) => (s.words > 0 ? (100 * s.selfCorrectionCount) / s.words : null) },
  { key: 'typeTokenRatio', weight: 0.15, worse: 'lower', floor: 0.03, value: (s) => (s.words >= MATTR_WINDOW ? s.typeTokenRatio : null) },
];

export interface MetricBaseline { readonly median: number; readonly spread: number; readonly count: number }
export interface Baseline { readonly ready: boolean; readonly sessions: number; readonly metrics: ReadonlyMap<keyof DynamicsSession, MetricBaseline> }

export function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

export function medianAbsoluteDeviation(values: readonly number[], center: number = median(values)): number {
  return median(values.map((value) => Math.abs(value - center)));
}

/** Sessions in the 14 days strictly before `at`. */
export function baselineWindow(sessions: readonly DynamicsSession[], at: number, excludeId?: string): DynamicsSession[] {
  const from = at - BASELINE_DAYS * DAY_MS;
  return sessions.filter((s) => {
    const time = Date.parse(s.createdAt);
    return time >= from && time < at && s.id !== excludeId;
  });
}

export function computeBaseline(window: readonly DynamicsSession[]): Baseline {
  const metrics = new Map<keyof DynamicsSession, MetricBaseline>();
  for (const metric of FOG_METRICS) {
    const values = window.map(metric.value).filter((v): v is number => v !== null && Number.isFinite(v));
    if (values.length < BASELINE_MIN_SESSIONS) continue;
    const center = median(values);
    metrics.set(metric.key, { median: center, spread: MAD_SCALE * medianAbsoluteDeviation(values, center), count: values.length });
  }
  return { ready: window.length >= BASELINE_MIN_SESSIONS && metrics.size > 0, sessions: window.length, metrics };
}

export function fogLabel(index: number): FogLabel {
  if (index < STEADY_BELOW) return 'steady';
  return index < FOGGY_FROM ? 'a-little-foggy' : 'foggy';
}

export function squash(raw: number): number {
  return Math.round(100 / (1 + Math.exp(-LOGISTIC_SLOPE * (raw - LOGISTIC_CENTER))));
}

/** Fog reading for a session against a baseline; null when the baseline isn't ready. */
export function fogReading(session: DynamicsSession, baseline: Baseline): FogReading | null {
  if (!baseline.ready) return null;
  let weighted = 0;
  let weights = 0;
  const scored: { metric: keyof DynamicsSession; z: number }[] = [];
  for (const metric of FOG_METRICS) {
    const value = metric.value(session);
    const base = baseline.metrics.get(metric.key);
    if (value === null || !base) continue;
    const z = (value - base.median) / Math.max(base.spread, metric.floor);
    const worseZ = Math.max(-Z_LIMIT, Math.min(Z_LIMIT, metric.worse === 'higher' ? z : -z));
    weighted += metric.weight * worseZ;
    weights += metric.weight;
    scored.push({ metric: metric.key, z: worseZ });
  }
  if (weights === 0) return null;
  const fogIndex = squash(weighted / weights);
  const contributors = scored
    .filter((entry) => Math.abs(entry.z) >= CONTRIBUTOR_Z)
    .sort((a, b) => Math.abs(b.z) - Math.abs(a.z))
    .slice(0, MAX_CONTRIBUTORS)
    .map((entry) => ({ metric: entry.metric, direction: entry.z > 0 ? 'worse' as const : 'better' as const, z: Math.round(entry.z * 100) / 100 }));
  return { fogIndex, label: fogLabel(fogIndex), contributors };
}

/** First index whose time is ≥ `target` (times sorted ascending). */
export function lowerBound(times: readonly number[], target: number): number {
  let low = 0;
  let high = times.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (times[mid] < target) low = mid + 1;
    else high = mid;
  }
  return low;
}

/**
 * Reading for `session` using only the sessions in the 14 days before it.
 * `sorted` must be ordered oldest first and `times` must hold their parsed timestamps.
 */
export function readingAt(session: DynamicsSession, sorted: readonly DynamicsSession[], times: readonly number[]): FogReading | null {
  const at = Date.parse(session.createdAt);
  const window = sorted
    .slice(lowerBound(times, at - BASELINE_DAYS * DAY_MS), lowerBound(times, at))
    .filter((candidate) => candidate.id !== session.id);
  return fogReading(session, computeBaseline(window));
}
