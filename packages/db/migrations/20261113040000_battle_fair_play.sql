-- migrate:up
-- P5-W31-S04a (§6.9, Q-P5-17): one outside paste of 200 or more characters flags a
-- battle's player for review, so a flag may rest on a single signal. Quick games still
-- flag at 3 (the worker's rule, Q-P3-20).
alter table fair_play_flag drop constraint fair_play_flag_signals_check;
alter table fair_play_flag add constraint fair_play_flag_signals_check check (signals >= 1);

-- migrate:down
alter table fair_play_flag drop constraint fair_play_flag_signals_check;
alter table fair_play_flag add constraint fair_play_flag_signals_check check (signals >= 3);
