-- migrate:up
-- Q-3 (P2-W9-S08): "anomalies are pulled for review". The weekly recalibration queues a
-- question almost everyone gets right (over 98%) or wrong (under 20%) once it has 30
-- answers, beside the sample and flagged reasons.
alter type review_reason add value if not exists 'anomaly';

-- migrate:down
-- Postgres can't drop an enum value; 'anomaly' stays, unused.
