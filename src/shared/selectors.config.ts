export const selectors = {
  linkedin: {
    website: ['a[data-control-name="page_details_website"]', '.org-page-details__definition-text a[href^="http"]', 'a[aria-label*="website"]'],
    about: ['.org-page-details__definition-text', '.org-about-us-organization-description', 'main'],
    firstDegree: ['.dist-value', '[data-test-distance-badge]'],
    mailto: ['a[href^="mailto:"]'],
    jobTitle: ['.job-card-list__title', '.job-card-container__link', 'a[href*="/jobs/view/"]'],
    navigation: ['nav[aria-label="Primary Navigation"]', '#global-nav', 'header.global-nav'],
    cards: ['.entity-result', '[data-chameleon-result-urn]', 'li.reusable-search__result-container'],
    companyLink: ['.entity-result__title-text a[href*="/company/"]', 'a.app-aware-link[href*="/company/"]', 'a[href*="/company/"]'],
    peopleLink: ['.entity-result__title-text a[href*="/in/"]', 'a.app-aware-link[href*="/in/"]', 'a[href*="/in/"]'],
    title: ['.entity-result__title-text [aria-hidden="true"]', '.entity-result__title-text', 'h3'],
    industry: ['.entity-result__primary-subtitle', '[data-field="industry"]'],
    location: ['.entity-result__secondary-subtitle', '[data-field="location"]'],
    summary: ['.entity-result__summary', '[data-field="summary"]'],
    jobs: ['.job-card-container', '.jobs-search-results__list-item', '[data-job-id]'],
    next: ['button[aria-label="Next"]', 'button.artdeco-pagination__button--next'],
    showMore: ['button[aria-label*="Show more"]', 'button.inline-show-more-text__button'],
    contact: ['a[href*="overlay/contact-info"]', 'a#top-card-text-details-contact-info'],
    overlay: ['[role="dialog"] .pv-contact-info', '[role="dialog"]'],
    login: ['input#username', 'input[name="session_key"]'],
    challenge: ['iframe[src*="captcha"]', '#captcha-internal', 'form[action*="checkpoint/challenge"]']
  },
  gmail: {
    message: ['.adn.ads', '[data-message-id]', '.adn'],
    quote: ['.gmail_quote', 'blockquote', '[data-smartmail="gmail_quote"]'],
    older: ['[role="button"][aria-label="Older"]', '[role="button"][data-tooltip="Older"]'],
    sender: ['.gD[email]', '[data-hovercard-id][email]'],
    messageBody: ['.a3s.aiL', '.a3s', '[data-message-body]'],
    messageSubject: ['h2.hP', '[data-message-subject]'],
    rowSubject: ['.bog', '[data-subject]'],
    rowSender: ['.yW [email]', '[data-hovercard-id]', '[email]'],
    messageLink: ['a[href*="#inbox/"]', 'a[href*="#search/"]'],
    closeCompose: ['[data-tooltip="Save & close"]', '[aria-label="Save & close"]'],
    search: ['input[aria-label="Search mail"]', 'input[name="q"]'],
    compose: ['[role="button"][gh="cm"]', '.T-I.T-I-KE.L3'],
    subject: ['input[name="subjectbox"]', 'input[placeholder="Subject"]'],
    to: ['input[name="to"]', 'input[aria-label="To recipients"]', '[email]'],
    from: ['select[name="from"]', '[name="from"]', '.az2'],
    body: ['[role="textbox"][contenteditable="true"]', '[contenteditable="true"][aria-label="Message Body"]'],
    send: ['[role="button"][data-tooltip^="Send ("]', '[role="button"][aria-label^="Send ("]', 'button[aria-label="Send"]'],
    saved: ['[role="status"]', '.oG'],
    toast: ['[role="alert"]', '[role="status"]', '.bAq'],
    rows: ['tr.zA', '[role="row"]'],
    reply: ['[role="button"][data-tooltip="Reply"]', '[role="button"][aria-label="Reply"]'],
    login: ['input[type="email"]', '#identifierId'],
    challenge: ['iframe[src*="recaptcha"]', '#captchaimg']
  },
  gemini: {
    composer: ['rich-textarea [contenteditable="true"]', '[role="textbox"][contenteditable="true"]'],
    send: ['button[aria-label="Send message"]', 'button[aria-label="Send"]', 'button.send-button'],
    stop: ['button[aria-label*="Stop"]', 'button[aria-label*="stop"]'],
    reply: ['model-response .markdown', 'model-response message-content', 'model-response'],
    temporary: ['button[aria-label*="Temporary chat"]', '[role="switch"][aria-label*="Temporary"]'],
    newChat: ['a[aria-label="New chat"]', 'button[aria-label="New chat"]', 'a[href="/app"]'],
    login: ['a[href*="accounts.google.com/ServiceLogin"]', 'button[aria-label="Sign in"]'],
    challenge: ['iframe[src*="recaptcha"]', '#captchaimg']
  },
  chatgpt: {
    fileInput: ['input[type="file"][accept]', 'input[type="file"]'],
    attachment: ['[data-testid="file-thumbnail"]', '[data-testid="attachment"]', '[aria-label*="Remove file"]', '[aria-label*="Remove attachment"]'],
    uploading: ['[role="progressbar"]', '[aria-label*="Uploading"]'],
    composer: ['#prompt-textarea[contenteditable="true"]', '.ProseMirror[contenteditable="true"]', 'textarea#prompt-textarea'],
    send: ['button[data-testid="send-button"]', 'button[aria-label="Send prompt"]', 'button[aria-label="Send message"]'],
    stop: ['button[data-testid="stop-button"]', 'button[aria-label*="Stop"]'],
    reply: ['[data-message-author-role="assistant"] .markdown', '[data-message-author-role="assistant"]'],
    search: ['button[aria-label="Search"]', 'button[data-testid="composer-search-button"]', '[role="menuitem"][data-testid="search"]'],
    searchOn: ['button[aria-label="Search"][aria-pressed="true"]', '[data-testid="composer-search-button"][data-state="on"]'],
    tools: ['button[aria-label="Tools"]', 'button[data-testid="composer-plus-btn"]'],
    temporary: ['button[aria-label*="Temporary"]', 'button[data-testid="temporary-chat-button"]'],
    newChat: ['a[data-testid="create-new-chat-button"]', 'a[aria-label="New chat"]'],
    login: ['button[data-testid="login-button"]', 'a[href="/auth/login"]'],
    challenge: ['iframe[src*="challenges.cloudflare.com"]', '#challenge-running', '#challenge-stage']
  }
} as const;
export type Site = keyof typeof selectors;
export function siteForHost(host: string): Site | null {
  return ({ "linkedin.com": "linkedin", "www.linkedin.com": "linkedin", "mail.google.com": "gmail", "gemini.google.com": "gemini", "chatgpt.com": "chatgpt" } as Record<string, Site>)[host] ?? null;
}
