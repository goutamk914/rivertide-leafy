import rawData from './data/leafy-poses.json';

/** Every pose shipped in the Leafy pose pack, grouped the same way as the pack README. */
export const POSE_CATEGORIES = {
  thinking: ['think-dots', 'think-question', 'think-idea', 'think-no-idea-yet', 'think-hmm', 'think-code', 'think-binary', 'think-water', 'think-love', 'think-math', 'think-answer', 'think-daydream', 'confused', 'overthinking', 'eureka'],
  emotions: ['neutral', 'smile', 'happy', 'laugh', 'shy', 'love-eyes', 'star-struck', 'surprised', 'shocked', 'scared', 'sad', 'crying', 'angry', 'grumpy', 'sleepy', 'yawn', 'dizzy', 'sick', 'hurt', 'proud', 'smug-wink', 'bored', 'determined', 'cool', 'relieved', 'embarrassed', 'excited', 'wilted'],
  actions: ['wave-hi', 'thumbs-up', 'clap', 'jump', 'stretch', 'lean-left', 'dance', 'sing', 'run', 'peek-curious', 'sprouting', 'seed', 'float-meditate', 'back-view', 'sneeze', 'hug'],
  work: ['typing', 'typing-happy', 'bug-found', 'debugging', 'coffee', 'reading', 'reading-wow', 'writing-notes', 'lab-test-tube', 'dna', 'awareness-ribbon', 'holding-heart', 'task-done', 'error', 'level-up', 'streak-fire', 'notification', 'got-mail', 'hello-speech'],
  celebrate: ['party-hat', 'confetti', 'crown', 'graduation', 'trophy', 'gift', 'gift-opened', 'balloon', 'bloom', 'holding-flower', 'star-catch'],
  nature: ['watered', 'sunbathing', 'umbrella', 'snowy', 'windy', 'autumn', 'ladybug-friend', 'night', 'dormant', 'dreaming', 'snore-bubble'],
} as const;

export type PoseCategory = keyof typeof POSE_CATEGORIES;
export type PoseName = (typeof POSE_CATEGORIES)[PoseCategory][number];

export interface Pose {
  readonly name: PoseName;
  readonly category: PoseCategory;
  /** Rows of single-character palette keys; '.' is transparent. */
  readonly pixels: readonly string[];
}

export interface PosePack {
  readonly width: number;
  readonly height: number;
  readonly palette: Readonly<Record<string, string>>;
  readonly poses: ReadonlyMap<PoseName, Pose>;
}

interface RawPosePack {
  size: [number, number];
  palette: Record<string, string>;
  poses: { category: string; name: string; pixels: string[] }[];
}

export const POSE_NAMES: readonly PoseName[] = Object.values(POSE_CATEGORIES).flat();

const POSE_NAME_SET: ReadonlySet<string> = new Set(POSE_NAMES);

export function isPoseName(value: string): value is PoseName {
  return POSE_NAME_SET.has(value);
}

function buildPack(raw: RawPosePack): PosePack {
  const [width, height] = raw.size;
  const poses = new Map<PoseName, Pose>();
  for (const pose of raw.poses) {
    if (!isPoseName(pose.name)) continue;
    if (pose.pixels.length !== height || pose.pixels.some((row) => row.length !== width)) {
      throw new Error(`Leafy pose "${pose.name}" does not match the ${width}x${height} grid`);
    }
    poses.set(pose.name, Object.freeze({
      name: pose.name,
      category: pose.category as PoseCategory,
      pixels: Object.freeze([...pose.pixels]),
    }));
  }
  return Object.freeze({ width, height, palette: Object.freeze({ ...raw.palette }), poses });
}

export const LEAFY: PosePack = buildPack(rawData as unknown as RawPosePack);

export function getPose(name: PoseName): Pose {
  const pose = LEAFY.poses.get(name);
  if (!pose) throw new Error(`Unknown Leafy pose: ${name}`);
  return pose;
}
