// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { SharePayload } from '../types';
import { usePlayerSession } from './usePlayerSession';
import { subscribeShare, subscribeShareConnection } from '../firebase';

vi.mock('../firebase',()=>({subscribeShare:vi.fn(),subscribeShareConnection:vi.fn(),fetchShare:vi.fn(()=>{throw Error('reader must not fetch/delete');}),createShare:vi.fn(()=>{throw Error('reader must not write');})}));
const payload=(revision=1):SharePayload & {createdAt:number}=>({v:1,revision,createdAt:Date.now(),p:[['A','M'],['B','M'],['C','M'],['D','M']],slots:[{s:1,c:[[ [0,1],[2,3] ]],sit:[]}]});
let feeds:Array<{data:(data:SharePayload|null)=>void;error:(error:unknown)=>void;stop:ReturnType<typeof vi.fn>}>;
let connections:Array<{connected:(value:boolean)=>void;error:(error:unknown)=>void;stop:ReturnType<typeof vi.fn>}>;
beforeEach(()=>{
  vi.useFakeTimers();vi.setSystemTime(2_000_000_000_000);vi.clearAllMocks();feeds=[];connections=[];
  vi.spyOn(navigator,'onLine','get').mockReturnValue(true);
  vi.mocked(subscribeShare).mockImplementation((_id,data,error)=>{const stop=vi.fn();feeds.push({data,error,stop});return stop;});
  vi.mocked(subscribeShareConnection).mockImplementation((connected,error)=>{const stop=vi.fn();connections.push({connected,error,stop});return stop;});
});
afterEach(()=>{cleanup();vi.useRealTimers();vi.restoreAllMocks();});

it('loads validated public updates, only reports live with connection, and never writes storage',()=>{
 const write=vi.spyOn(Storage.prototype,'setItem');
 const {result}=renderHook(()=>usePlayerSession('share'));
 expect(result.current.status).toBe('loading');
 act(()=>feeds[0]!.data(payload()));expect(result.current.status).toBe('reconnecting');
 act(()=>connections[0]!.connected(true));expect(result.current.status).toBe('live');
 act(()=>feeds[0]!.data(payload(2)));expect(result.current.data?.revision).toBe(2);
 expect(result.current.receivedAt).toBe(Date.now());expect(write).not.toHaveBeenCalled();
});
it('keeps last valid data visibly stale while offline, reconnecting or failed',()=>{
 const {result}=renderHook(()=>usePlayerSession('share'));
 act(()=>{connections[0]!.connected(true);feeds[0]!.data(payload());});
 act(()=>connections[0]!.connected(false));expect(result.current.status).toBe('reconnecting');
 act(()=>window.dispatchEvent(new Event('offline')));expect(result.current.status).toBe('offline');
 expect(result.current.data?.revision).toBe(1);
 act(()=>window.dispatchEvent(new Event('online')));expect(result.current.status).toBe('reconnecting');
 act(()=>feeds.at(-1)!.error(Error('denied')));expect(result.current.status).toBe('error');expect(result.current.data).not.toBeNull();
});
it.each(['missing','invalid','expired'] as const)('clears stale roster on terminal %s',kind=>{
 const {result}=renderHook(()=>usePlayerSession('share'));
 act(()=>{connections[0]!.connected(true);feeds[0]!.data(payload());});
 act(()=>feeds[0]!.data(kind==='missing'?null:kind==='invalid'?{...payload(),p:[]}:({...payload(),createdAt:Date.now()-30*24*60*60*1000} as SharePayload)));
 expect(result.current.data).toBeNull();expect(result.current.status).toBe(kind==='missing'?'not_found':kind);
});
it('expires an already open view locally even across the browser maximum timer delay',()=>{
 const {result}=renderHook(()=>usePlayerSession('share'));
 act(()=>{connections[0]!.connected(true);feeds[0]!.data(payload());});
 act(()=>vi.advanceTimersByTime(30*24*60*60*1000));
 expect(result.current.status).toBe('expired');expect(result.current.data).toBeNull();
});
it('times out first load, retries, and ignores callbacks from old subscriptions',()=>{
 const {result,rerender,unmount}=renderHook(({id})=>usePlayerSession(id),{initialProps:{id:'one'}});
 act(()=>vi.advanceTimersByTime(15_000));expect(result.current.status).toBe('error');
 act(()=>result.current.retry());expect(feeds).toHaveLength(2);expect(feeds[0]!.stop).toHaveBeenCalled();
 act(()=>feeds[0]!.data(payload()));expect(result.current.data).toBeNull();
 act(()=>{connections[1]!.connected(true);feeds[1]!.data(payload());});expect(result.current.status).toBe('live');
 rerender({id:'two'});expect(result.current.data).toBeNull();
 act(()=>feeds[1]!.data(payload(99)));expect(result.current.data).toBeNull();
 unmount();expect(feeds[2]!.stop).toHaveBeenCalled();expect(connections[2]!.stop).toHaveBeenCalled();expect(vi.getTimerCount()).toBe(0);
});
it('does not subscribe without a link and starts offline honestly',()=>{
 const {result,rerender}=renderHook(({id})=>usePlayerSession(id),{initialProps:{id:null as string|null}});
 expect(subscribeShare).not.toHaveBeenCalled();expect(result.current.status).toBe('not_found');
 vi.spyOn(navigator,'onLine','get').mockReturnValue(false);rerender({id:'share'});
 expect(result.current.status).toBe('offline');
});
it('retains the expiry deadline across retry while the old view is stale',()=>{
 const {result}=renderHook(()=>usePlayerSession('share'));
 act(()=>{connections[0]!.connected(true);feeds[0]!.data({...payload(),createdAt:Date.now()-30*24*60*60*1000+1000} as SharePayload);});
 act(()=>result.current.retry());expect(result.current.data).not.toBeNull();
 act(()=>vi.advanceTimersByTime(1000));expect(result.current.status).toBe('expired');expect(result.current.data).toBeNull();
});
it('ignores older revisions and handles immediate subscription snapshots',()=>{
 vi.mocked(subscribeShare).mockImplementation((_id,data,error)=>{const stop=vi.fn();feeds.push({data,error,stop});data(payload(3));return stop;});
 vi.mocked(subscribeShareConnection).mockImplementation((connected,error)=>{const stop=vi.fn();connections.push({connected,error,stop});connected(true);return stop;});
 const {result}=renderHook(()=>usePlayerSession('share'));
 expect(result.current.status).toBe('live');expect(result.current.data?.revision).toBe(3);
 act(()=>feeds[0]!.data(payload(2)));expect(result.current.data?.revision).toBe(3);
});
it('resamples the SDK connection after browser online and never trusts the old connected flag',()=>{
 const {result}=renderHook(()=>usePlayerSession('share'));
 act(()=>{connections[0]!.connected(true);feeds[0]!.data(payload());});
 const receivedAt=result.current.receivedAt;
 act(()=>window.dispatchEvent(new Event('offline')));expect(result.current.status).toBe('offline');
 act(()=>window.dispatchEvent(new Event('online')));
 expect(feeds).toHaveLength(2);expect(result.current.status).toBe('reconnecting');
 expect(result.current.receivedAt).toBe(receivedAt);expect(result.current.data?.revision).toBe(1);
 act(()=>connections[0]!.connected(true));expect(result.current.status).toBe('reconnecting');
 act(()=>connections[1]!.connected(true));expect(result.current.status).toBe('live');
});
it('accepts a freshly sampled connected SDK when browser online caused no SDK transition',()=>{
 const {result}=renderHook(()=>usePlayerSession('share'));
 act(()=>{connections[0]!.connected(true);feeds[0]!.data(payload());});
 act(()=>window.dispatchEvent(new Event('offline')));
 vi.mocked(subscribeShareConnection).mockImplementation((connected,error)=>{const stop=vi.fn();connections.push({connected,error,stop});connected(true);return stop;});
 act(()=>window.dispatchEvent(new Event('online')));
 expect(connections).toHaveLength(2);expect(result.current.status).toBe('live');expect(result.current.data?.revision).toBe(1);
});
it('clears a payload that decodes but has an invalid explicit runtime lineup',()=>{
 const {result}=renderHook(()=>usePlayerSession('share'));
 act(()=>{connections[0]!.connected(true);feeds[0]!.data(payload());});
 act(()=>feeds[0]!.data({...payload(),runtime:{live:[{slot:1,court:0,players:['A','B','C']}]}}));
 expect(result.current.status).toBe('invalid');expect(result.current.data).toBeNull();
});
