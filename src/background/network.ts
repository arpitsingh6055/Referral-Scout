import { z } from 'zod';
import { DAY, MAX_REVIEW_QUEUE, SHORTLIST_BACKLOG, defaultSettings, emptyNetwork, networkKey, networkProfileSchema, nextContact, renderNote, introduction, withinActiveHours, type NetworkState, type NetworkContact } from '../shared/network';
import { classify, normalizeCompany, planSearch, companyOf } from '../shared/targeting';
import { companyFromCurrent } from '../parsers/network';
import { read, mutate } from '../storage/state';
import { acquire, release, renew } from './lease';
import { networkCommand, networkTab, showWorkTab } from './network-browser';
import { prepareIntroduction, prepareInvitation } from './network-ai';

/** Saved settings with defaults filled in. Installs from before v0.10 are moved to ChatGPT-written messages once; a later choice is kept. */
function settingsOf(s:NetworkState):NonNullable<NetworkState['settings']>{
  return {...defaultSettings,...s.settings,roles:s.settings?.roles?.length?s.settings.roles:[s.target],...(s.aiDefaultV2?{}:{aiMode:'chatgpt' as const}),...(s.paceV2?{}:{paceMinutes:defaultSettings.paceMinutes})};
}
export async function getNetwork(): Promise<NetworkState> {
  const old=await read<NetworkState>(networkKey);
  if(!old)return emptyNetwork();
  // In-place legacy migration removes old binary CV caches without deleting history.
  const cv=old.cv ? { ...old.cv,name:old.cv.name,type:old.cv.type,text:old.cv.text||'',characterCount:old.cv.characterCount??old.cv.text?.length??0} : null;
  if(cv && 'data' in cv)delete (cv as typeof cv & {data?:unknown}).data;
  return {...old,cv,settings:settingsOf(old)};
}
export async function updateNetwork(fn:(s:NetworkState)=>NetworkState):Promise<NetworkState> {
  const state=await mutate<NetworkState>(networkKey,old=>{
    const base=old??emptyNetwork();
    base.actions=(base.actions??[]).filter(a=>Date.now()-a.at<35*DAY); // limits only look back 7 days
    const cv=base.cv?{...base.cv,name:base.cv.name,type:base.cv.type,text:base.cv.text||'',characterCount:base.cv.characterCount??base.cv.text?.length??0}:null;
    if(cv && 'data' in cv)delete (cv as typeof cv & {data?:unknown}).data;
    const before=base.status;
    const next=fn({...base,cv,settings:settingsOf(base)});next.aiDefaultV2=true;next.paceV2=true;
    // Every new status line is also kept in a short activity log the side panel can show.
    if(next.status&&next.status!==before)next.log=[...(next.log??[]),{at:Date.now(),text:next.status,kind:/attention|could not|not signed in|usage limit|paused|limit reached|failed|interrupted|quiet hours|waiting/i.test(next.status)?'warn' as const:/saved|sent|started|confirmed|accepted|recovered|validated/i.test(next.status)?'ok' as const:'info' as const}].slice(-60);
    return next;
  });
  return state;
}
let running:Promise<void>|null=null,controller:AbortController|null=null;
export async function pauseNetwork(reason='Paused. Your saved people and progress are kept.'):Promise<void>{
  await updateNetwork(s=>({...s,active:false,revision:s.revision+1,status:reason}));
  controller?.abort();
  const tab=await read<number>('network-tab');
  if(tab!==undefined)await chrome.tabs.sendMessage(tab,{kind:'network.cancel'}).catch(()=>undefined);
}
export async function currentRun(revision:number,signal:AbortSignal):Promise<NetworkState>{
  signal.throwIfAborted();const s=await getNetwork();
  if(!s.active||s.revision!==revision)throw new Error('Outreach was paused.');return s;
}
export async function recoverNetwork():Promise<void>{
  await updateNetwork(s=>{
    for(const p of s.contacts)if(p.state==='requesting'||p.state==='messaging'){
      p.state='attention';p.reason='The browser stopped during this send. Inspect LinkedIn before doing anything else; no resend will occur automatically.';
    }
    s.intent=null;return s;
  });
}
async function saveContact(person:NetworkContact):Promise<void>{
  await updateNetwork(s=>{s.contacts=s.contacts.map(p=>p.url===person.url&&p.state!=='skipped'?person:p);s.intent=null;return s;});
}
function permittedCompany(name:string,s:NetworkState):boolean {
  const settings=s.settings??defaultSettings,low=name.toLowerCase();
  return !settings.companyExclusions.some(c=>low.includes(c.toLowerCase()))&&(!settings.companyAllowlist.length||settings.companyAllowlist.some(c=>low.includes(c.toLowerCase())));
}
const PER_COMPANY=3; // never pile several invitations onto one company
const KIND_LABEL={campus:'campus recruiters',recruiter:'recruiters',leader:'team leaders',founder:'founders'} as const;
async function discover(s:NetworkState,signal:AbortSignal):Promise<void>{
  const roles=s.settings?.roles??[s.target];
  const plan=planSearch(roles,s.location,s.searchCursor);
  if(!plan){await updateNetwork(c=>({...c,searchCursor:0,nextDiscoveryAt:Date.now()+6*3600000,status:'Every search for your current targets has been checked. Add roles or change the location to find more people; searching starts over in 6 hours.'}));return;}
  const url=new URL('https://www.linkedin.com/search/results/people/');
  url.searchParams.set('keywords',plan.combo.keywords);url.searchParams.set('page',String(plan.page));
  // Only 2nd and 3rd+ degree people can be invited; 1st-degree people are already connected.
  url.searchParams.set('network',JSON.stringify(['S','O']));url.searchParams.set('origin','FACETED_SEARCH');
  const label=`${KIND_LABEL[plan.combo.kind]} for ${plan.combo.role} (page ${plan.page})`;
  await note(s,`Searching LinkedIn for ${label}…`);
  const tab=await networkTab(url.href,signal);
  const people=z.array(networkProfileSchema).parse(await networkCommand(tab,{action:'search'},signal));
  await currentRun(s.revision,signal);
  let added=0,rejected=0;
  await updateNetwork(current=>{
    if(!current.active||current.revision!==s.revision)return current;
    const perCompany=new Map<string,number>();
    for(const c of current.contacts){const n=normalizeCompany(c.companyName??companyOf(c.headline)??'');if(n)perCompany.set(n,(perCompany.get(n)??0)+1);}
    for(const person of people){
      if(person.url===current.profile?.url||current.contacts.some(c=>c.url===person.url))continue;
      const verdict=classify({headline:person.headline,location:person.location,...(person.degree?{degree:person.degree}:{})},{roles:current.settings?.roles??[current.target],location:current.location});
      if(!verdict){rejected++;continue;}
      // LinkedIn's own "Current: Recruiter at X" line is more reliable than guessing the employer from the headline.
      const company=companyFromCurrent(person.current)??verdict.company;const key=normalizeCompany(company??'');
      if(key&&(perCompany.get(key)??0)>=PER_COMPANY){rejected++;continue;}
      if(!permittedCompany(company??person.headline,current)){rejected++;continue;}
      if(key)perCompany.set(key,(perCompany.get(key)??0)+1);
      current.contacts.push({...person,reason:verdict.reason,score:verdict.score,category:verdict.category,
        state:'shortlisted',addedAt:Date.now(),requestedAt:0,checkedAt:0,messagedAt:0,message:'',...(company?{companyName:company}:{})});added++;
    }
    current.searchCursor++;
    current.nextDiscoveryAt=Date.now()+(people.length?20000:45000)+Math.floor(Math.random()*20000);
    current.status=`Searched ${label}: saved ${added} new ${added===1?'person':'people'}, skipped ${rejected} that did not fit.`;
    return current;
  });
}
const PENDING_EXPIRY=30*DAY,OWNER_RECHECK=6*3600000;
/** Checks are spaced out too, so a laptop waking up never fires a burst of page loads. */
async function pace(minMs:number,maxMs:number):Promise<void>{await updateNetwork(c=>({...c,nextActionAt:Math.max(c.nextActionAt,Date.now()+minMs+Math.floor(Math.random()*(maxMs-minMs)))}));}
/** Account-level signals pause everything. Anything else is about one contact. */
const ACCOUNT_LEVEL=/HALT:|sign in to linkedin|signed out|signed-in linkedin account|different linkedin account|checkpoint|outreach (?:was|is|has been) paused|no longer authorized|did not finish loading/i;
const MAX_ATTEMPTS=2,STREAK_LIMIT=3;
/** Errors raised before anything is submitted that are about this recipient only. */
const RECIPIENT_ONLY=/Connect is unavailable on this recipient|requires a recipient email|Message button is unavailable|already have a conversation|unsent draft|already contains a draft|permits \d+ characters|open profile changed/i;
export async function processContact(s:NetworkState,p:NetworkContact,signal:AbortSignal,approved=false):Promise<void>{
  await note(s,`Opening ${p.name}'s profile…`);
  const tab=await networkTab(p.url,signal);
  const relation=z.object({state:z.enum(['connected','pending','not-connected','unknown'])}).parse(await networkCommand(tab,{action:'relationship',url:p.url},signal));
  await currentRun(s.revision,signal);
  const now=Date.now();p.checkedAt=now;
  if(relation.state==='pending'){
    if(!p.requestedAt){p.state='skipped';p.reason='A request existed before this campaign; it was not adopted as an extension send.';}
    else if(now-p.requestedAt>PENDING_EXPIRY){p.state='skipped';p.reason='No response after 30 days. LinkedIn may still show it as pending: consider withdrawing it under My Network, Manage, Sent, which also frees your pending count.';}
    else{p.state='pending';p.nextCheckAt=now+DAY;p.reason='Still pending. Next acceptance check scheduled for 24 hours later.';}
    await saveContact(p);await pace(40000,90000);return;
  }
  if(relation.state==='connected'&&!p.requestedAt){p.state='skipped';p.reason='Already connected before this campaign. No artificial acceptance event was created.';await saveContact(p);return;}
  if(p.requestedAt&&relation.state!=='connected'){
    p.state=relation.state==='unknown'||relation.state==='not-connected'?'attention':'pending';
    p.reason='A known invitation is not visibly pending or accepted. Check it manually; do not invite again.';
    p.nextCheckAt=now+DAY;await saveContact(p);return;
  }
  if(p.requestedAt&&relation.state==='connected'&&!p.acceptedAt){
    p.acceptedAt=now;p.state='connected';p.reason='First-degree connection confirmed after this campaign’s tracked invitation.';
    await saveContact(p);
  }
  const kind=relation.state==='connected'?'message':'connect';
  if(kind==='message'&&p.messagedAt)return;
  if(kind==='connect'&&relation.state==='unknown'){p.state='attention';p.reason='Could not determine LinkedIn connection controls; no invitation was attempted.';await saveContact(p);return;}
  const fresh=await currentRun(s.revision,signal);
  const settings=fresh.settings??defaultSettings;
  const cap=kind==='connect'?settings.dailyInvites:settings.dailyMessages;
  if(cap!==null&&fresh.actions.filter(a=>a.kind===kind&&a.confirmed!==false&&now-a.at<DAY).length>=cap){
    await updateNetwork(current=>({...current,status:`Your configured ${kind} daily threshold was reached. No action taken.`}));return;
  }
  if(!p.rawText || kind==='message'){
    const data=networkProfileSchema.parse(await networkCommand(tab,{action:'profile',url:p.url},signal));
    // The scraped page must be the intended recipient. Never let it rewrite the recipient's identity.
    if(data.url!==p.url){p.state='attention';p.reason='LinkedIn showed a different profile than the intended recipient. Nothing was sent.';await saveContact(p);return;}
    const {url:scrapedUrl,...facts}=data;void scrapedUrl;
    Object.assign(p,facts);
  }
  const me=fresh.profile!.name;
  // ChatGPT personalisation is optional. If it is off, or fails, the user's own template is used so outreach never stalls.
  const draft=async(ai:()=>Promise<string>,template:()=>string):Promise<string>=>{
    if(settings.aiMode!=='chatgpt')return template();
    try{await note(fresh,`Asking ChatGPT to write a message for ${p.name}…`);const text=await ai();await currentRun(s.revision,signal);await showWorkTab(tab);return text;}
    catch(error){
      if(signal.aborted||/paused/i.test(String(error)))throw error;
      await showWorkTab(tab);
      // Never fail silently: say why ChatGPT was not used, then carry on with the template.
      const why=error instanceof Error?error.message:String(error);
      const reason=/sign in to chatgpt/i.test(why)?'ChatGPT is not signed in. Sign in at chatgpt.com to get personalised messages.':/usage limit/i.test(why)?'ChatGPT has reached its usage limit.':`ChatGPT could not write this message (${why.slice(0,160)}).`;
      await updateNetwork(c=>({...c,status:`${reason} Your template was used for ${p.name} instead.`}));
      return template();
    }
  };
  if(kind==='connect'&&settings.noteMode!=='none'&&!p.invitationNote)
    p.invitationNote=await draft(()=>prepareInvitation(fresh,p,200,signal),()=>renderNote(settings,fresh.target,p,me));
  if(kind==='message'&&!p.message)
    p.message=await draft(()=>prepareIntroduction(fresh,p,signal),()=>introduction(fresh,p,me));
  const review=kind==='connect'?settings.outreachMode==='review':settings.followupMode==='review';
  if(review&&!approved){
    p.state='review';p.approvalKind=kind;p.reason=`${kind==='connect'?'Invitation note':'Post-acceptance thank-you'} drafted. Confirm the exact recipient and approve before sending.`;
    await saveContact(p);return;
  }
  if(approved&&p.approvalKind!==kind)throw new Error('Approval does not match the intended action.');
  const intent:NonNullable<NetworkState['intent']>={id:crypto.randomUUID(),tabId:tab,url:p.url,kind,at:Date.now(),body:kind==='connect'?p.invitationNote??'':p.message,revision:s.revision,claimed:false};
  p.state=kind==='connect'?'requesting':'messaging';delete p.approvalKind;
  await updateNetwork(current=>{
    if(!current.active||current.revision!==s.revision)throw new Error('Outreach was paused.');
    current.contacts=current.contacts.map(c=>c.url===p.url?p:c);
    current.intent=intent;current.nextActionAt=Date.now()+Math.round(settings.paceMinutes*60000*(0.75+Math.random()*0.7));
    current.actions.push({at:intent.at,kind,url:p.url,confirmed:false,idempotencyKey:`${fresh.profile!.url}|${p.url}|${kind}|${p.requestedAt||intent.at}`});
    return current;
  });
  try{
    const result=z.object({state:z.enum(['pending','connected','messaged']),noteSent:z.boolean().optional()}).parse(await networkCommand(tab,{action:kind,url:p.url,intentId:intent.id,body:intent.body,noteMode:settings.noteMode},signal));
    if(kind==='connect'&&result.state!=='pending')throw new Error('The invitation did not produce a confirmed Pending indicator.');
    if(kind==='message'&&result.state!=='messaged')throw new Error('The sent message bubble could not be confirmed.');
    if(kind==='connect'){p.requestedAt=Date.now();p.nextCheckAt=p.requestedAt+DAY;p.state='pending';p.reason=`Invitation confirmed Pending${result.noteSent===false&&settings.noteMode!=='none'?' (sent without a note: LinkedIn did not offer one)':''}. The first acceptance check is in 24 hours.`;}
    else{p.messagedAt=Date.now();p.state='messaged';p.reason='New follow-up bubble verified in the correct LinkedIn conversation.';}
    await updateNetwork(current=>{const action=current.actions.find(a=>a.at===intent.at&&a.url===p.url&&a.kind===kind);if(action)action.confirmed=true;return current;});
  }catch(error){
    const message=error instanceof Error?error.message:String(error);
    p.lastError=message;
    if(/weekly invitation limit/i.test(message)){
      // LinkedIn refused before sending. Put this person back in the queue and wait for the quota to reset.
      p.state='shortlisted';p.reason='LinkedIn’s weekly invitation limit was reached before this invitation was sent. It will be retried after the pause.';
      await updateNetwork(current=>{current.actions=current.actions.filter(a=>!(a.at===intent.at&&a.url===p.url&&a.kind===kind));return current;});
      await pauseNetwork('LinkedIn says you reached its weekly invitation limit. Outreach is paused; resume in a few days.');
    }else if(RECIPIENT_ONLY.test(message)){
      // Nothing was submitted and the problem is this one profile: skip them and keep going.
      p.state='skipped';p.reason=`${message} Skipped; the campaign continues with the next person.`;
      await updateNetwork(current=>{current.actions=current.actions.filter(a=>!(a.at===intent.at&&a.url===p.url&&a.kind===kind));current.status=`Skipped ${p.name}: ${message}`;return current;});
    }else{
      p.state='attention';
      p.reason=`${message} This action is NOT automatically retried.`;
      await pauseNetwork('A send attempt needs review. Inspect LinkedIn before resuming.');
    }
  }
  await saveContact(p);
}
/** Why nothing can be sent right now, in plain words. */
function idleReason(s:NetworkState,now=Date.now()):string|null {
  const st=s.settings??defaultSettings,count=(k:'connect'|'message',span:number)=>s.actions.filter(a=>a.kind===k&&a.confirmed!==false&&now-a.at<span).length;
  if(s.contacts.filter(p=>p.state==='review').length>=MAX_REVIEW_QUEUE)return `${MAX_REVIEW_QUEUE} drafts are waiting for your review. Approve or skip them to continue.`;
  if(!s.contacts.some(p=>p.state==='shortlisted'||(p.state==='connected'&&!p.messagedAt)))return null;
  if(st.dailyInvites!==null&&count('connect',DAY)>=st.dailyInvites)return `Daily invitation limit reached (${st.dailyInvites}). Outreach continues automatically within 24 hours.`;
  if(st.weeklyInvites!==null&&count('connect',7*DAY)>=st.weeklyInvites)return `Weekly invitation limit reached (${st.weeklyInvites}), which protects your LinkedIn account. Outreach continues automatically.`;
  if(st.maxPending!==null&&s.contacts.filter(p=>p.state==='pending').length>=st.maxPending)return `${st.maxPending} invitations are still pending. Outreach waits for responses.`;
  return null;
}
/** Update the status line only when it changed, so idle ticks do not rewrite storage. */
async function note(s:NetworkState,status:string):Promise<void>{if(s.status!==status)await updateNetwork(c=>({...c,status}));}
let worked=false;
async function run():Promise<void>{
  const owner=crypto.randomUUID();if(!await acquire(owner))return;
  const abort=new AbortController();controller=abort;
  const renewal=setInterval(()=>{void renew(owner).then(ok=>{if(!ok)abort.abort();});},20000);
  try{
    const s=await getNetwork();if(!s.active||!s.profile)return;
    if(s.intent||s.contacts.some(p=>['requesting','messaging'].includes(p.state))){await recoverNetwork();await pauseNetwork('Interrupted send requires manual inspection.');return;}
    const settings=s.settings??defaultSettings;
    if(!withinActiveHours(settings)){await note(s,`Quiet hours: outreach resumes at ${String(settings.activeHours!.from).padStart(2,'0')}:00 local time. Nothing is wrong.`);return;}
    // Confirm a few times a day that the same LinkedIn account is still signed in before acting on its behalf.
    if(Date.now()-(s.ownerVerifiedAt??0)>OWNER_RECHECK){
      const tab=await networkTab('https://www.linkedin.com/in/me/',abort.signal);
      const {url}=z.object({url:z.string()}).parse(await networkCommand(tab,{action:'identity'},abort.signal));
      if(url!==s.profile.url)throw new Error('A different LinkedIn account is signed in. Sign in as the account you set up, or clear saved data and read the new profile.');
      await updateNetwork(c=>({...c,ownerVerifiedAt:Date.now()}));return;
    }
    const person=nextContact(s);
    if(person){
      if(Date.now()<s.nextActionAt)return;
      worked=true;
      try{await processContact(s,person,abort.signal);if(s.failureStreak)await updateNetwork(c=>({...c,failureStreak:0}));}
      catch(error){
        const message=error instanceof Error?error.message:String(error);
        if(abort.signal.aborted||ACCOUNT_LEVEL.test(message))throw error;
        // One unreadable or unusable profile must not stop the campaign, and must not be retried forever.
        let streak=0;
        await updateNetwork(c=>{
          const p=c.contacts.find(x=>x.url===person.url);streak=(c.failureStreak??0)+1;c.failureStreak=streak;c.intent=null;
          if(p){p.failures=(p.failures??0)+1;p.lastError=message;
            if(p.failures>=MAX_ATTEMPTS){p.state='attention';p.reason=`Could not be processed twice: ${message} Open the profile in LinkedIn to check it.`;}
            else p.retryAfter=Date.now()+30*60000;}
          c.status=`Could not process ${person.name}: ${message} Moving on.`;return c;});
        if(streak>=STREAK_LIMIT)throw new Error(`${STREAK_LIMIT} LinkedIn pages in a row could not be handled (${message}). LinkedIn may have changed its layout or shown a notice. Check LinkedIn, then resume.`);
      }
      return;
    }
    const queued=s.contacts.filter(p=>p.state==='shortlisted').length;
    const why=idleReason(s);
    if(why){await note(s,why);return;}
    if(queued>=SHORTLIST_BACKLOG){await note(s,`${queued} people are queued. Searching pauses until the queue shrinks.`);return;}
    if(Date.now()>=s.nextDiscoveryAt){worked=true;await discover(s,abort.signal);}
  }catch(error){if(!abort.signal.aborted)await pauseNetwork(error instanceof Error?error.message:String(error));}
  finally{clearInterval(renewal);controller=null;await release(owner);}
}
export async function networkTick():Promise<void>{
  if(running)return;worked=false;running=run();try{await running;}finally{running=null;}
  // The alarm only fires once a minute. When a step just finished and more can be done, carry on after a short,
  // irregular pause instead of leaving the person staring at an idle screen. Sending still obeys the pace setting.
  if(worked&&typeof chrome!=='undefined'&&chrome.alarms?.onAlarm)setTimeout(()=>{void networkTick();},5000+Math.floor(Math.random()*7000));
}
