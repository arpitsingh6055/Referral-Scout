import { z } from 'zod';
import { runProvider } from './providers';
import { wait, find } from './dom';
import { selectors } from '../shared/selectors.config';

const documentId = crypto.randomUUID();
const loadedAt = Date.now();
let settledEditor: HTMLElement | null = null, settledAt = 0;
export function chatGptReady(): boolean {
  const editor = find(selectors.chatgpt.composer);
  if (editor !== settledEditor || !editor || document.readyState !== 'complete') {
    settledEditor = editor; settledAt = Date.now(); return false;
  }
  return Date.now() - loadedAt >= 8000 && Date.now() - settledAt >= 5000
    && editor.isConnected && editor.getAttribute('aria-disabled') !== 'true' && !editor.hasAttribute('disabled');
}
const request = z.object({ kind: z.literal('network.ai'), id: z.string().max(100), action: z.enum(['run','status']), prompt: z.string().max(1600000).default(''), attachment: z.object({name:z.string().max(200), type:z.string().max(120), data:z.string().max(3000000)}).nullable().default(null) });
const jobs = new Map<string, {state:string; text?:string; error?:string; notes?:string[]}>();
chrome.runtime.onMessage.addListener((input: unknown, sender, respond) => {
  // Service-worker senders can omit url. Content-script senders must never run AI jobs.
  if(sender.id !== chrome.runtime.id || sender.tab || (sender.url && sender.url !== chrome.runtime.getURL('service-worker.js'))) return false;
  if(input && typeof input === 'object' && 'kind' in input && input.kind === 'network.ai.ping') { respond({ok:true,ready:chatGptReady(),documentId}); return false; }
  const parsed=request.safeParse(input); if(!parsed.success) return false;
  const cmd=parsed.data;
  if(cmd.action==='status' || jobs.has(cmd.id)) { respond(jobs.get(cmd.id) ?? {state:'unknown'}); return false; }
  jobs.set(cmd.id,{state:'running'});
  let stage = 'Waiting for the ChatGPT input to settle';
  void (async()=>{
    const signal=new AbortController().signal;
    await wait(()=>chatGptReady(),signal,45000);
    stage = 'Inserting the prompt, sending, and waiting for ChatGPT';
    const result=await runProvider({kind:'llm.run',requestId:crypto.randomUUID(),deadline:Date.now()+300000,jobId:cmd.id,prompt:cmd.prompt,search:true,first:60000,total:240000,repair:false},signal);
    jobs.set(cmd.id,{state:'done',text:result.text,notes:result.notes});
  })().catch((e:unknown)=>jobs.set(cmd.id,{state:'failed',error:`${stage}: ${e instanceof Error?e.message:String(e)}`}));
  respond({state:'running',documentId}); return false;
});

