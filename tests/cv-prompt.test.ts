import { expect, it, vi } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { completeCvText } from '../src/ui/cv-text';
import { dossierPrompt } from '../src/background/network-ai';
import { emptyNetwork } from '../src/shared/network';
import { validatedDossier } from '../src/shared/dossier';

it('extracts all Word paragraphs including tables, headers and decoded entities', async () => {
  const long = 'Experience '.repeat(3000);
  const zip = zipSync({
    'word/document.xml':strToU8(`<w:document xmlns:w="word"><w:body><w:p><w:r><w:t>${long}</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>R&amp;D final achievement</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>`),
    'word/header1.xml':strToU8('<w:hdr xmlns:w="word"><w:p><w:r><w:t>Candidate name</w:t></w:r></w:p></w:hdr>')
  });
  const text=await completeCvText(zip.buffer as ArrayBuffer,'CV.docx');
  expect(text.length).toBeGreaterThan(30000);
  expect(text).toContain('R&D final achievement');expect(text).toContain('Candidate name');
});

it('puts full saved LinkedIn and CV text directly in the prompt without binary attachment data', () => {
  const state=emptyNetwork();
  state.profile={name:'Example',url:'https://www.linkedin.com/in/example/',headline:'Engineer',location:'India',about:'About',rawText:'Complete LinkedIn final section'};
  state.cv={name:'CV.pdf',type:'application/pdf',text:'Experience '.repeat(4000)+'LAST CV FACT',data:'BINARY_NOT_FOR_CHATGPT'};
  const prompt=dossierPrompt(state);
  expect(prompt).toContain('Complete LinkedIn final section');expect(prompt).toContain('LAST CV FACT');
  expect(prompt).not.toContain('BINARY_NOT_FOR_CHATGPT');expect(prompt).toContain('Return ONLY one JSON object');
  expect(prompt).toContain('prioritize the CV');
  expect(prompt).toContain('CV value was chosen');
  state.cv=null;expect(dossierPrompt(state)).toContain('"cv":null');
});

it('accepts only the fixed career-profile schema', () => {
  const data={schemaVersion:1,name:'Example',summary:'Engineer',experience:[{detail:'Built a tool',source:'cv'}],education:[],projects:[],skills:[],certifications:[],achievements:[],otherFacts:[],missingInformation:[],conflicts:[]};
  expect(JSON.parse(validatedDossier(JSON.stringify(data)))).toEqual(data);
  expect(()=>validatedDossier('Here is your career profile')).toThrow('required career-profile JSON');
  expect(()=>validatedDossier('{"summary":"Incomplete"}')).toThrow();
});

it('extracts every PDF page in order and rejects a page without text', async () => {
  const destroy=vi.fn();
  const getPage=vi.fn(async (n:number)=>({getTextContent:async()=>({items:[{str:`Page ${n} fact`,hasEOL:true}]})}));
  vi.doMock('pdfjs-dist',()=>({GlobalWorkerOptions:{},getDocument:()=>({promise:Promise.resolve({numPages:2,getPage}),destroy})}));
  const text=await completeCvText(new ArrayBuffer(0),'CV.pdf');
  expect(text).toContain('Page 1 fact');expect(text).toContain('Page 2 fact');expect(destroy).toHaveBeenCalled();
  getPage.mockResolvedValue({getTextContent:async()=>({items:[]})});
  await expect(completeCvText(new ArrayBuffer(0),'CV.pdf')).rejects.toThrow('no extractable text');
});
