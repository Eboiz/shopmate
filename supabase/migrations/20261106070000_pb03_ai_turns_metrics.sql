-- PB-03 (Eboiz/Documents#3): engine metrics read straight from ai_turns.
-- Additive only: no existing column, enum or policy changes, and rows written
-- before this migration stay valid (null / 0 = unknown).
alter table public.ai_turns
  -- Start of the turn to the first text token of the last model response (what
  -- the shopper reads). Null when the model didn't write the reply (handoff,
  -- truncated) and on older rows.
  add column ttft_ms integer check (ttft_ms >= 0),
  -- 0 = unknown (rows from before this migration); every PB-03 row has >= 1.
  add column model_calls integer not null default 0 check (model_calls >= 0),
  add column model text,
  add column prompt_version text;
