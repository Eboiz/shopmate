import "server-only";
import { after } from "next/server";
import type { EngineInput, EngineOutput } from "@/contract";
import { requireStaff } from "@/lib/auth";
import { runEngine as runEngineTurn, type EngineResult } from "./engine";

// The one function channels call (PB-15 Messenger, the web chat, ...): same name
// and place as the placeholder PB-15 shipped, so the channel code does not change.
//
// The reply is ready as soon as this resolves. The ai_turns write and the
// Langfuse send keep running after the response (after()), because on serverless
// the process may stop before they finish. When the turn handed the conversation
// to staff, the reply is HANDOFF_TEXT: the channel sends it as a system message,
// so nothing else needs to be sent here.
export async function runEngine(input: EngineInput): Promise<EngineOutput> {
  return finish(await runEngineTurn(input));
}

// A customer turn for the channels (receive.ts): the reply, plus what R3 needs
// when a newer shopper message arrived meanwhile (send the reply anyway after
// an order write, else mark the logged turn superseded).
export type CustomerTurn = Pick<EngineResult, "output" | "orderAttempted" | "turnLogged">;

export async function runCustomerTurn(input: Extract<EngineInput, { mode: "customer" }>): Promise<CustomerTurn> {
  const result = await runEngineTurn(input);
  finish(result);
  return { output: result.output, orderAttempted: result.orderAttempted, turnLogged: result.turnLogged };
}

// The reply assistant (PB-20). The input carries no shop; it comes from the
// signed-in staff member's profile (requireStaff), never from the request.
// Redirects to the login page when nobody is signed in.
export async function runStaffDraft(input: Extract<EngineInput, { mode: "staff_draft" }>): Promise<EngineOutput> {
  const { shopId } = await requireStaff();
  return finish(await runEngineTurn(input, { staffShopId: shopId }));
}

function finish({ output, turnLogged }: EngineResult): EngineOutput {
  try {
    after(turnLogged);
  } catch {
    // Not inside a request (a script, a test): turnLogged never rejects, let it finish on its own.
    void turnLogged;
  }
  return output;
}
