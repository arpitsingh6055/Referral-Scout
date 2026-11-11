/* Page hooks that are not about meaning. LinkedIn pages are read by role, label and text (see parsers/network.ts);
   only sign-in and security-check detection is listed here. ChatGPT's composer has stable hooks, kept in one place. */
export const selectors = {
  linkedin: {
    login: ['input#username', 'input[name="session_key"]', 'form[action*="login-submit"]'],
    challenge: ['iframe[src*="captcha"]', '#captcha-internal', 'form[action*="checkpoint/challenge"]']
  },
  chatgpt: {
    composer: ['#prompt-textarea[contenteditable="true"]', '.ProseMirror[contenteditable="true"]', 'textarea#prompt-textarea', 'textarea[name="prompt"]', '[aria-label="Chat with ChatGPT"]'],
    send: ['button[data-testid="send-button"]', 'button[aria-label="Send prompt"]', 'button[aria-label="Send message"]', 'button[aria-label="Send"]', 'form[data-chatgpt-composer] button[type="submit"]'],
    stop: ['button[data-testid="stop-button"]', 'button[aria-label*="Stop"]'],
    reply: ['[data-talvt-turn-state="complete"]', '[data-message-author-role="assistant"] .markdown', '[data-message-author-role="assistant"]'],
    thinking: ['button[aria-label*="Thinking" i]', 'button[aria-label*="Reasoning" i]', '[role="button"][title*="Thinking" i]', '[role="button"][title*="Reasoning" i]'],
    thinkingMedium: ['[role="menuitem"][aria-label*="Medium" i]', '[role="option"][aria-label*="Medium" i]', 'button[aria-label*="Medium" i]'],
    temporary: ['button[aria-label*="Temporary"]', 'button[data-testid="temporary-chat-button"]'],
    newChat: ['a[data-testid="create-new-chat-button"]', 'a[aria-label="New chat"]'],
    login: ['form[data-logged-out]', 'button[data-testid="login-button"]', 'a[href="/auth/login"]'],
    challenge: ['iframe[src*="challenges.cloudflare.com"]', '#challenge-running', '#challenge-stage']
  }
} as const;
export type Site = keyof typeof selectors;
export function siteForHost(host: string): Site | null {
  return ({ "linkedin.com": "linkedin", "www.linkedin.com": "linkedin", "chatgpt.com": "chatgpt" } as Record<string, Site>)[host] ?? null;
}
