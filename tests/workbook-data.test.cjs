const {test} = require('node:test');
const assert = require('node:assert/strict');
const {MONTHS, INPUT_KEYS, inputTemplate, inputSheetName, departmentSheets, parseInputSheet, computeTotals, inputDataset, parseProducts} = require('../site/workbook-data.js');

function filledInput(year) {
  const rows = inputTemplate(year);
  const header = rows[2], col = name => header.indexOf(name);
  for (const row of rows.slice(3)) {
    if (row[0] !== 'revenue') row[col('Jan Actual')] = 10;
    row[col('Jan BP')] = row[0] === 'revenue' ? 1000 : 20;
  }
  return rows;
}

test('template lists only hand-entered BP บริษัท A items; subtotals are never input rows',()=>{
  const rows = inputTemplate(2026);
  assert.equal(inputSheetName(2026),'PL Input 2026');
  assert.deepEqual(rows.slice(3).map(r=>r[0]),INPUT_KEYS);
  for (const key of ['vc','cm','fc','profit','net']) assert.ok(!INPUT_KEYS.includes(key));
  assert.equal(rows[2].length,27);assert.equal(rows[3][3],'อัตโนมัติ');
});
test('totals follow the template formulas and blank items count as zero',()=>{
  const t = computeTotals({revenue:1000,rm:300,labor:100,ohfc:50,other:20,tax:10});
  assert.equal(t.vc,400);assert.equal(t.cm,600);assert.equal(t.fc,50);assert.equal(t.profit,550);assert.equal(t.net,560);
  const empty = computeTotals({revenue:1000});
  assert.equal(empty.vc,null);assert.equal(empty.cm,null);assert.equal(empty.net,null);
});
test('input sheet: Actual revenue waits for production, costs and BP come from the tab, kinds follow today',()=>{
  const scope = parseInputSheet(filledInput(2026),2026,new Date(2026,1,15));
  const jan = scope.periods[0];
  assert.equal(jan.result.revenue,null);assert.equal(jan.result.rm,10);assert.equal(jan.result.vc,70);
  assert.equal(jan.bp.revenue,1000);assert.equal(jan.bp.vc,140);assert.equal(jan.bp.cm,860);assert.equal(jan.bp.fc,100);
  assert.equal(jan.bp.net,860-100+20-60);
  assert.equal(jan.resultCol,'D');assert.equal(jan.bpCol,'P');assert.equal(scope.rowByKey.revenue,4);
  assert.deepEqual(scope.periods.map(p=>p.kind).slice(0,3),['Actual','Actual','Forecast']);
  assert.equal(scope.missing,false);
});
test('missing input tab yields an empty H9 scope flagged for creation',()=>{
  const ds = inputDataset({properties:{title:'DB'},spreadsheetId:'x',sheets:[{properties:{title:'Sale Price',sheetId:1,gridProperties:{rowCount:5,columnCount:17}}},{properties:{title:'Manpower',sheetId:2,gridProperties:{rowCount:5,columnCount:5}}}]},{year:2026,saleRows:[[,,,,,,'#REF!']]});
  assert.equal(ds.inputMissing,true);assert.equal(ds.scopes.length,1);assert.equal(ds.scopes[0].id,'pd');
  assert.equal(ds.sources.find(s=>s.name==='Manpower').used,false);
  assert.deepEqual(ds.errors,[{sheet:'Sale Price',cell:'G1',error:'#REF!'}]);
});
test('products are joined by SKU instead of row position and retain incomplete BP prices',()=>{
  const rows=Array.from({length:7},()=>[]);
  Object.assign(rows[4],{1:'SKU-A-S',2:'A',3:10,5:330,10:'SKU-B',12:22,13:5,14:704,16:5/22});
  Object.assign(rows[5],{1:'SKU-B-S',3:11,5:363,10:'SKU-A',12:20,13:4,14:640,16:.2});
  Object.assign(rows[6],{10:'SKU-C',12:30});
  const products=parseProducts(rows);assert.equal(products.length,3);
  assert.equal(products[0].model,'SKU-A-S');assert.equal(products[0].fcPriceUSD,20);assert.equal(products[0].rmUSD,null);
  assert.equal(products[1].fcTHB,704);assert.equal(products[2].priceUSD,null);
});
test('duplicate BP rows are retained and ambiguous forecast SKU rows are never merged silently',()=>{
  const rows=Array.from({length:8},()=>[]);
  Object.assign(rows[4],{1:'SKU-A-S',3:10,10:'SKU-A',12:20});
  Object.assign(rows[5],{1:'SKU-A-S',3:11});
  let products=parseProducts(rows);assert.equal(products.length,2);assert.equal(products[0].priceUSD,10);assert.equal(products[1].priceUSD,11);assert.equal(products[1].fcPriceUSD,20);
  Object.assign(rows[6],{10:'SKU-A',12:21});products=parseProducts(rows);assert.equal(products.length,4);assert.equal(products[0].fcPriceUSD,null);assert.ok(products[0].matchWarning);
});

test('every PL Input <year> <name> tab is a department; H9 is always first and never duplicated',()=>{
  const d=departmentSheets(['Sale Price','PL Input 2026','PL Input 2026 QA','PL Input 2026 แผนก ขาย','PL Input 2026 h9','PL Input 2025 QA','PL Input 2026 ','PL Input 20260'],2026);
  assert.deepEqual(d.map(x=>x.id),['pd','d:qa','d:แผนก ขาย']);
  assert.deepEqual(d.map(x=>x.label),['แผนก H9','แผนก QA','แผนก ขาย']);
  assert.deepEqual(d.map(x=>x.auto),[true,false,false]);assert.deepEqual(d.map(x=>x.name),['','QA','แผนก ขาย']);
  assert.equal(departmentSheets([],2026).length,1);
});
test('department template: manual revenue and editable names; the H9 template keeps the automatic marker',()=>{
  const manual=inputTemplate(2026,{label:'แผนก QA',auto:false}),auto=inputTemplate(2026);
  assert.match(manual[0][0],/แผนก QA/);assert.equal(manual[3][3],'');assert.equal(auto[3][3],'อัตโนมัติ');
  assert.equal(manual[2][1],'รายการ (ชื่อที่แสดงบนเว็บ)');
});
test('renamed items are read from columns B and C and matching still uses the key column',()=>{
  const rows=inputTemplate(2026);rows[4][1]='วัตถุดิบ (ใหม่)';rows[4][2]='Renamed material';rows[5][1]='';rows[5][2]='';
  rows[4][rows[2].indexOf('Jan Actual')]=5;
  const scope=parseInputSheet(rows,2026,new Date(2026,1,1));
  assert.deepEqual(scope.labels.rm,{label:'วัตถุดิบ (ใหม่)',en:'Renamed material'});
  assert.equal(scope.labels.labor,undefined);assert.equal(scope.periods[0].result.rm,5);
});
test('manual revenue numbers are kept; the automatic marker stays empty until production fills it',()=>{
  const rows=inputTemplate(2026);rows[3][rows[2].indexOf('Feb Actual')]=1234;
  const scope=parseInputSheet(rows,2026,new Date(2026,3,1));
  assert.equal(scope.periods[0].revenueManual,null);assert.equal(scope.periods[1].revenueManual,1234);assert.equal(scope.periods[1].result.revenue,1234);
});
test('dataset reads one scope per department tab and lists each tab as used',()=>{
  const meta={properties:{title:'DB'},spreadsheetId:'x',sheets:['Sale Price','PL Input 2026','PL Input 2026 QA','Manpower'].map((t,i)=>({properties:{title:t,sheetId:i,gridProperties:{rowCount:5,columnCount:27}}}))};
  const ds=inputDataset(meta,{year:2026,saleRows:[],inputRows:{'PL Input 2026 QA':inputTemplate(2026,{label:'แผนก QA',auto:false})}});
  assert.deepEqual(ds.scopes.map(s=>s.id),['pd','d:qa']);assert.equal(ds.scopes[0].missing,true);assert.equal(ds.scopes[1].missing,false);assert.equal(ds.inputMissing,true);
  assert.deepEqual(ds.sources.filter(s=>s.used).map(s=>s.name),['Sale Price','PL Input 2026','PL Input 2026 QA']);
});
