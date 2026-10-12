const {test} = require('node:test');
const assert = require('node:assert/strict');
const {MONTHS, DEFINITIONS, decodeGrid, parseScope, parseProducts} = require('../site/workbook-data.js');

function fixture() {
  const rows = Array.from({length:40},()=>[]);
  const labels = ['REVENUES','Raw material consumed','Direct labour','Overtime direct','Direct labour - SCAN','Overtime direct - SCAN','OH VC','Selling expenses','VC total','CM','OH FC','Admin FC','Center Expenses_แบ่ง 3','Center Expenses_แบ่ง 7','Loss on impairment of assets','FC total','Profit','Other income','Extra','Interest','Tax','Net Profit'];
  let col=6;
  MONTHS.forEach((month,i)=>{rows[3][col]=month;rows[4][col]='BP';rows[4][col+2]=i===0?'Actual':'Forecast';rows[1][col]=i+1;rows[1][col+2]=i+2;labels.forEach((label,j)=>{rows[j+6][1]=label;rows[j+6][col]=100+i+j;rows[j+6][col+2]=200+i+j;});col+=4;if(i%3===2){rows[3][col]='Q'+(i+1)/3+"'35";rows[4][col]='BP';rows[4][col+2]='Forecast';labels.forEach((_,j)=>{rows[j+6][col]=999999;rows[j+6][col+2]=999999;});col+=4;}});
  rows[3][col]='Y2035';rows[4][col]='BP';
  rows[3][col+7]='Jan';rows[4][col+7]='Target';rows[4][col+9]='Forecast';
  return rows;
}

test('monthly columns skip quarters, annual totals and historic Target columns; locate shifted rows',()=>{
  const scope=parseScope(fixture(),'pd','BP บริษัท A (PD)','PD');
  assert.equal(scope.year,2035);assert.equal(scope.periods.length,12);
  assert.deepEqual(scope.periods.map(p=>p.month),MONTHS);
  assert.equal(scope.periods[3].bpCol,'W');assert.equal(scope.periods[3].resultCol,'Y');
  assert.equal(scope.periods[0].kind,'Actual');assert.equal(scope.periods[1].kind,'Forecast');
  assert.equal(scope.periods[11].bp.revenue,111);assert.equal(scope.rowByKey.net,28);
  assert.equal(scope.periods.reduce((sum,p)=>sum+p.bp.revenue,0),1266);
});
test('blank and spreadsheet errors stay unavailable; zero and full precision stay numeric',()=>{
  const rows=fixture();rows[6][6]=0;rows[6][8]=123.123456789;rows[7][8]='#REF!';rows[8][8]='';
  const p=parseScope(rows,'pd','BP บริษัท A (PD)','PD').periods[0];
  assert.equal(p.bp.revenue,0);assert.equal(p.result.revenue,123.123456789);assert.equal(p.result.rm,null);assert.equal(p.result.labor,null);
});
test('typed Google grid errors retain cell address and diagnostic message',()=>{
  const g=decodeGrid({properties:{title:'BP'},data:[{startRow:5,startColumn:6,rowData:[{values:[{effectiveValue:{numberValue:0}},{effectiveValue:{errorValue:{type:'REF',message:'Missing source'}}},{}]}]}]});
  assert.equal(g.rows[5][6],0);assert.equal(g.rows[5][7],'#REF!');assert.equal(g.rows[5][8],null);
  assert.deepEqual(g.errors,[{sheet:'BP',cell:'H6',error:'#REF!',message:'Missing source'}]);
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
test('missing months and required totals fail clearly rather than mapping arbitrary cells',()=>{
  const rows=fixture();rows[3][6]='Missing';assert.throws(()=>parseScope(rows,'pd','BP','PD'),/12 เดือน/);
  const noNet=fixture();noNet[27][1]='Unknown';assert.throws(()=>parseScope(noNet,'pd','BP','PD'),/net/);
});
test('duplicate BP rows are retained and ambiguous forecast SKU rows are never merged silently',()=>{
  const rows=Array.from({length:8},()=>[]);
  Object.assign(rows[4],{1:'SKU-A-S',3:10,10:'SKU-A',12:20});
  Object.assign(rows[5],{1:'SKU-A-S',3:11});
  let products=parseProducts(rows);assert.equal(products.length,2);assert.equal(products[0].priceUSD,10);assert.equal(products[1].priceUSD,11);assert.equal(products[1].fcPriceUSD,20);
  Object.assign(rows[6],{10:'SKU-A',12:21});products=parseProducts(rows);assert.equal(products.length,4);assert.equal(products[0].fcPriceUSD,null);assert.ok(products[0].matchWarning);
});
