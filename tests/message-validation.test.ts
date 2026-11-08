import { expect, it } from 'vitest';
import { verifyMessage } from '../src/background/network-ai';
import type { NetworkContact } from '../src/shared/network';

const p = { name: 'Priya', url: 'https://www.linkedin.com/in/priya/' } as NetworkContact;

it.each([
  'Hi Priya, see https://example.com/me for my work.',
  'Hi Priya, my site is www.example.com',
  'Hi Priya, mail me at arpit@example.com',
  'Hi Priya, call me on +91 98765 43210',
  'Hi Priya, I have attached my CV.',
  'Hi {firstName}, I am exploring roles.',
])('refuses model output containing %s', text => expect(() => verifyMessage(text, p, 200)).toThrow());

it('allows a plain, short, human note and enforces the length limit', () => {
  expect(verifyMessage('Hi Priya, I admired your work on payments at Acme. Would love to connect.', p, 200)).toContain('Priya');
  expect(() => verifyMessage('x'.repeat(201), p, 200)).toThrow(/exceeds/);
});
