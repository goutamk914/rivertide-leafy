/**
 * Messages between main and the wake-word utility process, validated on both sides. The worker
 * never sends audio or words back: only whether a detection was confirmed, with its scores.
 */
import { z } from 'zod';
import { FRAME_SAMPLES } from './features';

export const WakeSensitivitySchema = z.enum(['low', 'medium', 'high']);

export const WorkerRequestSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('start'), modelDir: z.string().min(1).max(2000), sensitivity: WakeSensitivitySchema }),
  z.object({
    type: z.literal('audio'),
    samples: z.custom<Int16Array>((s) => s instanceof Int16Array && s.length === FRAME_SAMPLES, `exactly ${FRAME_SAMPLES} PCM16 samples`),
    /** First frame after a gap: the worker clears its buffers before using it. */
    fresh: z.boolean(),
  }),
  z.object({ type: z.literal('sensitivity'), sensitivity: WakeSensitivitySchema }),
]);

const score = z.number().min(0).max(1);
const margin = z.number().min(-1000).max(1000);

export const WorkerEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ready') }),
  z.object({ type: z.literal('detected'), score, margin }),
  z.object({ type: z.literal('rejected'), score, margin }),
  z.object({ type: z.literal('error'), message: z.string().max(500), fatal: z.boolean() }),
]);

export type WorkerRequest = z.infer<typeof WorkerRequestSchema>;
export type WorkerEvent = z.infer<typeof WorkerEventSchema>;
