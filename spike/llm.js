/* Run as a DevTools Snippet in a fresh Gemini or ChatGPT chat. */
(() => {
  "use strict";
  function parseReply(text) {
    const value = JSON.parse(text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, ""));
    if (!value || Array.isArray(value) || Object.keys(value).length !== 1 || value.ok !== true)
      throw new Error("Expected exactly {\"ok\":true}");
    return value;
  }
  if (typeof module !== "undefined" && module.exports) { module.exports = { parseReply }; return; }
  const provider = location.hostname === "gemini.google.com" ? "gemini" :
    location.hostname === "chatgpt.com" ? "chatgpt" : null;
  if (!provider) throw new Error("Run only on gemini.google.com or chatgpt.com");
  const selectors = provider === "gemini" ? {
    composer: ['rich-textarea [contenteditable="true"]', '[role="textbox"][contenteditable="true"]'],
    send: ['button[aria-label="Send message"]', 'button[aria-label="Send"]', 'button.send-button'],
    stop: ['button[aria-label*="Stop"]', 'button[aria-label*="stop"]'],
    replies: ['model-response .markdown', 'model-response message-content', 'model-response']
  } : {
    composer: ['#prompt-textarea[contenteditable="true"]', '.ProseMirror[contenteditable="true"]', 'textarea#prompt-textarea'],
    send: ['button[data-testid="send-button"]', 'button[aria-label="Send prompt"]', 'button[aria-label="Send message"]'],
    stop: ['button[data-testid="stop-button"]', 'button[aria-label*="Stop"]'],
    replies: ['[data-message-author-role="assistant"] .markdown', '[data-message-author-role="assistant"]']
  };
  const visible = e => e.getClientRects().length > 0 && getComputedStyle(e).visibility !== "hidden";
  const find = list => list.flatMap(s => [...document.querySelectorAll(s)]).find(visible);
  const replies = () => {
    for (const s of selectors.replies) {
      const nodes = [...document.querySelectorAll(s)].filter(visible);
      if (nodes.length) return nodes;
    }
    return [];
  };
  let running = false, cancelled = false;
  const guard = () => {
    if (cancelled) throw new Error("Cancelled; an already submitted prompt may still finish");
    if (document.visibilityState !== "visible") throw new Error("Keep this tab visible during the probe");
    if (/captcha|verify you are human|unusual activity|too many requests|usage limit|you.ve reached.*limit/i.test(document.body.innerText))
      throw new Error("Provider warning detected; stop and inspect the page manually");
  };
  window.recruiterLLMProbe = {
    stop() { cancelled = true; },
    async run() {
      if (running) throw new Error("Probe already running");
      running = true; cancelled = false;
      const started = performance.now();
      let stage = "preflight";
      try {
        guard();
        if (replies().length || find(selectors.stop)) throw new Error("Open a fresh empty chat first");
        const editor = find(selectors.composer);
        if (!editor) throw new Error("Composer missing: check login and selectors");
        if ((editor.value ?? editor.innerText).trim()) throw new Error("Composer must be empty");
        const prompt = 'Reply with JSON {"ok":true}';
        stage = "insert"; editor.focus();
        document.execCommand("insertText", false, prompt);
        editor.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: prompt }));
        if ((editor.value ?? editor.innerText).trim() !== prompt) throw new Error("Full prompt insertion failed");
        await new Promise(r => setTimeout(r, 500)); guard();
        const send = find(selectors.send);
        if (!send || send.disabled || send.getAttribute("aria-disabled") === "true") throw new Error("Send control missing or disabled");
        stage = "awaiting_reply"; send.click();
        const submitted = performance.now();
        let last = "", changed = submitted, firstTokenMs = null;
        while (performance.now() - submitted < 90000) {
          await new Promise(r => setTimeout(r, 500)); guard();
          const text = replies().at(-1)?.innerText.trim() ?? "";
          const now = performance.now();
          if (text && firstTokenMs === null) firstTokenMs = Math.round(now - submitted);
          if (text !== last) { last = text; changed = now; }
          if (firstTokenMs === null && now - submitted > 20000) throw new Error("No first token within 20 seconds");
          if (text && !find(selectors.stop) && now - changed >= 3000) {
            stage = "parse";
            const report = { ok: true, provider, reply: parseReply(text), firstTokenMs, durationMs: Math.round(now - started) };
            console.log("LLM PROBE", report); return report;
          }
        }
        throw new Error("Reply did not finish within 90 seconds");
      } catch (error) {
        const report = { ok: false, provider, stage, error: error.message, durationMs: Math.round(performance.now() - started) };
        console.error("LLM PROBE", report); return report;
      } finally { running = false; }
    }
  };
  console.log("Ready. Run: await recruiterLLMProbe.run(). Cancel: recruiterLLMProbe.stop()");
})();
