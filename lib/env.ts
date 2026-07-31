function required(value: string | undefined, name: string) {
  value = value?.trim();
  if (!value) throw new Error(`${name} is not configured.`);
  return value;
}

export function publicSupabaseEnv() {
  return {
    url: required(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      "NEXT_PUBLIC_SUPABASE_URL",
    ),
    publishableKey: required(
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    ),
  };
}

export function serverSupabaseEnv() {
  return {
    ...publicSupabaseEnv(),
    secretKey: required(process.env.SUPABASE_SECRET_KEY, "SUPABASE_SECRET_KEY"),
  };
}

export function registrationRateLimitSecret() {
  return (
    process.env.REGISTRATION_RATE_LIMIT_SECRET?.trim() ||
    serverSupabaseEnv().secretKey
  );
}
