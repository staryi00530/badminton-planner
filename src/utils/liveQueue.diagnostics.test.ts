// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';

it('snapshots event details so later lineup edits cannot rewrite earlier logs',async()=>{
  vi.resetModules();
  const {liveQueueDebug,exportLiveQueueLogs}=await import('./liveQueue');
  const details={intent:'keep-history',players:['A','B','C','D']};
  liveQueueDebug('generate:start',details);
  details.players[0]='Changed';
  const exported=JSON.parse(exportLiveQueueLogs());
  expect(exported.logs[0].details.players[0]).toBe('A');
  expect(exported.logs[0].details.intent).toBe('keep-history');
});
it('retains a longer session trace and makes truncation explicit',async()=>{
  vi.resetModules();
  const {liveQueueDebug,exportLiveQueueLogs}=await import('./liveQueue');
  for(let i=0;i<2001;i++)liveQueueDebug('event',{i});
  const exported=JSON.parse(exportLiveQueueLogs());
  expect(exported.retention).toEqual({limit:2000,retained:2000,dropped:1,firstSequence:2,lastSequence:2001});
  expect(exported.logs[0].details.i).toBe(1);
  expect(exported.logs.at(-1).details.i).toBe(2000);
});
it('keeps a logging serialization error from breaking the session action',async()=>{
  vi.resetModules();
  const {liveQueueDebug,exportLiveQueueLogs}=await import('./liveQueue');
  const circular:Record<string,unknown>={};circular.self=circular;
  expect(()=>liveQueueDebug('bad-details',circular)).not.toThrow();
  expect(JSON.parse(exportLiveQueueLogs()).logs[0].details.diagnosticError).toBeTruthy();
});
