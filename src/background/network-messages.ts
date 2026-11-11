import { z } from 'zod';
import { rememberMessage, type SavedItem, networkRequest, networkProfileSchema, profileUrl, networkKey, suggestedTarget, defaultSettings, type NetworkState, DAY, introduction, renderNote , directMessage, unfinished } from '../shared/network';
import { trustedExtension, trustedSite } from '../validators/security';
import { referralMessage, referralAsk, referralNote } from '../shared/referral';
import { fitNote } from '../shared/network';
import { getNetwork, updateNetwork, pauseNetwork, networkTick, queueBest } from './network';
import { networkCommand, networkTab } from './network-browser';
import { acquire, release, renew } from './lease';
import { all, remove } from '../storage/database';
import { prepareDossier, prepareInvitation, prepareIntroduction, clearAiJobs, recoverDossier } from './network-ai';
import { validatedDossier } from '../shared/dossier';

const authorization=z.object({kind:z.literal('network.authorize'),id:z.uuid(),claim:z.boolean()});
async function importProfile():Promise<void>{
  const signal=new AbortController().signal;
  // linkedin.com/in/me/ always redirects to the signed-in person's own profile, so no menu has to be opened or guessed.
  const tab=await networkTab('https://www.linkedin.com/in/me/',signal);
  const {url:identity}=z.object({url:z.string().refine(v=>profileUrl(v)===v)}).parse(await networkCommand(tab,{action:'identity'},signal));
  const current=await getNetwork();
  if(current.profile&&current.profile.url!==identity&&(current.cv||current.contacts.length||current.dossier))throw new Error('Different LinkedIn account detected. Export or clear this account’s saved outreach before switching; CVs are owner-scoped.');
  const profile=networkProfileSchema.parse(await networkCommand(tab,{action:'profile',url:identity},signal));
  await updateNetwork(s=>({...s,profile,profileCapturedAt:Date.now(),ownerVerifiedAt:Date.now(),...(s.profile?.url===profile.url?{}:{dossier:'',dossierSavedAt:0}),
    contacts:s.contacts.map(p=>{if(p.messagedAt)return p; const {invitationNote:oldNote,...rest}=p;void oldNote;return {...rest,message:''};}),
    target:s.profile?s.target:suggestedTarget(profile.headline,profile.rawText??''),location:s.profile?s.location:(profile.location.split(',').pop()?.trim()||'India'),
    status:'Your LinkedIn profile is saved. Next: say what you are looking for.'}));
}
async function clearAllNetwork():Promise<void>{
  await remove('meta',networkKey);await clearAiJobs();
  await remove('meta','network-tab');
}
function statusView(s:NetworkState):NetworkState {
  // Polls are metadata only. Exact CV/profile text is read by the background
  // when needed for a user-initiated ChatGPT job; never sent on each sidepanel poll.
  return {...s,
    ...(s.profile?{profile:(()=>{const {sections:original,...rest}=s.profile!;void original;return {...rest,rawText:''};})()}:{}),
    ...(s.cv?{cv:{...s.cv,text:'',textVersion:2,characterCount:s.cv.characterCount??s.cv.text.length}}:{}),
    contacts:s.contacts.map(p=>({...p,rawText:''}))};
}
export function registerNetworkMessages():void{
  chrome.runtime.onMessage.addListener((input:unknown,sender,respond)=>{
    const auth=authorization.safeParse(input);
    if(auth.success){
      if(!trustedSite(sender,chrome.runtime.id)||!profileUrl(sender.url??'')){respond({allowed:false});return false;}
      void (async()=>{
        let allowed=false;
        await updateNetwork(s=>{
          const i=s.intent;
          allowed=!!i&&s.active&&i.revision===s.revision&&i.id===auth.data.id&&i.tabId===sender.tab?.id&&i.url===profileUrl(sender.url??'')&&Date.now()-i.at<120000&&(auth.data.claim?!i.claimed:i.claimed);
          if(allowed&&i&&auth.data.claim)i.claimed=true;
          return s;
        });return allowed;
      })().then(allowed=>respond({allowed})).catch(()=>respond({allowed:false}));return true;
    }
    const referral=referralMessage.safeParse(input);
    if(referral.success){
      // Sent by the two referral buttons on a LinkedIn job page.
      if(!trustedSite(sender,chrome.runtime.id)){respond({ok:false});return false;}
      if(sender.tab?.id!==undefined)void chrome.sidePanel?.open?.({tabId:sender.tab.id}).catch(()=>undefined); // show progress where the person can see it
      const {mode,job}=referral.data;
      void (async()=>{
        if(!(await getNetwork()).profile)return {ok:false,message:'Open Referral Scout and read your LinkedIn profile first.'};
        let message='';
        await updateNetwork(s=>{
          const list=s.referralJobs??(s.referralJobs=[]),old=list.find(j=>j.url===job.url);
          if(!old){list.unshift({...job,mode,addedAt:Date.now(),cursor:0,found:0});s.referralJobs=list.slice(0,100);message='Searching. See the Referrals tab.';}
          else if(old.mode==='connections'&&mode==='referral'){
            // Already listed the connections; now also look wider and reach out.
            old.mode='referral';old.cursor=0;delete old.finishedAt;
            message='Reaching out. See the Referrals tab.';
          }else if(old.finishedAt){
            // Asked again: search again from the start (new people join, and the search itself may have improved).
            old.cursor=0;old.found=s.contacts.filter(p=>p.referralJob===job.url).length;delete old.finishedAt;delete old.idTried;message='Searching again. See the Referrals tab.';
          }else message='Already searching. See the Referrals tab.';
          if(old&&job.companyUrl&&!old.companyUrl)old.companyUrl=job.companyUrl;
          if(old&&job.suggested)old.suggested=job.suggested;
          s.status=`${job.company}: ${mode==='referral'?'looking for people who can refer you for':'listing your connections for'} ${job.title}.`;
          // "Ask for referrals" means act now. If outreach is paused, switch on referral outreach only; general outreach stays off.
          if(mode==='referral'&&!s.active){s.active=true;s.revision++;s.scope='referrals';}
          return s;
        });
        void updateNetwork(s=>{delete s.paused;return s;}).then(()=>networkTick());
        return {ok:true,message};
      })().then(respond).catch(()=>respond({ok:false,message:'Something went wrong. Open Referral Scout for details.'}));return true;
    }
    const remember=rememberMessage.safeParse(input);
    if(remember.success){
      // Sent by the Remember button on a LinkedIn page. Only the top frame of a real LinkedIn tab may use it.
      if(!trustedSite(sender,chrome.runtime.id)){respond({saved:null});return false;}
      const {action,item}=remember.data;
      void (async()=>{
        let result:SavedItem|null=null;
        const before=(await getNetwork()).saved?.find(x=>x.url===item.url);
        if(action==='get'&&(!before||!item.relation||before.relation===item.relation))return before??null; // nothing to write
        await updateNetwork(s=>{
          const list=s.saved??[],old=list.find(x=>x.url===item.url);
          if(action==='remove'){s.saved=list.filter(x=>x.url!==item.url);return s;}
          if(action==='get'){
            if(old&&item.relation){
              if(old.relation==='pending'&&item.relation==='connected'){old.acceptedAt=Date.now();s.status=`${old.title} accepted your connection request.${old.note?` Your note: ${old.note}`:''}`;}
              old.relation=item.relation;
            }
            result=old??null;return s;
          }
          result={...old,...item,note:item.note||old?.note||'',savedAt:old?.savedAt??Date.now()};
          s.saved=[result,...list.filter(x=>x.url!==item.url)].slice(0,500);
          return s;
        });
        return result;
      })().then(saved=>respond({saved})).catch(()=>respond({saved:null}));return true;
    }
    if(!trustedExtension(sender,chrome.runtime.id))return false;
    const parsed=networkRequest.safeParse(input);
    if(!parsed.success){
      // Never go silent on the side panel: say which value was not accepted, in plain words.
      if(!input||typeof input!=='object'||!('kind' in input)||input.kind!=='network')return false;
      const issue=parsed.error.issues[0],field=String(issue?.path.at(-1)??'');
      const names:Record<string,string>={paceMinutes:'Seconds between sends (5 or more)',dailyInvites:'Invitations per day',dailyMessages:'Messages per day',weeklyInvites:'Invitations per week',maxPending:'Pending invitations limit',roles:'Target roles (at least one, 2 letters or more)',noteTemplate:'Invitation note (10 characters or more)',template:'Follow-up message (10 characters or more)',target:'Target role',from:'Active hours',to:'Active hours'};
      respond({ok:false,error:`Not saved. Please check: ${names[field]??(field||'one of the values')}.`});return false;
    }
    const req=parsed.data;
    void (async()=>{
      if(req.action==='status')return statusView(await getNetwork());
      if(req.action==='ownerData')return getNetwork();
      if(req.action==='export'){const state=await getNetwork();return {...state,aiTaskMetadata:(await all('aiJobs')).filter(j=>j.owner===state.profile?.url)};}
      if(req.action==='diagnostics'){const state=statusView(await getNetwork());const jobs=(await all('aiJobs')).filter(j=>j.owner===state.profile?.url).map(j=>({stage:j.stage,updatedAt:j.updatedAt,tab:j.tab,error:j.error,id:j.id}));return {...state,diagnostics:jobs};}
      if(req.action==='selfTest'){
        const tabs=await chrome.tabs.query({url:['https://www.linkedin.com/*','https://linkedin.com/*']});
        const tab=tabs.find(t=>t.active)??tabs[0];
        if(!tab?.id)throw new Error('Open a LinkedIn people search or a profile in a tab first.');
        const result=await networkCommand(tab.id,{action:'selftest'},new AbortController().signal);
        return {...statusView(await getNetwork()),selfTest:result};
      }
      if(req.action==='pause'){await pauseNetwork();return statusView(await getNetwork());}
      if(req.action==='clear')await pauseNetwork();
      const signal=new AbortController().signal;
      // Only reading your own profile needs the LinkedIn tab to itself. Everything else (approving, editing, skipping,
      // saving, a ChatGPT rewrite in its own window) runs alongside whatever outreach is doing and never waits for it.
      const exclusive=req.action==='import';
      const owner=crypto.randomUUID();if(exclusive&&!await acquire(owner))throw new Error('Outreach is in the middle of a LinkedIn step. Your profile will be readable in a few seconds; try again.');
      const timer=setInterval(()=>{if(exclusive)void renew(owner);},20000);
      try{
        const current=await getNetwork();
        if(req.action==='import'){
          if(current.active)throw new Error('Pause outreach before refreshing your profile.');
          await importProfile();await clearAiJobs();
        }
        if(req.action==='save'){
          if(current.active)throw new Error('Pause outreach before editing settings.');
          if(/\{(?!firstName\}|target\})[^}]*\}/.test(req.template))throw new Error('Only {firstName} and {target} are supported in the optional manual template.');
          const settings=req.settings??{...(current.settings??defaultSettings),roles:req.target.split(/[;,\n]+/).map(x=>x.trim()).filter(Boolean)};
          await updateNetwork(s=>({...s,target:req.target,location:req.location,template:req.template,settings,
            nextDiscoveryAt:0,targetSet:true,status:'Settings saved.'}));
        }
        if(req.action==='saveCv'){
          if(current.active)throw new Error('Pause outreach before changing your CV.');
          if(!current.profile)throw new Error('Read your own LinkedIn profile before adding a CV so text is linked to the right owner.');
          await clearAiJobs();
          await updateNetwork(s=>({...s,cv:{name:req.name,type:req.type,text:req.text,textVersion:2,savedAt:Date.now(),characterCount:req.text.length,...(req.pages?{pages:req.pages}:{})},
            dossier:'',dossierSavedAt:0,contacts:s.contacts.map(p=>{if(p.messagedAt)return p;const {invitationNote:oldNote,...rest}=p;void oldNote;return {...rest,message:''};}),
            status:`CV saved (${req.text.length.toLocaleString()} characters, text only). ChatGPT will use it when you ask it to rewrite a message.`}));
        }
        if(req.action==='deleteCv'){
          if(current.active)throw new Error('Pause outreach before deleting your CV.');
          await clearAiJobs();
          await updateNetwork(s=>({...s,cv:null,dossier:'',dossierSavedAt:0,status:'CV text deleted from this device.'}));
        }
        if(req.action==='analyze'){
          if(current.active)throw new Error('Pause outreach before reprocessing the owner dossier.');
          await updateNetwork(s=>({...s,status:'Opening visible ChatGPT and waiting for a verified dossier response…'}));
          try{
            const dossier=await prepareDossier(await getNetwork(),signal);
            await updateNetwork(s=>({...s,dossier,dossierSavedAt:Date.now(),status:'Validated dossier saved locally. Ready to find people.'}));
          }catch(error){
            await updateNetwork(s=>({...s,status:`ChatGPT processing needs attention: ${error instanceof Error?error.message:String(error)}. Original source evidence remains saved.`}));
            throw error;
          }
        }
        if(req.action==='importDossier'||req.action==='recoverAi'){
          if(current.active)throw new Error('Pause outreach before saving a dossier.');
          if(!current.profile)throw new Error('Read your own LinkedIn profile first.');
          const dossier=req.action==='importDossier'?validatedDossier(req.text):await recoverDossier(current.profile.url);
          await updateNetwork(s=>({...s,dossier,dossierSavedAt:Date.now(),status:req.action==='importDossier'?'Pasted ChatGPT reply validated and saved as your dossier.':'Reply recovered from the ChatGPT conversation, validated and saved.'}));
        }
        if(req.action==='resetAi'){
          if(current.active)throw new Error('Pause outreach before resetting ChatGPT tasks.');
          await clearAiJobs();
          await updateNetwork(s=>({...s,status:'Stuck ChatGPT tasks cleared. You can process again.'}));
        }
        if(req.action==='prepare'){
          const person=current.contacts.find(p=>p.url===req.url);
          if(!person||!current.profile)throw new Error('Read your LinkedIn profile first.');
          if(person.direct)throw new Error('ChatGPT rewriting is for invitations and follow-ups. Edit this message directly instead.');
          const message=person.acceptedAt?await prepareIntroduction(current,person,signal):await prepareInvitation(current,person,200,signal);
          await updateNetwork(s=>{const p=s.contacts.find(x=>x.url===person.url);if(p)if(p.acceptedAt)p.message=message;else p.invitationNote=message;return {...s,status:`Draft prepared for ${person.name}. No LinkedIn message was sent.`};});
        }
        if(req.action==='start'){
          const after=await getNetwork();
          if(!after.profile)throw new Error('Read your own LinkedIn profile first.');
          await updateNetwork(s=>{
            if(s.revision!==after.revision)throw new Error('Outreach was paused while processing; start again when ready.');
            // v0.9.0 read a hidden "1st" label and wrongly set people aside as already connected; give them another look.
            for(const p of s.contacts)if(p.state==='skipped'&&/^Already connected before this campaign/.test(p.reason)&&!p.requestedAt){p.state='shortlisted';p.reason='Queued again after a wrong "already connected" reading.';}
            return {...s,active:true,scope:'all' as const,revision:s.revision+1,status:s.settings?.outreachMode==='automatic'?'Outreach started. Invitations are sent automatically within your limits.':'Outreach started. Finding people and drafting notes for you to approve.'};
          });
          await chrome.alarms.create('network-tick',{periodInMinutes:1});
        }
        if(req.action==='approve'){
          // Approving never blocks: the message joins a short send queue and outreach sends it in turn, a few seconds apart.
          await updateNetwork(s=>{
            const waiting=s.contacts.filter(p=>p.state==='review'&&p.approvalKind&&!p.approved&&(req.url==='*'||p.url===req.url));
            if(!waiting.length)throw new Error('There is no message waiting for approval here.');
            for(const p of waiting){p.approved=true;p.reason='Approved. It will be sent in turn, a few seconds after the previous one.';}
            s.status=waiting.length===1?`Approved for ${waiting[0]!.name}. Sending shortly.`:`${waiting.length} messages approved. They are sent one after another.`;
            return s;
          });
          void updateNetwork(s=>{delete s.paused;return s;}).then(()=>networkTick());
        }
        if(req.action==='unapprove')await updateNetwork(s=>{
          const p=s.contacts.find(x=>x.url===req.url);
          if(!p||p.state!=='review'||!p.approved)throw new Error('This message has already gone out or is being sent right now.');
          delete p.approved;p.reason='Sending cancelled. It is waiting for your approval again.';return s;
        });
        if(req.action==='removeContact'){await updateNetwork(s=>({...s,contacts:s.contacts.filter(p=>p.url!==req.url)}));}
        if(req.action==='updateSaved')await updateNetwork(s=>{
          const item=s.saved?.find(x=>x.url===req.url);if(!item)throw new Error('This saved item no longer exists.');
          if(req.status&&req.status!==item.status){item.status=req.status;item.statusAt=Date.now();}
          if(req.note!==undefined)item.note=req.note.trim();
          if(req.remindDays===null)delete item.remindAt;
          else if(req.remindDays!==undefined){
            // "In 5 days" means the morning of that day, so it is waiting when the person starts work, not at the same minute.
            const due=new Date(Date.now()+req.remindDays*DAY);if(req.remindDays>0)due.setHours(8,0,0,0);item.remindAt=due.getTime();
          }
          return s;
        });
        if(req.action==='editDraft'||req.action==='templateDraft')await updateNetwork(s=>{
          const p=s.contacts.find(x=>x.url===req.url);
          if(!p||!s.profile||['pending','messaged','requesting','messaging'].includes(p.state))throw new Error('This message can no longer be changed.');
          const forMessage=!!p.acceptedAt||!!p.direct;
          const job=p.referralJob?s.referralJobs?.find(j=>j.url===p.referralJob):undefined;
          const text=req.action==='editDraft'?req.text:job?(forMessage?referralAsk(job,p,s.profile.name,!p.direct):fitNote(referralNote(job,p,s.profile.name))):p.direct?directMessage(s,p,s.profile.name):forMessage?introduction(s,p,s.profile.name):renderNote(s.settings??defaultSettings,s.target,p,s.profile.name);
          if(!forMessage&&text.length>200)throw new Error(`LinkedIn allows 200 characters in an invitation note; this is ${text.length}.`);
          if(forMessage)p.message=text;else p.invitationNote=text;
          return s;
        });
        if(req.action==='askReferral')await updateNetwork(s=>{
          const p=s.contacts.find(x=>x.url===req.url);if(!p||p.state!=='found')throw new Error('This person is already queued or has been contacted.');
          p.state=p.direct?'connected':'shortlisted';p.auto=true;
          if(!s.active){s.active=true;s.revision++;s.scope='referrals';}
          s.status=`${p.name} queued. ${p.direct?'A message':'An invitation'} goes out in turn.`;return s;
        });
        const referralsOn=(s:NetworkState):void=>{if(!s.active){s.active=true;s.revision++;s.scope='referrals';}};
        if(req.action==='findJobs'){
          if(!current.profile)throw new Error('Read your LinkedIn profile first.');
          await updateNetwork(s=>({...s,jobSearch:{status:'finding',cursor:0,found:[],startedAt:Date.now()},status:'Starting your job search…'}));
        }
        if(req.action==='resume')await updateNetwork(s=>{
          // After a pause, exactly what was running comes back: sending only if it was on, with the same scope. Without a pause this is "Resume sending".
          const back=s.paused?s.resumeTo:undefined;
          if(back){if(back.active&&!s.active){s.active=true;s.revision++;}if(back.scope)s.scope=back.scope;}else referralsOn(s);
          delete s.paused;delete s.resumeTo;s.failureStreak=0;
          const left=unfinished(s,s.active);
          s.status=left.length?`Resumed: ${left.join('; ')}.`:'Resumed. Nothing was left unfinished.';return s;});
        if(req.action==='cancelJobSearch')await updateNetwork(s=>{delete s.jobSearch;s.status='Job search closed. Companies you already chose are kept.';return s;});
        if(req.action==='pickJobs')await updateNetwork(s=>{
          const search=s.jobSearch;if(!search||search.status==='finding')throw new Error('The job list is not ready yet.');
          const chosen=search.found.filter(j=>req.ids.includes(j.id));if(!chosen.length)throw new Error('Tick at least one company.');
          const list=s.referralJobs??(s.referralJobs=[]);
          for(const j of chosen.reverse())if(!list.some(r=>r.url===j.url))list.unshift({url:j.url,title:j.title,company:j.company,location:j.location,mode:'referral',addedAt:Date.now(),cursor:0,found:0,perCompany:req.perCompany});
          s.referralJobs=list.slice(0,100);
          search.found=search.found.filter(j=>!req.ids.includes(j.id)).map(j=>({...j,picked:false}));search.status='working';
          referralsOn(s);
          s.status=`${chosen.length} ${chosen.length===1?'company':'companies'} chosen. Finding who can refer you, one company at a time.`;return s;
        });
        if(req.action==='referralDecision')await updateNetwork(s=>{
          const job=s.referralJobs?.find(j=>j.url===req.url);if(!job)throw new Error('This job is no longer in Referrals.');
          job.decision=req.widen?'widen':'known';delete job.waiting;
          if(!req.widen){job.finishedAt=Date.now();queueBest(s,job);}
          referralsOn(s);
          s.status=req.widen?`${job.company}: also looking for stronger referrers.`:`${job.company}: asking only the people you already know.`;return s;
        });
        if(req.action==='removeReferralJob')await updateNetwork(s=>{
          s.referralJobs=(s.referralJobs??[]).filter(j=>j.url!==req.url);
          // People only listed for this job go with it; anyone already queued or contacted stays on the People list.
          s.contacts=s.contacts.filter(p=>!(p.referralJob===req.url&&p.state==='found'));
          for(const p of s.contacts)if(p.referralJob===req.url&&!p.requestedAt&&!p.messagedAt&&['shortlisted','connected','review'].includes(p.state)){p.state='skipped';p.reason='The job was removed from Referrals.';delete p.approved;}
          return s;
        });
        if(req.action==='forget')await updateNetwork(s=>({...s,saved:(s.saved??[]).filter(x=>x.url!==req.url)}));
        if(req.action==='skip')await updateNetwork(s=>{const p=s.contacts.find(p=>p.url===req.url);if(p){p.state='skipped';p.reason='Skipped. No future action is scheduled.';}return s;});
        if(req.action==='clear')await clearAllNetwork();
        return statusView(await getNetwork());
      }finally{clearInterval(timer);if(exclusive)await release(owner);if(['start','askReferral','findJobs','pickJobs','referralDecision','resume'].includes(req.action))void updateNetwork(s=>{delete s.paused;return s;}).then(()=>networkTick());}
    })().then(data=>respond({ok:true,data})).catch((error:unknown)=>respond({ok:false,error:error instanceof Error?error.message:String(error)}));return true;
  });
}
