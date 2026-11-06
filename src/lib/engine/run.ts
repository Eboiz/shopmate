import "server-only";
import { after } from "next/server";
import type { EngineInput, EngineOutput } from "@/contract";
import { runEngine as runEngineTurn } from "./engine";

// The one function channels call (PB-15 Messenger, the web chat, ...): same name
// and place as the placeholder PB-15 shipped, so the channel code does not change.
//
// The reply is ready as soon as this resolves. The ai_turns write and the
// Langfuse send keep running after the response (after()), because on serverless
// the process may stop before they finish. When the turn handed the conversation
// to staff, the reply is HANDOFF_TEXT: the channel sends it as a system message,
// so nothing else needs to be sent here.
export async function runEngine(input: EngineInput): Promise<EngineOutput> {
  const { output, turnLogged } = await runEngineTurn(input);
  try {
    after(turnLogged);
  } catch {
    // Not inside a request (a script, a test): turnLogged never rejects, let it finish on its own.
    void turnLogged;
  }
  return output;
}
