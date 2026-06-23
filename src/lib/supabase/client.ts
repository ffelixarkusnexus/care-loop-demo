import { createBrowserClient } from "@supabase/ssr";

/** Browser Supabase client (anon key). Used for sign-in and invoking the edge function. */
export function createSupabaseBrowserClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
