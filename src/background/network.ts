import { z } from 'zod';
import { legacyNoteTemplate, profileUrl, fitNote, ACCEPTANCE_SWEEP, directMessage, DAY, MAX_REVIEW_QUEUE, SHORTLIST_BACKLOG, defaultSettings, emptyNetwork, networkKey, networkProfileSchema, nextContact, renderNote, introduction, withinActiveHours, type NetworkState, type NetworkContact } from '../shared/network';
import { classify, geoFor, normalizeCompany, planSearch, companyOf } from '../shared/targeting';
import { companyFromCurrent } from '../parsers/network';
import { read, mutate } from '../storage/state';
import { acquire, release, renew } from './lease';
import { referralAsk, referralNote, referralPlan, referralSearchUrl, rankReferral, type ReferralJob, pickCompany } from '../shared/referral';
import { reviewFromReply, reviewPrompt, companyPlanPrompt, fallbackTitles, fill, jobsSearchUrl, planFromReply, planPrompt, rulesPlan, scoreJob, shortlist, sizeForType, sizeOf, strategiesFromReply, withRecruiters, type CompanyStrategy } from '../shared/jobsearch';
import { extractJson } from '../parsers/json';
import { networkCommand, networkTab, showWorkTab } from './network-browser';
import { prepareIntroduction, prepareInvitation, askChatGpt } from './network-ai';

/** Saved settings with defaults filled in. Templates are the default for the first note; v0.10.0 briefly defaulted to ChatGPT, so existing installs are moved back once. A later choice is kept. */
function settingsOf(s:NetworkState):NonNullable<NetworkState['settings']>{
  return {...defaultSettings,...s.settings,roles:s.settings?.roles?.length?s.settings.roles:[s.target],...(s.aiDefaultV3?{}:{aiMode:'template' as const}),...(s.paceV2?{}:{paceMinutes:defaultSettings.paceMinutes}),...(!s.noteV2&&s.settings?.noteTemplate===legacyNoteTemplate?{noteTemplate:defaultSettings.noteTemplate}:{}),...(s.hoursV2?{}:{activeHours:null})};
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
    const settings=settingsOf(base);
    // One-time: drafts still waiting for approval were written with the old closing line; write them again.
    if(!base.noteV2&&base.profile)for(const p of base.contacts??[])if(p.state==='review'&&p.approvalKind==='connect'&&settings.aiMode==='template')p.invitationNote=renderNote(settings,base.target,p,base.profile.name);
    const next=fn({...base,cv,settings});next.noteV2=true;next.aiDefaultV3=true;next.paceV2=true;next.hoursV2=true;
    // Every new status line is also kept in a short activity log the side panel can show.
    if(next.status&&next.status!==before)next.log=[...(next.log??[]),{at:Date.now(),text:next.status,kind:/attention|could not|not signed in|usage limit|paused|limit reached|failed|interrupted|different linkedin account/i.test(next.status)?'warn' as const:/saved|sent|started|confirmed|accepted|recovered|validated/i.test(next.status)?'ok' as const:'info' as const}].slice(-60);
    return next;
  });
  return state;
}
let running:Promise<void>|null=null,controller:AbortController|null=null;
export async function pauseNetwork(reason='Paused. Your saved people and progress are kept.'):Promise<void>{
  // Remember what was running, once: a second pause (or an error after a pause) must not overwrite it.
  await updateNetwork(s=>({...s,...(s.paused?{}:{resumeTo:{active:s.active,...(s.scope?{scope:s.scope}:{})}}),active:false,paused:true,revision:s.revision+1,status:reason}));
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
    for(const p of s.contacts){
      if(p.state==='requesting'){
        // Look at the profile again: Pending means it went out, otherwise it is sent then. Never twice.
        p.attemptedAt=s.intent?.at??Date.now();p.state='review';p.approvalKind='connect';p.approved=true;p.retryAfter=Date.now()+60000;
        p.reason='The browser stopped during this invitation. Checking whether it went out; it will not be sent twice.';
      }else if(p.state==='messaging'){
        p.state='attention';p.reason='The browser stopped while this message was being sent. Open the conversation to check; it will not be sent again.';
      }
    }
    s.intent=null;s.status='Picked up after an interruption. Outreach continues.';return s;
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
  // LinkedIn's own degree filter: 2nd and 3rd+ can be invited; 1st-degree people are already connections and can be messaged straight away.
  url.searchParams.set('network',JSON.stringify(['F','S','O']));url.searchParams.set('origin','FACETED_SEARCH');
  const geo=geoFor(s.location);if(geo)url.searchParams.set('geoUrn',JSON.stringify([geo])); // LinkedIn's Locations filter
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
      const direct=person.degree===1;
      const verdict=classify({headline:person.headline,location:person.location,...(person.degree&&!direct?{degree:person.degree}:{})},{roles:current.settings?.roles??[current.target],location:current.location});
      if(!verdict){rejected++;continue;}
      // LinkedIn's own "Current: Recruiter at X" line is more reliable than guessing the employer from the headline.
      const company=companyFromCurrent(person.current)??verdict.company;const key=normalizeCompany(company??'');
      if(key&&(perCompany.get(key)??0)>=PER_COMPANY){rejected++;continue;}
      if(!permittedCompany(company??person.headline,current)){rejected++;continue;}
      if(key)perCompany.set(key,(perCompany.get(key)??0)+1);
      current.contacts.push({...person,reason:direct?`${verdict.reason}. Already your connection, so a message can go straight to them.`:verdict.reason,score:verdict.score+(direct?15:0),category:verdict.category,
        ...(direct?{direct:true}:{}),state:direct?'connected':'shortlisted',addedAt:Date.now(),requestedAt:0,checkedAt:0,messagedAt:0,message:'',...(company?{companyName:company}:{})});added++;
    }
    current.searchCursor++;
    current.nextDiscoveryAt=Date.now()+(people.length?20000:45000)+Math.floor(Math.random()*20000);
    current.status=`Searched ${label}: saved ${added} new ${added===1?'person':'people'}, skipped ${rejected} that did not fit.`;
    return current;
  });
}
const PENDING_EXPIRY=30*DAY,OWNER_RECHECK=6*3600000;
/** How many people already known at one company are messaged by themselves. */
const KNOWN_AUTO=5;
/**
 * Decides who is contacted for one job once its search is complete (or the person chose "only people I know"):
 * the strongest people already known get a message, the strongest others an invitation, up to the job's own number.
 * Everyone else stays listed with a button.
 */
export function queueBest(current:NetworkState,job:ReferralJob):void{
  const mine=current.contacts.filter(p=>p.referralJob===job.url);
  const open=mine.filter(p=>!p.requestedAt&&!p.messagedAt&&['found','shortlisted','connected'].includes(p.state)).sort((a,b)=>(b.score??0)-(a.score??0));
  const sent=(direct:boolean):number=>mine.filter(p=>!!p.direct===direct&&(p.requestedAt||p.messagedAt||['review','requesting','messaging','pending','messaged'].includes(p.state))).length;
  let messages=sent(true),invites=sent(false);const per=job.perCompany??3;
  for(const p of open){
    const take=p.direct?messages++<KNOWN_AUTO:job.decision!=='known'&&invites++<per;
    if(take){p.state=p.direct?'connected':'shortlisted';p.auto=true;}else{p.state='found';delete p.auto;}
  }
}
const jobRowSchema=z.object({id:z.string().regex(/^\d+$/),title:z.string(),company:z.string(),location:z.string(),insight:z.string(),promoted:z.boolean().optional()});
/** One step of a job search per turn: first the plan (once per set of target roles), then one LinkedIn job search per planned title. */
/* Planning prompts wait at most 40 s for ChatGPT to accept the question and 2 minutes in all; each stage is shown as it happens. */
const AI_STAGES:Record<string,string>={queued:'opening ChatGPT',tab_opened:'ChatGPT page is loading',send_clicked:'question sent',user_turn_verified:'question received',assistant_streaming:'ChatGPT is writing its answer',completion_verified:'answer finished, reading it',response_extracted:'answer read'};
const planLimits=(what:string)=>({startMs:40_000,totalMs:120_000,onStage:(stage:string):void=>{const label=AI_STAGES[stage];if(label)void updateNetwork(c=>({...c,status:`${what}: ${label}…`})).catch(()=>undefined);}});
async function findJobsStep(s:NetworkState,signal:AbortSignal):Promise<void>{
  const roles=s.settings?.roles?.length?s.settings.roles:[s.target],search=s.jobSearch!;
  if(!s.plan||s.plan.forRoles!==roles.join('|')){
    await note(s,'Planning your search: asking ChatGPT for similar job titles (up to 2 minutes; a built-in list is used if it does not answer)…');
    let plan=rulesPlan(roles),why='';
    try{plan=planFromReply(extractJson(await askChatGpt(planPrompt(roles,s.location,`${s.profile?.headline??''}. ${(s.cv?.text||s.profile?.about||'').slice(0,1200)}`),signal,'LEGACY',s.profile!.url,'',planLimits('Planning your search'))),roles);}
    catch(error){why=error instanceof Error?error.message:String(error);if(signal.aborted)throw error;}
    await updateNetwork(c=>({...c,plan,status:plan.source==='chatgpt'?`Search planned with ChatGPT. Job titles to search: ${plan.terms.join(', ')}.`:`ChatGPT was not available (${why.slice(0,110)||'no reply'}), so the built-in plan is used. Job titles to search: ${plan.terms.join(', ')}.`}));
    return;
  }
  const term=s.plan.terms[search.cursor];
  if(term===undefined){
    // Before the person sees the list, ChatGPT takes out adverts and poor matches. If it cannot, the list is shown as it is.
    const list=shortlist(search.found,(s.referralJobs??[]).map(r=>r.company));
    let drop=new Map<string,string>(),why='';
    if(list.length>1){
      await note(s,`Checking ${list.length} jobs with ChatGPT to remove adverts and poor matches (up to 2 minutes)…`);
      try{drop=reviewFromReply(extractJson(await askChatGpt(reviewPrompt(list,roles,s.location),signal,'LEGACY',s.profile!.url,'',planLimits('Checking the job list'))),list.map(j=>j.id));}
      catch(error){why=error instanceof Error?error.message:String(error);if(signal.aborted)throw error;}
    }
    await updateNetwork(c=>{
      const j=c.jobSearch;if(!j||j.status!=='finding')return c;
      j.found=list.filter(x=>!drop.has(x.id));j.dropped=list.filter(x=>drop.has(x.id)).map(x=>({title:x.title,company:x.company,why:drop.get(x.id)!}));j.status='choosing';
      const checked=drop.size?` ChatGPT removed ${drop.size} ${drop.size===1?'advert or poor match':'adverts or poor matches'}.`:why?' ChatGPT could not check the list, so it is unfiltered.':'';
      c.status=j.found.length?`Jobs found at ${j.found.length} companies.${checked} Open Jobs and confirm which ones to pursue.`:'No matching jobs were found. Try other target roles or a wider location in Settings.';
      return c;
    });
    return;
  }
  await note(s,`Searching LinkedIn jobs for “${term}” (${search.cursor+1} of ${s.plan.terms.length})…`);
  let rows:z.infer<typeof jobRowSchema>[]=[];
  try{const tab=await networkTab(jobsSearchUrl(term,s.location),signal);rows=z.array(jobRowSchema).parse(await networkCommand(tab,{action:'jobs'},signal));}
  catch(error){const m=error instanceof Error?error.message:String(error);if(signal.aborted||ACCOUNT_LEVEL.test(m))throw error;}
  await updateNetwork(c=>{
    const j=c.jobSearch;if(!j||j.status!=='finding')return c;
    for(const r of rows)if(!j.found.some(f=>f.id===r.id))j.found.push({...r,url:`https://www.linkedin.com/jobs/view/${r.id}/`,term,picked:false,score:scoreJob(r,roles,c.plan?.terms??[])});
    j.cursor++;c.status=`“${term}”: ${rows.length} ${rows.length===1?'job':'jobs'} read.`;return c;
  });
}
/** One ChatGPT prompt for every company still waiting for a plan: who is worth asking for a referral at each. */
async function planCompanies(s:NetworkState,jobs:ReferralJob[],signal:AbortSignal):Promise<void>{
  const roles=s.settings?.roles?.length?s.settings.roles:[s.target];
  await note(s,`Asking ChatGPT who can refer you at ${jobs.length===1?jobs[0]!.company:`${jobs.length} companies`}…`);
  let found=new Map<string,CompanyStrategy>(),why='';
  try{found=strategiesFromReply(extractJson(await askChatGpt(companyPlanPrompt(jobs.map(j=>({company:j.company,title:j.title,size:j.sizeText})),roles,`${s.profile?.headline??''}. ${(s.cv?.text||s.profile?.about||'').slice(0,1000)}`),signal,'LEGACY',s.profile!.url,'',planLimits('Planning who to ask'))));}
  catch(error){why=error instanceof Error?error.message:String(error);if(signal.aborted)throw error;}
  await updateNetwork(c=>{
    let planned=0;
    for(const j of c.referralJobs??[])if(jobs.some(x=>x.url===j.url)){j.strategyTried=true;const st=found.get(normalizeCompany(j.company));if(st){j.strategy=st;planned++;}}
    c.status=planned?`ChatGPT planned who to ask at ${planned} ${planned===1?'company':'companies'}.`:`ChatGPT was not available (${why.slice(0,110)||'no usable reply'}). Built-in rules by company size are used instead.`;
    return c;
  });
}
/** One search of a job's referral plan per turn; the next follows a few seconds later. */
async function referralScan(s:NetworkState,job:ReferralJob,signal:AbortSignal):Promise<void>{
  // A job taken from a search list: open the job itself once for its company page and LinkedIn's own suggested people.
  if(!job.companyUrl&&!job.infoTried){
    await note(s,`${job.company}: opening the ${job.title} job…`);
    const infoSchema=z.object({companyUrl:z.string().nullable(),location:z.string(),suggested:z.array(z.object({url:z.string(),name:z.string(),headline:z.string(),degree:z.number().optional(),alum:z.boolean().optional()}))});
    const got:{info?:z.infer<typeof infoSchema>}={};
    try{const tab=await networkTab(job.url,signal);got.info=infoSchema.parse(await networkCommand(tab,{action:'jobInfo'},signal));}
    catch(error){const m=error instanceof Error?error.message:String(error);if(signal.aborted||ACCOUNT_LEVEL.test(m))throw error;}
    await updateNetwork(current=>{
      const saved=current.referralJobs?.find(j=>j.url===job.url),info=got.info;
      if(saved){
        saved.infoTried=true;
        if(info?.companyUrl&&/^https:\/\/www\.linkedin\.com\/company\/[^/?#]+\/$/.test(info.companyUrl))saved.companyUrl=info.companyUrl;
        if(info?.suggested.length)saved.suggested=info.suggested.slice(0,10).map(p=>({url:p.url,name:p.name,headline:p.headline,...(p.degree?{degree:p.degree}:{}),...(p.alum?{alum:true}:{})}));
        if(info?.location&&!saved.location)saved.location=info.location;
      }
      return current;
    });
    return;
  }
  // The job did not give the company page: find it through LinkedIn's company search, so the Current company filter can still be used.
  if(!job.companyUrl&&!job.lookupTried){
    await note(s,`${job.company}: looking up the company page on LinkedIn…`);
    let url:string|null=null;
    try{const tab=await networkTab(`https://www.linkedin.com/search/results/companies/?keywords=${encodeURIComponent(job.company)}`,signal);
      url=pickCompany(z.array(z.object({name:z.string(),url:z.string(),lines:z.array(z.string())})).parse(await networkCommand(tab,{action:'companies'},signal)),job.company,job.location);}
    catch(error){const m=error instanceof Error?error.message:String(error);if(signal.aborted||ACCOUNT_LEVEL.test(m))throw error;}
    await updateNetwork(current=>{
      const saved=current.referralJobs?.find(j=>j.url===job.url);
      if(saved){saved.lookupTried=true;if(url)saved.companyUrl=url;else current.status=`${job.company}: no LinkedIn company page with exactly that name. People are searched by name and kept only if they work there now.`;}
      return current;
    });
    return;
  }
  // First, once: read the company's LinkedIn number from its page, so every search can use the Current company filter.
  if(job.companyUrl&&!job.companyId&&!job.idTried){
    await note(s,`${job.company}: finding the company on LinkedIn…`);
    let id:string|null=null,sizeText='';
    try{const tab=await networkTab(job.companyUrl,signal);const read=z.object({id:z.string().nullable(),size:z.string().optional()}).parse(await networkCommand(tab,{action:'companyId'},signal));id=read.id;sizeText=read.size??'';}
    catch(error){const m=error instanceof Error?error.message:String(error);if(signal.aborted||ACCOUNT_LEVEL.test(m))throw error;}
    await updateNetwork(current=>{const saved=current.referralJobs?.find(j=>j.url===job.url);if(saved){saved.idTried=true;if(id)saved.companyId=id;if(sizeText){saved.sizeText=sizeText.slice(0,60);saved.size=sizeOf(sizeText);}current.status=id?`${saved.company}: found. Searching only people who work there now.`:`${saved.company}: company filter unavailable, searching by name instead.`;}return current;});
    return;
  }
  // Which titles to look for depends on the company's size: the planned list when there is one, built-in rules otherwise.
  // ChatGPT's plan for this company when there is one; otherwise the planned list for a company of this size, or built-in rules.
  const size=job.size??(job.strategy?sizeForType[job.strategy.type]:undefined),avoid=job.strategy?.avoid??[];
  const titles=job.companyId&&(job.strategy||size)?withRecruiters(job.strategy?.titles??(s.plan?.titles??fallbackTitles([job.title]))[size!]):undefined;
  const plan=referralPlan(job,titles),step=plan[job.cursor],verified=!!job.companyId;
  let people:z.infer<typeof networkProfileSchema>[]=[],failed='';
  if(step){
    await note(s,`${job.company}: searching ${step.label} (step ${job.cursor+1} of ${plan.length})…`);
    try{
      const tab=await networkTab(referralSearchUrl(step,job.companyId),signal);
      people=z.array(networkProfileSchema).parse(await networkCommand(tab,{action:'search'},signal));
    }catch(error){
      failed=error instanceof Error?error.message:String(error);
      if(signal.aborted||ACCOUNT_LEVEL.test(failed))throw error; // signed out or a security check: stop and say so
    }
  }
  await updateNetwork(current=>{
    const saved=current.referralJobs?.find(j=>j.url===job.url);if(!saved)return current; // removed while searching
    const queue=saved.mode==='referral';let added=0;
    // LinkedIn's own suggestions from the job page are ranked by the same rules, once. They are not known to work
    // at the company, so the company must be visible in their headline; the school flag is carried over.
    const offered=(saved.suggested??[]).flatMap(o=>{const url=profileUrl(o.url);return url?[{url,name:o.name,headline:o.headline,location:'',about:'',...(o.degree?{degree:o.degree}:{}),alum:o.alum===true,offered:true}]:[];});
    delete saved.suggested;
    const alumni=new Set(offered.filter(o=>o.alum).map(o=>o.url));
    for(const row of [...people.map(p=>({...p,alum:alumni.has(p.url),offered:false})),...offered.filter(o=>!people.some(p=>p.url===o.url))]){
      const {alum,offered:fromLinkedIn,...person}=row;
      if(person.url===current.profile?.url)continue;
      const verdict=rankReferral({...person,alum},{...saved,...(size?{size}:{})},verified&&!fromLinkedIn,titles??[],avoid);if(!verdict)continue;
      const direct=person.degree===1,state='found' as const; // everyone is listed first; the strongest are queued together once the search is complete
      const existing=current.contacts.find(c=>c.url===person.url);
      if(existing){
        // Someone already on the list is tied to this job only if nothing has been sent to them yet.
        if(existing.referralJob||existing.requestedAt||existing.messagedAt||!['found','shortlisted','skipped','connected','review'].includes(existing.state))continue;
        Object.assign(existing,{referralJob:saved.url,score:verdict.score,reason:verdict.reason,category:verdict.kind,companyName:saved.company,message:'',state,...(direct?{direct:true}:{})});
        delete existing.invitationNote;delete existing.approvalKind;delete existing.approved;added++;continue;
      }
      current.contacts.push({...person,reason:verdict.reason,score:verdict.score,category:verdict.kind,companyName:saved.company,referralJob:saved.url,
        ...(direct?{direct:true}:{}),state,addedAt:Date.now(),requestedAt:0,checkedAt:0,messagedAt:0,message:''});added++;
    }
    // A short page means there is no next page of the same search: skip it.
    saved.cursor+=plan[saved.cursor+1]?.page&&people.length<10?2:1;saved.found+=added;
    // After the "people you know" searches: if there are some, the person decides whether that is enough.
    const knownSteps=plan.filter(st=>st.network.join()==='F').length;
    if(queue&&verified&&saved.decision===undefined&&saved.cursor>=knownSteps&&saved.cursor<plan.length){
      saved.known=current.contacts.filter(p=>p.referralJob===saved.url&&p.direct).length;
      if(saved.known){saved.waiting=true;current.status=`You already know ${saved.known} ${saved.known===1?'person':'people'} at ${saved.company}. Choose in the Referrals tab: ask only them, or also look for stronger referrers.`;return current;}
      saved.decision='widen';
    }
    if(saved.cursor>=plan.length){
      saved.finishedAt=Date.now();
      if(queue)queueBest(current,saved);
      current.status=saved.found?`${saved.company}: found ${saved.found} ${saved.found===1?'person':'people'} who can help with ${saved.title}. See the Referrals tab.`:`${saved.company}: nobody suitable was found for ${saved.title}. LinkedIn may be showing few people from this company.`;
    }else current.status=failed?`${saved.company}: one search could not be read (${failed.slice(0,120)}). Carrying on.`:`${saved.company}: ${added} found in ${step?.label??'this search'}. Next search in a few seconds.`;
    return current;
  });
}
async function sweepAcceptances(s:NetworkState,signal:AbortSignal):Promise<void>{
  await note(s,'Checking your connections list for people who accepted…');
  const tab=await networkTab('https://www.linkedin.com/mynetwork/invite-connect/connections/',signal);
  const connected=new Set(z.array(z.string()).parse(await networkCommand(tab,{action:'connections'},signal)));
  await currentRun(s.revision,signal);
  await updateNetwork(current=>{
    const names:string[]=[],now=Date.now();
    for(const p of current.contacts)if(p.state==='pending'&&p.requestedAt>0&&connected.has(p.url)){
      p.state='connected';p.acceptedAt=now;p.checkedAt=now;p.reason='Accepted your invitation. A follow-up message is next.';names.push(p.name);
    }
    for(const item of current.saved??[])if(item.type==='person'&&item.relation==='pending'&&connected.has(item.url)){item.relation='connected';item.acceptedAt=now;names.push(item.title);}
    current.nextSweepAt=now+ACCEPTANCE_SWEEP+Math.floor(Math.random()*600000);
    current.status=names.length?`${names.slice(0,3).join(', ')}${names.length>3?` and ${names.length-3} more`:''} accepted your invitation.`:'No new acceptances yet. Checking again in about 2 hours.';
    return current;
  });
}
/** Checks are spaced out too, so a laptop waking up never fires a burst of page loads. */
async function pace(minMs:number,maxMs:number):Promise<void>{await updateNetwork(c=>({...c,nextActionAt:Math.max(c.nextActionAt,Date.now()+minMs+Math.floor(Math.random()*(maxMs-minMs)))}));}
/** Account-level signals pause everything. Anything else is about one contact. */
const ACCOUNT_LEVEL=/HALT:|sign in to linkedin|signed out|signed-in linkedin account|different linkedin account|checkpoint|outreach (?:was|is|has been) paused|no longer authorized|did not finish loading/i;
const MAX_ATTEMPTS=2,STREAK_LIMIT=3;
/** Errors raised before anything is submitted that are about this recipient only. */
const RECIPIENT_ONLY=/Connect is unavailable on this recipient|requires a recipient email|Message button is unavailable|already have a conversation|unsent draft|already contains a draft|permits \d+ characters|open profile changed/i;
export async function processContact(s:NetworkState,p:NetworkContact,signal:AbortSignal,approved=false):Promise<void|false>{
  let failed=false;void failed;
  await note(s,`Opening ${p.name}'s profile…`);
  const tab=await networkTab(p.url,signal);
  const relation=z.object({state:z.enum(['connected','pending','not-connected','unknown'])}).parse(await networkCommand(tab,{action:'relationship',url:p.url},signal));
  await currentRun(s.revision,signal);
  const now=Date.now();p.checkedAt=now;if(approved)delete p.approved;
  if(relation.state==='pending'){
    if(!p.requestedAt&&p.attemptedAt){
      // The earlier send did go through after all.
      p.requestedAt=p.attemptedAt;delete p.attemptedAt;delete p.approvalKind;delete p.retryAfter;p.failures=0;p.state='pending';p.nextCheckAt=now+3*DAY;p.reason='Invitation sent (confirmed on a second look). The first acceptance check is in 24 hours.';
      await updateNetwork(current=>{const action=current.actions.find(a=>a.url===p.url&&a.kind==='connect'&&a.confirmed===false);if(action)action.confirmed=true;current.status=`Invitation to ${p.name} confirmed.`;return current;});
    }
    else if(!p.requestedAt){p.state='skipped';p.reason='A request existed before this campaign; it was not adopted as an extension send.';}
    else if(now-p.requestedAt>PENDING_EXPIRY){p.state='skipped';p.reason='No response after 30 days. LinkedIn may still show it as pending: consider withdrawing it under My Network, Manage, Sent, which also frees your pending count.';}
    else{p.state='pending';p.nextCheckAt=now+3*DAY;p.reason='Invitation sent. Your connections list is checked every 2 hours for an acceptance.';}
    await saveContact(p);await pace(40000,90000);return;
  }
  if(p.attemptedAt&&relation.state==='not-connected'){delete p.attemptedAt;await updateNetwork(current=>{current.actions=current.actions.filter(a=>!(a.url===p.url&&a.kind==='connect'&&a.confirmed===false));return current;});} // it was not sent; send it now
  if(relation.state!=='connected'&&p.direct&&!p.requestedAt){delete p.direct;p.state='shortlisted';} // not a connection after all: invite them like anyone else
  if(relation.state==='connected'&&!p.requestedAt&&!p.direct){p.state='skipped';p.reason='Already connected before this campaign. No artificial acceptance event was created.';await saveContact(p);return;}
  if(p.requestedAt&&relation.state!=='connected'){
    p.state=relation.state==='unknown'||relation.state==='not-connected'?'attention':'pending';
    p.reason='A known invitation is not visibly pending or accepted. Check it manually; do not invite again.';
    p.nextCheckAt=now+DAY;await saveContact(p);return;
  }
  if(p.requestedAt&&relation.state==='connected'&&p.state==='connected'&&p.acceptedAt){/* already recorded by the connections check */}
  else if(p.requestedAt&&relation.state==='connected'&&!p.acceptedAt){
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
  // Found for a specific job: the wording is about that job and a referral, not general networking.
  const job=p.referralJob?fresh.referralJobs?.find(j=>j.url===p.referralJob):undefined;
  // Wording written for this company comes first, then the wording planned for the whole search, then the built-in text.
  const wording=job?{note:job.strategy?.note??fresh.plan?.note,ask:job.strategy?.ask??fresh.plan?.ask,followUp:job.strategy?.followUp??fresh.plan?.followUp}:undefined;
  const words=job?{firstName:p.name.split(/\s+/)[0]||p.name,myFirstName:me.split(/\s+/)[0]||me,title:job.title,company:job.company,jobUrl:job.url}:undefined;
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
    p.invitationNote=job?fitNote(wording?.note?fill(wording.note,words!):referralNote(job,p,me)):await draft(()=>prepareInvitation(fresh,p,200,signal),()=>renderNote(settings,fresh.target,p,me));
  if(kind==='message'&&!p.message)
    p.message=job?((p.direct?wording?.ask:wording?.followUp)?fill((p.direct?wording!.ask:wording!.followUp)!,words!):referralAsk(job,p,me,!p.direct)):p.direct?directMessage(fresh,p,me):await draft(()=>prepareIntroduction(fresh,p,signal),()=>introduction(fresh,p,me));
  const review=kind==='connect'?settings.outreachMode==='review':settings.followupMode==='review';
  if(review&&!approved&&!p.auto){
    p.state='review';p.approvalKind=kind;p.reason=kind==='connect'?'Invitation ready. Approve to send.':p.direct?'Already your connection. Message ready; approve to send.':'They accepted. Follow-up message ready; approve to send.';
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
    if(kind==='connect'){p.requestedAt=Date.now();p.nextCheckAt=p.requestedAt+3*DAY;p.state='pending';p.reason=`Invitation confirmed Pending${result.noteSent===false&&settings.noteMode!=='none'?' (sent without a note: LinkedIn did not offer one)':''}. The first acceptance check is in 24 hours.`;}
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
    }else if(ACCOUNT_LEVEL.test(message)){
      // About the account or the browser, not this person: keep them approved and stop until it is sorted out.
      p.state='review';p.approvalKind=kind;p.approved=true;p.reason='Waiting to be sent once outreach resumes.';
      await updateNetwork(current=>{current.actions=current.actions.filter(a=>!(a.at===intent.at&&a.url===p.url&&a.kind===kind));return current;});
      await saveContact(p);
      await pauseNetwork(message.replace(/^HALT:\s*/,''));
      return false;
    }else{
      failed=true;
      p.failures=(p.failures??0)+1;
      // Only errors raised before the Send click are certain. Anything else (a lost reply, a timeout) might have gone out.
      const unsure=!/No invitation was sent|no request was submitted|was NOT sent|no longer authorized|left untouched|is unavailable|before sending|could not be verified\.$/i.test(message);
      if(unsure&&kind==='connect'){
        // Send was pressed but LinkedIn was slow to show Pending. Look again shortly: if it is pending it counts as sent, if not it is sent then. Never twice.
        p.attemptedAt=intent.at;p.state='review';p.approvalKind=kind;p.approved=true;p.retryAfter=Date.now()+2*60000;
        p.reason='LinkedIn was slow to confirm this invitation. Checking again in 2 minutes; it will not be sent twice.';
      }else if(unsure){
        // A message cannot be re-checked safely, so this one is left for the person. Everyone else carries on.
        p.state='attention';p.reason=`${message} Open the conversation to check whether it was sent. It will not be sent again.`;
      }else if(p.failures>=MAX_ATTEMPTS){
        p.state='skipped';p.reason=`Could not be sent after ${MAX_ATTEMPTS} tries (${message}). Skipped; nothing was sent to this person.`;
      }else{
        // Certainly not sent: try again by itself in a few minutes, already approved.
        p.state='review';p.approvalKind=kind;p.approved=true;p.retryAfter=Date.now()+5*60000;
        p.reason=`Did not go through (${message}). Trying again in 5 minutes.`;
      }
      let streak=0;
      await updateNetwork(current=>{
        if(!unsure)current.actions=current.actions.filter(a=>!(a.at===intent.at&&a.url===p.url&&a.kind===kind));
        streak=(current.failureStreak??0)+1;current.failureStreak=streak;
        current.status=`Could not send to ${p.name}: ${message} Carrying on with the others.`;return current;});
      await saveContact(p);
      if(streak>=STREAK_LIMIT)await pauseNetwork(`${STREAK_LIMIT} sends in a row failed (${message}). LinkedIn may have changed something or shown a notice. Check the LinkedIn window, then press Start.`);
      return false;
    }
  }
  await saveContact(p);
}
/** Why nothing can be sent right now, in plain words. */
function idleReason(s:NetworkState,now=Date.now()):string|null {
  const st=s.settings??defaultSettings,count=(k:'connect'|'message',span:number)=>s.actions.filter(a=>a.kind===k&&a.confirmed!==false&&now-a.at<span).length;
  if(s.contacts.filter(p=>p.state==='review'&&!p.approved).length>=MAX_REVIEW_QUEUE)return `${MAX_REVIEW_QUEUE} drafts are waiting for your review. Approve or skip them to continue.`;
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
    const s=await getNetwork();if(!s.profile)return;
    // Paused means everything: searches and reading as well as sending. Starting or resuming anything lifts it.
    if(s.paused)return;
    // A referral search was asked for by a click on a job page, so it runs straight away, even while outreach is paused or outside active hours. It only reads.
    if(s.jobSearch?.status==='finding'){worked=true;await findJobsStep(s,abort.signal);return;}
    // Before any company is searched: one prompt covering every company that has no plan yet.
    const unplanned=(s.referralJobs??[]).filter(j=>j.finishedAt===undefined&&j.mode==='referral'&&!j.strategy&&!j.strategyTried).slice(0,20);
    if(unplanned.length){worked=true;await planCompanies(s,unplanned,abort.signal);return;}
    const scan=(s.referralJobs??[]).find(j=>j.finishedAt===undefined&&!j.waiting);
    if(scan){
      worked=true;
      try{await referralScan(s,scan,abort.signal);}
      catch(error){
        const message=error instanceof Error?error.message:String(error);
        if(abort.signal.aborted||ACCOUNT_LEVEL.test(message))throw error;
        // One company that cannot be read must not block the others or a new job search: retry twice, then close it with what was found.
        await updateNetwork(c=>{
          const j=(c.referralJobs??[]).find(x=>x.url===scan.url);if(!j)return c;
          j.failures=(j.failures??0)+1;
          if(j.failures>=3){j.finishedAt=Date.now();j.error=message.slice(0,200);if(j.mode==='referral')queueBest(c,j);c.status=`${j.company}: LinkedIn pages could not be read after three tries, so this company is closed with what was found. The other companies carry on.`;}
          else c.status=`${j.company}: a page did not load properly. Trying again (${j.failures} of 3).`;
          return c;});
      }
      return;
    }
    if(!s.active)return;
    // A send that was cut off (browser closed, tab crashed) is sorted out by itself and outreach carries on.
    if(s.intent||s.contacts.some(p=>['requesting','messaging'].includes(p.state))){await recoverNetwork();worked=true;return;}
    const settings=s.settings??defaultSettings;
    if(!withinActiveHours(settings)){await note(s,`Quiet hours: outreach resumes at ${String(settings.activeHours!.from).padStart(2,'0')}:00 local time. Nothing is wrong.`);return;}
    // Confirm a few times a day that the same LinkedIn account is still signed in before acting on its behalf.
    if(Date.now()-(s.ownerVerifiedAt??0)>OWNER_RECHECK){
      const tab=await networkTab('https://www.linkedin.com/in/me/',abort.signal);
      const {url}=z.object({url:z.string()}).parse(await networkCommand(tab,{action:'identity'},abort.signal));
      if(url!==s.profile.url)throw new Error('A different LinkedIn account is signed in. Sign in as the account you set up, or clear saved data and read the new profile.');
      await updateNetwork(c=>({...c,ownerVerifiedAt:Date.now()}));return;
    }
    // Every 2 hours, one look at the connections list shows everyone who accepted, however many invitations are out.
    const waiting=s.contacts.some(p=>p.state==='pending'&&p.requestedAt>0)||(s.saved??[]).some(i=>i.type==='person'&&i.relation==='pending');
    if(waiting&&Date.now()>=(s.nextSweepAt??0)){worked=true;await sweepAcceptances(s,abort.signal);return;}
    // In referrals-only running, general contacts are left exactly as they are.
    const referralsOnly=s.scope==='referrals',view=referralsOnly?{...s,contacts:s.contacts.filter(p=>p.referralJob)}:s;
    const person=nextContact(view);
    if(person){
      if(Date.now()<s.nextActionAt)return;
      worked=true;
      try{const ok=await processContact(s,person,abort.signal,person.state==='review'&&person.approved===true);if(ok!==false&&s.failureStreak)await updateNetwork(c=>({...c,failureStreak:0}));}
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
    const queued=view.contacts.filter(p=>p.state==='shortlisted').length;
    const why=idleReason(view);
    if(why){await note(s,why);return;}
    if(queued>=SHORTLIST_BACKLOG){await note(s,`${queued} people are queued. Searching pauses until the queue shrinks.`);return;}
    if(referralsOnly){await note(s,view.contacts.some(p=>p.state==='pending')?'Referral invitations are out. Acceptances are checked every 2 hours.':'Referral outreach is up to date.');return;}
    if(Date.now()>=s.nextDiscoveryAt){worked=true;await discover(s,abort.signal);}
  }catch(error){if(!abort.signal.aborted)await pauseNetwork(error instanceof Error?error.message:String(error));}
  finally{clearInterval(renewal);controller=null;await release(owner);}
}
let again=false;
export async function networkTick():Promise<void>{
  // A request that arrives while a step is still winding down (Pause, then Resume straight away) is not dropped: it runs right after.
  if(running){again=true;return;}
  worked=false;running=run();try{await running;}finally{running=null;}
  if(again){again=false;setTimeout(()=>{void networkTick();},300);return;}
  // The alarm only fires once a minute. When a step just finished and more can be done, carry on after a short,
  // irregular pause instead of leaving the person staring at an idle screen. Sending still obeys the pace setting.
  if(worked&&typeof chrome!=='undefined'&&chrome.alarms?.onAlarm)setTimeout(()=>{void networkTick();},5000+Math.floor(Math.random()*7000));
}
