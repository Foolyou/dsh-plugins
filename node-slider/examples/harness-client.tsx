// Copy into the browser /client entry of an existing Harness plugin.
// The library is a presentation primitive, not a standalone Cordis feature plugin.
import { useState } from 'react';
import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client';
import type {} from '@deepseek-ai/dsh-client-ui-session/client';
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import { NodeSlider } from 'node-slider';
import 'node-slider/style.css';

type HeaderProps = PropsRuntime<'conversation.session.header.actions'>;
const nodes = [
  { id:'low', label:'低', color:'#78B8A0' },
  { id:'medium', label:'中', color:'#8674DF' },
  { id:'high', label:'高', color:'#DB8195' },
];
function HeaderSlider({ useSession }: HeaderProps) {
  const running = useSession(snapshot => snapshot.running);
  // Demo-only local view state. Project persistent business state and mutation
  // callbacks from your service through the registration's inject face instead.
  const [value, setValue] = useState('medium');
  return <div style={{ width:220 }}><NodeSlider nodes={nodes} value={value}
    onValueChange={setValue} disabled={running} trackHeight={10} thumbSize={24}
    aria-label="示例档位" renderThumb={({ node }) => <span style={{
      display:'grid', placeItems:'center', width:'100%', height:'100%',
      borderRadius:'50%', background:'currentColor',
    }}><span style={{ color:'white', fontSize:10 }}>{node.label}</span></span>} /></div>;
}
export const name = 'node-slider-example';
export const inject = ['slots'];
export function apply(ctx: Context): void {
  ctx.slots.inject('conversation.session.header.actions', () =>
    ctx.slots.register({ name:'conversation.session.header.actions', id:'node-slider-example', order:100 }, HeaderSlider));
}
