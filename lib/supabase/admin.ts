import { createClient } from "@supabase/supabase-js";

/**
 * Server-only client using the secret key. Bypasses Row Level Security,
 * so it must never be imported into client components — only into
 * server actions or route handlers.
 */
export function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    },
  );
}
