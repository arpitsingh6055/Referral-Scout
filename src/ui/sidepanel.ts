import './network.css';
import { appRoot, element, errorText } from './render';
import { DAY, defaultSettings, type NetworkRequest, type NetworkState, type ContactState, type OutreachSettings } from '../shared/network';
import { completeCvText } from './cv-text';
import { renderNote, introduction } from '../shared/network';
import { createToaster, type ToastKind } from './toast';

const root=appRoot();let busy=false,filter='all',last:NetworkState|null=null,signature='';
const notice=element('div');notice.className='notice';notice.setAttribute('role','status');
const page=element('div');root.append(notice,page);
const toaster=createToaster(document.body);let spoke=false;
/** One place for every user-visible outcome: a toast, plus a persistent banner for errors. */
function notify(kind:ToastKind,message:string):void{spoke=true;toaster.show(kind,message);notice.textContent=kind==='error'?message:'';}
const withHint=(m:string)=>/cannot be verified|uncertain|did not return the required|Recover reply/i.test(m)&&!/Stuck\?/.test(m)?`${m} Your reply may already be in ChatGPT: open "Stuck? Recover a ChatGPT reply" in step 1.`:m;
const aiSteps:[string,string][]=[['queued','Preparing the ChatGPT task'],['tab_opened','ChatGPT tab opened, waiting for the page'],['current_document_ready','ChatGPT page is ready'],['composer_stable','Composer is ready'],['prompt_inserted','Prompt pasted, checking it is complete'],['insertion_verified','Prompt verified, sending it'],['send_clicked','Sent, waiting for ChatGPT to accept it'],['user_turn_verified','ChatGPT received it, waiting for the reply'],['assistant_streaming','ChatGPT is writing the reply'],['completion_verified','Reply finished, reading it'],['response_extracted','Reply received, validating it']];
/** Live progress while a ChatGPT task runs, driven by the task stages the extension already records. */
async function withProgress<T>(title:string,run:()=>Promise<T>):Promise<T>{
  const started=Date.now(),toast=toaster.show('progress',`${title}…`);spoke=true;
  const poll=setInterval(()=>{void request({kind:'network',action:'diagnostics'}).then(d=>{
    const jobs=(d as NetworkState&{diagnostics?:{stage:string;updatedAt:number}[]}).diagnostics??[];
    const latest=jobs.filter(j=>j.updatedAt>=started-2000).sort((a,b)=>b.updatedAt-a.updatedAt)[0];if(!latest)return;
    const i=aiSteps.findIndex(([k])=>k===latest.stage);if(i>=0)toast.update(`${title}: step ${i+1} of ${aiSteps.length}. ${aiSteps[i]![1]}…`,'progress');
  }).catch(()=>undefined);},1500);
  try{return await run();}finally{clearInterval(poll);toast.close();}
}
function node<K extends keyof HTMLElementTagNameMap>(tag:K,text='',className=''):HTMLElementTagNameMap[K]{
  const result=element(tag,text);result.className=className;return result;
}
async function request(data:NetworkRequest):Promise<NetworkState>{
  const reply=await chrome.runtime.sendMessage(data) as {ok:boolean;data?:NetworkState;error?:string};
  if(!reply?.ok||!reply.data)throw new Error(reply?.error||'The extension did not respond. Reload it and retry.');
  return reply.data;
}
function button(text:string,action:()=>Promise<void>,className='button',done?:string):HTMLButtonElement{
  const b=node('button',text,className);b.type='button';
  b.addEventListener('click',()=>{
    if(busy)return;busy=true;b.disabled=true;notice.textContent='';spoke=false;
    void action().then(()=>{if(!spoke)notify('success',done??`${text}: done.`);}).catch(e=>notify('error',withHint(errorText(e)))).finally(()=>{busy=false;b.disabled=false;});
  });return b;
}
function link(text:string,url:string,className='text-link'):HTMLAnchorElement{
  const a=node('a',text,className);a.href=url;a.target='_blank';a.rel='noopener noreferrer';return a;
}
async function act(data:NetworkRequest,done?:string):Promise<void>{const state=await request(data);render(state);notify('success',done??(state.status||'Done.'));}
function field(label:string,value:string,multiline=false):{label:HTMLLabelElement;input:HTMLInputElement|HTMLTextAreaElement}{
  const wrapper=node('label',label),input=multiline?node('textarea'):node('input');input.value=value;
  if(input instanceof HTMLTextAreaElement)input.rows=multiline?4:2;
  wrapper.append(input);return {label:wrapper,input};
}
function optionField(label:string,value:string,choices:[string,string][]):{label:HTMLLabelElement;input:HTMLSelectElement}{
  const wrapper=node('label',label),input=node('select');
  for(const [v,name] of choices){const opt=node('option',name);opt.value=v;input.append(opt);}input.value=value;wrapper.append(input);return {label:wrapper,input};
}
const labels:Record<ContactState,string>={shortlisted:'Shortlisted',requesting:'Attempting invitation',pending:'Invitation pending',connected:'Accepted',messaging:'Sending',messaged:'Introduction sent',attention:'Needs attention',skipped:'Skipped',review:'Needs approval'};
const localDate=(t?:number)=>t?new Date(t).toLocaleString(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}):'Not yet';
function render(s:NetworkState):void{
  last=s;signature=JSON.stringify(s);page.replaceChildren();
  const header=node('header','','brand');header.append(node('span','cc','brand-mark'),node('span','Cold Contact Pro','brand-name'),node('span','LINKEDIN','eyebrow'));page.append(header);
  if(!s.profile){
    const hero=node('section','','welcome');hero.append(node('span','LINKEDIN + VISIBLE CHATGPT','eyebrow'),node('h1','Relevant people, better introductions.'),
      node('p','Read your LinkedIn profile, check who we will contact and your introduction, then press Start. We find recruiters, hiring leaders and founders, send invitations slowly, and send one introduction after someone accepts. Nothing is sent without your approval unless you change that.','lede'),
      button('Read my LinkedIn profile',async()=>{await act({kind:'network',action:'import'},'Profile saved. Check your target and introduction below, then press Start outreach.');},'button primary wide'),
      node('p','Sign in to LinkedIn first. This only reads your own profile and stores it on this device.','hint'),
      node('p','LinkedIn restricts automated activity. Defaults are deliberately slow and conservative, but you use this at your own risk.','hint'));
    page.append(hero);return;
  }
  const greeting=node('div','','greeting');greeting.append(node('span','OWNER','eyebrow'),node('h1',s.active?'Outreach active':'Your outreach workspace'));page.append(greeting);
  const profile=node('section','','profile-strip');profile.append(node('div',s.profile.name.split(/\s+/).map(n=>n[0]).slice(0,2).join(''),'avatar'));
  const identity=node('div');identity.append(link(s.profile.name,s.profile.url,'profile-name'),node('p',s.profile.headline,'muted'));profile.append(identity);page.append(profile);

  const owner=node('details','','control-card');owner.append(node('summary',`Optional: personalise with ChatGPT using your CV${s.dossier?' · dossier ready':''}`),
    node('p',s.dossier?'Career dossier validated and saved. Turn on ChatGPT personalisation in Advanced settings to use it.':'Only needed if you want ChatGPT to write each note. Your template works without it.','hint'));
  const source=node('div');source.append(node('p',`LinkedIn captured: ${localDate(s.profileCapturedAt)} · ${s.profile.url}`,'hint'));
  source.append(button('View full LinkedIn source',async()=>{
    const details=await request({kind:'network',action:'ownerData'});preview.textContent=details.profile?.rawText||'No detailed profile text was captured.';
  },'button quiet'));
  const preview=node('pre','','source-preview');source.append(preview);owner.append(source);
  const cvLabel=node('label',s.cv?`Extracted CV: ${s.cv.name} · ${(s.cv.characterCount??0).toLocaleString()} characters`:'Optional CV (PDF, DOCX or TXT)');
  const cv=node('input') as HTMLInputElement;cv.type='file';cv.accept='.pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain';cv.disabled=s.active;
  cv.addEventListener('change',()=>{
    if(busy)return;const file=cv.files?.[0];if(!file)return;
    if(file.size>30_000_000){notify('error','The CV is larger than 30 MB. Convert it to a text-searchable PDF or DOCX first.');cv.value='';return;}
    busy=true;cv.disabled=true;spoke=false;notify('info','Extracting CV text locally. No original file will be retained…');
    void file.arrayBuffer().then(async buffer=>{
      const extracted=await completeCvText(buffer,file.name);
      const pages=(extracted.match(/^\[Page \d+\]/gm)||[]).length;
      const saved=await request({kind:'network',action:'saveCv',name:file.name,type:file.type||'text/plain',text:extracted,...(pages?{pages}:{})});
      render(saved);notify('success',`CV saved: ${extracted.length.toLocaleString()} characters read locally. Next: press Process with ChatGPT.`);
    }).catch(e=>notify('error',`CV could not be read: ${errorText(e)}`)).finally(()=>{busy=false;cv.disabled=false;});
  });
  cvLabel.append(cv);owner.append(cvLabel);
  if(s.cv){
    const row=node('div','','person-actions');row.append(button('View extracted CV text',async()=>{
      const data=await request({kind:'network',action:'ownerData'});cvPreview.textContent=data.cv?.text||'No extracted CV text available.';
    },'button quiet'),button('Delete CV text',async()=>{if(confirm('Delete extracted CV text and invalidate your dossier?'))await act({kind:'network',action:'deleteCv'},'CV text deleted. Process with ChatGPT again to refresh your dossier.');},'button text-button'));
    owner.append(row);const cvPreview=node('pre','','source-preview');owner.append(cvPreview);
  }
  owner.append(node('p','CVs are parsed inside the extension. Only readable text is included in the visible ChatGPT prompt. No attachments are used for outreach.','hint'));
  if(!s.active)owner.append(button(s.dossier?'Reprocess with ChatGPT':'Process with ChatGPT',async()=>{
    await withProgress('Processing with ChatGPT',()=>act({kind:'network',action:'analyze'},'Dossier validated and saved. Next: check your targets in step 2, then press Start.'));
  },'button primary wide'));
  if(s.dossier){const detail=node('details');detail.append(node('summary','Inspect validated career dossier'),node('pre',s.dossier,'source-preview'));owner.append(detail);}
  if(!s.active){
    const rescue=node('details','','recovery');rescue.append(node('summary','Stuck? Recover a ChatGPT reply'),
      node('p','Use this if ChatGPT answered but nothing was saved, or if you see “cannot be verified”. The first and last buttons never send anything to ChatGPT.','hint'));
    const pasted=node('textarea') as HTMLTextAreaElement;pasted.placeholder='Paste ChatGPT’s JSON reply here';
    rescue.append(
      button('Recover reply from the open ChatGPT tab',()=>act({kind:'network',action:'recoverAi'}),'button quiet wide','Reply recovered and saved as your dossier.'),
      pasted,
      button('Save pasted reply',async()=>{if(!pasted.value.trim())throw new Error('Paste the JSON reply from ChatGPT first.');await act({kind:'network',action:'importDossier',text:pasted.value},'Pasted reply validated and saved as your dossier.');},'button quiet wide'),
      button('Clear stuck ChatGPT tasks',()=>act({kind:'network',action:'resetAi'},'Stuck ChatGPT tasks cleared. You can press Process with ChatGPT again.'),'button text-button'));
    owner.append(rescue);
  }

  const settings=s.settings??defaultSettings;
  const preferences=node('details','','preferences');preferences.append(node('summary','Advanced: sending, limits and safety'));
  const roles=field('Target titles (one per line)',settings.roles.join('\n'),true);
  const location=field('Search geography',s.location);
  const searchMode=optionField('Search',settings.searchMode,[['both','Jobs + People'],['jobs','Jobs only'],['people','People only']]);
  const outreachMode=optionField('Sending invitations',settings.outreachMode,[['review','Review before every send'],['automatic','Automatic after Start']]);
  const noteMode=optionField('Connection note',settings.noteMode,[['require','Always require a note'],['preferred','Use a note when available'],['none','Send without note (explicit choice)']]);
  const followupMode=optionField('Sending post-acceptance messages',settings.followupMode,[['review','Review before every send'],['automatic','Automatically after confirmed acceptance']]);
  const pace=field('Minutes between sends (minimum 1)',String(settings.paceMinutes));if(pace.input instanceof HTMLInputElement){pace.input.type='number';pace.input.min='1';pace.input.max='1440';}
  const invites=field('Optional daily invitation threshold (blank = none)',settings.dailyInvites?.toString()??'');if(invites.input instanceof HTMLInputElement){invites.input.type='number';invites.input.min='1';}
  const messages=field('Optional daily follow-up threshold (blank = none)',settings.dailyMessages?.toString()??'');if(messages.input instanceof HTMLInputElement){messages.input.type='number';messages.input.min='1';}
  const maxPending=field('Optional pending-invitation threshold (blank = none)',settings.maxPending?.toString()??'');if(maxPending.input instanceof HTMLInputElement){maxPending.input.type='number';maxPending.input.min='1';}
  const allow=field('Preferred company names, separated by commas',settings.companyAllowlist.join(', '));
  const exclude=field('Exclude companies, separated by commas',settings.companyExclusions.join(', '));
  const template=field('Message sent once after they accept ({firstName}, {target}, {myFirstName}, {company})',s.template,true);
  const noteTemplate=field('Invitation note, max 200 characters ({firstName}, {myFirstName}, {target}, {company})',settings.noteTemplate,true);
  const aiMode=optionField('How notes are written',settings.aiMode,[['template','My templates (recommended, no ChatGPT needed)'],['chatgpt','Personalise with ChatGPT (needs CV processed below)']]);
  const weekly=field('Weekly invitation limit (blank = none). LinkedIn restricts accounts that send too many',settings.weeklyInvites?.toString()??'');if(weekly.input instanceof HTMLInputElement){weekly.input.type='number';weekly.input.min='1';}
  const hours=optionField('When to act',settings.activeHours?'on':'off',[['on',`Only ${settings.activeHours?.from??8}:00 to ${settings.activeHours?.to??22}:00 local time (recommended)`],['off','Any time of day']]);
  const sample=node('p','','hint');
  const refreshSample=():void=>{const sampleNote=renderNote({noteTemplate:noteTemplate.input.value||settings.noteTemplate},roles.input.value.split(/[\n;,]+/)[0]?.trim()||s.target,{name:'Priya Sharma',companyName:'Acme'},s.profile!.name);sample.textContent=`Preview (${sampleNote.length}/200): ${sampleNote}`;};
  noteTemplate.input.addEventListener('input',refreshSample);roles.input.addEventListener('input',refreshSample);refreshSample();
  const everyField=[roles,location,searchMode,outreachMode,noteMode,followupMode,pace,invites,messages,maxPending,allow,exclude,template,noteTemplate,aiMode,weekly,hours];
  for(const f of everyField)f.input.disabled=s.active;
  // Plan: who and what. Advanced: everything about pace and safety.
  const plan=node('section','','control-card');plan.append(node('h2','1. Who to contact'),node('p','We search for recruiters, team leaders in your field, and founders, and skip students, former roles and people you already know.','hint'),roles.label,location.label);
  const intro=node('section','','control-card');intro.append(node('h2','2. Your introduction'),noteTemplate.label,sample,template.label,node('p',`Example follow-up: ${introduction({template:template.input.value||s.template,target:s.target},{name:'Priya Sharma',companyName:'Acme'},s.profile.name)}`,'hint'));
  for(const f of [searchMode,outreachMode,noteMode,followupMode,aiMode,pace,invites,weekly,messages,maxPending,hours,allow,exclude])preferences.append(f.label);
  const fields=everyField;void fields;
  const csv=(v:string)=>v.split(',').map(x=>x.trim()).filter(Boolean);
  const optional=(v:string)=>v.trim()?Number(v):null;
  async function save():Promise<void>{
    const nextRoles=roles.input.value.split(/[\n;,]+/).map(x=>x.trim()).filter(Boolean);
    if(!nextRoles.length)throw new Error('Enter at least one target role.');
    const newSettings:OutreachSettings={...settings,roles:nextRoles,aiMode:aiMode.input.value as OutreachSettings['aiMode'],noteTemplate:noteTemplate.input.value.trim()||settings.noteTemplate,weeklyInvites:optional(weekly.input.value),activeHours:hours.input.value==='on'?(settings.activeHours??{from:8,to:22}):null,searchMode:searchMode.input.value as OutreachSettings['searchMode'],outreachMode:outreachMode.input.value as OutreachSettings['outreachMode'],noteMode:noteMode.input.value as OutreachSettings['noteMode'],followupMode:followupMode.input.value as OutreachSettings['followupMode'],paceMinutes:Number(pace.input.value),dailyInvites:optional(invites.input.value),dailyMessages:optional(messages.input.value),maxPending:optional(maxPending.input.value),companyAllowlist:csv(allow.input.value),companyExclusions:csv(exclude.input.value)};
    await request({kind:'network',action:'save',target:nextRoles[0]!,location:location.input.value,template:template.input.value,settings:newSettings});
  }
  if(!s.active)preferences.append(button('Save settings',async()=>{await save();await act({kind:'network',action:'status'},'Settings saved.');},'button primary wide'));
  preferences.append(node('p','Review mode is the default. Automatic mode can send through visible LinkedIn tabs after you press Start. Site blocks or uncertain actions always pause.','hint'));
  page.append(plan,intro);

  const control=node('section','','control-card');
  const state=node('div','','state-line');state.append(node('span','',s.active?'dot live':'dot'),node('strong',s.active?'Outreach running':'Outreach stopped or paused'));control.append(state);
  control.append(node('p',s.status||'Ready to start.','muted'));
  control.append(button(s.active?'Pause outreach':'Start outreach',async()=>{
    if(s.active)await act({kind:'network',action:'pause'},'Outreach paused. Your progress is kept.');
    else{await save();const needsAi=aiMode.input.value==='chatgpt'&&!s.dossier?.trim();const go=()=>act({kind:'network',action:'start'},'Outreach started. It works slowly in visible LinkedIn tabs and pauses on anything uncertain.');if(needsAi)await withProgress('Processing your dossier, then starting outreach',go);else await go();}
  },s.active?'button wide':'button primary wide'));
  control.append(node('p','A per-contact 24-hour check runs only when the browser is running. Missed checks become due on the next launch. Pausing is retained across restarts.','hint'));
  page.append(control);

  const stats=node('div','','stats');
  for(const [name,count] of [['Contacts',s.contacts.filter(p=>p.state!=='skipped').length],['Jobs',s.jobs?.length??0],['Pending',s.contacts.filter(p=>p.state==='pending').length],['Introduced',s.contacts.filter(p=>p.state==='messaged').length]] as const){
    const el=node('div');el.append(node('strong',String(count)),node('span',name));stats.append(el);
  }page.append(stats);

  page.append(preferences,owner);

  const jobs=node('details','','people-section');jobs.append(node('summary',`Matched LinkedIn jobs · ${s.jobs?.length??0}`));
  for(const j of (s.jobs??[]).slice(-60).reverse()){
    const card=node('article','','person');card.append(link(j.title,j.url,'person-name'),node('p',`${j.companyName} · ${j.location}`,'person-headline'),node('p',j.matchingReasons.join(' · '),'hint'));
    card.append(node('p',`Captured ${localDate(j.sourceCapturedAt)} · ${j.captureStatus} evidence; may no longer be open.`,'hint'));
    if(j.companyUrl)card.append(link('Company page',j.companyUrl));
    card.append(node('p',`Associated contacts: ${s.contacts.filter(p=>p.jobIds?.includes(j.id)).length}`,'hint'));jobs.append(card);
  }
  if((s.jobs?.length??0)>60)jobs.append(node('p','Showing the latest 60 saved jobs in this compact view. Older records remain stored.','hint'));
  page.append(jobs);

  const people=node('section','','people-section');const heading=node('div','','section-heading');heading.append(node('h2','3. People and acceptance timeline'));
  const select=node('select');select.setAttribute('aria-label','Filter contacts');
  for(const [v,name] of [['all','All'],['shortlisted','Shortlisted'],['review','Awaiting approval'],['pending','Pending'],['connected','Accepted'],['messaged','Messaged'],['attention','Needs attention'],['skipped','Skipped']]){
    const option=node('option',name);option.value=v!;select.append(option);
  }select.value=filter;select.addEventListener('change',()=>{filter=select.value;if(last)render(last);});heading.append(select);people.append(heading);
  const selection=s.contacts.filter(p=>filter==='all'?p.state!=='skipped':p.state===filter);
  if(!selection.length)people.append(node('p','No matching contacts yet. Start discovery or change the filter.','muted'));
  for(const p of selection){
    const card=node('article','','person');const top=node('div','','person-top');top.append(link(p.name,p.url,'person-name'),node('span',labels[p.state],`badge ${p.state}`));card.append(top,node('p',p.headline,'person-headline'));
    card.append(node('p',p.reason,'hint'));
    if(p.jobIds?.length)card.append(node('p',`Jobs: ${p.jobIds.join(', ')} · ${p.companyName||'Company not verified'}`,'hint'));
    if(p.requestedAt)card.append(node('p',`Invitation: ${localDate(p.requestedAt)} · last checked ${localDate(p.checkedAt)} · next check ${localDate(p.nextCheckAt??((p.checkedAt||p.requestedAt)+DAY))}`,'hint'));
    if(p.acceptedAt)card.append(node('p',`Acceptance verified: ${localDate(p.acceptedAt)}`,'hint'));
    if(p.invitationNote){const detail=node('details');detail.append(node('summary','Personalized invitation note'),node('p',p.invitationNote,'message-preview'));card.append(detail);}
    if(p.message){const detail=node('details');detail.append(node('summary',p.messagedAt?'Sent follow-up':'Prepared follow-up'),node('p',p.message,'message-preview'));card.append(detail);}
    const actions=node('div','','person-actions');actions.append(link('Open LinkedIn profile',p.url));
    if(p.state==='review'&&p.approvalKind&&s.active)actions.append(button(`Approve ${p.approvalKind==='connect'?'invitation':'follow-up'} send`,async()=>{
      if(!confirm(`Confirm sending the saved ${p.approvalKind==='connect'?'invitation':'follow-up'} to ${p.name}?`))return;
      await act({kind:'network',action:'approve',url:p.url},`Approval processed for ${p.name}. Check the contact card for the verified result.`);
    },'button primary'));
    if(!s.active&&!['pending','messaged','skipped'].includes(p.state))actions.append(button('Draft via ChatGPT',()=>withProgress(`Drafting for ${p.name}`,()=>act({kind:'network',action:'prepare',url:p.url})),'button quiet'));
    if(!['messaged','skipped','requesting','messaging'].includes(p.state))actions.append(button('Skip',()=>act({kind:'network',action:'skip',url:p.url},`${p.name} skipped. No future action is scheduled.`),'button text-button'));
    actions.append(button('Delete record',async()=>{if(confirm(`Delete saved record for ${p.name}? This will not retract any LinkedIn action.`))await act({kind:'network',action:'removeContact',url:p.url},`Record for ${p.name} deleted.`);},'button text-button'));
    card.append(actions);people.append(card);
  }page.append(people);

  const activity=node('details','','control-card');activity.append(node('summary','5. Automation diagnostics'));
  activity.append(node('p','Only stage, document and error metadata are stored in ordinary logs, not raw CV text.','hint'));
  const diagnosticText=node('pre','','source-preview');activity.append(button('Refresh task diagnostics',async()=>{
    const details=await request({kind:'network',action:'diagnostics'});
    diagnosticText.textContent=JSON.stringify((details as NetworkState&{diagnostics?:unknown[]}).diagnostics??[],null,2);
  },'button quiet'),diagnosticText);page.append(activity);
  const footer=node('footer');footer.append(button('Export saved data',async()=>{
    const data=await request({kind:'network',action:'export'});const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));
    const a=node('a');a.href=url;a.download='cold-contact-pro-export.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  },'button quiet'),button('Clear all local outreach',async()=>{
    if(confirm('Delete the owner profile, extracted CV, career dossier, jobs, contacts and AI task history? This will not undo LinkedIn actions.'))await act({kind:'network',action:'clear',confirm:true},'All local outreach data deleted.');
  },'button text-button'));
  footer.append(node('p','User-approved automation runs in visible LinkedIn and ChatGPT tabs. Account challenges and ambiguous submissions are never silently bypassed or retried.','hint'));
  page.append(footer);
}
async function refresh():Promise<void>{
  if(busy||page.contains(document.activeElement)&&/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName??''))return;
  const current=await request({kind:'network',action:'status'});if(JSON.stringify(current)!==signature)render(current);
}
void refresh().catch(e=>{notice.textContent=errorText(e);});
const timer=setInterval(()=>{void refresh().catch(e=>{notice.textContent=errorText(e);});},5000);
addEventListener('pagehide',()=>clearInterval(timer),{once:true});
