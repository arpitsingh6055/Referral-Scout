/* Run as a DevTools Snippet on mail.google.com; see README for commands. */
(() => {
  "use strict";
  function threadId(hash) {
    return /^#(?:sent|all|inbox)\/([A-Za-z0-9_-]{8,})$/.exec(hash)?.[1] ??
      /^#search\/[^/]+\/([A-Za-z0-9_-]{8,})$/.exec(hash)?.[1] ?? null;
  }
  function normalize(text) { return text.replace(/\r\n/g, "\n").replace(/\u00a0/g, " ").trim(); }
  if (typeof module !== "undefined" && module.exports) { module.exports = { threadId, normalize }; return; }
  if (location.hostname !== "mail.google.com") throw new Error("Run on mail.google.com");
  const key = "recruiter.phase0.gmail";
  const visible = e => e.getClientRects().length > 0 && getComputedStyle(e).visibility !== "hidden";
  const find = (root, selectors) => selectors.flatMap(s => [...root.querySelectorAll(s)]).find(visible);
  let cancelled = false, busy = false;
  const get = () => {
    const state = JSON.parse(sessionStorage.getItem(key) || "null");
    if (!state) throw new Error("Run prepare first");
    return state;
  };
  const put = state => sessionStorage.setItem(key, JSON.stringify(state));
  const guard = () => {
    if (cancelled) throw new Error("Cancelled; do not retry an uncertain send");
    if (document.visibilityState !== "visible") throw new Error("Keep Gmail visible during the probe");
    const warnings = [...document.querySelectorAll('[role="alert"], [role="alertdialog"], [role="status"]')].filter(visible).map(e => e.innerText).join(" ");
    if (/sending limit|suspicious activity|unusual activity|too many messages|verify.*identity/i.test(warnings))
      throw new Error("Gmail warning: inspect manually");
  };
  const wait = async (read, timeout = 20000) => {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      guard(); const result = read(); if (result) return result;
      await new Promise(r => setTimeout(r, 250));
    }
    throw new Error("Timed out waiting for the expected Gmail state");
  };
  const verify = async state => {
    const subject = await wait(() => find(document, ['input[name="subjectbox"]']));
    const root = subject.closest('[role="dialog"]') ?? subject.closest("form");
    if (!root) throw new Error("Compose container missing");
    const body = find(root, ['[role="textbox"][contenteditable="true"]', '[contenteditable="true"][aria-label="Message Body"]']);
    const addresses = [...root.querySelectorAll('[email], input[name="to"], input[name="cc"], input[name="bcc"], [data-hovercard-id]')]
      .filter(e => !e.closest('[name="from"], .az2'))
      .map(e => e.getAttribute("email") || e.getAttribute("data-hovercard-id") || e.value || "")
      .filter(v => v.includes("@"));
    if (!addresses.length || addresses.some(v => v.trim().toLowerCase() !== state.email))
      throw new Error("Recipient mismatch or recipient chips unavailable");
    if (subject.value !== state.subject || !body || normalize(body.innerText) !== normalize(state.body))
      throw new Error("Subject/body mismatch; no send attempted");
    const from = find(root, ['select[name="from"]', 'input[name="from"]', '[name="from"]', '.az2']);
    const fromText = from ? (from.value || from.getAttribute("email") || from.innerText) : "";
    const fromAddresses = fromText.match(/[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [];
    if (fromAddresses.length !== 1 || fromAddresses[0].toLowerCase() !== state.email)
      throw new Error("Cannot prove From address. Expose the From line and rerun; never assume the account address is the sender");
    return root;
  };
  const task = async fn => {
    if (busy) throw new Error("Probe already running");
    busy = true; cancelled = false;
    try { const result = await fn(); console.log("GMAIL PROBE", result); return result; }
    catch (e) { const result = { ok: false, error: e.message }; console.error("GMAIL PROBE", result); return result; }
    finally { busy = false; }
  };
  window.recruiterGmailProbe = {
    stop() { cancelled = true; },
    prepare(email, index = 0) {
      if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email) || !Number.isInteger(index) || index < 0)
        throw new Error("Supply your actual Gmail sending address and a nonnegative account index");
      if (sessionStorage.getItem(key)) throw new Error("A probe already exists. Inspect it; use clear() only after reconciling any send");
      const state = { email: email.toLowerCase(), index, subject: `Recruiter feasibility ${crypto.randomUUID()}`,
        body: "This is a self-addressed feasibility test. No outreach campaign is running.", phase: "prepared" };
      put(state);
      const url = new URL(`https://mail.google.com/mail/u/${index}/`);
      url.search = new URLSearchParams({ view: "cm", fs: "1", to: state.email, su: state.subject, body: state.body }).toString();
      location.assign(url.href);
    },
    saveDraft() { return task(async () => {
      const state = get();
      if (!["prepared", "draft_saved"].includes(state.phase)) throw new Error("Probe is already in send/reconciliation state");
      const root = await verify(state);
      const saved = await wait(() => find(root, ['[role="status"]', '.oG'])?.innerText.match(/draft saved|saved to drafts|all changes saved/i) ||
        [...document.querySelectorAll('[role="status"], [role="alert"]')].filter(visible).some(e => /draft saved|saved to drafts|all changes saved/i.test(e.innerText)), 30000);
      state.phase = "draft_saved"; put(state);
      return { ok: Boolean(saved), phase: state.phase, subject: state.subject, note: "Compose left open for the optional self-send" };
    }); },
    sendSelf() { return task(async () => {
      const state = get();
      if (state.phase !== "draft_saved") throw new Error("Run saveDraft successfully first; never retry an uncertain send");
      const root = await verify(state); guard();
      const send = find(root, ['[role="button"][data-tooltip^="Send ("]', '[role="button"][aria-label^="Send ("]', 'button[aria-label="Send"]']);
      if (!send || send.getAttribute("aria-disabled") === "true") throw new Error("Send button missing or disabled");
      state.phase = "send_intent"; put(state);
      send.click();
      await wait(() => [...document.querySelectorAll('[role="alert"], [role="status"], .bAq')].filter(visible).some(e => /message sent/i.test(e.innerText)), 15000);
      state.phase = "sent_confirmed"; put(state);
      return { ok: true, phase: state.phase, next: "Run await recruiterGmailProbe.locate()" };
    }); },
    locate() { return task(async () => {
      const state = get();
      if (!["send_intent", "sent_confirmed", "located"].includes(state.phase)) throw new Error("No send to reconcile");
      location.hash = "#search/" + encodeURIComponent(`in:sent to:${state.email} subject:(${state.subject})`);
      const row = await wait(() => [...document.querySelectorAll('tr.zA, [role="row"]')].filter(visible)
        .find(e => [...e.querySelectorAll('.bog, [data-thread-id]')].some(n => normalize(n.innerText) === state.subject)), 30000);
      row.click();
      const id = await wait(() => threadId(location.hash));
      state.phase = "located"; state.threadId = id; put(state);
      return { ok: true, phase: state.phase, threadId: id, threadUrl: location.href };
    }); },
    status() { return get(); },
    clear() { if (busy) throw new Error("Wait for the probe to finish"); sessionStorage.removeItem(key); }
  };
  console.log("Ready. Use prepare(email, index), saveDraft(), sendSelf(), locate(), status(), stop(), clear() on recruiterGmailProbe.");
})();
