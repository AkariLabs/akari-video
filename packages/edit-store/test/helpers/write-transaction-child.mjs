import { writeProjectFilesTransactional } from '../../lib/write-gate.js';

process.on('message', async input => {
  try {
    const result = await writeProjectFilesTransactional(input.root, {
      label: '子プロセスの競合試験',
      files: { 'captions.json': { expectedHash: input.hash, next: input.next } },
    });
    process.send?.({ written: result.written });
  } catch (error) {
    process.send?.({ code: error.code, message: error.message });
  }
});
