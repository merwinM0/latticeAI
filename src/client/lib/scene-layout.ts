export interface SceneLayout {
  width: number;
  height: number;
  faceX: number;
  faceY: number;
  diameter: number;
  safeBottom: number;
  margin: number;
}
export interface ReplySource { id: string; text: string }
export interface ReplyPlacement { x: number; y: number; width: number; maxHeight: number }
interface Rect { x: number; y: number; width: number; height: number }

export function createSceneLayout(width: number, height: number, composerTop = height - 112): SceneLayout {
  const safeBottom = Math.max(120, Math.min(height - 24, composerTop - 24));
  const wide = width > safeBottom * 1.65;
  const margin = width < 600 ? 20 : 36;
  const faceY = safeBottom * 0.48;
  let diameter = Math.max(72, Math.min(width * 0.76, safeBottom * (wide ? 0.82 : 0.66), wide ? 580 : Math.max(72, safeBottom - 200), 580));
  const sideRoom = width / 2 - diameter * 0.54 - 16 - margin - 24;
  if (sideRoom < 176) {
    // Without side captions, reserve TWO readable zones instead of stacking replies.
    const caption = safeBottom < 360 ? 40 : 72;
    const radius = Math.min(faceY - margin - 12 - caption, safeBottom - faceY - 12 - caption);
    diameter = Math.max(72, Math.min(diameter, (radius - 16) / 0.54));
  }
  return { width, height, faceX: width / 2, faceY, diameter, safeBottom, margin };
}

function seeded(id: string) {
  let seed = 2166136261;
  for (const character of id) seed = Math.imul(seed ^ character.charCodeAt(0), 16777619);
  return () => {
    seed = Math.imul(seed ^ (seed >>> 15), 2246822519);
    seed = Math.imul(seed ^ (seed >>> 13), 3266489917);
    return ((seed ^= seed >>> 16) >>> 0) / 4294967296;
  };
}
function readingHeight(text: string, width: number, maxHeight: number) {
  const length = Array.from(text).reduce((size, char) => size + (char.charCodeAt(0) > 255 ? 1 : 0.55), 0);
  return Math.min(maxHeight, Math.max(32, Math.ceil(length / Math.max(8, (width - 8) / 18)) * 30 + 8));
}
function overlap(a: Rect, b: Rect) {
  const x = Math.max(0, Math.min(a.x + a.width + 16, b.x + b.width + 16) - Math.max(a.x - 16, b.x - 16));
  const y = Math.max(0, Math.min(a.y + a.height + 12, b.y + b.height + 12) - Math.max(a.y - 12, b.y - 12));
  return x * y;
}

/** Seeded safe zones give each reply a random-looking but stable position while typing. */
export function placeReplies(layout: SceneLayout, replies: ReplySource[]): ReplyPlacement[] {
  const { width, faceX, faceY, diameter, safeBottom, margin } = layout;
  const radius = diameter * 0.54 + 16;
  const sideWidth = faceX - radius - margin - 24;
  const topEnd = faceY - radius - 12;
  const bottomStart = faceY + radius + 12;
  const zones: Rect[] = [];
  if (sideWidth >= 176) {
    const zoneWidth = Math.min(280, sideWidth);
    zones.push({ x: Math.max(margin, faceX - radius - zoneWidth - 32), y: Math.max(margin, faceY - diameter * 0.42), width: zoneWidth, height: Math.min(safeBottom - margin, faceY + diameter * 0.48) - Math.max(margin, faceY - diameter * 0.42) });
    zones.push({ x: Math.min(width - margin - zoneWidth, faceX + radius + 32), y: zones[0]!.y, width: zoneWidth, height: zones[0]!.height });
  }
  const textWidth = Math.min(width - margin * 2, width < 600 ? 304 : 320);
  if (topEnd - margin >= 32) {
    const height = Math.min(132, topEnd - margin);
    zones.push({ x: (width - textWidth) / 2, y: topEnd - height, width: textWidth, height });
  }
  if (safeBottom - bottomStart >= 32) zones.push({ x: (width - textWidth) / 2, y: bottomStart, width: textWidth, height: Math.min(132, safeBottom - bottomStart) });
  const occupied: Rect[] = [];
  return replies.map((reply) => {
    const random = seeded(reply.id);
    const candidates: { rect: Rect; maxHeight: number; score: number }[] = [];
    for (const zone of zones) {
      const maxHeight = Math.max(32, Math.min(192, zone.height));
      const height = readingHeight(reply.text, zone.width, maxHeight);
      for (let attempt = 0; attempt < 6; attempt++) {
        const spread = Math.max(0, Math.min(40, width - margin - zone.x - zone.width));
        const x = Math.min(width - margin - zone.width, Math.max(margin, zone.x + (random() - 0.5) * spread));
        const y = zone.y + (attempt === 0 ? 0 : attempt === 1 ? 1 : random()) * Math.max(0, zone.height - height);
        const rect = { x, y, width: zone.width, height };
        candidates.push({ rect, maxHeight, score: occupied.reduce((sum, other) => sum + overlap(rect, other), 0) + random() * 10 });
      }
    }
    candidates.sort((a, b) => a.score - b.score);
    const selected = candidates[0] || { rect: { x: margin, y: margin, width: width - margin * 2, height: 36 }, maxHeight: 36 };
    occupied.push(selected.rect);
    return { x: selected.rect.x, y: selected.rect.y, width: selected.rect.width, maxHeight: selected.maxHeight };
  });
}

export function replyLifetime(text: string) {
  return Math.max(6000, Math.min(45_000, Array.from(text).length * 140 + 2400));
}
