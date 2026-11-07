/** Retired legacy file-attachment pathway. The product is text-only. */
export async function attachChatGptFile():Promise<never>{
  throw new Error('CV attachments are disabled. Extract the CV locally and send source text in the visible ChatGPT composer instead.');
}
