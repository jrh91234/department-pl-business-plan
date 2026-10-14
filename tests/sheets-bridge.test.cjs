const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const adapter=require('../site/workbook-data.js');

async function connectFixture({withInput=false,extra=[]}={}) {
  const elements=new Map(),writes=[],reads=[];
  const element=id=>{if(!elements.has(id))elements.set(id,{hidden:false,disabled:true,style:{},classList:{toggle(){}},setAttribute(){},addEventListener(name,fn){this[name]=fn;}});return elements.get(id);};
  const year=new Date().getFullYear(),inputTitle=`PL Input ${year}`;
  const sheet=(title,id)=>({properties:{title,sheetId:id,gridProperties:{rowCount:50,columnCount:30}}});
  const metadata={spreadsheetId:'fixture-id',properties:{title:'Test workbook'},sheets:[sheet('Sale Price',1),sheet('Manpower',3)]};
  if(withInput)metadata.sheets.push(sheet(inputTitle,4));
  extra.forEach((name,i)=>metadata.sheets.push(sheet(`${inputTitle} ${name}`,20+i)));
  const sale=[[],[],[],[],[null,'M-S','Model',10,null,330,null,null,null,null,'M',null,10,null,320]];
  let header=[],inputRows=withInput?adapter.inputTemplate(year):[];
  const response=(body,ok=true)=>({ok,status:ok?200:400,json:async()=>body});
  const fetch=async(url,opts={})=>{
    const uri=new URL(url), method=opts.method||'GET';
    if(method!=='GET')writes.push({url:decodeURIComponent(url),method,body:JSON.parse(opts.body)});
    if(uri.pathname.endsWith(':batchUpdate')){const title=JSON.parse(opts.body).requests[0].addSheet.properties.title;metadata.sheets.push(sheet(title,metadata.sheets.length+10));return response({replies:[{}]});}
    if(uri.pathname.endsWith('values:batchGet')){const ranges=uri.searchParams.getAll('ranges');reads.push(...ranges);return response({valueRanges:ranges.map(r=>({values:r.startsWith("'Sale Price'")?sale:r.startsWith("'business_plans'")?(header.length?[header]:[]):inputRows}))});}
    if(uri.pathname.includes('/values/')){const path=decodeURIComponent(uri.pathname);if(method==='PUT'&&path.includes('business_plans'))header=JSON.parse(opts.body).values[0];if(method==='PUT'&&path.includes('PL Input'))inputRows=JSON.parse(opts.body).values;return response(method==='GET'?{values:path.includes('PL Input')?(path.includes('QA')?adapter.inputTemplate(year,{label:'แผนก QA',auto:false}):inputRows):header.length?[header]:[]}:{updates:{updatedRows:1}});}
    return response(structuredClone(metadata));
  };
  class View {setFileIds(){return this;}setMimeTypes(){return this;}setIncludeFolders(){return this;}setSelectFolderEnabled(){return this;}setMode(){return this;}}
  class Picker {addView(){return this;}setMaxItems(){return this;}setLocale(){return this;}setDeveloperKey(){return this;}setAppId(){return this;}setOAuthToken(){return this;}setCallback(cb){this.callback=cb;return this;}build(){return {setVisible:()=>this.callback({action:'picked',docs:[{id:this.id||'fixture-id'}]})};}}
  const stored=new Map();
  const window={PL_CONFIG:{googleClientId:'fixture',googleApiKey:'fixture',googleProjectNumber:'fixture',spreadsheetId:'fixture-id',jobOrderSpreadsheetId:'fixture-id',jobOrderSheetName:'Log'},PL_WORKBOOK:adapter,gapi:{load:(name,opts)=>opts.callback()},google:{accounts:{oauth2:{initTokenClient:opts=>({requestAccessToken:()=>opts.callback({access_token:'fixture-token'})})}},picker:{DocsView:View,PickerBuilder:Picker,ViewId:{SPREADSHEETS:'sheets'},DocsViewMode:{LIST:'list'},Action:{PICKED:'picked',CANCEL:'cancel'}}}};
  const document={querySelector:element,createElement:()=>({}),head:{appendChild:s=>s.onload()},body:{appendChild(){}}};
  const localStorage={getItem:k=>stored.get(k)??null,setItem:(k,v)=>stored.set(k,String(v)),removeItem:k=>stored.delete(k)};
  vm.runInNewContext(fs.readFileSync(require.resolve('../site/google-sheets.js'),'utf8'),{window,document,fetch,localStorage,setTimeout,URL,URLSearchParams,Intl,crypto:require('node:crypto').webcrypto,location:{reload(){}}});
  await new Promise(resolve=>setImmediate(resolve));
  element('#google-signin').click();
  for(let i=0;i<200&&!window.PL_DB&&element('#google-signin').disabled;i++)await new Promise(resolve=>setImmediate(resolve));
  assert.ok(window.PL_DB?.connected,element('#connect-message-text').textContent);
  return {window,writes,reads,inputTitle,setHeader:value=>header=value};
}

test('only Sale Price, PL Input and business_plans are read; manpower and legacy tabs never are',async()=>{
  const {window,reads,inputTitle}=await connectFixture({withInput:true});
  assert.deepEqual(reads,["'Sale Price'!A1:Q",`'${inputTitle}'!A1:AA`]);
  assert.equal(window.PL_DATA.inputMissing,false);assert.equal(window.PL_DATA.scopes.length,1);
});
test('creating the input tab writes the template once and never over an existing tab',async()=>{
  const {window,writes,inputTitle}=await connectFixture();
  assert.equal(window.PL_DATA.inputMissing,true);assert.equal(writes.length,0);
  await window.PL_DB.createInputSheet();
  assert.equal(writes.length,2);assert.ok(writes[0].url.endsWith(':batchUpdate'));
  assert.equal(writes[1].method,'PUT');assert.equal(writes[1].body.values[2][3],'Jan Actual');assert.ok(writes[1].url.includes(inputTitle));
  await window.PL_DB.createInputSheet();assert.equal(writes.length,2);
});
test('adding a department creates its own tab with a manual-revenue template; bad names are rejected',async()=>{
  const {window,writes,inputTitle}=await connectFixture({withInput:true});
  await assert.rejects(window.PL_DB.createInputSheet(window.PL_DATA.year,'PD'),/ไม่ซ้ำกับ PD/);
  await assert.rejects(window.PL_DB.createInputSheet(window.PL_DATA.year,'a/b'),/ห้ามมี/);
  assert.equal(writes.length,0);
  const title=await window.PL_DB.createInputSheet(window.PL_DATA.year,'QA');
  assert.equal(title,`${inputTitle} QA`);assert.equal(writes.length,2);
  assert.equal(writes[0].body.requests[0].addSheet.properties.title,title);
  const values=writes[1].body.values;assert.match(values[0][0],/แผนก QA/);assert.equal(values[3][3],'');
});
test('every department tab is read in the same single batch request',async()=>{
  const {reads}=await connectFixture({withInput:true,extra:['QA']});
  assert.equal(reads.length,3);assert.ok(reads.some(r=>r.includes('QA')));
});
test('a filled input tab is never overwritten',async()=>{
  const {window,writes}=await connectFixture({withInput:true});
  await window.PL_DB.createInputSheet();assert.equal(writes.length,0);
});
test('new workbook opens without business_plans; log creation and header writes occur only on Save',async()=>{
  const {window,writes}=await connectFixture();assert.equal(writes.length,0);assert.equal(window.PL_DATA.year,new Date().getFullYear());
  await window.PL_DB.savePlan('pd',{assumptions:{volume:0,price:1,raw:2,labor:3,fixed:4},initiatives:[]});
  assert.equal(writes.length,3);assert.ok(writes[0].url.endsWith(':batchUpdate'));assert.equal(writes[1].method,'PUT');assert.ok(writes[2].url.includes(':append'));
  assert.equal(writes[2].body.values[0][1],'pd');assert.equal(writes[2].body.values[0][4],0);
  await window.PL_DB.savePlan('pd',{assumptions:{volume:0,price:0,raw:0,labor:0,fixed:0},initiatives:[]});assert.equal(writes.length,4);
});
test('malformed history headers stop append without overwriting the existing header',async()=>{
  const {window,writes,setHeader}=await connectFixture();
  await window.PL_DB.savePlan('pd',{assumptions:{volume:0,price:0,raw:0,labor:0,fixed:0},initiatives:[]});
  setHeader(['different_schema']);const before=writes.length;
  await assert.rejects(window.PL_DB.savePlan('pd',{assumptions:{volume:0,price:0,raw:0,labor:0,fixed:0},initiatives:[]}),/หัวตาราง/);
  assert.equal(writes.length,before);
});
