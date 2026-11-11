import { lazy, Suspense } from 'react';
import PlayerSessionViewer from './components/PlayerSessionViewer';
import { playerShareId } from './utils/playerView';

const BadmintonPlanner=lazy(()=>import('./BadmintonPlanner'));
export default function App({search=window.location.search}:{search?:string}) {
  if(new URLSearchParams(search).get('view')==='players') return <PlayerSessionViewer shareId={playerShareId(search)} />;
  return <Suspense fallback={<p>Opening Match Planner…</p>}><BadmintonPlanner /></Suspense>;
}
