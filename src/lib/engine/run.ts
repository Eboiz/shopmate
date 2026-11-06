import "server-only";
import type { EngineInput, EngineOutput } from "@/contract";

// The AI engine (PB-03). Channels call this one function; PB-03 replaces the body.
// Until then every call fails, and the channel hands the conversation to staff.
export async function runEngine(input: EngineInput): Promise<EngineOutput> {
  void input;
  throw new Error("not_implemented: the AI engine is built in PB-03");
}
