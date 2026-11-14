import { searchErrors, type SearchResponse } from "./request";

// State of the shop page's description/photo search (PB-34), kept pure so the
// page logic is tested without a browser. `seq` drops answers that arrive
// after a newer search started.

export type SearchState =
  | { status: "idle" }
  | { status: "loading"; seq: number; label: string }
  | { status: "done"; seq: number; label: string; productIds: string[] }
  | { status: "error"; message: string };

export type SearchResult = { ok: true; body: SearchResponse; hasPhoto: boolean } | { ok: false; message: string };

// Heading above the results (spec copy).
export function searchLabel(text: string, hasPhoto: boolean): string {
  const trimmed = text.trim();
  if (!trimmed && hasPhoto) return "Kết quả tìm bằng ảnh";
  return `Kết quả cho “${trimmed}”`;
}

export function applyResult(state: SearchState, seq: number, result: SearchResult): SearchState {
  if (state.status !== "loading" || state.seq !== seq) return state;
  if (!result.ok) return { status: "error", message: result.message };
  if (result.body.mode === "semantic") {
    return { status: "done", seq, label: state.label, productIds: result.body.productIds };
  }
  // Service off or slow (AC4): a text search keeps the instant filter with no
  // error; a photo has no fallback, so it says so.
  return result.hasPhoto ? { status: "error", message: searchErrors.photoUnavailable } : { status: "idle" };
}
