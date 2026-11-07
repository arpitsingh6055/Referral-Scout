import { expect,it } from 'vitest';
import { attachChatGptFile } from '../src/content/chatgpt-upload';
it('refuses the retired ChatGPT CV attachment pathway',async()=>{
  await expect(attachChatGptFile()).rejects.toThrow(/attachments are disabled/i);
});
