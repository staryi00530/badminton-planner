// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { usePlayerSession } from '../hooks/usePlayerSession';
import type { SharePayload } from '../types';
import PlayerSessionViewer from './PlayerSessionViewer';

vi.mock('../hooks/usePlayerSession',()=>({usePlayerSession:vi.fn()}));
const data:SharePayload={v:1,ids:['a','b','c','d','e','f','g','h'],p:['A','B','C','D','E','F','G','H'].map(name=>[name,'M']),
  slots:[{s:1,c:[[[0,1],[2,3]]],sit:[]},{s:2,c:[[[0,4],[5,6]]],sit:[]},{s:3,c:[[[1,2],[3,7]]],sit:[]}],
  runtime:{live:[{slot:1,court:0,players:['A','B','C','D']}],completed:[]},cfg:{g:15,c:1,sessionStart:'20:30'}};
beforeEach(()=>{localStorage.clear();sessionStorage.clear();vi.mocked(usePlayerSession).mockReturnValue({data,status:'live',receivedAt:1000,retry:vi.fn()});});
afterEach(()=>{cleanup();vi.restoreAllMocks();});

it('shows all games then filters My games, remembers stable ID and exposes no organizer controls',()=>{
  localStorage.setItem('bp-players','personal roster');sessionStorage.setItem('bp-admin','private');
  render(<PlayerSessionViewer shareId="-share" />);
  expect(screen.getByText('Receiving live updates')).toBeInTheDocument();
  expect(screen.getAllByRole('article')).toHaveLength(3);
  fireEvent.change(screen.getByLabelText('Choose your name'),{target:{value:'a'}});
  expect(screen.getByRole('tab',{name:'My games'})).toHaveAttribute('aria-selected','true');
  expect(screen.getAllByRole('article')).toHaveLength(2);
  expect(screen.getByText(/Future games are tentative/)).toBeInTheDocument();
  expect(localStorage.getItem('bp-players')).toBe('personal roster');
  expect(sessionStorage.getItem('bp-admin')).toBe('private');
  expect(screen.queryByRole('button',{name:/Finish|Start game|Edit|Undo|Share|Save/})).not.toBeInTheDocument();
  cleanup();render(<PlayerSessionViewer shareId="-share" />);
  expect(screen.getByLabelText('Choose your name')).toHaveValue('a');
});
it('keeps the same selected identity on rename and explains removal without selecting somebody else',()=>{
  const {rerender}=render(<PlayerSessionViewer shareId="-share" />);
  fireEvent.change(screen.getByLabelText('Choose your name'),{target:{value:'a'}});
  vi.mocked(usePlayerSession).mockReturnValue({data:{...data,p:data.p.map((p,i)=>i===0?['Renamed','M']:p)},status:'live',retry:vi.fn()});
  rerender(<PlayerSessionViewer shareId="-share" />);
  expect(screen.getByLabelText('Choose your name')).toHaveValue('a');
  expect(within(screen.getByLabelText('Choose your name')).getByRole('option',{name:'Renamed'})).toBeInTheDocument();
  vi.mocked(usePlayerSession).mockReturnValue({data:{...data,ids:['replacement',...data.ids!.slice(1)]},status:'live',retry:vi.fn()});
  rerender(<PlayerSessionViewer shareId="-share" />);
  expect(screen.getByText(/selected player is no longer listed/i)).toBeInTheDocument();
  expect(screen.queryAllByRole('article')).toHaveLength(0);
});
it('labels stale games and offers retry while retaining the last view',()=>{
  const retry=vi.fn();vi.mocked(usePlayerSession).mockReturnValue({data,status:'offline',retry});
  render(<PlayerSessionViewer shareId="-share" />);
  expect(screen.getByText('Offline — showing last received games')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'Retry connection'}));expect(retry).toHaveBeenCalledOnce();
  expect(screen.getAllByRole('article')).toHaveLength(3);
});
it('does not claim a last received view exists when opening offline without data',()=>{
  vi.mocked(usePlayerSession).mockReturnValue({data:null,status:'offline',retry:vi.fn()});
  render(<PlayerSessionViewer shareId="-share" />);
  expect(screen.getByText('Offline — connect to load this session')).toBeInTheDocument();
  expect(screen.queryAllByRole('article')).toHaveLength(0);
});
it('keeps player preference scoped to this share and works when storage is blocked',()=>{
  const {rerender}=render(<PlayerSessionViewer shareId="-one" />);
  fireEvent.change(screen.getByLabelText('Choose your name'),{target:{value:'a'}});
  rerender(<PlayerSessionViewer shareId="-two" />);
  expect(screen.getByLabelText('Choose your name')).toHaveValue('');
  expect(screen.getByRole('tab',{name:'All games'})).toHaveAttribute('aria-selected','true');
  cleanup();
  vi.spyOn(Storage.prototype,'getItem').mockImplementation(()=>{throw Error('Storage blocked');});
  vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw Error('Storage blocked');});
  render(<PlayerSessionViewer shareId="-blocked" />);
  fireEvent.change(screen.getByLabelText('Choose your name'),{target:{value:'a'}});
  expect(screen.getAllByRole('article')).toHaveLength(2);
});
