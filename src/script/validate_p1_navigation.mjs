/** Browser integration check for the real authenticated Project shell.
 * Run from src with Playwright available (or LIOS_PLAYWRIGHT_MODULE pointing to its ESM entry).
 * Optional LIOS_CHROMIUM_EXECUTABLE/LIOS_CHROMIUM_ARGS_JSON select a local browser.
 * API fixtures belong only to this verification process; production code is never mocked.
 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createServer } from "vite";
const { chromium } = await import(process.env.LIOS_PLAYWRIGHT_MODULE || "playwright");
const root = process.cwd();
const htmlPath = path.join(root, "client/__p1_navigation_check.html");
const fixturePath = path.join(root, "client/src/__p1_navigation_check.tsx");
const output = process.env.LIOS_NAVIGATION_CHECK_OUTPUT || await fs.mkdtemp(path.join(os.tmpdir(), "lios-navigation-"));
await fs.mkdir(output, { recursive: true });
const styleImports = (await fs.readFile(path.join(root, "client/src/main.tsx"), "utf8")).split("\n").filter((line) => line.startsWith('import "./')).join("\n");
let server, browser;
try {
 await fs.writeFile(fixturePath, "import React from \"react\";\nimport { createRoot } from \"react-dom/client\";\nimport { QueryClient, QueryClientProvider } from \"@tanstack/react-query\";\nimport ProjectExperienceShell from \"./components/terminal/ProjectExperienceShell\";\nimport { GatewayProvider } from \"./lib/gateway/GatewayProvider\";\nconst client = new QueryClient({ defaultOptions: { queries: { retry:false } } });\nconst action = (name: string) => () => { document.body.dataset.lastAction = name; };\ncreateRoot(document.getElementById(\"root\")!).render(<QueryClientProvider client={client}><GatewayProvider enabled={true}><div className=\"terminal-root dark\" style={{height:\"100dvh\",display:\"flex\",flexDirection:\"column\"}}><ProjectExperienceShell audience=\"internal\" activeView=\"chart\" account={{name:\"Verification User\",email:\"verification@example.test\"}} onLogout={action(\"logout\")} onOpenSettings={action(\"settings\")} onOpenWorkbench={action(\"workspace\")} onOpenEnvironment={action(\"connectors\")} workspaceAdapter={{} as any} /></div></GatewayProvider></QueryClientProvider>);" + "\n" + styleImports);
 await fs.writeFile(htmlPath, "<html><head><meta name=\"viewport\" content=\"width=device-width, initial-scale=1\" /></head><body><div id=\"root\"></div><script type=\"module\" src=\"/src/__p1_navigation_check.tsx\"></script></body></html>\n");
 server = await createServer({ configFile: path.join(root, "vite.config.ts"), server: { host: "127.0.0.1", port: 4173, strictPort:true, fs: { allow: [root, await fs.realpath(path.join(root, "node_modules"))] } } });
 await server.listen();
 browser = await chromium.launch({ headless:true, ...(process.env.LIOS_CHROMIUM_EXECUTABLE ? { executablePath:process.env.LIOS_CHROMIUM_EXECUTABLE } : {}), args: process.env.LIOS_CHROMIUM_ARGS_JSON ? JSON.parse(process.env.LIOS_CHROMIUM_ARGS_JSON) : [] });
 const browserContext = await browser.newContext({viewport:{width:1440,height:900}});
 const page = await browserContext.newPage();
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const now='2026-10-01T08:00:00Z';
 const project={id:1,ownerUserId:1,organizationId:null,name:'Company research',instructions:'Use primary sources. Keep assumptions explicit.',status:'active',pinned:false,createdAt:now,updatedAt:now,lastActivityAt:now};
 const chat={id:11,projectId:1,ownerUserId:1,organizationId:null,scope:'project',title:'Investment thesis review',status:'active',pinned:false,createdAt:now,updatedAt:now,lastActivityAt:now};
 let artifactFailure=false, automationFailure=false, createFailure=true, emptyProjects=false, responseComplete=false;
 const projects=[project];
 const writes=[];
 await browserContext.routeWebSocket('**/gateway', socket => {
   let seq = 0;
   const send = frame => socket.send(JSON.stringify(frame));
   socket.onMessage(raw => {
     const frame = JSON.parse(String(raw));
     if (frame.method === 'connect') {
       send({type:'res',id:frame.id,ok:true,payload:{type:'hello-ok',protocol:1,server:{version:'ui-fixture',connId:'ui-connection',bootId:'ui-boot'},features:{methods:['conversation.start','conversation.active','conversation.subscribe'],events:['conversation.event']},auth:{role:'operator',scopes:['read','write']},policy:{maxPayload:1000000,maxBufferedBytes:1000000,tickIntervalMs:60000,handshakeTimeoutMs:15000}}});
     } else if (frame.method === 'conversation.active') {
       send({type:'res',id:frame.id,ok:true,payload:{runs:[]}});
     } else if (frame.method === 'conversation.start') {
       const requestId = frame.params.body.requestId;
       responseComplete = true;
       send({type:'res',id:frame.id,ok:true,payload:{requestId}});
       for (const [runSeq,event] of [{type:'text',text:'UI verification finished.'},{type:'done',status:'completed'}].entries()) send({type:'event',event:'conversation.event',seq:seq++,payload:{requestId,runSeq,event}});
     }
   });
 });

 await page.addInitScript(()=>{localStorage.setItem('lios.activeProjectId','1');localStorage.setItem('lios.activeProjectChatId','11');});
 const apiHandler=async route=>{
   const req=route.request(),u=new URL(req.url());let data=[];let status=200;
   if(u.pathname==='/api/project-chats/22/respond') { responseComplete=true; await route.fulfill({status:200,contentType:'text/event-stream',body:'data: '+JSON.stringify({type:'text',text:'UI verification finished.'})+'\n\n'});return; }
   else if(req.method()==='POST' && u.pathname==='/api/projects') {
     writes.push({path:u.pathname,method:req.method()});
     if(createFailure) {status=503;data={error:'Project storage unavailable'};}
     else { data={...project,id:2,name:JSON.parse(req.postData()).name}; projects.push(data); }
   }
   else if(req.method()!=='GET'){writes.push({path:u.pathname,method:req.method()}); data=req.method()==='PATCH'?{...chat,...JSON.parse(req.postData()||'{}')}:{...chat,id:22,scope:'quick',projectId:null,title:'New conversation'};}
   else if(u.pathname==='/api/work-search'){const q=(u.searchParams.get('q')||'').toLowerCase();data={query:q,results:q.includes('evidence')?[{kind:'chat',id:'chat:11',title:'Investment thesis review',snippet:'Review the evidence supporting our thesis.',projectId:1,chatId:11,artifactId:null,resourceId:null,updatedAt:now}]:[]};}
   else if(u.pathname==='/api/projects')data=u.searchParams.get('status')==='archived'||emptyProjects?[]:projects;
   else if(/^\/api\/projects\/\d+\/home$/.test(u.pathname)){const current=projects.find(p=>p.id===Number(u.pathname.split('/')[3]));data={project:current,chats:current.id===1?[chat]:[],resources:[],sessions:[]};}
   else if(u.pathname==='/api/project-chats')data=[chat];
   else if(u.pathname==='/api/project-chats/11/messages')data=[{id:1,chatId:11,role:'user',content:'Review the evidence supporting our thesis.',metadata:{},createdAt:now},{id:2,chatId:11,role:'assistant',content:'No connected financial observations are available for this Project. Connect a source or attach a filing to begin a source-backed review.',metadata:{},createdAt:now}];
   else if(u.pathname.includes('/artifacts')&&artifactFailure){status=503;data={error:'unavailable'};}
   else if(u.pathname.includes('/automation/')&&automationFailure){status=503;data={error:'unavailable'};}
   else if(u.pathname==='/api/quick-chats' && responseComplete)data=[{...chat,id:22,projectId:null,scope:'quick',title:'New conversation'}];
   else if(u.pathname==='/api/project-chats/22/messages' && responseComplete)data=[{id:3,chatId:22,role:'assistant',content:'UI verification finished.',metadata:{},createdAt:now}];
   else if(u.pathname==='/api/voice/providers')data={providers:[],configured:false};
   await route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
 };
 await page.route('**/api/**',apiHandler);
 await page.goto('http://127.0.0.1:4173/__p1_navigation_check.html');
 await page.getByRole('textbox',{name:'Ask LiOS',exact:true}).waitFor();
 assert.equal(await page.getByRole('complementary',{name:'Project context'}).count(),0);
 await page.screenshot({path:path.join(output, "lios-conversation-desktop.png")});
 await page.locator('main').getByRole('button',{name:'Company research',exact:true}).click();
 await page.getByRole('button',{name:'Close Project context'}).waitFor();
 await page.setViewportSize({width:1024,height:768});
 assert.equal(await page.getByRole('textbox',{name:'Ask LiOS',exact:true}).isVisible(),false);
 await page.getByRole('button',{name:'Close Project context'}).press('Escape');
 assert.equal(await page.getByRole('textbox',{name:'Ask LiOS',exact:true}).isVisible(),true);
 await page.setViewportSize({width:1440,height:900});
 const desktopNav=page.locator('.lios-authenticated-navigation');
 await desktopNav.getByRole('button',{name:'Search',exact:true}).click();
 const workSearch=page.getByRole('textbox',{name:'Search LiOS work',exact:true});
 await workSearch.fill('no-match');
 await page.getByText('No matching work.',{exact:true}).waitFor();
 await workSearch.fill('evidence');
 await page.getByRole('dialog',{name:'Search LiOS',exact:true}).getByRole('button',{name:/Investment thesis review/}).click();
 assert.equal(await page.getByRole('button',{name:'Clear chat',exact:true}).count(),0);
 await desktopNav.getByRole('button',{name:'Chats',exact:true}).click();
 await page.getByRole('heading',{name:'Chats',exact:true}).waitFor();
 await page.getByRole('button',{name:/Investment thesis review/}).last().click();
 assert.equal(writes.length,0);
 const input=page.getByRole('textbox',{name:'Ask LiOS',exact:true});await input.fill('composition test');
 await input.evaluate(el=>el.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',code:'Enter',bubbles:true,isComposing:true})));
 assert.equal(writes.length,0);
 await page.locator('.lios-authenticated-navigation').getByRole('button',{name:'Company research',exact:true}).click();
 await page.getByRole('dialog',{name:'Leave this draft?'}).waitFor();
 await page.getByRole('button',{name:'Cancel',exact:true}).click();
 assert.equal(await input.inputValue(),'composition test');
 await input.fill('');
 artifactFailure=true;
 await desktopNav.getByRole('button',{name:'Artifacts',exact:true}).click();
 await page.getByText('Unable to load artifacts.',{exact:false}).waitFor();
 artifactFailure=false;await page.getByRole('button',{name:'Retry',exact:true}).click();
 await page.getByText('Project Artifacts',{exact:true}).waitFor();
 automationFailure=true;
 await desktopNav.getByRole('button',{name:'Automations',exact:true}).click();
 await page.getByText('Unable to load automations.',{exact:false}).waitFor();
 automationFailure=false;await page.getByRole('button',{name:'Retry',exact:true}).click();
 await page.getByText('Continuous Intelligence',{exact:true}).waitFor();
 await desktopNav.getByRole('button',{name:'Plugins',exact:true}).click();
 await page.getByRole('button',{name:'Open Connectors'}).click();assert.equal(await page.locator('body').getAttribute('data-last-action'),'connectors');
 await page.setViewportSize({width:390,height:844});
 await page.getByRole('button',{name:'Open navigation'}).click();
 await page.locator('.lios-navigation-sheet').getByRole('button',{name:'Projects',exact:true}).click();
 await page.getByRole('heading',{name:'Projects',exact:true}).waitFor();
 await page.screenshot({path:path.join(output, "lios-projects-mobile.png")});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 await page.getByRole('button',{name:'Open navigation'}).click();
 const mobileActions=page.locator('.lios-navigation-sheet').getByRole('button',{name:'Actions for Company research',exact:true});
 await mobileActions.click();
 await page.getByRole('menuitem',{name:'Rename',exact:true}).click();
 await page.getByRole('dialog',{name:'Rename Project',exact:true}).waitFor();
 await page.getByRole('button',{name:'Cancel',exact:true}).click();
 await page.waitForFunction(el=>el===document.activeElement,await mobileActions.elementHandle());
 await page.locator('.lios-navigation-sheet').getByRole('button',{name:'Close',exact:true}).click();
 await page.getByRole('button',{name:'New Project',exact:true}).click();
 await page.getByRole('dialog',{name:'New Project'}).waitFor();
 await page.getByRole('textbox',{name:'Project name',exact:true}).fill('Portfolio review');
 await page.getByRole('button',{name:'Create Project',exact:true}).click();
 await page.getByRole('alert').filter({hasText:'Project storage unavailable'}).waitFor();
 assert.equal(await page.getByRole('textbox',{name:'Project name',exact:true}).inputValue(),'Portfolio review');
 createFailure=false;
 await page.getByRole('button',{name:'Create Project',exact:true}).click();
 await page.getByRole('heading',{name:'Portfolio review',exact:true}).waitFor();
 assert.equal(await page.evaluate(()=>localStorage.getItem('lios.activeProjectId')),'2');

 await page.getByRole('button',{name:'Open navigation'}).click();
 await page.locator('.lios-navigation-sheet').getByRole('button',{name:'Account: Verification User'}).click();
 await page.getByRole('menuitem',{name:'Sign out'}).click();
 assert.equal(await page.locator('body').getAttribute('data-last-action'),'logout');
 emptyProjects=true;
 const firstSend=await page.context().newPage();
 await firstSend.addInitScript(() => localStorage.clear());
 firstSend.on('pageerror',e=>errors.push(e.message));
 await firstSend.route('**/api/**',apiHandler);
 await firstSend.goto('http://127.0.0.1:4173/__p1_navigation_check.html');
 try { await firstSend.getByRole('textbox',{name:'Ask LiOS',exact:true}).fill('Verify the first saved conversation.'); } catch(error) { console.error(await firstSend.locator('body').innerText(), errors); await firstSend.screenshot({path:path.join(output,'first-send-failure.png')});throw error; }
 await firstSend.getByRole('button',{name:'Send',exact:true}).click();
 await firstSend.getByText('UI verification finished.',{exact:true}).waitFor();
 assert.equal(await firstSend.evaluate(()=>localStorage.getItem('lios.activeProjectChatId')),'22');
 assert.equal(await firstSend.getByRole('dialog').count(),0);
 await firstSend.close();
 assert.deepEqual(errors,[]);
 console.log(JSON.stringify({passed:19,coverage:['desktop conversation','on-demand context','1024 context replacement','Escape context return','saved-work search no-results','saved-work search opens chat','no permanent clear-chat chrome','IME Enter safety','Library error and retry','Automations error and retry','plugin connector callback','mobile navigation','mobile overflow','account sign-out','unsent draft cancel preservation','mobile Project creation failure and retry','created Project selection','mobile object menu and rename-cancel focus','first-send creates and selects chat during execution'],pageErrors:errors}));
 console.log(`Screenshots: ${output}`);
} finally {
 await browser?.close();
 await server?.close();
 await fs.rm(htmlPath, {force:true});
 await fs.rm(fixturePath, {force:true});
}
