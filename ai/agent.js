(() => {
  // =========================
  // Agent Alpha Configuration
  // =========================

  // Replace this once your Cloudflare Worker is deployed:
  // Example: "https://agent-alpha.YOURNAME.workers.dev/api/agent"
 const WORKER_ENDPOINT = "https://agent-alpha.techdawgs.workers.dev/api/agent";

  // Session-only memory key
  const SESSION_KEY = "dawgshaus_agent_alpha_session_v1";

  // Minimal "persona" seed (we'll refine later)
  const SYSTEM_HINT =
    "You are Agent Alpha for DawgsHaus. You help users explore projects and answer technical questions. " +
    "Keep responses concise, practical, and terminal-friendly.";

  // =========================
  // DOM
  // =========================
  const screen = document.getElementById("screen");
  const form = document.getElementById("promptForm");
  const input = document.getElementById("promptInput");
  const btnSend = document.getElementById("btnSend");
  const btnClear = document.getElementById("btnClear");
  const btnReset = document.getElementById("btnReset");

  // =========================
  // Session Memory (per session)
  // =========================
  function loadSession() {
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      if (!raw) return { messages: [] };
      const parsed = JSON.parse(raw);
      if (!parsed || !Array.isArray(parsed.messages)) return { messages: [] };
      return parsed;
    } catch {
      return { messages: [] };
    }
  }

  function saveSession(state) {
    try {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(state));
    } catch {
      // ignore
    }
  }

  let session = loadSession();

  // =========================
  // UI Helpers
  // =========================
  function nowStamp() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }

  function appendLine(text, className) {
    const p = document.createElement("div");
    p.className = `line ${className || ""}`.trim();
    p.textContent = text;
    screen.appendChild(p);
    scrollToBottom();
    return p;
  }

  function appendRichLine(parts, className) {
    // parts: [{text, cls}]
    const p = document.createElement("div");
    p.className = `line ${className || ""}`.trim();
    for (const part of parts) {
      const span = document.createElement("span");
      if (part.cls) span.className = part.cls;
      span.textContent = part.text;
      p.appendChild(span);
    }
    screen.appendChild(p);
    scrollToBottom();
    return p;
  }

  function scrollToBottom() {
    screen.scrollTop = screen.scrollHeight;
  }

  function setBusy(isBusy) {
    screen.setAttribute("aria-busy", isBusy ? "true" : "false");
    input.disabled = isBusy;
    btnSend.disabled = isBusy;
  }

  function autosizeTextarea(el) {
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 180) + "px";
  }

  // =========================
  // Commands
  // =========================
  function handleCommand(cmdRaw) {
    const cmd = cmdRaw.trim().toLowerCase();

    if (cmd === "/help") {
      appendLine("Commands:", "meta");
      appendLine("  /help        Show commands", "meta");
      appendLine("  /about       What is Agent Alpha", "meta");
      appendLine("  /status      Show session status", "meta");
      appendLine("  /clear       Clear screen (does not reset memory)", "meta");
      appendLine("  /reset       Reset session memory + screen", "meta");
      return true;
    }

    if (cmd === "/about") {
      appendLine("Agent Alpha is a DawgsHaus demo assistant. Public, session-memory only. Backend will run via Cloudflare Worker.", "meta");
      return true;
    }

    if (cmd === "/status") {
      const count = session.messages.length;
      appendLine(`Status @ ${nowStamp()}`, "meta");
      appendLine(`  Session messages stored: ${count}`, "meta");
      appendLine(`  Worker endpoint: ${WORKER_ENDPOINT ? WORKER_ENDPOINT : "(mock mode)"}`, "meta");
      return true;
    }

    if (cmd === "/clear") {
      screen.innerHTML = "";
      bootBanner(false);
      return true;
    }

    if (cmd === "/reset") {
      session = { messages: [] };
      saveSession(session);
      screen.innerHTML = "";
      bootBanner(true);
      return true;
    }

    return false;
  }

  // =========================
  // Network
  // =========================
  async function callAgentAPI(userText) {
    // Build request payload. The Worker will translate this into an OpenAI call.
    const payload = {
      system: SYSTEM_HINT,
      // Session-only memory: we send the whole conversation so far.
      // (Later we can truncate/summarize to control token use.)
      messages: session.messages,
      user: userText
    };

    // Mock mode (until Worker exists)
    if (!WORKER_ENDPOINT) {
      await new Promise((r) => setTimeout(r, 400));
      return `MOCK: Received "${userText}".\n\nNext: deploy the Cloudflare Worker and set WORKER_ENDPOINT in /ai/agent.js.`;
    }

    const res = await fetch(WORKER_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(`Endpoint error (${res.status}): ${txt || res.statusText}`);
    }

    const data = await res.json();
    if (!data || typeof data.reply !== "string") {
      throw new Error("Malformed response from endpoint (expected JSON with { reply: string }).");
    }

    return data.reply;
  }

  // =========================
  // Render history
  // =========================
  function renderHistory() {
    screen.innerHTML = "";
    bootBanner(false);

    for (const m of session.messages) {
      if (m.role === "user") {
        appendRichLine(
          [{ text: "> ", cls: "promptmark" }, { text: m.content, cls: "" }],
          "user"
        );
      } else if (m.role === "assistant") {
        appendRichLine(
          [{ text: "alpha: ", cls: "label" }, { text: m.content, cls: "" }],
          "assistant"
        );
      }
    }
  }

  // =========================
  // Boot banner
  // =========================
  function bootBanner(isReset) {
    appendLine(`Agent Alpha Console ${isReset ? "(session reset)" : ""}`, "meta");
    appendLine(`Time: ${nowStamp()}`, "meta");
    appendLine(`Mode: ${WORKER_ENDPOINT ? "live" : "mock"} • Memory: session-only`, "meta");
    appendLine(`Type /help for commands.`, "meta");
    appendLine("", "meta");
  }

  // =========================
  // Events
  // =========================
  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const text = input.value.trim();
    if (!text) return;

    // Commands
    if (text.startsWith("/")) {
      appendRichLine([{ text: "> ", cls: "promptmark" }, { text }], "user");
      input.value = "";
      autosizeTextarea(input);
      const handled = handleCommand(text);
      if (!handled) {
        appendLine("Unknown command. Try /help", "error");
      }
      return;
    }

    // Print user line
    appendRichLine([{ text: "> ", cls: "promptmark" }, { text }], "user");

    // Save to session memory
    session.messages.push({ role: "user", content: text });
    saveSession(session);

    // Thinking line
    const thinking = appendRichLine([{ text: "alpha: thinking", cls: "" }], "assistant");
    thinking.classList.add("thinking");

    setBusy(true);
    input.value = "";
    autosizeTextarea(input);

    try {
      const reply = await callAgentAPI(text);

      // Replace thinking with final
      thinking.classList.remove("thinking");
      thinking.textContent = ""; // clear
      thinking.className = "line assistant";

      // Render assistant prefix + content
      const label = document.createElement("span");
      label.className = "label";
      label.textContent = "alpha: ";
      const content = document.createElement("span");
      content.textContent = reply;

      thinking.appendChild(label);
      thinking.appendChild(content);

      // Save assistant to memory
      session.messages.push({ role: "assistant", content: reply });
      saveSession(session);
    } catch (err) {
      thinking.classList.remove("thinking");
      thinking.className = "line error";
      thinking.textContent = `Error: ${err?.message || String(err)}`;
    } finally {
      setBusy(false);
      input.focus();
      scrollToBottom();
    }
  });

  input.addEventListener("input", () => autosizeTextarea(input));

  input.addEventListener("keydown", (e) => {
    // Enter to submit, Shift+Enter for newline
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      form.requestSubmit();
    }
  });

  btnClear.addEventListener("click", () => {
    screen.innerHTML = "";
    bootBanner(false);
    input.focus();
  });

  btnReset.addEventListener("click", () => {
    session = { messages: [] };
    saveSession(session);
    screen.innerHTML = "";
    bootBanner(true);
    input.focus();
  });

  // =========================
  // Init
  // =========================
  renderHistory();
  input.focus();
  autosizeTextarea(input);
})();
