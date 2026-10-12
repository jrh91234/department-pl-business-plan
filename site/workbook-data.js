'use strict';
(() => {
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const DEFINITIONS = [
    ['revenue','รายได้รวม','Revenue','income',/^REVENUES$/i],
    ['rm','วัตถุดิบใช้ไป','Raw materials','expense',/^Raw material consumed$/i],
    ['labor','ค่าแรงทางตรง','Direct labour','expense',/^Direct labour$/i],
    ['ot','ค่าล่วงเวลาทางตรง','Overtime','expense',/^Overtime direct$/i],
    ['sc','ค่าแรงจ้างเหมาภายนอก','Subcontract labour','expense',/^Direct labour\s*-/i],
    ['scot','OT จ้างเหมาภายนอก','Subcontract overtime','expense',/^Overtime direct\s*-/i],
    ['ohvc','ค่าใช้จ่ายการผลิตผันแปร','Variable overhead','expense',/^OH VC$/i],
    ['selling','ค่าใช้จ่ายในการขาย','Selling expenses','expense',/^Selling expenses$/i],
    ['vc','ต้นทุนผันแปรรวม','Variable cost','subtotal',/^VC total$/i],
    ['cm','กำไรส่วนเกิน','Contribution margin','profit',/^CM$/i],
    ['ohfc','ค่าใช้จ่ายการผลิตคงที่','Fixed overhead','expense',/^OH FC$/i],
    ['admin','ค่าใช้จ่ายบริหารคงที่','Admin fixed cost','expense',/^Admin FC$/i],
    ['center3','ค่าใช้จ่ายส่วนกลาง (แบ่ง 3)','Shared expenses / 3','expense',/^Center Expenses_แบ่ง 3$/i],
    ['center7','ค่าใช้จ่ายส่วนกลาง (แบ่ง 7)','Shared expenses / 7','expense',/^Center Expenses_แบ่ง 7$/i],
    ['impairment','ด้อยค่าของสินทรัพย์','Impairment','expense',/^Loss on impairment of assets$/i],
    ['fc','ต้นทุนคงที่รวม','Fixed cost','subtotal',/^FC total$/i],
    ['profit','กำไรจากการดำเนินงาน','Operating profit','profit',/^Profit$/i],
    ['other','รายได้อื่น','Other income','income',/^Other income$/i],
    ['extra','ค่าใช้จ่ายพิเศษ','Extra expenses','expense',/^Extra$/i],
    ['interest','ดอกเบี้ยจ่าย','Interest','expense',/^Interest$/i],
    ['tax','ภาษีเงินได้','Tax','expense',/^Tax$/i],
    ['net','กำไรสุทธิ','Net profit','final',/^Net Profit$/i],
  ];
  const text = value => typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
  const number = value => typeof value === 'number' && Number.isFinite(value) ? value : null;
  function columnName(index) {
    let result = '';
    for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) result = String.fromCharCode(65 + (n - 1) % 26) + result;
    return result;
  }
  function decodeGrid(sheet) {
    const rows = [], errors = [];
    const codes = { REF:'#REF!', DIVIDE_BY_ZERO:'#DIV/0!', VALUE:'#VALUE!', N_A:'#N/A', NAME:'#NAME?', NUM:'#NUM!', ERROR:'#ERROR!', NULL_VALUE:'#NULL!' };
    for (const block of sheet.data || []) {
      (block.rowData || []).forEach((row, i) => {
        const rowIndex = (block.startRow || 0) + i;
        rows[rowIndex] ||= [];
        (row.values || []).forEach((cell, j) => {
          const colIndex = (block.startColumn || 0) + j;
          const value = cell.effectiveValue;
          rows[rowIndex][colIndex] = value?.numberValue ?? value?.stringValue ?? value?.boolValue ?? null;
          if (value?.errorValue) {
            const error = codes[value.errorValue.type] || '#ERROR!';
            rows[rowIndex][colIndex] = error;
            errors.push({sheet:sheet.properties.title, cell:columnName(colIndex) + (rowIndex + 1), error, message:value.errorValue.message || ''});
          }
        });
      });
    }
    return { rows, errors };
  }
  function parseScope(rows, id, sheet, label) {
    const headerIndex = rows.findIndex((row, i) => row && MONTHS.every(month => row.some((v, c) => text(v) === month && text(rows[i+1]?.[c]) === 'BP')));
    if (headerIndex < 0) throw new Error(`${sheet}: ไม่พบหัวตาราง BP ครบ 12 เดือน`);
    const headers = rows[headerIndex], kinds = rows[headerIndex + 1];
    const yearLabel = headers.map(text).find(v => /^Y\s*20\d{2}$/i.test(v));
    if (!yearLabel) throw new Error(`${sheet}: ไม่พบปีของตาราง P&L เช่น Y2022`);
    const year = Number(yearLabel.match(/20\d{2}/)[0]);
    const rowByKey = Object.fromEntries(DEFINITIONS.map(([key, , , , pattern]) => [key, rows.findIndex((r, i) => i > headerIndex + 1 && r?.slice(0,4).some(v => pattern.test(text(v)))) + 1]));
    for (const key of ['revenue','vc','cm','fc','profit','net']) if (!rowByKey[key]) throw new Error(`${sheet}: ไม่พบรายการ ${key} ในตาราง P&L`);
    const periods = MONTHS.map(month => {
      const bpIndex = headers.findIndex((v, i) => text(v) === month && text(kinds[i]) === 'BP');
      const offset = kinds.slice(bpIndex+1,bpIndex+4).findIndex(v => /^(Actual|Forecast)$/i.test(text(v)));
      if (offset < 0) throw new Error(`${sheet}: ไม่พบ Actual/Forecast ของ ${month}`);
      const resultIndex = bpIndex + offset + 1;
      const values = index => Object.fromEntries(DEFINITIONS.map(([key]) => [key, rowByKey[key] ? number(rows[rowByKey[key]-1]?.[index]) : null]));
      return {month,bpCol:columnName(bpIndex),resultCol:columnName(resultIndex),kind:/^Actual$/i.test(text(kinds[resultIndex]))?'Actual':'Forecast',bp:values(bpIndex),result:values(resultIndex),unitsBP:number(rows[headerIndex-2]?.[bpIndex]),unitsResult:number(rows[headerIndex-2]?.[resultIndex])};
    });
    return {id,label,sheet,year,rowByKey,periods};
  }
  function parseProducts(rows) {
    const keyOf = model => text(model).replace(/-S$/i,'').toUpperCase();
    const products = [], forecasts = new Map();
    rows.slice(4).forEach((row, i) => {
      const model = text(row[1]);
      if (!model) return;
      products.push({model,description:text(row[2]),priceUSD:number(row[3]),rmUSD:number(row[4]),bpTHB:number(row[5]),bpRmTHB:number(row[6]),bpRmRate:number(row[7]),forecastModel:'',fcPriceUSD:null,fcRmUSD:null,fcTHB:null,rmRate:null,sourceRow:i+5});
    });
    rows.slice(4).forEach((row, i) => {
      const model = text(row[10]);
      if (!model) return;
      const key = keyOf(model);
      const forecast = {forecastModel:model,description:text(row[11]),fcPriceUSD:number(row[12]),fcRmUSD:number(row[13]),fcTHB:number(row[14]),rmRate:number(row[16]),forecastSourceRow:i+5};
      if (!forecasts.has(key)) forecasts.set(key,[]);
      forecasts.get(key).push(forecast);
    });
    const matched = new Set();
    products.forEach(product => {
      const key = keyOf(product.model), candidates = forecasts.get(key) || [];
      if (candidates.length === 1) {
        const forecast = candidates[0];
        Object.assign(product,{...forecast,description:forecast.description||product.description});
        matched.add(key);
      } else if (candidates.length > 1) product.matchWarning = 'รหัส FC ซ้ำ จึงยังไม่จับคู่ราคา';
    });
    for (const [key,candidates] of forecasts) if (!matched.has(key)) candidates.forEach(forecast => products.push({model:forecast.forecastModel,priceUSD:null,rmUSD:null,bpTHB:null,bpRmTHB:null,bpRmRate:null,sourceRow:null,...forecast}));
    return products;
  }
  function nativeDataset(metadata, gridSheets) {
    const grids = Object.fromEntries(gridSheets.map(s => [s.properties.title,decodeGrid(s)]));
    const configs = [['pd','BP บริษัท A (PD)','แผนก PD'],['company','BP บริษัท A','บริษัท A (ภาพรวม)']];
    const scopes = configs.filter(([,name]) => grids[name]).map(([id,name,label]) => parseScope(grids[name].rows,id,name,label));
    if (!scopes.length) throw new Error('ไม่พบแท็บ P&L ที่เว็บรองรับ');
    if (new Set(scopes.map(s=>s.year)).size !== 1) throw new Error('ปีของตาราง P&L แต่ละหน่วยงานไม่ตรงกัน');
    const sale = grids['Sale Price']?.rows || [];
    return {
      source:metadata.properties.title,spreadsheetId:metadata.spreadsheetId,year:scopes[0].year,currency:'THB',schema:'native-workbook',loadedAt:new Date().toISOString(),
      rows:DEFINITIONS.map(([key,label,en,type],order)=>({key,label,en,type,order,row:scopes[0].rowByKey[key]})),scopes,
      products:parseProducts(sale),exchangeBP:number(sale[0]?.[6]),exchangeFC:number(sale[0]?.[14]),
      errors:Object.values(grids).flatMap(g=>g.errors),
      sources:metadata.sheets.map(({properties:p})=>({name:p.title,sheetId:p.sheetId,dimension:`A1:${columnName(p.gridProperties.columnCount-1)}${p.gridProperties.rowCount}`,hidden:!!p.hidden,errors:grids[p.title]?.errors.length??null,scope:grids[p.title]?'ตรวจเฉพาะช่วงที่เว็บอ่าน':'ยังไม่ได้ตรวจสูตร',checkedRange:grids[p.title]?`A1:${columnName(Math.min(p.gridProperties.columnCount,p.title==='Sale Price'?17:74)-1)}${p.gridProperties.rowCount}`:null})),
    };
  }
  const api = {MONTHS,DEFINITIONS,columnName,decodeGrid,parseScope,parseProducts,nativeDataset};
  if (typeof window !== 'undefined') window.PL_WORKBOOK = api;
  if (typeof module !== 'undefined') module.exports = api;
})();
