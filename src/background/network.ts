import { z } from 'zod';
import { DAY, MAX_REVIEW_QUEUE, SHORTLIST_BACKLOG, defaultSettings, emptyNetwork, networkKey, networkProfileSchema, nextContact, renderNote, introduction, withinActiveHours, type NetworkJob, type NetworkState, type NetworkContact } from '../shared/network';
import { COMPANY_KINDS, classify, companyMatches, functionWords, normalizeCompany, planSearch, companyOf } from '../shared/targeting';
import { read, mutate } from '../storage/state';
import { put } from '../storage/database';
import { acquire, release, renew } from './lease';
import { networkCommand, networkTab } from './network-browser';
import { prepareIntroduction, prepareInvitation } from './network-ai';

const mirrored=new Map<string,string>();
export const resetMirror=():void=>mirrored.clear();
export async function getNetwork(): Promise<NetworkState> {
  const old=await read<NetworkState>(networkKey);
  if(!old)return emptyNetwork();
  // In-place legacy migration removes old binary CV caches without deleting history.
  const cv=old.cv ? { ...old.cv,name:old.cv.name,type:old.cv.type,text:old.cv.text||'',characterCount:old.cv.characterCount??old.cv.text?.length??0} : null;
  if(cv && 'data' in cv)delete (cv as typeof cv & {data?:unknown}).data;
  return {...old,cv,jobs:old.jobs??[],settings:{...defaultSettings,...old.settings,roles:old.settings?.roles?.length?old.settings.roles:[old.target]}};
}
export async function updateNetwork(fn:(s:NetworkState)=>NetworkState):Promise<NetworkState> {
  const state=await mutate<NetworkState>(networkKey,old=>{
    const base=old??emptyNetwork();
    const cv=base.cv?{...base.cv,name:base.cv.name,type:base.cv.type,text:base.cv.text||'',characterCount:base.cv.characterCount??base.cv.text?.length??0}:null;
    if(cv && 'data' in cv)delete (cv as typeof cv & {data?:unknown}).data;
    return fn({...base,cv,jobs:base.jobs??[],settings:{...defaultSettings,...base.settings,roles:base.settings?.roles?.length?base.settings.roles:[base.target]}});
  });
  // V2 normalized mirrors, account keyed. network-v1 remains the safe migration source.
  if(state.profile){
    const owner=state.profile.url, createdAt=Date.now();
    // Only write records that actually changed; rewriting every contact on every tick does not scale.
    const mirror=async(store:string,id:string,row:Record<string,unknown>,body:unknown)=>{const sig=JSON.stringify(body);if(mirrored.get(`${store}|${id}`)===sig)return;await put(store as 'owners',{id,owner,createdAt,...row} as never);mirrored.set(`${store}|${id}`,sig);};
    await mirror('owners',owner,{profile:state.profile,cv:state.cv,dossier:state.dossier},[state.profile,state.cv,state.dossier]);
    await mirror('outreachSettings',owner,{settings:state.settings},state.settings);
    await mirror('searches',`${owner}|current`,{cursor:state.searchCursor,nextDiscoveryAt:state.nextDiscoveryAt,location:state.location},[state.searchCursor,state.location]);
    for(const j of state.jobs??[])await mirror('outreachCompanies',`${owner}|${j.companyName.toLowerCase()}`,{name:j.companyName,url:j.companyUrl??'',jobId:j.id,sourceCapturedAt:j.sourceCapturedAt},[j.companyName,j.companyUrl,j.id]);
    for(const action of state.actions)await mirror('actions',`${owner}|${action.url}|${action.kind}|${action.at}`,{createdAt:action.at,action},action);
    for(const j of state.jobs??[])await mirror('outreachJobs',`${owner}|${j.id}`,{job:j},j);
    for(const p of state.contacts)await mirror('contacts',`${owner}|${p.url}`,{contact:p},p);
  }
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
const jobDetailSchema=z.object({title:z.string().optional(),companyName:z.string().optional(),companyUrl:z.string().optional(),descriptionText:z.string().optional(),sourceCapturedAt:z.number().optional(),captureStatus:z.enum(['detail','unknown']).optional()});
const jobSchema=z.object({id:z.string(),url:z.string(),title:z.string(),companyName:z.string(),companyUrl:z.string().optional(),location:z.string(),sourceCapturedAt:z.number(),captureStatus:z.enum(['list','detail','unknown']),matchingReasons:z.array(z.string())}).passthrough();
function matchesRole(title:string,roles:string[]):boolean {
  const low=title.toLowerCase();return functionWords(roles).some(w=>low.includes(w));
}
function permittedCompany(name:string,s:NetworkState):boolean {
  const settings=s.settings??defaultSettings,low=name.toLowerCase();
  return !settings.companyExclusions.some(c=>low.includes(c.toLowerCase()))&&(!settings.companyAllowlist.length||settings.companyAllowlist.some(c=>low.includes(c.toLowerCase())));
}
const PER_COMPANY=3; // never pile several invitations onto one company
async function peopleSearch(s:NetworkState,signal:AbortSignal,job?:NetworkJob):Promise<void>{
  const roles=s.settings?.roles??[s.target];
  const url=new URL('https://www.linkedin.com/search/results/people/');
  let label:string;
  if(job){
    const kind=job.peopleSearches??0;
    url.searchParams.set('keywords',`${job.companyName} ${COMPANY_KINDS[kind%COMPANY_KINDS.length]!}${kind%COMPANY_KINDS.length===1?` ${functionWords(roles)[0]??''}`:''}`.trim());
    label=`people at ${job.companyName}`;
  }else{
    const plan=planSearch(roles,s.location,s.searchCursor);
    if(!plan){await updateNetwork(c=>({...c,nextDiscoveryAt:Date.now()+6*3600000,status:'Every search for your current targets has been checked. Add roles or change the location to find more people; new searches resume in 6 hours.'}));return;}
    url.searchParams.set('keywords',plan.combo.keywords);url.searchParams.set('page',String(plan.page));
    label=`${plan.combo.kind==='campus'?'campus recruiters':plan.combo.kind==='recruiter'?'recruiters':plan.combo.kind==='leader'?'team leaders':'founders'} for ${plan.combo.role} (page ${plan.page})`;
  }
  // Only 2nd and 3rd+ degree people can be invited; 1st-degree people are already connected.
  url.searchParams.set('network',JSON.stringify(['S','O']));url.searchParams.set('origin','FACETED_SEARCH');
  const tab=await networkTab(url.href,signal);
  const people=z.array(networkProfileSchema).parse(await networkCommand(tab,{action:'search',owner:s.profile!.url},signal));
  await currentRun(s.revision,signal);
  let added=0,rejected=0;
  await updateNetwork(current=>{
    if(!current.active||current.revision!==s.revision)return current;
    if(job){const stored=current.jobs?.find(j=>j.id===job.id);if(stored)stored.peopleSearches=(stored.peopleSearches??0)+1;}
    const perCompany=new Map<string,number>();
    for(const c of current.contacts){const n=normalizeCompany(c.companyName??companyOf(c.headline)??'');if(n)perCompany.set(n,(perCompany.get(n)??0)+1);}
    for(const person of people){
      if(person.url===current.profile?.url)continue;
      const existed=current.contacts.find(c=>c.url===person.url);
      // A job-linked search needs visible employer evidence in the headline, never just a keyword match.
      if(job&&!companyMatches(person.headline,job.companyName)){rejected++;continue;}
      const verdict=classify({headline:person.headline,location:person.location,...(person.degree?{degree:person.degree}:{})},{roles:current.settings?.roles??[current.target],location:current.location,...(job?{company:job.companyName}:{})});
      if(existed){if(job){existed.jobIds=[...new Set([...(existed.jobIds||[]),job.id])];if(!existed.companyName)existed.companyName=job.companyName;}continue;}
      if(!verdict){rejected++;continue;}
      const company=job?.companyName??verdict.company;const key=normalizeCompany(company??'');
      if(key&&(perCompany.get(key)??0)>=PER_COMPANY){rejected++;continue;}
      if(key)perCompany.set(key,(perCompany.get(key)??0)+1);
      const allowed=permittedCompany(company??person.headline,current);if(!allowed){rejected++;continue;}
      current.contacts.push({...person,reason:job?`${verdict.reason} at ${job.companyName}, linked to ${job.title}`:verdict.reason,score:verdict.score,category:verdict.category,
        state:'shortlisted',addedAt:Date.now(),requestedAt:0,checkedAt:0,messagedAt:0,message:'',
        ...(company?{companyName:company}:{}),...(job?{jobIds:[job.id],companyUrl:job.companyUrl}:{})});added++;
    }
    current.searchCursor++;
    current.nextDiscoveryAt=Date.now()+(people.length?60000:120000)+Math.floor(Math.random()*30000);
    current.status=`Searched ${label}: saved ${added} new ${added===1?'person':'people'}, skipped ${rejected} that did not fit (students, former roles, wrong function, already connected).`;
    return current;
  });
}
async function jobsSearch(s:NetworkState,signal:AbortSignal):Promise<void>{
  const roles=s.settings?.roles??[s.target];const role=roles[Math.floor(s.searchCursor/2)%roles.length]??s.target;
  const u=new URL('https://www.linkedin.com/jobs/search/');
  u.searchParams.set('keywords',role);u.searchParams.set('location',s.location);
  u.searchParams.set('start',String(Math.floor(s.searchCursor/(2*roles.length))*25));
  const tab=await networkTab(u.href,signal);
  const found=z.array(jobSchema).parse(await networkCommand(tab,{action:'jobs',owner:s.profile!.url},signal));
  await currentRun(s.revision,signal);
  const fresh=found.filter(job=>permittedCompany(job.companyName,s)&&matchesRole(job.title,roles));
  await updateNetwork(current=>{
    const merged=new Map((current.jobs??[]).map(j=>[j.id,j]));
    for(const job of fresh){
      const prior=merged.get(job.id);
      // One company needs only one set of people searches, however many of its jobs we saw.
      const sameCompany=[...merged.values()].some(j=>j.id!==job.id&&normalizeCompany(j.companyName)===normalizeCompany(job.companyName));
      merged.set(job.id,{...prior,...job,matchingReasons:[`Job title matches ${role}`],peopleSearches:prior?.peopleSearches??(sameCompany?COMPANY_KINDS.length:0)} as NetworkJob);
    }
    current.jobs=[...merged.values()];current.searchCursor++;current.nextDiscoveryAt=Date.now()+60000;
    current.status=`Found ${found.length} jobs for ${role}; ${fresh.length} fit your roles and allowed companies. Looking for recruiters and leaders at those companies next.`;
    return current;
  });
}
async function discover(s:NetworkState,signal:AbortSignal):Promise<void>{
  const mode=s.settings?.searchMode??'both';
  if(mode!=='people'){
    const needsDetail=s.jobs?.find(j=>j.captureStatus==='list');
    if(needsDetail){
      const tab=await networkTab(needsDetail.url,signal);
      let detail:z.infer<typeof jobDetailSchema>={captureStatus:'unknown'};
      try{detail=jobDetailSchema.parse(await networkCommand(tab,{action:'job',url:needsDetail.url,owner:s.profile!.url},signal));}
      catch{/* The card remains historical evidence even if LinkedIn no longer exposes details. */}
      await currentRun(s.revision,signal);
      await updateNetwork(current=>{const saved=current.jobs?.find(j=>j.id===needsDetail.id);if(saved){
        if(detail.descriptionText)saved.descriptionText=detail.descriptionText;
        if(detail.companyUrl)saved.companyUrl=detail.companyUrl;
        saved.captureStatus=detail.captureStatus??'unknown';
        saved.sourceCapturedAt=Date.now();
      }current.nextDiscoveryAt=Date.now()+60000;current.status=`Inspected job ${needsDetail.id}: ${detail.captureStatus??'unknown'} details.`;return current;});
      return;
    }
  }
  // Jobs-only still needs people: the point of a job is the recruiter or leader behind its company.
  if(mode!=='people'){
    const linked=s.jobs?.find(j=>(j.peopleSearches??0)<COMPANY_KINDS.length);
    if(linked){await peopleSearch(s,signal,linked);return;}
  }
  if(mode==='jobs'||(mode==='both'&&s.searchCursor%2===0)){await jobsSearch(s,signal);return;}
  await peopleSearch(s,signal);
}
/** Errors raised before anything is submitted that are about this recipient only. */
const RECIPIENT_ONLY=/Connect is unavailable on this recipient|requires a recipient email|Message button is unavailable|already have a conversation|unsent draft|already contains a draft|permits \d+ characters/i;
export async function processContact(s:NetworkState,p:NetworkContact,signal:AbortSignal,approved=false):Promise<void>{
  const tab=await networkTab(p.url,signal);
  const relation=z.object({state:z.enum(['connected','pending','not-connected','unknown'])}).parse(await networkCommand(tab,{action:'relationship',url:p.url,owner:s.profile!.url},signal));
  await currentRun(s.revision,signal);
  const now=Date.now();p.checkedAt=now;
  if(relation.state==='pending'){
    if(!p.requestedAt){p.state='skipped';p.reason='A request existed before this campaign; it was not adopted as an extension send.';}
    else{p.state='pending';p.nextCheckAt=now+DAY;p.reason='Still pending. Next acceptance check scheduled for 24 hours later.';}
    await saveContact(p);return;
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
    const data=networkProfileSchema.parse(await networkCommand(tab,{action:'profile',url:p.url,owner:s.profile!.url},signal));
    // The scraped page must be the intended recipient. Never let it rewrite the recipient's identity.
    if(data.url!==p.url){p.state='attention';p.reason='LinkedIn showed a different profile than the intended recipient. Nothing was sent.';await saveContact(p);return;}
    const {url:scrapedUrl,...facts}=data;void scrapedUrl;
    Object.assign(p,facts);
  }
  const me=fresh.profile!.name;
  // ChatGPT personalisation is optional. If it is off, or fails, the user's own template is used so outreach never stalls.
  const draft=async(ai:()=>Promise<string>,template:()=>string):Promise<string>=>{
    if(settings.aiMode!=='chatgpt'||!fresh.dossier?.trim())return template();
    try{const text=await ai();await currentRun(s.revision,signal);await chrome.tabs.update(tab,{active:true});return text;}
    catch(error){if(signal.aborted||/paused/i.test(String(error)))throw error;await chrome.tabs.update(tab,{active:true}).catch(()=>undefined);return template();}
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
    const result=z.object({state:z.enum(['pending','connected','messaged']),noteSent:z.boolean().optional()}).parse(await networkCommand(tab,{action:kind,url:p.url,owner:fresh.profile!.url,intentId:intent.id,body:intent.body,noteMode:settings.noteMode},signal));
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
async function run():Promise<void>{
  const owner=crypto.randomUUID();if(!await acquire(owner))return;
  const abort=new AbortController();controller=abort;
  const renewal=setInterval(()=>{void renew(owner).then(ok=>{if(!ok)abort.abort();});},20000);
  try{
    const s=await getNetwork();if(!s.active||!s.profile)return;
    if(s.intent||s.contacts.some(p=>['requesting','messaging'].includes(p.state))){await recoverNetwork();await pauseNetwork('Interrupted send requires manual inspection.');return;}
    const settings=s.settings??defaultSettings;
    if(!withinActiveHours(settings)){await note(s,`Quiet hours: outreach resumes at ${String(settings.activeHours!.from).padStart(2,'0')}:00 local time. Nothing is wrong.`);return;}
    const person=nextContact(s);
    if(person){if(person.state==='pending'||Date.now()>=s.nextActionAt)await processContact(s,person,abort.signal);return;}
    const queued=s.contacts.filter(p=>p.state==='shortlisted').length;
    const why=idleReason(s);
    if(why){await note(s,why);return;}
    if(queued>=SHORTLIST_BACKLOG){await note(s,`${queued} people are queued. Searching pauses until the queue shrinks.`);return;}
    if(Date.now()>=s.nextDiscoveryAt)await discover(s,abort.signal);
  }catch(error){if(!abort.signal.aborted)await pauseNetwork(error instanceof Error?error.message:String(error));}
  finally{clearInterval(renewal);controller=null;await release(owner);}
}
export async function networkTick():Promise<void>{if(running)return;running=run();try{await running;}finally{running=null;}}
