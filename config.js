/* ============================================================
   Brina — the only two values you need to fill in.

   Supabase dashboard → Project Settings → API
     Project URL   →  url
     anon / public →  anonKey

   The anon key is meant to be public. It is safe in this file
   and safe in a git repo. Never put the service_role key here.
   ============================================================ */

window.BRINA_CONFIG = {
  url: 'PASTE_YOUR_SUPABASE_PROJECT_URL_HERE',
  anonKey: 'PASTE_YOUR_SUPABASE_ANON_KEY_HERE'
};

window.BRINA_CONFIG.ready = !/^PASTE_/.test(window.BRINA_CONFIG.url) &&
                            !/^PASTE_/.test(window.BRINA_CONFIG.anonKey);
