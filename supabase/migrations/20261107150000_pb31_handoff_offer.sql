-- PB-31 (Eboiz/Documents#32): fewer handoffs.

-- Soft handoff: when the AI has only part of the answer it offers staff instead
-- of handing off. The reason it would have handed off with is kept on the turn,
-- so when the shopper accepts on the next turn the handoff carries that reason
-- (policy_not_covered, not_covered_by_data, size_out_of_range), not
-- asked_for_human. Null: the turn made no offer.
--
-- Only adds a nullable column, so it can run on the shared project before the
-- PB-31 code deploys. engine_search_products is no longer called (search_products
-- ranks in code) but stays until that code is live: the running deployment still
-- calls it. A later migration drops it.
alter table public.ai_turns
  add column if not exists handoff_offer public.handoff_reason;
