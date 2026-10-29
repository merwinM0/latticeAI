import characterUrl from "./generated/character.bin" with { type: "file" };
import { decodeCharacter, type CharacterModel } from "./data";

let pending: Promise<CharacterModel> | null = null;

/** Shared across StrictMode mounts, GPU fallback and resize; failed loads can retry. */
export function loadCharacter(): Promise<CharacterModel> {
  if (!pending) {
    pending = (async () => {
      const response = await fetch(characterUrl, { cache: "force-cache" });
      if (!response.ok) throw new Error("角色素材加载失败，请重试。");
      return decodeCharacter(await response.arrayBuffer());
    })().catch((error) => { pending = null; throw error; });
  }
  return pending;
}
