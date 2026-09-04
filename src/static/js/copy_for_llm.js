/**
 * Copy for LLM — progressive enhancement.
 * Button stays hidden without JS. Copies embedded Markdown from #llm-md.
 * Press feedback: pointer-down scale via .is-pressed (respects reduced motion).
 */
(function () {
  var button = document.querySelector("[data-copy-for-llm]");
  var source = document.getElementById("llm-md");
  if (!button || !source) {
    return;
  }

  var labelDefault = "Copy for LLM";
  var labelCopied = "Copied";
  var resetTimer = null;
  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  button.hidden = false;

  function setLabel(text) {
    button.textContent = text;
  }

  function clearPressed() {
    button.classList.remove("is-pressed");
  }

  function onSuccess() {
    setLabel(labelCopied);
    if (resetTimer !== null) {
      window.clearTimeout(resetTimer);
    }
    resetTimer = window.setTimeout(
      function () {
        setLabel(labelDefault);
        resetTimer = null;
      },
      reduceMotion ? 900 : 1600
    );
  }

  if (!reduceMotion) {
    button.addEventListener(
      "pointerdown",
      function () {
        button.classList.add("is-pressed");
      },
      { passive: true }
    );
    button.addEventListener(
      "pointerup",
      function () {
        clearPressed();
      },
      { passive: true }
    );
    button.addEventListener(
      "pointercancel",
      function () {
        clearPressed();
      },
      { passive: true }
    );
    button.addEventListener(
      "pointerleave",
      function () {
        clearPressed();
      },
      { passive: true }
    );
  }

  button.addEventListener("click", function () {
    var markdown = source.textContent || "";
    if (!markdown) {
      return;
    }

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(markdown).then(onSuccess).catch(function () {
        // no-op on clipboard failure — page remains readable
      });
      return;
    }

    var area = document.createElement("textarea");
    area.value = markdown;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.left = "-9999px";
    document.body.appendChild(area);
    area.select();
    try {
      if (document.execCommand("copy")) {
        onSuccess();
      }
    } catch (_err) {
      // no-op
    }
    document.body.removeChild(area);
  });
})();
