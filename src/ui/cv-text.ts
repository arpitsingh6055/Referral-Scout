import { unzipSync, strFromU8 } from 'fflate';

export async function completeCvText(buffer: ArrayBuffer, name: string): Promise<string> {
  let text = '';
  if (/\.pdf$/i.test(name)) {
    const pdfjs = await import('pdfjs-dist');
    const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
    const task = pdfjs.getDocument({ data: new Uint8Array(buffer), useSystemFonts: true });
    try {
      const pdf = await task.promise;
      const pages: string[] = [];
      for (let page = 1; page <= pdf.numPages; page++) {
        const content = await (await pdf.getPage(page)).getTextContent();
        const value = content.items
          .map(item => ('str' in item ? item.str + (item.hasEOL ? '\n' : ' ') : ''))
          .join('')
          .trim();
        if (!value) throw new Error(`CV page ${page} has no extractable text. Use a searchable PDF or Word (.docx) file.`);
        pages.push(`[Page ${page}]\n${value}`);
      }
      text = pages.join('\n\n');
    } finally {
      await task.destroy();
    }
  } else if (/\.docx$/i.test(name)) {
    const entries = unzipSync(new Uint8Array(buffer));
    const names = Object.keys(entries).filter(n => /^word\/(document|header\d*|footer\d*|footnotes|endnotes)\.xml$/.test(n));
    names.sort((a, b) => Number(b === 'word/document.xml') - Number(a === 'word/document.xml'));
    text = names
      .map(n => {
        const doc = new DOMParser().parseFromString(strFromU8(entries[n]!), 'application/xml');
        if (doc.querySelector('parsererror')) throw new Error('The Word file could not be read. Save a new .docx copy.');
        return [...doc.getElementsByTagNameNS('*', 'p')]
          .map(p => [...p.getElementsByTagNameNS('*', 't')].map(t => t.textContent ?? '').join(''))
          .join('\n');
      })
      .join('\n\n');
  } else if (/\.txt$/i.test(name)) text = new TextDecoder().decode(buffer);
  else throw new Error('Use a PDF, .docx, or .txt CV. Save older .doc files as .docx first.');
  text = text.trim();
  if (!text) throw new Error('No CV text could be extracted. Use a searchable PDF or .docx file.');
  return text;
}
