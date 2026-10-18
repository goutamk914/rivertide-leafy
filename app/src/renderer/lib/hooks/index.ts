/**
 * Shared renderer hooks and helpers (island, Leafy, palette; the dashboard may use them too).
 *
 * Data hooks — each subscribes on mount and cleans up on unmount:
 *   useVoiceSnapshot()        live VoiceSnapshot (IDLE_SNAPSHOT until main answers)
 *   useAudioLevel(active)     ref to the latest AudioLevel; read it in requestAnimationFrame loops
 *   useSettings()             Settings | null, follows settings:changed
 *   useLeafyCue()             latest leafy:cue with receivedAt + seq
 *   useAgentRun(target)       folded AgentRunState for a run id or 'latest'; useRunBook() for all
 *   useReducedMotion(pref)    settings.appearance.reduceMotion + OS preference
 *   useApplyAppearance(s)     mirrors theme / text scale / reduce-motion onto <html>
 *   useClock(wakeAt)          Date.now() that re-renders exactly at the given timestamps
 *
 * Pure helpers: agentRun (event folding), voiceCopy (phase wording), text, accelerator,
 * iconNames (tool/kind → lucide name), waveformMath. Components: <Icon/>, <Waveform/>.
 * Bridge: safeInvoke / safeOn / fireAndForget / reportError; ensureDevBridge() for dev:web.
 */
export { IDLE_SNAPSHOT, useVoiceSnapshot } from './useVoiceSnapshot';
export { SILENT_LEVEL, useAudioLevel } from './useAudioLevel';
export { useSettings } from './useSettings';
export { isCueActive, useLeafyCue, type ReceivedCue } from './useLeafyCue';
export { useAgentRun, useRunBook, type RunTarget, type UseAgentRunOptions } from './useAgentRun';
export { resolveReducedMotion, useReducedMotion, type MotionPreference } from './useReducedMotion';
export { resolveTheme, useApplyAppearance, type AppearanceOptions, type ResolvedTheme } from './useApplyAppearance';
export { nextWake, useClock } from './useClock';
export {
  activeStep, emptyRun, EMPTY_RUN_BOOK, recordAgentEvent, reduceAgentRun,
  type AgentRunState, type AgentRunStatus, type AgentStep, type AgentStepStatus, type RunBook,
} from './agentRun';
export { isBusyPhase, MODE_LABEL, phaseStatus, workingLabel } from './voiceCopy';
export { clamp, collapseWhitespace, estimateLines, firstWords, headText, tailText } from './text';
export { formatAccelerator, pasteShortcut, type Platform } from './accelerator';
export { safePlatform } from './platform';
export { ICON_NAMES, isIconName, kindIconName, normalizeIconName, toolActivity, toolIconName, type IconName } from './iconNames';
export { Icon, type IconProps } from './Icon';
export { Waveform, type WaveformProps } from './Waveform';
export { barHeights, INITIAL_WAVEFORM, stepWaveform, type WaveformShape, type WaveformState } from './waveformMath';
export { fireAndForget, reportError, safeInvoke, safeOn } from './bridge';
export { createFallbackBridge, ensureDevBridge } from './devBridge';
