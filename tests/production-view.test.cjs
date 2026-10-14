const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../site/app.js'),'utf8');
const prefix=source.split("\n$('#period').innerHTML=")[0];
function fixture(savedRate){
  const stored=new Map(savedRate===undefined?[]:[['pl-production-fx-v1-fixture',String(savedRate)]]);
  const data={year:2026,exchangeFC:32,scopes:[require('../site/workbook-data.js').parseInputSheet(require('../site/workbook-data.js').inputTemplate(2026),2026,new Date(2026,9,14))],inputSheet:'PL Input 2026',rows:require('../site/workbook-data.js').DEFINITIONS.map(([key,label,en,type],order)=>({key,label,en,type,order})),products:[
    {model:'MODEL-A-S',fcTHB:320,fcPriceUSD:10,fcExchangeRate:32,fcTHBSource:'Sale Price · FC USD × Rate',forecastSourceRow:5},
    {model:'FIXED',fcTHB:50,fcPriceUSD:null,fcExchangeRate:32,fcTHBSource:'Sale Price · FC BHT',forecastSourceRow:6},
  ],jobOrder:{status:'loaded',firstDate:'2026-10-01',lastDate:'2026-10-03',records:[
    {date:'2026-10-01',time:'08:00',model:'MODEL-A',qty:2,jobNo:'J1'},
    {date:'2026-10-01',time:'09:00',model:'FIXED',qty:3,jobNo:'J2'},
    {date:'2026-10-02',time:'08:00',model:'UNKNOWN',qty:4,jobNo:'J3'},
    {date:'2026-10-03',time:'08:00',model:'MODEL-A-S',qty:1,jobNo:'J4'},
  ]}};
  const context=vm.createContext({window:{PL_DATA:data,PL_CONFIG:{spreadsheetId:'fixture'}},localStorage:{getItem:key=>stored.get(key)||null,setItem:(key,value)=>stored.set(key,value)},Intl,Date,console});
  vm.runInContext(prefix,context);
  vm.runInContext("state.period='daily';state.dailyStart='2026-10-01';state.dailyEnd='2026-10-03';",context);
  return {context,stored,run:code=>vm.runInContext(code,context)};
}
test('Sale total uses matched production quantity and preserves THB-only prices under FX override',()=>{
  const {run}=fixture();
  assert.equal(run('dailySummary().estimatedValue'),1110);
  assert.equal(run('dailySummary().pricedQty'),6);
  run('fxOverride=35;priceMatchCache.clear()');
  assert.equal(run('dailySummary().estimatedValue'),1200);
  assert.equal(run("priceMatchForModel('FIXED').price"),50);
  assert.match(run("modelPriceNotes('MODEL-A')"),/35 บาท\/USD/);
});
test('remembered FX is restored on entry; invalid remembered values use sheet rate',()=>{
  assert.equal(fixture(35).run('dailySummary().estimatedValue'),1200);
  for(const value of ['bad',0,-1])assert.equal(fixture(value).run('effectiveExchangeRate()'),32);
});
test('chart has independent quantity and Sale axes in every granularity; unpriced periods leave a gap',()=>{
  const {run}=fixture();
  for(const mode of ['hourly','daily','monthly','quarterly','yearly']){
    const chart=run(`dailyProductionChart(dailyRecords(),'${mode}')`);
    assert.match(chart,/แกนซ้ายชิ้น แกนขวาบาท/);
    assert.match(chart,/stroke="#d18c35"/);
    assert.doesNotMatch(chart,/NaN|Infinity/);
  }
  const daily=run("dailyProductionChart(dailyRecords(),'daily')");
  assert.match(daily,/Sale ประมาณการ 790\.00 บาท/);
  assert.match(daily,/Sale ประมาณการ 320\.00 บาท/);
  assert.equal((daily.match(/<circle /g)||[]).length,2);
  assert.equal((daily.match(/M[\d.]+,/g)||[]).length,2);
});
test('dashboard omits raw log table and inline notes; notes and FX remain accessible as buttons',()=>{
  const html=fixture().run('dailyDashboard()');
  assert.doesNotMatch(html,/daily-log-panel|รายการผลิตรายชั่วโมง|price-match-note|daily-notice/);
  assert.match(html,/data-action="model-price-notes"/);
  assert.match(html,/data-action="production-rules"/);
  assert.match(html,/data-action="edit-production-fx"/);
  assert.match(html,/Sale Price!O1/);
});
test('saving FX clears cached prices, updates totals, and persists for next visit',()=>{
  const {run,context,stored}=fixture();
  run('dailySummary()');
  context.document={addEventListener:(event,handler)=>context.submit=handler,querySelector:()=>({close(){}})};
  context.FormData=class{get(){return '36';}};
  run('render=()=>{};toast=()=>{};');
  const listener=source.split('\n').find(line=>line.startsWith("document.addEventListener('submit'"));
  vm.runInContext(listener,context);
  context.submit({target:{id:'exchange-rate-form'},preventDefault(){}});
  assert.equal(stored.get('pl-production-fx-v1-fixture'),'36');
  assert.equal(run('dailySummary().estimatedValue'),1230);
  assert.equal(fixture(stored.get('pl-production-fx-v1-fixture')).run('dailySummary().estimatedValue'),1230);
});
test('monthly P&L revenue = production qty × FC price; unpriced models are counted but not valued',()=>{
  const {context,run}=fixture();
  const adapter=require('../site/workbook-data.js');
  context.window.PL_WORKBOOK=adapter;
  const scope=adapter.parseInputSheet(adapter.inputTemplate(2026),2026,new Date(2026,10,1));
  scope.periods[9].result.rm=100;
  run('D.scopes[0]=undefined');context.window.PL_DATA.scopes[0]=scope;
  run('applyProductionRevenue()');
  const oct=scope.periods[9];
  assert.equal(oct.unitsResult,10);assert.equal(oct.unpricedQty,4);
  assert.equal(oct.result.revenue,3*320+3*50);
  assert.equal(oct.result.cm,3*320+3*50-100);
  assert.equal(scope.periods[0].result.revenue,0);assert.equal(scope.periods[11].result.revenue,null);
});
test('overview is the date-range production page and has no period selector or daily toggle',()=>{
  const {run}=fixture();
  run("state.page='overview'");
  assert.deepEqual([...run('activeRange()')],['2026-10-01','2026-10-03']);
  assert.equal(run('productionView()'),true);assert.equal(run('chartMode()'),'daily');
  assert.equal(run('overview()'),run('dailyDashboard()'));
  run("state.page='pnl'");assert.equal(run('productionView()'),false);
});
test('cost structure covers the months in the date range, from PL Input costs',()=>{
  const {context,run}=fixture();
  assert.deepEqual([...run("state.dailyStart='2026-09-20';state.dailyEnd='2026-10-03';costMonthIndexes()")],[8,9]);
  assert.match(run('costPanel()'),/ยังไม่ได้กรอกต้นทุน/);assert.doesNotMatch(run('costPanel()'),/create-input/);
  assert.match(run('D.scopes[0].missing=true;costPanel()'),/data-action="create-input" data-dept=""/);run('D.scopes[0].missing=false');
  const periods=context.window.PL_DATA.scopes[0].periods,W=require('../site/workbook-data.js');
  periods[8].result=W.computeTotals({revenue:1,rm:400000,labor:100000,ohfc:300000});
  periods[9].result=W.computeTotals({revenue:1,rm:100000,ohvc:100000});
  const html=run('costPanel()');
  assert.match(html,/กันยายน–ตุลาคม 2026/);assert.match(html,/<svg viewBox="0 0 160 160"/);
  assert.match(html,/วัตถุดิบ<strong>0\.50<\/strong>/);assert.match(html,/ต้นทุนคงที่<strong>0\.30<\/strong>/);assert.match(html,/ค่าแรงและ OT<strong>0\.10<\/strong>/);
  periods[9].result=W.computeTotals({revenue:1});
  const partial=run('costPanel()');assert.match(partial,/วัตถุดิบ<strong>0\.40<\/strong>/);assert.match(partial,/ยังไม่ได้กรอกต้นทุนของ ตุลาคม/);
  assert.match(run('dailyDashboard()'),/cost-panel/);
});

function twoDepartments(){
  const f=fixture(),W=require('../site/workbook-data.js');f.context.window.PL_WORKBOOK=W;
  const rows=W.inputTemplate(2026,{label:'แผนก QA',auto:false}),h=rows[2];
  rows.find(r=>r[0]==='revenue')[h.indexOf('Sep Actual')]=900000;rows.find(r=>r[0]==='rm')[h.indexOf('Sep Actual')]=300000;
  rows.find(r=>r[0]==='rm')[1]='วัตถุดิบหลัก';rows.find(r=>r[0]==='rm')[2]='Main material';
  const qa=W.parseInputSheet(rows,2026,new Date(2026,9,14),{id:'d:qa',name:'QA',label:'แผนก QA',sheet:'PL Input 2026 QA',auto:false});
  f.context.window.PL_DATA.scopes.push(qa);
  return {...f,qa};
}
test('a department without production data shows only its cost structure and keeps manual revenue',()=>{
  const {run,context}=twoDepartments();
  run("applyProductionRevenue();state.scope='d:qa';state.page='overview';state.dailyStart='2026-09-01';state.dailyEnd='2026-09-30'");
  const html=run('dailyDashboard()');
  assert.match(html,/เป็นของแผนก PD เท่านั้น/);assert.match(html,/cost-panel/);assert.doesNotMatch(html,/daily-kpi-grid/);
  assert.match(html,/แผนก QA/);assert.match(html,/วัตถุดิบ<strong>0\.30<\/strong>/);
  assert.equal(context.window.PL_DATA.scopes[1].periods[8].result.revenue,900000);
  assert.equal(context.window.PL_DATA.scopes[1].periods[8].result.cm,600000);
});
test('production revenue goes only to PD; a number typed in the PD revenue cell wins',()=>{
  const {run,context}=twoDepartments(),scopes=context.window.PL_DATA.scopes;
  run('applyProductionRevenue()');
  assert.equal(scopes[0].periods[9].result.revenue,3*320+3*50);assert.equal(scopes[1].periods[9].result.revenue,null);
  scopes[0].periods[9].revenueManual=777;run('applyProductionRevenue()');
  assert.equal(scopes[0].periods[9].result.revenue,777);
});
test('item names typed in columns B and C of the department tab replace the built-in names',()=>{
  const {run}=twoDepartments();
  run("state.scope='d:qa'");
  assert.match(run('tableRows(true)'),/วัตถุดิบหลัก/);assert.match(run('tableRows(true)'),/Main material/);
  run("state.scope='pd'");assert.doesNotMatch(run('tableRows(true)'),/วัตถุดิบหลัก/);assert.match(run('tableRows(true)'),/วัตถุดิบใช้ไป/);
});
test('chart is drawn at the card width, so the sale axis stays inside the frame however long the range',()=>{
  const {run}=fixture();
  for(const [from,to] of [['2026-10-01','2026-10-03'],['2026-01-01','2026-12-31']]){
    run(`state.dailyStart='${from}';state.dailyEnd='${to}'`);
    const chart=run("dailyProductionChart(dailyRecords(),'daily',500,260)");
    assert.match(chart,/viewBox="0 0 500 260"/);assert.doesNotMatch(chart,/width:\d+px/);
    const xs=[...chart.matchAll(/<text x="([\d.]+)"[^>]*class="sale-axis"/g)].map(m=>Number(m[1]));
    assert.ok(xs.length>0&&xs.every(x=>x===423),xs.join());
    const ticks=(chart.match(/text-anchor="middle"/g)||[]).length;assert.ok(ticks<=Math.ceil(500/62)+1,`ticks ${ticks}`);
  }
  const tall=run("dailyProductionChart(dailyRecords(),'daily',500,520)");assert.match(tall,/viewBox="0 0 500 520"/);assert.doesNotMatch(tall,/NaN|Infinity/);
});
