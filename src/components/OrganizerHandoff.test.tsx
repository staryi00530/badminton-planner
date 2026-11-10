import { StrictMode } from 'react';
// @vitest-environment jsdom
import { it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import OrganizerHandoff from './OrganizerHandoff';
import { createShare, fetchShare } from '../firebase';
import { encryptOrganizerSetup, decryptOrganizerSetup, type OrganizerSetup } from '../utils/organizerTransfer';
vi.mock('../firebase', () => ({ createShare: vi.fn(), fetchShare: vi.fn(), isFirebaseConfigured: () => true }));
vi.mock('../utils/organizerTransfer', () => ({ encryptOrganizerSetup: vi.fn(), decryptOrganizerSetup: vi.fn() }));
const setup = { players: [{name:'Organizer',level:5}], playerHistory:[], hasPlan:true } as unknown as OrganizerSetup;
beforeEach(()=>vi.clearAllMocks());
it('creates a separate encrypted transfer link without exposing the key to storage', async()=>{
 vi.mocked(encryptOrganizerSetup).mockResolvedValue({envelope:{organizerTransfer:{ciphertext:'sealed'}},key:'private-key'});
 vi.mocked(createShare).mockResolvedValue('transfer-id');
 render(<OrganizerHandoff target={null} canExport createSetup={()=>setup} onImport={()=>true} onCancel={()=>{}} onCopy={()=>{}}/>);
 fireEvent.click(screen.getByRole('button',{name:'Transfer organizer setup'}));
 await waitFor(()=>expect((screen.getByRole('textbox',{name:'Private transfer link'}) as HTMLInputElement).value).toContain('?transfer=transfer-id#key=private-key'));
 expect(JSON.stringify(vi.mocked(createShare).mock.calls)).not.toContain('private-key');
 expect(screen.getByRole('dialog',{name:'Private organizer transfer'})).toHaveTextContent('Anyone with this link');
});
it('previews a transfer once and applies nothing until explicit acceptance',async()=>{
 vi.mocked(fetchShare).mockResolvedValue({status:'ok',data:{sealed:true}});
 vi.mocked(decryptOrganizerSetup).mockResolvedValue(setup);
 const apply=vi.fn(()=>true), cancel=vi.fn();
 const props={target:{id:'id',key:'secret'},canExport:false,createSetup:()=>setup,onImport:apply,onCancel:cancel,onCopy:()=>{}};
 const {rerender}=render(<OrganizerHandoff {...props}/>);
 await screen.findByRole('button',{name:'Use on this device'});
 expect(apply).not.toHaveBeenCalled();
 rerender(<OrganizerHandoff {...props}/>);
 expect(fetchShare).toHaveBeenCalledTimes(1);
 fireEvent.click(screen.getByRole('button',{name:'Use on this device'}));
 expect(apply).toHaveBeenCalledWith(setup);
});
it('keeps current data untouched on a bad key or cancelled preview',async()=>{
 vi.mocked(fetchShare).mockResolvedValue({status:'ok',data:{sealed:true}});
 vi.mocked(decryptOrganizerSetup).mockRejectedValue(new Error('private ciphertext and key details'));
 const apply=vi.fn(()=>true),cancel=vi.fn();
 render(<OrganizerHandoff target={{id:'id',key:'bad'}} canExport={false} createSetup={()=>setup} onImport={apply} onCancel={cancel} onCopy={()=>{}}/>);
 await screen.findByRole('alert');
 expect(screen.getByRole('alert')).not.toHaveTextContent('private ciphertext');
 fireEvent.click(screen.getByRole('button',{name:'Cancel transfer'}));
 expect(cancel).toHaveBeenCalledOnce();expect(apply).not.toHaveBeenCalled();
});
it('reads an immutable transfer only once under the StrictMode effect replay',async()=>{
 vi.mocked(fetchShare).mockResolvedValue({status:'ok',data:{sealed:true}});
 vi.mocked(decryptOrganizerSetup).mockResolvedValue(setup);
 render(<StrictMode><OrganizerHandoff target={{id:'strict',key:'secret'}} canExport={false} createSetup={()=>setup} onImport={()=>true} onCancel={()=>{}} onCopy={()=>{}}/></StrictMode>);
 await screen.findByRole('button',{name:'Use on this device'});
 expect(fetchShare).toHaveBeenCalledTimes(1);
});
