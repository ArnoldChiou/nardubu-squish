/** Damage-driven fracture stages, shared by the mesh and regression tests. */
export function fracturePose(damage: number, seed: number) {
  const d = Math.max(0, Math.min(1, damage));
  const variation = 0.85 + seed * 0.3;
  const threshold = [0.012, 0.038, 0.085, 0.17, 0.32];
  let stage = 0;
  for (const t of threshold) if (d >= t * variation) stage++;
  // Each local yield gives a distinct small snap rather than uniform shrinking.
  const opening = Math.min(1, Math.sqrt(d) * 0.8 + stage * 0.09);
  const splitting = Math.min(1, Math.max(0, stage - 1) * 0.20 + Math.max(0, d - 0.03) * 0.45);
  return { stage, opening, splitting };
}
