// Stable colour assignment for speaker chips. Hashing the label means the
// same speaker keeps the same colour across re-renders without us tracking
// an explicit speaker→colour map in state.

const SPEAKER_CHIP_PALETTE = [
  "bg-blue-500/15 text-blue-700 dark:text-blue-300",
  "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  "bg-violet-500/15 text-violet-700 dark:text-violet-300",
  "bg-rose-500/15 text-rose-700 dark:text-rose-300",
  "bg-cyan-500/15 text-cyan-700 dark:text-cyan-300",
];

export function speakerChipClass(speaker: string): string {
  // "Me" gets a deliberate, fixed colour so the local user is always recognisable.
  if (speaker === "Me") {
    return "bg-primary/15 text-primary";
  }
  let hash = 0;
  for (let i = 0; i < speaker.length; i++) {
    hash = (hash * 31 + speaker.charCodeAt(i)) | 0;
  }
  return SPEAKER_CHIP_PALETTE[Math.abs(hash) % SPEAKER_CHIP_PALETTE.length];
}
