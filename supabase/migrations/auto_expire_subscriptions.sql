-- Auto-expire Subscriptions Migration & Maintenance Function

-- 1. Immediate update for any currently expired subscriptions
UPDATE public.subscriptions
SET status = 'expired', updated_at = now()
WHERE status = 'active'
  AND current_period_end IS NOT NULL
  AND current_period_end < now();

-- 2. Optional function to run periodically via pg_cron (if pg_cron extension is enabled)
CREATE OR REPLACE FUNCTION public.expire_outdated_subscriptions()
RETURNS void AS $$
BEGIN
    UPDATE public.subscriptions
    SET status = 'expired', updated_at = now()
    WHERE status = 'active'
      AND current_period_end IS NOT NULL
      AND current_period_end < now();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
