const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const adapter=require('../site/workbook-data.js');

async function connectFixture() {
  const elements=new Map(),writes=[];
  const element=id=>{if(!elements.has(id))elements.set(id,{hidden:false,disabled:true,classList:{toggle(){}},addEventListener(name,fn){this[name]=fn;}});return elements.get(id);};
  const metadata={spreadsheetId:'fixture-id',properties:{title:'Test workbook'},sheets:[{properties:{title:'BP บริษัท A (PD)',sheetId:1,gridProperties:{rowCount:50,columnCount:80}}}]};
  const rows=Array.from({length:40},()=>[]);
  const labels=['REVENUES','Raw material consumed','Direct labour','Overtime direct','Direct labour - SCAN','Overtime direct - SCAN','OH VC','Selling expenses','VC total','CM','OH FC','Admin FC','Center Expenses_แบ่ง 3','Center Expenses_แบ่ง 7','Loss on impairment of assets','FC total','Profit','Other income','Extra','Interest','Tax','Net Profit'];
  adapter.MONTHS.forEach((month,i)=>{const c=6+i*4;rows[3][c]=month;rows[4][c]='BP';rows[4][c+2]=i?'Forecast':'Actual';labels.forEach((label,j)=>{rows[j+6][1]=label;rows[j+6][c]=100;rows[j+6][c+2]=101;});});rows[3][54]='Y2035';
  const grid={sheets:[{properties:{title:'BP บริษัท A (PD)'},data:[{rowData:rows.map(row=>({values:row.map(v=>({effectiveValue:typeof v==='number'?{numberValue:v}:{stringValue:v}}))}))}]}]};
  let header=[];
  const response=(body,ok=true)=>({ok,status:ok?200:400,json:async()=>body});
  const fetch=async(url,opts={})=>{
    const uri=new URL(url), method=opts.method||'GET';
    if(method!=='GET')writes.push({url,method,body:JSON.parse(opts.body)});
    if(uri.pathname.endsWith(':batchUpdate')){metadata.sheets.push({properties:{title:'business_plans',sheetId:2,gridProperties:{rowCount:1000,columnCount:10}}});return response({replies:[{}]});}
    if(uri.pathname.includes('/values/')){if(method==='PUT')header=JSON.parse(opts.body).values[0];return response(method==='GET'?{values:header.length?[header]:[]}:{updates:{updatedRows:1}});}
    return response((uri.searchParams.get('fields')||'').includes('effectiveValue')?grid:structuredClone(metadata));
  };
  class View {setFileIds(){return this;}setMimeTypes(){return this;}setIncludeFolders(){return this;}setSelectFolderEnabled(){return this;}setMode(){return this;}}
  class Picker {addView(){return this;}setMaxItems(){return this;}setLocale(){return this;}setDeveloperKey(){return this;}setAppId(){return this;}setOAuthToken(){return this;}setCallback(cb){this.callback=cb;return this;}build(){return {setVisible:()=>this.callback({action:'picked',docs:[{id:'fixture-id'}]})};}}
  const window={PL_CONFIG:{googleClientId:'fixture',googleApiKey:'fixture',googleProjectNumber:'fixture',spreadsheetId:'fixture-id'},PL_WORKBOOK:adapter,gapi:{load:(name,opts)=>opts.callback()},google:{accounts:{oauth2:{initTokenClient:opts=>({requestAccessToken:()=>opts.callback({access_token:'fixture-token'})})}},picker:{DocsView:View,PickerBuilder:Picker,ViewId:{SPREADSHEETS:'sheets'},DocsViewMode:{LIST:'list'},Action:{PICKED:'picked',CANCEL:'cancel'}}}};
  const document={querySelector:element,createElement:()=>({}),head:{appendChild:s=>s.onload()},body:{appendChild(){}}};
  vm.runInNewContext(fs.readFileSync(require.resolve('../site/google-sheets.js'),'utf8'),{window,document,fetch,URLSearchParams,crypto:require('node:crypto').webcrypto,location:{reload(){}}});
  await new Promise(resolve=>setImmediate(resolve));
  await element('#google-signin').click();
  assert.ok(window.PL_DB?.connected);
  return {window,writes,setHeader:value=>header=value};
}

test('new workbook opens without business_plans; log creation and header writes occur only on Save',async()=>{
  const {window,writes}=await connectFixture();assert.equal(writes.length,0);assert.equal(window.PL_DATA.year,2035);
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
