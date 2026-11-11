import { useCallback, useEffect, useRef, useState } from 'react';
import { subscribeShare, subscribeShareConnection } from '../firebase';
import type { SharePayload } from '../types';
import { playerViewModel } from '../utils/playerView';

export type PlayerSessionStatus = 'loading' | 'live' | 'reconnecting' | 'offline' | 'error' | 'not_found' | 'expired' | 'invalid';
export interface PlayerSessionResult {
  data: SharePayload | null;
  status: PlayerSessionStatus;
  message?: string;
  receivedAt?: number;
  retry: () => void;
}
interface PlayerSessionState {
  shareId: string | null;
  data: SharePayload | null;
  status: PlayerSessionStatus;
  message?: string;
  receivedAt?: number;
}
const TTL = 30 * 24 * 60 * 60 * 1000;
const MAX_TIMER = 2_147_483_647;

/** Public subscriptions only: never hydrates planner state, deletes expiry, or invokes writes. */
export function usePlayerSession(shareId: string | null): PlayerSessionResult {
  const [attempt,setAttempt] = useState(0);
  const [state,setState] = useState<PlayerSessionState>({shareId:null,data:null,status:'not_found'});
  const stateRef=useRef(state);
  stateRef.current=state;
  const retry = useCallback(()=>setAttempt(value=>value+1),[]);
  useEffect(()=>{
    let stopped=false;
    let online=navigator.onLine;
    let connected:boolean|null=null;
    let terminal:PlayerSessionStatus|null=null;
    let failed=false;
    const previous=stateRef.current;
    let latest=previous.shareId===shareId ? previous.data : null;
    let lastRevision=latest?.revision;
    let expiryTimer:ReturnType<typeof setTimeout>|undefined;
    let loadingTimer:ReturnType<typeof setTimeout>|undefined;
    const clearLoading=()=>{clearTimeout(loadingTimer);loadingTimer=undefined;};
    const clearExpiry=()=>{clearTimeout(expiryTimer);expiryTimer=undefined;};
    setState({shareId,data:latest,status:!shareId?'not_found':!online?'offline':latest?'reconnecting':'loading',
      ...(latest && previous.receivedAt!==undefined?{receivedAt:previous.receivedAt}:{})});
    if (!shareId) return ()=>{stopped=true;};
    const status=():PlayerSessionStatus=>terminal ?? (!online?'offline':failed?'error':connected===true && latest?'live':latest?'reconnecting':'loading');
    const publishStatus=()=>{
      if(stopped)return;
      setState(previous=>({...previous,status:status()}));
    };
    const end=(next:PlayerSessionStatus,message:string)=>{
      terminal=next;latest=null;clearLoading();clearExpiry();
      if(!stopped)setState({shareId,data:null,status:next,message});
    };
    const error=(_error:unknown)=>{
      if(stopped || terminal)return;
      failed=true;clearLoading();
      setState(previous=>({...previous,status:status(),message:'Could not receive live updates. The last received view may be out of date. Retry the connection.'}));
    };
    const scheduleExpiry=(createdAt:number)=>{
      clearExpiry();
      const check=()=>{
        if(stopped)return;
        const remaining=createdAt+TTL-Date.now();
        if(remaining<=0){end('expired','This player link has expired. Ask the organizer for a new link.');return;}
        expiryTimer=setTimeout(check,Math.min(remaining,MAX_TIMER));
      };
      check();
    };
    const data=(value:SharePayload|null)=>{
      if(stopped)return;
      if(!value){end('not_found','This player link was not found. Ask the organizer to share it again.');return;}
      try {
        playerViewModel(value);
        const createdAt=(value as SharePayload & {createdAt?:unknown}).createdAt;
        if(createdAt!==undefined && (typeof createdAt!=='number'||!Number.isSafeInteger(createdAt)||createdAt<0))throw Error('Invalid expiry');
        if(typeof createdAt==='number' && Date.now()>=createdAt+TTL){end('expired','This player link has expired. Ask the organizer for a new link.');return;}
        if(lastRevision!==undefined && value.revision!==undefined && value.revision<lastRevision)return;
        terminal=null;failed=false;latest=value;lastRevision=value.revision;clearLoading();clearExpiry();
        if(typeof createdAt==='number')scheduleExpiry(createdAt);
        setState({shareId,data:value,status:status(),receivedAt:Date.now()});
      } catch {end('invalid','This player schedule could not be read. Ask the organizer to publish it again.');}
    };
    const onOffline=()=>{online=false;connected=false;publishStatus();};
    const onOnline=()=>{
      online=true;connected=false;publishStatus();
      // Resample the SDK connection even if it never emitted a disconnect event.
      // The browser being online alone cannot make a cached view live again.
      setAttempt(value=>value+1);
    };
    const retainedCreatedAt=(latest as (SharePayload & {createdAt?:number})|null)?.createdAt;
    if(typeof retainedCreatedAt==='number')scheduleExpiry(retainedCreatedAt);
    window.addEventListener('offline',onOffline);
    window.addEventListener('online',onOnline);
    loadingTimer=setTimeout(()=>error(Error('Initial read timeout')),15_000);
    let unsubscribeData:()=>void=()=>{};
    let unsubscribeConnection:()=>void=()=>{};
    try {
      unsubscribeData=subscribeShare(shareId,data,error);
      unsubscribeConnection=subscribeShareConnection(value=>{if(stopped)return;connected=value;publishStatus();},error);
    } catch(cause){error(cause);}
    return ()=>{
      stopped=true;clearLoading();clearExpiry();unsubscribeData();unsubscribeConnection();
      window.removeEventListener('offline',onOffline);window.removeEventListener('online',onOnline);
    };
  },[shareId,attempt]);
  const visible=state.shareId===shareId?state:{shareId,data:null,status:shareId?'loading' as const:'not_found' as const};
  return {data:visible.data,status:visible.status,message:visible.message,receivedAt:visible.receivedAt,retry};
}
