// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import App from './App';

vi.mock('./BadmintonPlanner',()=>({default:()=>{throw Error('Organizer must not render on a player route');}}));
vi.mock('./components/PlayerSessionViewer',()=>({default:({shareId}:{shareId:string|null})=><p>Player reader: {shareId??'invalid'}</p>}));
afterEach(cleanup);
it('routes player links and malformed player links without loading the organizer',()=>{
  const {rerender}=render(<App search="?share=-abc&view=players" />);
  expect(screen.getByText('Player reader: -abc')).toBeInTheDocument();
  rerender(<App search="?view=players&share=../../private" />);
  expect(screen.getByText('Player reader: invalid')).toBeInTheDocument();
});
