import { afterEach, expect, it, vi } from 'vitest';
import { runProvider, currentPromptEditor } from '../src/content/providers';
import { selectors } from '../src/shared/selectors.config';

let manual = false;
function answer() {
  const editor=document.querySelector<HTMLElement>('#prompt-textarea')!;
  editor.textContent='';
  document.body.insertAdjacentHTML('beforeend','<div data-message-author-role="assistant"><div class="markdown">{"name":"Example"}</div></div>');
}
vi.mock('../src/content/dom', async importOriginal => {
  const original = await importOriginal<typeof import('../src/content/dom')>();
  return {...original,
    guard:()=>{},
    find:(variants:readonly string[])=>variants.map(s=>document.querySelector<HTMLElement>(s)).find(Boolean) ?? null,
    readEditor:(e:HTMLElement)=>e.textContent || '',
    sleep:async(ms:number)=>{vi.setSystemTime(Date.now()+ms);},
    wait:async(read:()=>unknown)=>{for(let i=0;i<20;i++){const result=read();if(result)return result;}throw new Error('timeout');},
    insert:(editor:HTMLElement,text:string)=>{
      const replacement=document.createElement('div');replacement.id='prompt-textarea';replacement.setAttribute('contenteditable','true');
      replacement.textContent=text.replace(/\s+/g,' ');editor.replaceWith(replacement);
      if(manual)answer();
    }
  };
});
afterEach(()=>{vi.useRealTimers();vi.restoreAllMocks();document.body.innerHTML='';manual=false;});

it.each([false,true])('handles a replaced editor and consumes the response (manual submission: %s)', async manualSend=>{
  vi.useFakeTimers();vi.setSystemTime(10000);manual=manualSend;
  document.body.innerHTML='<div id="prompt-textarea" contenteditable="true"></div><button data-testid="send-button">Send</button>';
  const clicked=vi.fn(answer);document.querySelector('button')!.addEventListener('click',clicked);
  const result=await runProvider({kind:'llm.run',requestId:crypto.randomUUID(),deadline:Date.now()+60000,jobId:'test',prompt:'Full profile\n\nCV text\nLast fact',search:false,first:60000,total:60000,repair:false},new AbortController().signal);
  expect(clicked).toHaveBeenCalledTimes(manualSend?0:1);
  expect(result.text).toBe('{"name":"Example"}');expect(result.state).toBe('done');
});

it('does not accept an edited or truncated prompt',()=>{
  document.body.innerHTML='<div id="prompt-textarea" contenteditable="true">Full profile</div>';
  expect(currentPromptEditor(selectors.chatgpt.composer,'Full profile and CV')).toBeNull();
});
