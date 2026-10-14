const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../site/app.js'),'utf8');
const prefix=source.split("\n$('#period').innerHTML=")[0];
function fixture(savedRate){
  const stored=new Map(savedRate===undefined?[]:[['pl-production-fx-v1-fixture',String(savedRate)]]);
  const data={year:2026,exchangeFC:32,scopes:[{id:'pd'}],products:[
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
  vm.runInContext("state.dailyStart='2026-10-01';state.dailyEnd='2026-10-03';",context);
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
