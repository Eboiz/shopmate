import { NextResponse } from "next/server";
import { engineInputSchema, type EngineInput } from "@/contract";
import { runEngine } from "@/lib/engine/engine";
import { createLangfuseSink } from "@/lib/engine/langfuse";
import type { TurnMetrics } from "@/lib/engine/metrics";
import { createAdminClient } from "@/lib/supabase/admin";

// DEV ONLY: a manual test bench for the AI engine. It runs with the secret key
// and takes the shop from the request, so it must never exist in production.
const off = () => process.env.NODE_ENV === "production";

export async function POST(request: Request) {
  if (off()) return new NextResponse(null, { status: 404 });

  const body = (await request.json()) as {
    mode: "customer" | "staff_draft";
    history: Array<{ sender: "shopper" | "ai"; text: string }>;
    productId?: string | null;
    conversationId?: string | null;
    shopSlug?: string;
  };
  const db = createAdminClient();

  // The demo shop unless a slug is given. The "-eval" shop is for engine:eval.
  const shopQuery = db.from("shops").select("id, slug");
  const { data: shops, error: shopError } = body.shopSlug
    ? await shopQuery.eq("slug", body.shopSlug)
    : await shopQuery.not("slug", "like", "%-eval").order("created_at").limit(1);
  const shop = shops?.[0];
  if (shopError || !shop) return NextResponse.json({ error: "shop not found, run pnpm db:seed" }, { status: 400 });

  let conversationId = body.conversationId ?? null;
  let input: EngineInput;
  if (body.mode === "customer") {
    if (!conversationId) {
      const { data: shopper, error: e1 } = await db
        .from("shoppers")
        .insert({ shop_id: shop.id, channel: "web", external_id: `dev-${crypto.randomUUID()}`, display_name: "Dev tester" })
        .select("id")
        .single();
      if (e1) return NextResponse.json({ error: `shoppers: ${e1.message}` }, { status: 500 });
      const { data: conv, error: e2 } = await db
        .from("conversations")
        .insert({ shop_id: shop.id, shopper_id: shopper.id })
        .select("id")
        .single();
      if (e2) return NextResponse.json({ error: `conversations: ${e2.message}` }, { status: 500 });
      conversationId = conv.id;
    }
    input = { mode: "customer", conversationId: conversationId!, history: body.history, productId: body.productId };
  } else {
    input = { mode: "staff_draft", history: body.history, productId: body.productId };
  }

  let metrics: TurnMetrics | null = null;
  const langfuse = createLangfuseSink(); // passing onMetrics replaces the engine's default sink, so add it back
  try {
    const parsed = engineInputSchema.parse(input);
    const result = await runEngine(parsed, {
      db,
      staffShopId: body.mode === "staff_draft" ? shop.id : undefined,
      onMetrics: (m) => {
        metrics = m;
        console.info(JSON.stringify(m));
        return langfuse?.(m);
      },
    });
    // Dev: wait for the ai_turns write (and Langfuse) so the next look at the DB is current.
    const turnId = await result.turnLogged;
    const { data: conv } = conversationId
      ? await db.from("conversations").select("mode").eq("id", conversationId).single()
      : { data: null };
    return NextResponse.json({
      reply: result.output.reply,
      personalReplyNeeded: result.output.personalReplyNeeded,
      handoffReason: result.handoffReason,
      conversationId,
      conversationMode: conv?.mode ?? null,
      turnId,
      shop: shop.slug,
      metrics,
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? `${e.name}: ${e.message}` : String(e) }, { status: 500 });
  }
}
