import { spawn } from 'node:child_process';
// Spawn exactly as the harness does: scrubbed env, cwd = .kb
const p = spawn(process.execPath, ['.kb/server.mjs'], {
  cwd: '/Users/alex/Desktop/deepseekharness/knowledge',
  env: { PATH: process.env.PATH, HOME: process.env.HOME },
  stdio: ['pipe', 'pipe', 'pipe'],
});
let buf = '';
const got = [];
p.stdout.on('data', d => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i+1); if (l.trim()) { got.push(JSON.parse(l)); check(); } } });
p.stderr.on('data', d => process.stderr.write('[child] ' + d));
const send = o => p.stdin.write(JSON.stringify(o) + '\n');
const check = () => {
  const last = got.at(-1);
  if (last.id === 1) { console.log('tools:', last.result.tools.map(t => t.name).join(', ')); send({jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'kb_status',arguments:{}}}); }
  else if (last.id === 2) { console.log('--- kb_status ---\n' + last.result.content[0].text); send({jsonrpc:'2.0',id:3,method:'tools/call',params:{name:'kb_search',arguments:{query:'怎么写博客 SEO',k:3}}}); }
  else if (last.id === 3) { console.log('--- kb_search ---\n' + last.result.content[0].text.slice(0, 1200)); send({jsonrpc:'2.0',id:4,method:'tools/call',params:{name:'kb_read',arguments:{path:'skills/INDEX.md',start_line:1,end_line:6}}}); }
  else if (last.id === 4) { console.log('--- kb_read ---\n' + last.result.content[0].text); p.kill(); process.exit(0); }
};
send({jsonrpc:'2.0',id:0,method:'initialize',params:{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'smoke',version:'1'}}});
setTimeout(() => { console.log('=== handshake ==='); send({jsonrpc:'2.0',method:'notifications/initialized'}); send({jsonrpc:'2.0',id:1,method:'tools/list',params:{}}); }, 300);
setTimeout(() => { console.error('TIMEOUT'); p.kill(); process.exit(1); }, 45000);
