/**
 * Progressive enhancement only — login/consent forms work without JS.
 * Press feedback is primarily CSS :active; this adds a brief class for
 * environments where :active is unreliable (some touch browsers).
 */
(function () {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    return;
  }

  document.addEventListener(
    "pointerdown",
    function (event) {
      var target = event.target;
      if (!(target instanceof Element)) return;
      var btn = target.closest(".btn");
      if (!btn) return;
      btn.classList.add("is-pressed");
    },
    { passive: true }
  );

  document.addEventListener(
    "pointerup",
    function () {
      document.querySelectorAll(".btn.is-pressed").forEach(function (btn) {
        btn.classList.remove("is-pressed");
      });
    },
    { passive: true }
  );
})();
