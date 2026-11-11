-- PB-31 (Eboiz/Documents#32): fewer handoffs.

-- Soft handoff: when the AI has only part of the answer it offers staff instead
-- of handing off. The reason it would have handed off with is kept on the turn,
-- so when the shopper accepts on the next turn the handoff carries that reason
-- (policy_not_covered, not_covered_by_data, size_out_of_range), not
-- asked_for_human. Null: the turn made no offer.
alter table public.ai_turns
  add column handoff_offer public.handoff_reason;

-- search_products now ranks the shop's products in code (exact / close matches,
-- synonyms), so the SQL search is no longer called.
drop function if exists public.engine_search_products(uuid, text, int);
