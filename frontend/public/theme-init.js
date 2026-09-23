// Runs synchronously before first paint to avoid a flash of the wrong theme.
// Kept as a classic (non-module) same-origin script so it needs no CSP script-src exception.
;(function () {
  try {
    var pref = localStorage.getItem('nook-theme') || 'system'
    if (pref === 'light' || pref === 'dark') {
      document.documentElement.setAttribute('data-theme', pref)
    }
  } catch (e) {
    /* localStorage unavailable (private mode, blocked storage) — fall back to system */
  }
  try {
    var skin = localStorage.getItem('nook-theme-skin')
    if (skin === 'telegram' || skin === 'github' || skin === 'material') {
      document.documentElement.setAttribute('data-theme-skin', skin)
    }
  } catch (e) {
    /* localStorage unavailable — fall back to the default skin */
  }
})()
