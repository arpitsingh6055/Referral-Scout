/* Page hooks that are not about meaning. LinkedIn pages are read by role, label and text (see parsers/network.ts);
   only sign-in and security-check detection is listed here. ChatGPT's composer has stable hooks, kept in one place. */
export const selectors = {
  linkedin: {
    login: ['input#username', 'input[name="session_key"]', 'form[action*="login-submit"]'],
    challenge: ['iframe[src*="captcha"]', '#captcha-internal', 'form[action*="checkpoint/challenge"]'],
  },
  /*
   * Gmail is read by role, label and its long-stable structural hooks. Gmail's visual class names are generated
   * and change; the attributes below (gh, role, aria-label, name) have been stable for years and are what the
   * page's own accessibility layer depends on, so they move far less often than anything else on the page.
   */
  gmail: {
    login: ['form#gaia_loginform', 'input[type="email"][name="identifier"]', 'a[href*="accounts.google.com/ServiceLogin"]'],
    challenge: ['iframe[src*="recaptcha"]', '#captchaimg', 'form[action*="challenge"]'],
    compose: ['[gh="cm"]', 'div[role="button"][aria-label*="Compose" i]'],
    composeDialog: ['div[role="dialog"]:has(input[name="subjectbox"])', 'div.nH.Hd[role="dialog"]', 'div[role="dialog"]'],
    to: ['input[name="to"]', 'input[aria-label="To recipients"]', 'textarea[name="to"]', 'input[peoplekit-id]'],
    subject: ['input[name="subjectbox"]', 'input[aria-label="Subject"]'],
    body: ['div[aria-label="Message Body"][contenteditable="true"]', 'div[role="textbox"][contenteditable="true"]', 'div.Am.Al.editable'],
    send: ['div[role="button"][data-tooltip^="Send"]', 'div[role="button"][aria-label^="Send"]', 'div.T-I.J-J5-Ji.aoO'],
    discard: ['div[role="button"][aria-label*="Discard" i]', 'div[role="button"][data-tooltip*="Discard" i]'],
    close: ['img[aria-label*="Save & close" i]', 'div[role="button"][aria-label*="Save & close" i]'],
    search: ['input[name="q"]', 'input[aria-label="Search mail"]'],
    threadRow: ['tr.zA'],
    openThread: ['div[role="listitem"] .gs', '.adn.ads'],
    sender: ['.gD[email]', 'span[email]'],
    timestamp: ['.g3[title]', 'span[title][alt]'],
    messageText: ['.a3s', 'div[data-message-id] .ii.gt'],
    sendConfirmation: ['div[role="alert"]', 'div.bAq span.aT'],
  },
  chatgpt: {
    composer: [
      '#prompt-textarea[contenteditable="true"]',
      '.ProseMirror[contenteditable="true"]',
      'textarea#prompt-textarea',
      'textarea[name="prompt"]',
      '[aria-label="Chat with ChatGPT"]',
    ],
    send: [
      'button[data-testid="send-button"]',
      'button[aria-label="Send prompt"]',
      'button[aria-label="Send message"]',
      'button[aria-label="Send"]',
      'form[data-chatgpt-composer] button[type="submit"]',
    ],
    stop: ['button[data-testid="stop-button"]', 'button[aria-label*="Stop"]'],
    reply: [
      '[data-talvt-turn-state="complete"]',
      '[data-response-body] [data-dil-response]',
      '[data-message-author-role="assistant"] .markdown',
      '[data-message-author-role="assistant"]',
    ],
    thinking: [
      'button[aria-label*="Thinking" i]',
      'button[aria-label*="Reasoning" i]',
      '[role="button"][title*="Thinking" i]',
      '[role="button"][title*="Reasoning" i]',
    ],
    thinkingMedium: [
      '[role="menuitem"][aria-label*="Medium" i]',
      '[role="option"][aria-label*="Medium" i]',
      'button[aria-label*="Medium" i]',
    ],
    temporary: ['button[aria-label*="Temporary"]', 'button[data-testid="temporary-chat-button"]'],
    newChat: ['a[data-testid="create-new-chat-button"]', 'a[aria-label="New chat"]'],
    login: ['form[data-logged-out]', 'button[data-testid="login-button"]', 'a[href="/auth/login"]'],
    challenge: ['iframe[src*="challenges.cloudflare.com"]', '#challenge-running', '#challenge-stage'],
  },
} as const;
export type Site = keyof typeof selectors;
export function siteForHost(host: string): Site | null {
  return (
    (
      { 'linkedin.com': 'linkedin', 'www.linkedin.com': 'linkedin', 'chatgpt.com': 'chatgpt', 'mail.google.com': 'gmail' } as Record<
        string,
        Site
      >
    )[host] ?? null
  );
}
