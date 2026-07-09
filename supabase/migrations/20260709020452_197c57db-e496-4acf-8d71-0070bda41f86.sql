
REVOKE EXECUTE ON FUNCTION public.generate_affiliate_code() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.process_lemon_squeezy_event(text, text, text, uuid, text, text, text, text, text, timestamptz, timestamptz, timestamptz, boolean, boolean, integer) FROM PUBLIC, anon, authenticated;
