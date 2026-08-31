/**
 * Minimal local auth types. These replace the shapes previously imported
 * from `@supabase/supabase-js` so the app no longer depends on Supabase.
 */

export interface User {
  id: string;
  email?: string;
  app_metadata: Record<string, unknown>;
  user_metadata: Record<string, unknown> & { full_name?: string };
  aud: string;
  created_at: string;
}

export interface Session {
  user: User;
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
}
