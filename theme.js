/* ============================================================
   Brina — light/dark toggle.

   Default is still the visitor's system setting, same as before.
   Clicking the toggle stores an explicit override in localStorage
   that wins from then on, on that device, until they toggle again.
   Runs before anything else so there's no flash of the wrong theme.
   ============================================================ */

(function () {
  'use strict';

  var KEY = 'brina.theme';

  function apply(theme) {
    if (theme === 'light' || theme === 'dark') {
      document.documentElement.setAttribute('data-theme', theme);
    } else {
      document.documentElement.removeAttribute('data-theme');
    }
  }

  var saved = null;
  try { saved = localStorage.getItem(KEY); } catch (e) {}
  apply(saved);

  document.addEventListener('DOMContentLoaded', function () {
    var btn = document.getElementById('theme-toggle');
    if (!btn) return;

    function systemPrefersDark() {
      return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    }

    function currentlyDark() {
      var explicit = document.documentElement.getAttribute('data-theme');
      if (explicit === 'dark') return true;
      if (explicit === 'light') return false;
      return systemPrefersDark();
    }

    btn.addEventListener('click', function () {
      var next = currentlyDark() ? 'light' : 'dark';
      apply(next);
      try { localStorage.setItem(KEY, next); } catch (e) {}
    });
  });
}());
