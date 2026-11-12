import { expect, it } from 'vitest';
import { readThread } from '../src/content/reply';
import { contactForThread, type NetworkContact } from '../src/shared/network';
import { replyPrompt } from '../src/shared/referral';

/* An open conversation as it is on the live page (12 November 2026): the header links to an encoded member id,
   messages from the other person carry "--other", your own do not. */
const page = (messages: string) =>
  new DOMParser().parseFromString(
    `<main><div class="msg-thread">
      <a class="xyz msg-thread__link-to-profile" href="https://www.linkedin.com/in/ACoAAB-cdEfGh1234567890abcdefghijklmnopq"><h2 class="msg-entity-lockup__entity-title">Ananya Rao</h2></a>
      <ul class="msg-s-message-list-content">${messages}</ul>
      <form class="msg-form"><div class="msg-form__contenteditable" contenteditable="true" role="textbox"><p><br></p></div></form>
    </div></main>`,
    'text/html',
  );
const event = (text: string, other: boolean) =>
  `<li class="msg-s-message-list__event"><div class="msg-s-event-listitem${other ? ' msg-s-event-listitem--other' : ''}"><p class="msg-s-event-listitem__body">${text}</p></div></li>`;
const contact = (name: string, patch: Partial<NetworkContact> = {}): NetworkContact =>
  ({
    name,
    url: `https://www.linkedin.com/in/${name.toLowerCase().replace(/\W+/g, '-')}/`,
    headline: 'Product Manager at Razorpay',
    requestedAt: 0,
    messagedAt: 5,
    ...patch,
  }) as NetworkContact;

it('reads an open conversation: who it is with, LinkedIn’s id for them, and who said what in order', () => {
  const doc = page(event('Hi Ananya, I am applying for the PM Intern role.', false) + event('Sure, share your CV', true));
  expect(readThread(doc, '/messaging/thread/2-abc==/')).toEqual({
    id: 'ACoAAB-cdEfGh1234567890abcdefghijklmnopq',
    name: 'Ananya Rao',
    messages: [
      { mine: true, text: 'Hi Ananya, I am applying for the PM Intern role.' },
      { mine: false, text: 'Sure, share your CV' },
    ],
  });
  expect(readThread(doc, '/messaging/')).toBeNull(); // only when one conversation is open
});

it('recognises whose conversation it is: by LinkedIn’s id once learned, otherwise by a name only one asked person has', () => {
  const people = [
    contact('Ananya Rao'),
    contact('Sam Lee'),
    contact('Sam Lee', { url: 'https://www.linkedin.com/in/sam-lee-2/' }),
    contact('Never Asked', { messagedAt: 0 }),
  ];
  expect(contactForThread(people, 'ACoA1', 'Ananya Rao (She/Her)')?.name).toBe('Ananya Rao');
  expect(contactForThread(people, 'ACoA2', 'Sam Lee')).toBeUndefined(); // two people share the name
  expect(contactForThread(people, 'ACoA3', 'Never Asked')).toBeUndefined(); // not someone the extension contacted
  expect(contactForThread([contact('Sam Lee', { messagingId: 'ACoA2' }), ...people], 'ACoA2', 'Sam Lee')?.messagingId).toBe('ACoA2');
});

it('gives ChatGPT the conversation, the job and the rules for the reply', () => {
  const prompt = replyPrompt({
    me: 'Arpit Singh',
    about: 'MBA student',
    roles: ['Product Management internship'],
    person: { name: 'Ananya Rao', headline: 'Product Manager at Razorpay', companyName: 'Razorpay' },
    job: { title: 'PM Intern', company: 'Razorpay', url: 'https://www.linkedin.com/jobs/view/1/' },
    messages: [
      { mine: true, text: 'Hi Ananya' },
      { mine: false, text: 'Sure, share your CV' },
    ],
  });
  for (const part of [
    'Sure, share your CV',
    '"from":"Ananya Rao"',
    'https://www.linkedin.com/jobs/view/1/',
    'rather than inventing it',
    '{"reply": the message text}',
    'attaches it themselves',
  ])
    expect(prompt).toContain(part);
});
