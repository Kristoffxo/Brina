/* ============================================================
   Brina — Supabase connection.

   This is the publishable key. It is designed to be public: it
   is in this file, in the git repo, and visible to anyone who
   views source. That is fine and intended.

   The secret key (sb_secret_… / service_role) must never appear
   here or anywhere in this folder.
   ============================================================ */

window.BRINA_CONFIG = {
  url: 'https://yelznjutyfzgfqroqgrk.supabase.co',
  anonKey: 'sb_publishable_3xGrF9pSv0Q_QyDOKywmJA_3plo1gQ_'
};

window.BRINA_CONFIG.ready = !/^PASTE_/.test(window.BRINA_CONFIG.url) &&
                            !/^PASTE_/.test(window.BRINA_CONFIG.anonKey);
