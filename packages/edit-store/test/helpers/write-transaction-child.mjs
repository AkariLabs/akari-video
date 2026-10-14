import { writeProjectFilesTransactional } from '../../lib/write-gate.js';

process.on('message', async input => {
  try {
    if (input.repeat) {
      let maxWaitMs = 0;
      const content = 'x'.repeat(20_000);
      for (let index = 0; index < input.repeat; index++) {
        const began = Date.now();
        await writeProjectFilesTransactional(input.root, { label: '連続保存', files: {
          'captions.json': { next: `${process.pid}:${index}:${content}` },
          'edit.json': { next: `${process.pid}:${index}:${content}` }
        } }, { writeUnchanged: true });
        maxWaitMs = Math.max(maxWaitMs, Date.now() - began);
      }
      process.send?.({ written: input.repeat, maxWaitMs });
      return;
    }
    const result = await writeProjectFilesTransactional(input.root, {
      label: '子プロセスの競合試験',
      files: { 'captions.json': { expectedHash: input.hash, next: input.next } },
    });
    process.send?.({ written: result.written });
  } catch (error) {
    process.send?.({ code: error.code, message: error.message });
  }
});
