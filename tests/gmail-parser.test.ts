import { describe, expect, it } from 'vitest';
import {
  classify,
  isBounce,
  matchMessage,
  quotedStripped,
  returnDate,
  signedInAddress,
  threadMessages,
  threadRows,
} from '../src/parsers/gmail';

const NOW = Date.parse('2026-11-24T12:00:00Z');
/** The suite runs in a jsdom environment, so a detached container is enough to parse against. */
const dom = (html: string): ParentNode => {
  const host = document.createElement('div');
  host.innerHTML = html;
  return host;
};

describe('the thread list', () => {
  const list = dom(`
    <table>
      <tr class="zA zE" data-legacy-thread-id="thread-f:1829">
        <td class="yW"><span email="talent@razorpay.com" name="Razorpay Talent">Razorpay Talent</span></td>
        <td class="xY"><span class="bog">Your application — Product Operations Intern</span>
          <span class="y2">&nbsp;- Thanks for applying. We would like to schedule a call.</span></td>
        <td class="xW"><span title="Mon, 24 Nov 2026, 11:02">11:02</span></td>
      </tr>
      <tr class="zA" data-legacy-thread-id="thread-f:1830">
        <td class="yW"><span email="noreply@swiggy.com" name="Swiggy">Swiggy</span></td>
        <td class="xY"><span class="bog">Application received</span><span class="y2">&nbsp;- We got it.</span></td>
        <td class="xW"><span title="Sun, 23 Nov 2026, 09:14">23 Nov</span></td>
      </tr>
      <tr class="zA"><td>no id here</td></tr>
    </table>`);

  it('reads each conversation with its own thread id', () => {
    const rows = threadRows(list);
    expect(rows).toHaveLength(2);
    expect(rows[0]!.threadId).toBe('1829');
    expect(rows[0]!.email).toBe('talent@razorpay.com');
    expect(rows[0]!.subject).toContain('Product Operations Intern');
  });

  it('knows which conversations are unread', () => {
    const rows = threadRows(list);
    expect(rows[0]!.unread).toBe(true);
    expect(rows[1]!.unread).toBe(false);
  });

  it('keeps the timestamp even when it cannot be parsed, and parses it when it can', () => {
    const rows = threadRows(list);
    expect(rows[0]!.dateText).toContain('24 Nov 2026');
    expect(rows[0]!.at).toBeTypeOf('number');
  });

  it('skips a row with no thread id rather than inventing one', () => {
    expect(threadRows(list).every(r => r.threadId)).toBe(true);
  });
});

describe('an open conversation', () => {
  const thread = dom(`
    <div class="adn ads">
      <span class="gD" email="me@gmail.com" name="Arpit">Arpit</span>
      <span class="g3" title="Mon, 24 Nov 2026, 10:00">10:00</span>
      <div class="a3s">Hi Asha, I applied for the Product Operations Intern role and would value your thoughts.</div>
    </div>
    <div class="adn ads">
      <span class="gD" email="asha@razorpay.com" name="Asha Mehta">Asha Mehta</span>
      <span class="g3" title="Mon, 24 Nov 2026, 11:02">11:02</span>
      <div class="a3s">Happy to help — can you share your availability this week?
        On Mon, 24 Nov 2026 at 10:00, Arpit wrote: &gt; Hi Asha, I applied for the Product Operations Intern role</div>
    </div>`);

  it('tells the person’s own messages from the replies', () => {
    const messages = threadMessages(thread, 'me@gmail.com');
    expect(messages).toHaveLength(2);
    expect(messages[0]!.mine).toBe(true);
    expect(messages[1]!.mine).toBe(false);
  });

  it('drops the quoted original so a reply is judged on its own words', () => {
    const messages = threadMessages(thread, 'me@gmail.com');
    expect(messages[1]!.text).toContain('availability this week');
    expect(messages[1]!.text).not.toContain('I applied for the Product Operations Intern role and would value');
  });

  it('strips several quoting styles', () => {
    expect(quotedStripped('Yes please.\nOn Mon, 1 Jan 2026 at 09:00, X wrote:\n> old text')).toBe('Yes please.');
    expect(quotedStripped('Sure.\n-- Original Message --\nold')).toBe('Sure.');
  });

  it('reads the signed-in address from the account control', () => {
    const page = dom('<a aria-label="Google Account: Arpit Singh (arpit@gmail.com)"></a>');
    expect(signedInAddress(page)).toBe('arpit@gmail.com');
  });
});

describe('classification', () => {
  it('spots an interview invitation', () => {
    const r = classify({ subject: 'Next steps', body: 'We would like to invite you to an interview. Please share your availability.' });
    expect(r.classification).toBe('interview');
    expect(r.confidence).toBeGreaterThan(0.6);
    expect(r.signals.length).toBeGreaterThan(0);
  });

  it('spots a rejection without reading it into a neutral note', () => {
    expect(classify({ subject: 'Your application', body: 'We have decided to proceed with other candidates.' }).classification).toBe(
      'rejection',
    );
    expect(classify({ subject: 'Hello', body: 'Thanks for getting in touch.' }).classification).toBe('unknown');
  });

  it('spots an assessment', () => {
    expect(classify({ subject: 'Coding challenge', body: 'Please complete the test on HackerRank.' }).classification).toBe('assessment');
  });

  it('spots a referral update', () => {
    expect(classify({ subject: 'Done', body: 'I have referred you internally — your referral ID is 4412.' }).classification).toBe(
      'referral-update',
    );
  });

  it('treats an out-of-office as an auto-reply, never as an answer', () => {
    const r = classify({
      subject: 'Automatic reply: Your application',
      body: 'I am currently out of office and will return on 2 December.',
    });
    expect(r.classification).toBe('auto-reply');
    expect(r.confidence).toBeGreaterThan(0.8);
  });

  it('does not let a quoted interview line in an auto-reply become an interview', () => {
    const r = classify({
      subject: 'Automatic reply',
      body: 'I am out of the office until Monday. On 24 Nov, Arpit wrote: > could we schedule an interview call',
    });
    expect(r.classification).toBe('auto-reply');
  });

  it('recognises a bounce from the daemon and from the body', () => {
    expect(
      isBounce({ subject: 'Delivery Status Notification (Failure)', body: 'Address not found', from: 'mailer-daemon@googlemail.com' }),
    ).toBe(true);
    expect(isBounce({ subject: 'Undeliverable', body: 'The recipient does not exist. 550-5.1.1', from: 'postmaster@acme.com' })).toBe(true);
    expect(isBounce({ subject: 'Re: your note', body: 'Happy to chat.', from: 'asha@razorpay.com' })).toBe(false);
  });

  it('says unknown rather than guessing at an ambiguous message', () => {
    const r = classify({ subject: 'Quick question', body: 'Are you around?' });
    expect(r.classification).toBe('unknown');
    expect(r.confidence).toBe(0);
  });

  it('is more confident when several independent phrases agree', () => {
    const one = classify({ subject: 'Interview', body: 'We would like to schedule a call.' });
    const many = classify({ subject: 'Interview invitation', body: 'Please share your availability — book here: calendly.com/x' });
    expect(many.confidence).toBeGreaterThan(one.confidence);
  });
});

describe('out-of-office return dates', () => {
  it('reads a date it can act on', () => {
    expect(returnDate('I will be back on 2 December', NOW)).toBe(Date.parse('2 December 2026'));
    expect(returnDate('Out of office until 2026-12-02', NOW)).toBe(Date.parse('2026-12-02'));
  });

  it('assumes next year when the date has already gone', () => {
    const r = returnDate('Back on 3 January', NOW);
    expect(r).toBe(Date.parse('3 January 2027'));
  });

  it('returns nothing when no date was given', () => {
    expect(returnDate('I am away at the moment.', NOW)).toBeUndefined();
  });
});

describe('matching a message to what we track', () => {
  const targets = [
    {
      id: 'a1',
      kind: 'application' as const,
      company: 'Razorpay',
      title: 'Product Operations Intern',
      domain: 'razorpay.com',
      threadId: '1829',
    },
    { id: 'c1', kind: 'contact' as const, company: 'Swiggy', contactEmail: 'asha@swiggy.com' },
    { id: 'a2', kind: 'application' as const, company: 'Microsoft', title: 'Product Intern' },
  ];

  it('prefers the conversation we started', () => {
    const m = matchMessage({ threadId: '1829', from: 'someone@else.com', subject: 'Re: hello', body: '' }, targets)!;
    expect(m.target.id).toBe('a1');
    expect(m.confidence).toBe(1);
  });

  it('matches the exact person we wrote to', () => {
    const m = matchMessage({ from: 'asha@swiggy.com', subject: 'Re: your note', body: '' }, targets)!;
    expect(m.target.id).toBe('c1');
  });

  it('matches the employer’s domain', () => {
    const m = matchMessage({ from: 'careers@razorpay.com', subject: 'Update', body: '' }, targets)!;
    expect(m.basis).toContain('razorpay.com');
    expect(m.confidence).toBeGreaterThan(0.8);
  });

  it('treats a company name alone as weak evidence', () => {
    const m = matchMessage({ from: 'newsletter@techcrunch.com', subject: 'Microsoft is hiring again', body: '' }, targets)!;
    expect(m.target.id).toBe('a2');
    expect(m.confidence).toBeLessThan(0.6);
  });

  it('is more confident when the subject names the role too', () => {
    const weak = matchMessage({ from: 'x@y.com', subject: 'about microsoft', body: '' }, targets)!;
    const strong = matchMessage({ from: 'x@y.com', subject: 'microsoft product intern application', body: '' }, targets)!;
    expect(strong.confidence).toBeGreaterThan(weak.confidence);
  });

  it('matches nothing when there is nothing to match', () => {
    expect(matchMessage({ from: 'a@b.com', subject: 'Lunch?', body: '' }, targets)).toBeUndefined();
  });
});
