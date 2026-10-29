import type { ChatMessage, Emotion } from "../../shared/types";

interface ContextTurn {
  user: string;
  bubbles: string[];
  emotion: Emotion;
  status: string;
}

/** Keep complete turns only, with the exact serialized size bounded for the API. */
export function createContext(turns: readonly ContextTurn[], text: string): ChatMessage[] {
  const completed = turns.filter((turn) => turn.status === "complete").slice(-18);
  const selected: ChatMessage[][] = [];
  let length = text.length;
  for (const turn of completed.reverse()) {
    const answer = JSON.stringify({ emotion: turn.emotion, messages: turn.bubbles });
    const size = turn.user.length + answer.length;
    if (answer.length > 10_000 || length + size > 18_000) break;
    selected.unshift([{ role: "user", content: turn.user }, { role: "assistant", content: answer }]);
    length += size;
  }
  return [...selected.flat(), { role: "user", content: text }];
}
