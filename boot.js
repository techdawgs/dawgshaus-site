(() => {
  // ===== Footer year =====
  const y = document.getElementById("y");
  if (y) y.textContent = new Date().getFullYear();

  // ===== Matrix rain (ASCII only) =====
  const rain = document.getElementById("rain");
  const glyphs = "01abcdef6789$#%*+-=<>[]{}()";
  const maxColumns = 36;

  function buildRain() {
    if (!rain) return;
    rain.innerHTML = "";
    const columns = Math.min(maxColumns, Math.max(18, Math.floor(window.innerWidth / 40)));

    for (let i = 0; i < columns; i++) {
      const span = document.createElement("span");
      const length = Math.floor(14 + Math.random() * 28);
      let text = "";

      for (let j = 0; j < length; j++) {
        text += glyphs[Math.floor(Math.random() * glyphs.length)] + "\n";
      }
      span.textContent = text;

      span.style.left = (i / columns) * 100 + "%";
      span.style.animationDuration = (7 + Math.random() * 11) + "s";
      span.style.animationDelay = (-Math.random() * 10) + "s";
      span.style.fontSize = (12 + Math.random() * 4) + "px";
      span.style.opacity = (0.10 + Math.random() * 0.28).toFixed(2);

      rain.appendChild(span);
    }
  }

  buildRain();
  window.addEventListener("resize", () => {
    clearTimeout(window.__rainResize);
    window.__rainResize = setTimeout(buildRain, 250);
  });

  // ===== Cinematic boot sequence (decryption + glitch) =====
  const boot = document.getElementById("boot");
  const bootLinesEl = document.getElementById("bootLines");
  const bootBox = document.getElementById("bootBox");

  if (!boot || !bootLinesEl || !bootBox) return;

  // Boot should only run once per tab/session
  const BOOT_KEY = "DawgsHausBootSeen";

  function skipBootIfSeen() {
    try {
      if (sessionStorage.getItem(BOOT_KEY) === "1") {
        boot.classList.add("hidden");
        // Remove quickly so it doesn't intercept clicks
        setTimeout(() => boot.remove(), 10);
        return true;
      }
    } catch (_) {}
    return false;
  }

  // If already seen, do not run boot typing again
  if (skipBootIfSeen()) return;

  function glitch() {
    bootBox.classList.add("glitch");
    setTimeout(() => bootBox.classList.remove("glitch"), 240);
  }

  function randHex(n) {
    const chars = "0123456789abcdef";
    let out = "";
    for (let i = 0; i < n; i++) out += chars[(Math.random() * chars.length) | 0];
    return out;
  }

  const phases = [
    { label: "booting DawgsHaus kernel v0.2 …", glitch: false },
    { label: "mount /apps -> ready", glitch: false },
    { label: "mount /agents -> ready", glitch: false },
    { label: "link github.remote -> ok", glitch: false },
    { label: "handshake tls -> pending", glitch: true },

    { label: "decrypting payload [stage 1/3] …", glitch: true, decrypt: 22 },
    { label: "decrypting payload [stage 2/3] …", glitch: true, decrypt: 28 },
    { label: "decrypting payload [stage 3/3] …", glitch: true, decrypt: 34 },

    { label: "dns route -> verified", glitch: false },
    { label: "encryption layer -> active", glitch: false },
    { label: "status -> ONLINE", glitch: true },
    { label: "", glitch: false },
    { label: "press any key to continue …", glitch: false, caret: true }
  ];

  function appendLine(text) {
    bootLinesEl.textContent += (bootLinesEl.textContent ? "\n" : "") + text;
  }

  function typeLine(text, speedMin = 14, speedMax = 28) {
    return new Promise((resolve) => {
      let i = 0;
      const timer = () => {
        bootLinesEl.textContent += text[i] || "";
        i++;
        if (i <= text.length) {
          setTimeout(timer, speedMin + Math.random() * (speedMax - speedMin));
        } else {
          resolve();
        }
      };
      timer();
    });
  }

  function decryptBurst(chars = 24, bursts = 10) {
    return new Promise((resolve) => {
      let count = 0;
      const go = () => {
        if (count === 0) appendLine("");
        const lines = bootLinesEl.textContent.split("\n");
        lines[lines.length - 1] = randHex(chars);
        bootLinesEl.textContent = lines.join("\n");

        if (count % 2 === 0) glitch();
        count++;

        if (count < bursts) {
          setTimeout(go, 55 + Math.random() * 55);
        } else {
          resolve();
        }
      };
      go();
    });
  }

  function removeExistingBootCaret() {
    const existing = bootLinesEl.querySelector(".bootCaret");
    if (existing) existing.remove();
  }

  async function runBoot() {
    bootLinesEl.textContent = "";

    for (const p of phases) {
      if (p.glitch) glitch();

      if (p.label) {
        if (bootLinesEl.textContent) bootLinesEl.textContent += "\n";
        await typeLine(p.label, 12, 24);

        if (p.caret) {
          // IMPORTANT: don't touch textContent after this, or caret gets removed
          removeExistingBootCaret();
          const caret = document.createElement("span");
          caret.className = "bootCaret";
          bootLinesEl.appendChild(caret);
        }
      } else {
        appendLine("");
      }

      if (p.decrypt) {
        await decryptBurst(p.decrypt, 12);
        appendLine("decryption -> ok");
      }

      await new Promise((r) => setTimeout(r, 90 + Math.random() * 120));
    }
  }

  function finishBoot() {
    if (!boot || boot.classList.contains("hidden")) return;

    try { sessionStorage.setItem(BOOT_KEY, "1"); } catch (_) {}

    boot.classList.add("hidden");
    setTimeout(() => boot.remove(), 900);
  }

  // Wait for key/click to dismiss (no auto-dismiss)
  function continueBoot() { finishBoot(); }
  window.addEventListener("keydown", continueBoot, { once: true });
  window.addEventListener("pointerdown", continueBoot, { once: true });

  runBoot();
})();
