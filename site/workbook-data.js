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
  // Line items the department fills by hand, in the order of the "BP บริษัท A" template.
  // Subtotals (VC, CM, FC, Profit, Net) are always computed so the sheet cannot drift from the web.
  const SHEET_LABELS = {
    revenue:'REVENUES', rm:'Raw material consumed', labor:'Direct labour', ot:'Overtime direct',
    sc:'Direct labour - SCAN', scot:'Overtime direct - SCAN', ohvc:'OH VC', selling:'Selling expenses',
    ohfc:'OH FC', admin:'Admin FC', center3:'Center Expenses_แบ่ง 3', center7:'Center Expenses_แบ่ง 7',
    impairment:'Loss on impairment of assets', other:'Other income', extra:'Extra', interest:'Interest', tax:'Tax',
  };
  const INPUT_KEYS = DEFINITIONS.filter(([, , , type]) => type === 'income' || type === 'expense').map(([key]) => key);
  const LABOR_KEYS = ['labor','ot','sc','scot'];
  const VC_KEYS = ['rm','labor','ot','sc','scot','ohvc','selling'];
  const FC_KEYS = ['ohfc','admin','center3','center7','impairment'];
  // The base tab "PL Input <year>" belongs to the department that owns the barcode production data.
  const BASE_NAME = 'H9', BASE_LABEL = 'แผนก H9';
  const inputSheetName = year => `PL Input ${year}`;
  const AUTO_REVENUE = 'อัตโนมัติ';
  function inputTemplate(year, {label = BASE_LABEL, auto = true} = {}) {
    const header = ['key','รายการ (ชื่อที่แสดงบนเว็บ)','ชื่อรอง / ภาษาอังกฤษ',...MONTHS.map(m => `${m} Actual`),...MONTHS.map(m => `${m} BP`)];
    const rows = DEFINITIONS.filter(([key]) => INPUT_KEYS.includes(key)).map(([key,thai,en]) => [
      key, thai, SHEET_LABELS[key] || en,
      ...MONTHS.map(() => key === 'revenue' && auto ? AUTO_REVENUE : ''),
      ...MONTHS.map(() => ''),
    ]);
    const revenueNote = auto ? 'รายได้ Actual คำนวณจากยอดผลิต × ราคา Process USD ใน Sale Price (ใส่ตัวเลขทับเพื่อใช้ค่าที่กรอกเอง)' : 'รายได้ Actual ของแผนกนี้กรอกเอง (ไม่มียอดผลิตให้คำนวณ)';
    return [
      [`P&L Input · ${label} · ปี ${year}`],
      [`กรอกเป็นบาท ค่าใช้จ่ายใส่เป็นค่าบวก · ${revenueNote} · แก้ชื่อในคอลัมน์ B และ C ได้ เว็บหาแถวจากคอลัมน์ key · ค่าแรงใส่เฉพาะยอดรวมต่อเดือน · ช่องว่างนับเป็น 0 ในยอดรวม`],
      header, ...rows,
    ];
  }
  // Every tab named "PL Input <year>" (H9) or "PL Input <year> <name>" is a department.
  function departmentSheets(titles, year) {
    const base = inputSheetName(year), out = [{id:'pd',name:'',label:BASE_LABEL,sheet:base,auto:true}], seen = new Set(['pd']);
    for (const title of titles) {
      if (!title.startsWith(base + ' ')) continue;
      const name = title.slice(base.length + 1).trim(), id = 'd:' + name.toLowerCase();
      if (!name || name.toLowerCase() === BASE_NAME.toLowerCase() || seen.has(id)) continue;
      seen.add(id);
      out.push({id,name,label:/^แผนก/.test(name) ? name : 'แผนก ' + name,sheet:title,auto:false});
    }
    return out;
  }
  function groupSum(values, keys) {
    const entered = keys.map(key => values[key]).filter(value => number(value) !== null);
    return entered.length ? entered.reduce((a, b) => a + b, 0) : null;
  }
  function computeTotals(values) {
    const out = {...values};
    out.vc = groupSum(out, VC_KEYS);
    out.fc = groupSum(out, FC_KEYS);
    out.cm = number(out.revenue) !== null && out.vc !== null ? out.revenue - out.vc : null;
    out.profit = out.cm !== null && out.fc !== null ? out.cm - out.fc : null;
    out.net = out.profit !== null ? out.profit + (out.other ?? 0) - (out.extra ?? 0) - (out.interest ?? 0) - (out.tax ?? 0) : null;
    return out;
  }
  function parseInputSheet(rows, year, today = new Date(), dept = {id:'pd',name:'',label:BASE_LABEL,sheet:inputSheetName(year),auto:true}) {
    const headerIndex = (rows || []).findIndex(row => row?.some(v => text(v) === 'Jan Actual'));
    const headers = headerIndex >= 0 ? rows[headerIndex].map(text) : [];
    const rowByKey = {}, labels = {};
    if (headerIndex >= 0) rows.forEach((row, i) => {
      const key = text(row?.[0]);
      if (i > headerIndex && INPUT_KEYS.includes(key) && !rowByKey[key]) {
        rowByKey[key] = i + 1;
        const name = text(row[1]), second = text(row[2]);
        if (name || second) labels[key] = {label:name,en:second};
      }
    });
    const closedMonths = year < today.getFullYear() ? 12 : year > today.getFullYear() ? 0 : today.getMonth() + 1;
    const periods = MONTHS.map((month, m) => {
      const resultIndex = headers.indexOf(`${month} Actual`), bpIndex = headers.indexOf(`${month} BP`);
      const values = index => Object.fromEntries(INPUT_KEYS.map(key => [key, index >= 0 && rowByKey[key] ? number(rows[rowByKey[key]-1]?.[index]) : null]));
      const result = values(resultIndex);
      // A number in the revenue cell is a manual figure. the base department otherwise fills it from production × price.
      const revenueManual = result.revenue;
      return {month,bpCol:bpIndex >= 0 ? columnName(bpIndex) : '',resultCol:resultIndex >= 0 ? columnName(resultIndex) : '',kind:m < closedMonths ? 'Actual' : 'Forecast',revenueManual,bp:computeTotals(values(bpIndex)),result:computeTotals(result),unitsBP:null,unitsResult:null};
    });
    return {id:dept.id,name:dept.name || '',label:dept.label,sheet:dept.sheet,auto:!!dept.auto,year,rowByKey,labels,periods,missing:headerIndex < 0};
  }
  function parseProducts(rows) {
    const keyOf = model => text(model).replace(/-S$/i,'').toUpperCase();
    const fcExchangeRate = number(rows[0]?.[14]);
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
      const fcPriceUSD = number(row[12]), sheetFcTHB = number(row[14]);
      const fcTHB = sheetFcTHB ?? (fcPriceUSD !== null && fcExchangeRate !== null ? fcPriceUSD * fcExchangeRate : null);
      const forecast = {forecastModel:model,description:text(row[11]),fcPriceUSD,fcRmUSD:number(row[13]),fcTHB,fcTHBSource:sheetFcTHB !== null ? 'Sale Price · FC BHT' : fcTHB !== null ? 'Sale Price · FC USD × Rate' : '',fcExchangeRate,rmRate:number(row[16]),forecastSourceRow:i+5};
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
  function parseCsvRows(input) {
    const source = String(input ?? '').replace(/^\uFEFF/, '');
    const rows = [];
    let row = [], field = '', quoted = false;
    for (let i = 0; i < source.length; i++) {
      const char = source[i];
      if (char === '"') {
        if (quoted && source[i + 1] === '"') { field += '"'; i++; }
        else quoted = !quoted;
      } else if (char === ',' && !quoted) {
        row.push(field); field = '';
      } else if ((char === '\n' || char === '\r') && !quoted) {
        row.push(field); field = '';
        if (row.some(value => text(value))) rows.push(row);
        row = [];
        if (char === '\r' && source[i + 1] === '\n') i++;
      } else field += char;
    }
    if (field || row.length) {
      row.push(field);
      if (row.some(value => text(value))) rows.push(row);
    }
    return rows;
  }
  function dateKey(value) {
    const raw = text(value).replace(/^'/,'');
    const input = raw.split(' ')[0];
    if (!input || input === '-') return '';
    const toKey = (year,month,day) => {
      year = Number(year); month = Number(month); day = Number(day);
      if (!Number.isInteger(year) || year < 1000 || !Number.isInteger(month) || month < 1 || month > 12 || !Number.isInteger(day) || day < 1 || day > 31) return '';
      const date = new Date(Date.UTC(year,month-1,day));
      return date.getUTCFullYear()===year && date.getUTCMonth()===month-1 && date.getUTCDate()===day
        ? `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}` : '';
    };
    let match = input.match(/^(\d{1,4})\/(\d{1,2})\/(\d{1,4})$/);
    if (match) {
      const first = Number(match[1]), second = Number(match[2]), third = Number(match[3]);
      if (first > 1000) return toKey(first,second,third); // YYYY/MM/DD
      if (first > 12) return toKey(third,second,first); // DD/MM/YYYY
      if (second > 12) return toKey(third,first,second); // MM/DD/YYYY
      return toKey(third,second,first); // Ambiguous dates follow the source app's Thai DD/MM rule.
    }
    match = input.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (match) return toKey(match[1],match[2],match[3]);
    match = input.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
    if (match) return toKey(match[3],match[2],match[1]); // DD-MM-YYYY
    const serial = Number(input);
    if (Number.isFinite(serial) && serial > 10000) {
      const date = new Date(Date.UTC(1899,11,30) + Math.trunc(serial) * 86400000);
      return toKey(date.getUTCFullYear(),date.getUTCMonth()+1,date.getUTCDate());
    }
    const fallback = new Date(raw);
    return Number.isNaN(fallback.getTime()) ? '' : toKey(fallback.getUTCFullYear(),fallback.getUTCMonth()+1,fallback.getUTCDate());
  }
  function timeValue(value) {
    const match = text(value).replace(/^'/,'').match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
    if (!match) return null;
    const hour = Number(match[1]), minute = Number(match[2]), second = Number(match[3]||0);
    if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
    return {label:`${String(hour).padStart(2,'0')}:${String(minute).padStart(2,'0')}`,hour,minute,second};
  }
  function parseJobOrderCsv(input) {
    const rows = parseCsvRows(input);
    if (rows.length < 2) return {status:'loaded',records:[],rowCount:0,firstDate:'',lastDate:'',loadedAt:new Date().toISOString()};
    const headers = rows[0].map(text);
    const findColumn = (exact, partial=[]) => {
      const normalized = headers.map(value=>value.toLowerCase());
      const exactIndex = normalized.findIndex(value=>exact.some(alias=>value===alias.toLowerCase()));
      if (exactIndex >= 0) return exactIndex;
      return normalized.findIndex(value=>partial.some(alias=>value.includes(alias.toLowerCase())));
    };
    const cols = {
      date:findColumn(['Date'],['date','วันที่']),
      time:findColumn(['Time (เวลา)','Time'],['time','เวลา']),
      job:findColumn(['Job order No. หมายเลขกำกับงาน','Job order No.','Job order','Job No'],['job order','job no','หมายเลขกำกับงาน']),
      model:findColumn(['Model'],['model']),
      qty:findColumn(['FG Qty (จำนวน)','FG Qty','fgqty'],['fg qty','fgqty','จำนวน']),
      line:findColumn(['Line'],['line']),
      shift:findColumn(['Shift','กะ'],['shift','กะ']),
      shiftAB:findColumn(['Shift A/B','ShiftA/B'],['shift a/b','shiftab','กะย่อย']),
      status:findColumn(['Status','สถานะ'],['status','สถานะ']),
      barcode:findColumn(['Barcode','บาร์โค้ด'],['barcode','บาร์โค้ด']),
    };
    for (const key of ['date','time','job','qty']) if (cols[key] < 0) {
      throw new Error(`Job-order Tracking: ไม่พบคอลัมน์ ${key} ใน CSV`);
    }
    const seen = new Set(), scans = [];
    // Keep the same production-row filters as Job-order Tracking's buildHourlyBreakdownMap.
    for (const values of rows.slice(1)) {
      const get = key => text(values[cols[key]]);
      const raw = key => String(values[cols[key]] ?? '').trim();
      const jobNo = raw('job'), model = cols.model < 0 ? '' : get('model'), dateRaw = raw('date'), timeRaw = raw('time'), date = dateKey(dateRaw);
      const qty = parseInt(get('qty').replace(/,/g,''),10) || 0;
      const time = timeValue(timeRaw);
      if (!jobNo || !date || !time || qty <= 0) continue;
      const line = cols.line < 0 ? 'Line 1' : (raw('line') || 'Line 1');
      const shift = cols.shift < 0 ? 'Day' : (get('shift') || 'Day');
      const shiftAB = cols.shiftAB < 0 ? '-' : (get('shiftAB') || '-');
      const barcode = cols.barcode < 0 ? '' : raw('barcode');
      const status = cols.status < 0 ? '' : raw('status').toUpperCase();
      if (status === 'VOID') continue;
      const key = barcode ? `${barcode}_${dateRaw}_${timeRaw}` : `${jobNo}_${dateRaw}_${timeRaw}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const [year,month,day] = date.split('-').map(Number);
      const ts = Date.UTC(year,month-1,day,time.hour,time.minute,time.second);
      scans.push({date,time:time.label,jobNo,model:model||'ไม่ระบุรุ่น',qty,line,shift,shiftAB,barcode,ts});
    }
    scans.sort((a,b)=>a.ts-b.ts);
    const lastScanByLineAndBarcode = new Map(), records = [];
    for (const scan of scans) {
      if (scan.barcode && scan.barcode !== '-') {
        const key = `${scan.line}|${scan.barcode}`;
        const previous = lastScanByLineAndBarcode.get(key);
        if (previous && scan.ts === previous.ts) continue;
        lastScanByLineAndBarcode.set(key,scan);
      }
      records.push(scan);
    }
    const dates = records.map(record=>record.date).sort();
    return {status:'loaded',records,rowCount:rows.length-1,firstDate:dates[0]||'',lastDate:dates[dates.length-1]||'',loadedAt:new Date().toISOString()};
  }
  function parseBarcodeLog(rows) {
    if (!Array.isArray(rows) || !rows.length) throw new Error('barcode record: ไม่พบข้อมูลในแท็บ Log');
    const headers = rows[0].map(value=>String(value??'').trim().toLowerCase());
    const findColumn = (...names) => headers.findIndex(header=>names.some(name=>header===name.toLowerCase()));
    const cols = {
      dateTime:findColumn('date/time'), job:findColumn('job order'), model:findColumn('model'),
      barcode:findColumn('barcode'), status:findColumn('status'), line:findColumn('line'),
      group:findColumn('scangroupid'),
    };
    if (cols.dateTime < 0) throw new Error('barcode record · Log: ไม่พบคอลัมน์ Date/Time');
    const parseDate = value => {
      const raw = String(value??'').trim();
      const match = raw.match(/^(\d{1,4})[/-](\d{1,2})[/-](\d{1,4})$/);
      let year,month,day;
      if (match) {
        const a=Number(match[1]),b=Number(match[2]),c=Number(match[3]);
        if (a>1000) { year=a;month=b;day=c; }
        else { day=a;month=b;year=c; }
      } else {
        const iso=raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
        if (!iso) return '';
        year=Number(iso[1]);month=Number(iso[2]);day=Number(iso[3]);
      }
      if (year>=2400) year-=543;
      const date=new Date(Date.UTC(year,month-1,day));
      if (!Number.isInteger(year)||!Number.isInteger(month)||!Number.isInteger(day)||date.getUTCFullYear()!==year||date.getUTCMonth()!==month-1||date.getUTCDate()!==day) return '';
      return `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
    };
    const groupRows=new Map(), legacySeen=new Set(), scans=[];
    let rawRows=0,voidRows=0,ignoredRows=0;
    for (const row of rows.slice(1)) {
      const rawDateTime=String(row[cols.dateTime]||'').trim();
      if (!rawDateTime) continue;
      rawRows++;
      let datePart='',timePart='';
      const dateTime=rawDateTime.match(/^(.+?)\s+(\d{1,2}:\d{2}(?::\d{2})?)(?:\s.*)?$/);
      if (dateTime) { datePart=dateTime[1];timePart=dateTime[2]; }
      else if (typeof row[cols.dateTime]==='number'&&Number.isFinite(row[cols.dateTime])) {
        const serial=row[cols.dateTime],whole=Math.floor(serial),seconds=Math.round((serial-whole)*86400);
        const calendar=new Date(Date.UTC(1899,11,30)+whole*86400000);
        const hour=Math.floor(seconds/3600),minute=Math.floor(seconds%3600/60),second=seconds%60;
        datePart=`${calendar.getUTCDate()}/${calendar.getUTCMonth()+1}/${calendar.getUTCFullYear()}`;
        timePart=`${hour}:${minute}:${second}`;
      } else { ignoredRows++;continue; }
      const date=parseDate(datePart),time=timeValue(timePart);
      if (!date||!time) { ignoredRows++;continue; }
      const [year,month,day]=date.split('-').map(Number);
      const ts=Date.UTC(year,month-1,day,time.hour,time.minute,time.second);
      const prodDate=new Date(ts);
      const shift=time.hour<8?'Night':time.hour>=20?'Night':'Day';
      if (time.hour<8) prodDate.setUTCDate(prodDate.getUTCDate()-1);
      const productionDate=`${prodDate.getUTCFullYear()}-${String(prodDate.getUTCMonth()+1).padStart(2,'0')}-${String(prodDate.getUTCDate()).padStart(2,'0')}`;
      const barcode=String(row[cols.barcode]||'-').trim();
      const status=String(row[cols.status]||'OK').trim();
      const model=String(row[cols.model]||'-').trim();
      if (status.toUpperCase()==='CHANGEOVER') { ignoredRows++;continue; }
      const scan={
        date:productionDate,time:time.label,ts,jobNo:String(row[cols.job]||'MANUAL_MODE').trim(),
        model,barcode,status,line:String(row[cols.line]||'-').trim(),shift,hour:time.hour,
        rawDateTime,
      };
      const groupId=cols.group<0?'':String(row[cols.group]||'').trim();
      if (groupId) {
        if (!groupRows.has(groupId)) groupRows.set(groupId,[]);
        groupRows.get(groupId).push(scan);
      } else {
        const key=`${barcode}_${rawDateTime}`;
        if (legacySeen.has(key)) { ignoredRows++;continue; }
        legacySeen.add(key);
        scan.qty=model.trim().toUpperCase()==='R9HME106'?5:1;
        scans.push(scan);
      }
    }
    for (const group of groupRows.values()) {
      const representative=group[0];
      representative.qty=group.length;
      scans.push(representative);
    }
    const records=scans.filter(scan=>{
      if (scan.status.toUpperCase()==='VOID') { voidRows++;return false; }
      if (scan.status.toUpperCase()!=='OK') { ignoredRows++;return false; }
      return true;
    }).map(({rawDateTime,...record})=>record).sort((a,b)=>a.ts-b.ts);
    const dates=records.map(record=>record.date).sort();
    return {status:'loaded',records,rowCount:rawRows,voidRows,ignoredRows,firstDate:dates[0]||'',lastDate:dates.at(-1)||'',loadedAt:new Date().toISOString()};
  }
  function inputDataset(metadata, {year, inputRows = {}, saleRows = [], today = new Date()} = {}) {
    const titles = metadata.sheets.map(({properties:p}) => p.title), departments = departmentSheets(titles, year);
    const rowsBySheet = Array.isArray(inputRows) ? {[departments[0].sheet]:inputRows} : inputRows;
    const scopes = departments.map(dept => parseInputSheet(rowsBySheet[dept.sheet] || [], year, today, dept));
    const isError = v => typeof v === 'string' && /^#(REF!|DIV\/0!|VALUE!|N\/A|NAME\?|NUM!|ERROR!|NULL!)$/.test(v.trim());
    const errorsIn = (title, rows) => rows.flatMap((row, r) => (row || []).map((v, c) => isError(v) ? {sheet:title,cell:columnName(c)+(r+1),error:v.trim()} : null).filter(Boolean));
    const errors = [...errorsIn('Sale Price', saleRows), ...departments.flatMap(d => errorsIn(d.sheet, rowsBySheet[d.sheet] || []))];
    const read = {'Sale Price':'A1:Q', business_plans:'A1:J', ...Object.fromEntries(departments.map(d => [d.sheet,'A1:AA']))};
    return {
      source:metadata.properties.title,spreadsheetId:metadata.spreadsheetId,year,currency:'THB',schema:'pl-input',loadedAt:new Date().toISOString(),
      rows:DEFINITIONS.map(([key,label,en,type],order)=>({key,label,en,type,order,row:scopes[0].rowByKey[key]||null,input:INPUT_KEYS.includes(key),labor:LABOR_KEYS.includes(key)})),
      scopes,inputSheet:scopes[0].sheet,inputMissing:scopes[0].missing,
      products:parseProducts(saleRows),exchangeBP:number(saleRows[0]?.[6]),exchangeFC:number(saleRows[0]?.[14]),
      errors,
      sources:metadata.sheets.map(({properties:p})=>({name:p.title,sheetId:p.sheetId,dimension:`A1:${columnName(p.gridProperties.columnCount-1)}${p.gridProperties.rowCount}`,hidden:!!p.hidden,used:!!read[p.title],errors:read[p.title]?errors.filter(e=>e.sheet===p.title).length:null,checkedRange:read[p.title]||null})),
    };
  }
  const api = {MONTHS,DEFINITIONS,BASE_NAME,BASE_LABEL,INPUT_KEYS,LABOR_KEYS,AUTO_REVENUE,columnName,inputSheetName,departmentSheets,inputTemplate,computeTotals,parseInputSheet,parseProducts,parseCsvRows,parseJobOrderCsv,parseBarcodeLog,inputDataset};
  if (typeof window !== 'undefined') window.PL_WORKBOOK = api;
  if (typeof module !== 'undefined') module.exports = api;
})();
