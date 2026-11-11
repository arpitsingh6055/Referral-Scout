import { z } from 'zod';
import { rememberMessage, type SavedItem, networkRequest, networkProfileSchema, profileUrl, networkKey, suggestedTarget, defaultSettings, type NetworkState, DAY, introduction, renderNote } from '../shared/network';
import { trustedExtension, trustedSite } from '../validators/security';
import { getNetwork, updateNetwork, pauseNetwork, networkTick, processContact } from './network';
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
    status:'Your LinkedIn profile is saved. Check your target and introduction below, then press Start outreach.'}));
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
    const parsed=networkRequest.safeParse(input);if(!parsed.success)return false;
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
      const owner=crypto.randomUUID();if(!await acquire(owner))throw new Error('A LinkedIn step is already finishing. Try again once it completes.');
      const timer=setInterval(()=>{void renew(owner);},20000);
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
            nextDiscoveryAt:0,status:'Target roles, mode, pacing and filters saved.'}));
        }
        if(req.action==='saveCv'){
          if(current.active)throw new Error('Pause outreach before changing your CV.');
          if(!current.profile)throw new Error('Read your own LinkedIn profile before adding a CV so text is linked to the right owner.');
          await clearAiJobs();
          await updateNetwork(s=>({...s,cv:{name:req.name,type:req.type,text:req.text,textVersion:2,savedAt:Date.now(),characterCount:req.text.length,...(req.pages?{pages:req.pages}:{})},
            dossier:'',dossierSavedAt:0,contacts:s.contacts.map(p=>{if(p.messagedAt)return p;const {invitationNote:oldNote,...rest}=p;void oldNote;return {...rest,message:''};}),
            status:`Extracted ${req.text.length.toLocaleString()} readable characters locally from ${req.name}; no binary file retained.`}));
        }
        if(req.action==='deleteCv'){
          if(current.active)throw new Error('Pause outreach before deleting your CV.');
          await clearAiJobs();
          await updateNetwork(s=>({...s,cv:null,dossier:'',dossierSavedAt:0,status:'Local extracted CV text deleted. Reprocess the owner profile before outreach.'}));
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
            return {...s,active:true,revision:s.revision+1,status:s.settings?.outreachMode==='automatic'?'Outreach started. Invitations are sent automatically within your limits.':'Outreach started. Finding people and drafting notes for you to approve.'};
          });
          await chrome.alarms.create('network-tick',{periodInMinutes:1});
        }
        if(req.action==='approve'){
          const fresh=await getNetwork();
          if(!fresh.active||!fresh.profile)throw new Error('Start or resume outreach before approving a pending draft.');
          const person=fresh.contacts.find(p=>p.url===req.url);
          if(!person||person.state!=='review'||!person.approvalKind)throw new Error('This recipient has no valid send awaiting review.');
          await processContact(fresh,person,signal,true);
        }
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
          const forMessage=!!p.acceptedAt;
          const text=req.action==='editDraft'?req.text:forMessage?introduction(s,p,s.profile.name):renderNote(s.settings??defaultSettings,s.target,p,s.profile.name);
          if(!forMessage&&text.length>200)throw new Error(`LinkedIn allows 200 characters in an invitation note; this is ${text.length}.`);
          if(forMessage)p.message=text;else p.invitationNote=text;
          return s;
        });
        if(req.action==='forget')await updateNetwork(s=>({...s,saved:(s.saved??[]).filter(x=>x.url!==req.url)}));
        if(req.action==='skip')await updateNetwork(s=>{const p=s.contacts.find(p=>p.url===req.url);if(p){p.state='skipped';p.reason='Skipped. No future action is scheduled.';}return s;});
        if(req.action==='clear')await clearAllNetwork();
        return statusView(await getNetwork());
      }finally{clearInterval(timer);await release(owner);if(req.action==='start')void networkTick();}
    })().then(data=>respond({ok:true,data})).catch((error:unknown)=>respond({ok:false,error:error instanceof Error?error.message:String(error)}));return true;
  });
}
