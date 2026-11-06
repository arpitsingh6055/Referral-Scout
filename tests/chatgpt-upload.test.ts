import { afterEach, expect, it, vi } from 'vitest';
import { attachChatGptFile } from '../src/content/chatgpt-upload';
vi.mock('../src/content/dom', () => ({
  visible: () => true, find: () => document.querySelector('#prompt-textarea'),
  sleep: async () => {},
  wait: async (read:()=>unknown) => {const value=read(); if(!value) throw new Error('timeout'); return value;}
}));
afterEach(()=>{vi.unstubAllGlobals();document.body.innerHTML='';});
it('opens the attachment menu and uses the lazily mounted document input', async () => {
  const files: File[]=[];
  vi.stubGlobal('DataTransfer',class {items={add:(file:File)=>files.push(file)};files=files;});
  document.body.innerHTML='<main><button id="add" aria-label="Add files and more">+</button></main>';
  let attached = false;
  document.querySelector('#add')!.addEventListener('click',()=>{
    const upload=document.createElement('button');upload.textContent='Add photos & files Upload from computer';
    upload.addEventListener('click',()=>{
      const input=document.createElement('input');input.type='file';input.accept='.pdf,.docx';
      Object.defineProperty(input,'files',{writable:true,value:null});
      input.addEventListener('change',()=>{attached=true;document.querySelector('main')!.insertAdjacentHTML('beforeend','<span>CV.pdf</span>');});
      document.body.append(input);
    });document.querySelector('main')!.append(upload);
  });
  await attachChatGptFile({name:'CV.pdf',type:'application/pdf',data:'cGRm'},new AbortController().signal);
  expect(attached).toBe(true);expect(files[0]?.name).toBe('CV.pdf');
});
it('reports the attachment step when the upload control is missing', async()=>{
  document.body.innerHTML='<main><div id="prompt-textarea"></div></main>';
  await expect(attachChatGptFile({name:'CV.pdf',type:'application/pdf',data:'cGRm'},new AbortController().signal)).rejects.toThrow('CV upload:');
});
