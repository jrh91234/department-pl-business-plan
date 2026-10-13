'use strict';
(() => {
  const config = window.PL_CONFIG || {};
  const gate = document.querySelector('#connect-gate');
  const message = document.querySelector('#connect-message');
  const messageText = document.querySelector('#connect-message-text');
  const connectProgress = document.querySelector('#connect-progress');
  const connectProgressBar = document.querySelector('#connect-progress-bar');
  const connectProgressValue = document.querySelector('#connect-progress-value');
  const signIn = document.querySelector('#google-signin');
  const rememberedFileKey = 'pl-google-selected-file-v1';
  const rememberedJobOrderFileKey = 'pl-google-job-order-file-v1';
  let accessToken = null;
  let tokenClient = null;
  let dbMetadata = null;
  let needsAccountPicker = false;
  const planHeaders = ['record_id','scope_id','plan_name','saved_at','volume_pct','price_pct','raw_material_pct','labor_pct','fixed_cost_pct','initiatives_json'];

  function setMessage(text, error = false, percent = null) {
    messageText.textContent = text;
    message.classList.toggle('error', error);
    const loading = Number.isFinite(percent);
    connectProgress.hidden = !loading;
    if (loading) {
      const value = Math.max(0, Math.min(100, Math.round(percent)));
      connectProgress.setAttribute('role', 'progressbar');
      connectProgress.setAttribute('aria-valuemin', '0');
      connectProgress.setAttribute('aria-valuemax', '100');
      connectProgress.setAttribute('aria-valuenow', String(value));
      connectProgressBar.style.width = `${value}%`;
      connectProgressValue.textContent = `${value}%`;
    }
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      script.async = true;
      script.defer = true;
      script.onload = resolve;
      script.onerror = () => reject(new Error('โหลดบริการ Google ไม่สำเร็จ'));
      document.head.appendChild(script);
    });
  }

  async function loadGoogleServices() {
    await Promise.all([
      loadScript('https://accounts.google.com/gsi/client'),
      loadScript('https://apis.google.com/js/api.js'),
    ]);
    await new Promise((resolve, reject) => {
      try { window.gapi.load('picker', { callback: resolve }); }
      catch (error) { reject(error); }
    });
  }

  function requestAccessToken(prompt = 'select_account') {
    return new Promise((resolve, reject) => {
      tokenClient = window.google.accounts.oauth2.initTokenClient({
        client_id: config.googleClientId,
        scope: 'https://www.googleapis.com/auth/drive.file',
        callback: response => {
          if (response.error) return reject(new Error(response.error_description || response.error));
          accessToken = response.access_token;
          resolve(accessToken);
        },
        error_callback: error => reject(new Error(error.message || 'เข้าสู่ระบบ Google ไม่สำเร็จ')),
      });
      tokenClient.requestAccessToken({ prompt });
    });
  }

  function readLocal(key) {
    try { return localStorage.getItem(key); } catch { return null; }
  }

  function writeLocal(key, value) {
    try { localStorage.setItem(key, value); } catch { /* Private browsing may block storage. */ }
  }

  function removeLocal(key) {
    try { localStorage.removeItem(key); } catch { /* Private browsing may block storage. */ }
  }

  async function authenticatedFetch(url, options = {}) {
    return fetch(url, {
      ...options,
      headers: { ...(options.headers || {}), Authorization: `Bearer ${accessToken}` },
    });
  }

  function selectGoogleSheet(fileId, title) {
    return new Promise((resolve, reject) => {
      const view = new window.google.picker.DocsView(window.google.picker.ViewId.SPREADSHEETS)
        .setFileIds(fileId)
        .setMimeTypes('application/vnd.google-apps.spreadsheet')
        .setIncludeFolders(false)
        .setSelectFolderEnabled(false)
        .setMode(window.google.picker.DocsViewMode.LIST);
      const picker = new window.google.picker.PickerBuilder()
        .addView(view)
        .setMaxItems(1)
        .setLocale('th')
        .setDeveloperKey(config.googleApiKey)
        .setAppId(config.googleProjectNumber)
        .setOAuthToken(accessToken)
        .setCallback(data => {
          if (data.action === window.google.picker.Action.PICKED) {
            const selectedId = data.docs?.[0]?.id;
            if (selectedId !== fileId) return reject(new Error(`เลือกไฟล์ ${title} ไม่สำเร็จ`));
            return resolve();
          }
          if (data.action === window.google.picker.Action.CANCEL) reject(new Error(`ยกเลิกการเลือก ${title}`));
        })
        .build();
      picker.setVisible(true);
    });
  }

  async function sheetValues(range, spreadsheetId = config.spreadsheetId, valueRenderOption = 'UNFORMATTED_VALUE') {
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}?valueRenderOption=${encodeURIComponent(valueRenderOption)}`;
    const response = await authenticatedFetch(url);
    const body = await response.json();
    if (!response.ok) throw new Error(body.error?.message || `Google Sheets API ตอบกลับ ${response.status}`);
    return body.values || [];
  }

  async function spreadsheetRequest(suffix = '', options = {}, spreadsheetId = config.spreadsheetId) {
    const response = await authenticatedFetch(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}${suffix}`, {
      ...options,
      headers: { 'Content-Type': 'application/json' },
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error?.message || `Google Sheets API ตอบกลับ ${response.status}`);
    return body;
  }

  async function readMetadata() {
    const fields = 'spreadsheetId,properties(title),sheets(properties(sheetId,title,hidden,gridProperties(rowCount,columnCount)))';
    dbMetadata = await spreadsheetRequest(`?fields=${encodeURIComponent(fields)}`);
    return dbMetadata;
  }

  function quoted(name) { return "'" + name.replaceAll("'", "''") + "'"; }

  async function ensurePlanLog() {
    // Creating the history tab is triggered only by the user's Save action.
    await readMetadata();
    if (!dbMetadata.sheets.some(s => s.properties.title === 'business_plans')) {
      try {
        await spreadsheetRequest(':batchUpdate', {method:'POST',body:JSON.stringify({requests:[{addSheet:{properties:{title:'business_plans',gridProperties:{rowCount:1000,columnCount:10,frozenRowCount:1}}}}]})});
      } catch (error) {
        // Another editor may have created it while this request was running.
        await readMetadata();
        if (!dbMetadata.sheets.some(s => s.properties.title === 'business_plans')) throw error;
      }
    }
    const rows = await sheetValues("'business_plans'!A1:J1");
    if (!rows.length || rows[0].every(v => v === '' || v === null)) {
      await spreadsheetRequest(`/values/${encodeURIComponent("'business_plans'!A1:J1")}?valueInputOption=RAW`, {method:'PUT',body:JSON.stringify({values:[planHeaders]})});
    } else if (planHeaders.some((header,i) => rows[0][i] !== header)) {
      throw new Error('หัวตาราง business_plans ไม่ตรงกับรูปแบบประวัติแผน กรุณาตรวจแท็บก่อนบันทึก');
    }
  }

  async function appendPlan(scopeId, plan) {
    await ensurePlanLog();
    const range = encodeURIComponent('business_plans!A:J');
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(config.spreadsheetId)}/values/${range}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`;
    const savedAt = plan.savedAt || new Date().toISOString();
    const row = [
      `${scopeId}-${Date.now()}-${crypto.randomUUID()}`, scopeId, `Business Plan ${window.PL_DATA.year}`, savedAt,
      plan.assumptions.volume, plan.assumptions.price, plan.assumptions.raw,
      plan.assumptions.labor, plan.assumptions.fixed, JSON.stringify(plan.initiatives || []),
    ];
    const response = await authenticatedFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ values: [row] }),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error?.message || `บันทึกชีตไม่สำเร็จ (${response.status})`);
    window.PL_SAVED_BY_SCOPE[scopeId] = {
      savedAt,
      assumptions: { ...plan.assumptions },
      initiatives: [...(plan.initiatives || [])],
    };
    return body;
  }

  function valueAt(row, headers, name) {
    return row[headers[name]] ?? '';
  }

  function asNumber(value) {
    if (value === '' || value === null || value === undefined) return null;
    const number = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function columnOf(cell) {
    return String(cell).match(/^[A-Z]+/)?.[0] || '';
  }

  function toObjects(rows) {
    if (!rows.length) return [];
    const headers = Object.fromEntries(rows[0].map((key, index) => [key, index]));
    return rows.slice(1).map(row => Object.fromEntries(Object.entries(headers).map(([key, index]) => [key, row[index] ?? ''])));
  }

  function savedPlans(planRows, year) {
    const plans = toObjects(planRows).filter(plan => {
      const planYear = String(plan.plan_name).match(/\b(20\d{2})\b/)?.[1];
      return planYear ? Number(planYear) === year : year === 2022;
    }).sort((a,b) => String(a.saved_at).localeCompare(String(b.saved_at)));
    const savedByScope = {};
    for (const plan of plans) {
      let initiatives = [];
      try { initiatives = JSON.parse(plan.initiatives_json || '[]'); } catch { initiatives = []; }
      savedByScope[plan.scope_id] = {savedAt:plan.saved_at, assumptions:{volume:asNumber(plan.volume_pct)??0,price:asNumber(plan.price_pct)??0,raw:asNumber(plan.raw_material_pct)??0,labor:asNumber(plan.labor_pct)??0,fixed:asNumber(plan.fixed_cost_pct)??0}, initiatives:Array.isArray(initiatives)?initiatives:[]};
    }
    window.PL_SAVED_BY_SCOPE = savedByScope;
  }

  async function loadNativeDataset(metadata, onProgress = () => {}) {
    const ranges = metadata.sheets.filter(s => ['BP บริษัท A','BP บริษัท A (PD)','Sale Price'].includes(s.properties.title)).map(({properties:p}) => {
      const cols = Math.min(p.gridProperties.columnCount, p.title === 'Sale Price' ? 17 : 74);
      return `${quoted(p.title)}!A1:${window.PL_WORKBOOK.columnName(cols-1)}${p.gridProperties.rowCount}`;
    });
    const query = new URLSearchParams({includeGridData:'true',fields:'sheets(properties(title),data(startRow,startColumn,rowData(values(effectiveValue))))'});
    ranges.forEach(range => query.append('ranges',range));
    const planSheet = metadata.sheets.find(s => s.properties.title === 'business_plans');
    onProgress({percent:15,message:'กำลังอ่านตาราง P&L จาก Google Sheets…'});
    const [grid,planRows] = await Promise.all([
      spreadsheetRequest('?' + query.toString()),
      planSheet ? sheetValues(`'business_plans'!A1:J${planSheet.properties.gridProperties.rowCount}`) : Promise.resolve([]),
    ]);
    onProgress({percent:78,message:'อ่านชีตแล้ว กำลังจัดรูปข้อมูล…'});
    const dataset = window.PL_WORKBOOK.nativeDataset(metadata,grid.sheets || []);
    savedPlans(planRows,dataset.year);
    onProgress({percent:94,message:'เตรียมข้อมูล P&L เสร็จแล้ว…'});
    return dataset;
  }

  async function loadDataset(onProgress = () => {}) {
    onProgress({percent:2,message:'กำลังอ่านโครงสร้าง Google Sheets…'});
    const sheetMeta = await readMetadata();
    onProgress({percent:8,message:'อ่านโครงสร้าง Google Sheets แล้ว…'});
    const titles = sheetMeta.sheets.map(s => s.properties.title);
    if (titles.some(name => ['BP บริษัท A','BP บริษัท A (PD)'].includes(name))) return loadNativeDataset(sheetMeta,onProgress);
    if (!titles.includes('pnl') || !titles.includes('accounts')) throw new Error('โครงสร้างชีตไม่ตรงกับตาราง P&L ที่เว็บรองรับ');
    onProgress({percent:15,message:'กำลังอ่านตาราง P&L และราคาสินค้า…'});
    const [pnlRows, accountRows, productRows, sourceRows, errorRows, planRows, metadataRows] = await Promise.all([
      sheetValues('pnl!A1:S'), sheetValues('accounts!A1:F'), sheetValues('products!A1:H'),
      sheetValues('source_sheets!A1:E'), sheetValues('source_errors!A1:C'),
      titles.includes('business_plans') ? sheetValues('business_plans!A1:J') : Promise.resolve([]), sheetValues('metadata!A1:B'),
    ]);
    onProgress({percent:78,message:'อ่านชีตแล้ว กำลังสรุปข้อมูล…'});
    const records = toObjects(pnlRows);
    const accounts = toObjects(accountRows).map(a => ({
      key: a.account_key, row: asNumber(a.source_row), label: a.account_name_th,
      en: a.account_name_en, type: a.line_type, order: asNumber(a.account_order),
    })).sort((a, b) => a.order - b.order);
    const scopeMap = new Map();
    for (const record of records) {
      let scope = scopeMap.get(record.scope_id);
      if (!scope) {
        scope = { id: record.scope_id, label: record.scope_name, sheet: record.source_sheet, periods: Array(12) };
        scopeMap.set(record.scope_id, scope);
      }
      const monthIndex = Math.max(0, Number(record.month_index) - 1);
      let period = scope.periods[monthIndex];
      if (!period) {
        period = {
          month: record.month, bpCol: '', resultCol: '', kind: record.period_type,
          bp: {}, result: {}, unitsBP: null, unitsResult: null,
        };
        scope.periods[monthIndex] = period;
      }
      const cellColumn = columnOf(record.source_cell);
      const target = record.statement_type === 'BP' ? period.bp : period.result;
      target[record.account_key] = asNumber(record.amount_thb);
      if (record.statement_type === 'BP') {
        period.bpCol = cellColumn;
        period.unitsBP = asNumber(record.unit_count);
      } else {
        period.resultCol = cellColumn;
        period.unitsResult = asNumber(record.unit_count);
      }
      period.kind = record.period_type || period.kind;
    }
    for (const scope of scopeMap.values()) {
      scope.periods = scope.periods.map((period, index) => period || {
        month: ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][index],
        bpCol: '', resultCol: '', kind: 'Forecast', bp: {}, result: {}, unitsBP: null, unitsResult: null,
      });
    }
    const metadata = Object.fromEntries(toObjects(metadataRows).map(row => [row.key, row.value]));
    savedPlans(planRows,asNumber(metadata.fiscal_year) || 2022);
    onProgress({percent:94,message:'เตรียมข้อมูล P&L เสร็จแล้ว…'});
    return {
      source: metadata.source_file || 'Department P&L Database',
      year: asNumber(metadata.fiscal_year) || 2022,
      currency: metadata.currency || 'THB',
      exchangeBP: asNumber(metadata.exchange_rate_business_plan),
      exchangeFC: asNumber(metadata.exchange_rate_forecast),
      rows: accounts,
      scopes: [...scopeMap.values()],
      sources: toObjects(sourceRows).map(s => ({
        name: s.sheet_name, dimension: s.dimensions, hidden: s.is_hidden === true || s.is_hidden === 'TRUE',
        errors: asNumber(s.error_count) || 0, scope: s.coverage_note,
      })),
      errors: toObjects(errorRows).map(e => ({ sheet: e.sheet_name, cell: e.cell, error: e.error_value })),
      products: toObjects(productRows).map(p => ({
        model: p.model, description: p.description, priceUSD: asNumber(p.price_usd),
        rmUSD: asNumber(p.raw_material_usd), bpTHB: asNumber(p.business_plan_thb),
        fcTHB: asNumber(p.forecast_thb), rmRate: asNumber(p.raw_material_rate), sourceRow: asNumber(p.source_row),
      })),
    };
  }

  async function loadJobOrderShiftTransfers() {
    if (!config.jobOrderShiftTransfersUrl) return {transfers:[],error:''};
    try {
      const response = await fetch(config.jobOrderShiftTransfersUrl, {
        method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},
        body:JSON.stringify({action:'GET_SHIFT_TRANSFERS'}),redirect:'follow',cache:'no-store',
      });
      if (!response.ok) return {transfers:[],error:`Apps Script ตอบกลับ ${response.status}`};
      const data=await response.json();
      if (data?.result!=='success'||!Array.isArray(data.transfers)) return {transfers:[],error:'Apps Script ส่งรูปแบบรายการโอนกะไม่ถูกต้อง'};
      const transfers=data.transfers.map(row=>{
        const id=String(row.ID||'');
        const idDate=id.match(/^(\d{4}-\d{2}-\d{2})_/ )?.[1];
        const parsedDate=row.Date?new Date(row.Date):null;
        const date=idDate||(parsedDate&&!Number.isNaN(parsedDate.getTime())?`${parsedDate.getFullYear()}-${String(parsedDate.getMonth()+1).padStart(2,'0')}-${String(parsedDate.getDate()).padStart(2,'0')}`:'');
        return {date,line:String(row.Line||'').trim(),fromHour:Number.parseInt(row.FromHour,10)||0,toHour:Number.parseInt(row.ToHour,10)||0,targetShift:String(row.TargetShift||'').trim()==='Night'?'Night':'Day'};
      }).filter(row=>row.date&&row.line);
      return {transfers,error:''};
    } catch (error) { return {transfers:[],error:error.message||'อ่านรายการโอนกะไม่สำเร็จ'}; }
  }

  async function loadJobOrderDataset(onProgress = () => {}) {
    const spreadsheetId=config.jobOrderSpreadsheetId;
    if (!spreadsheetId) return {status:'not-configured',records:[],rowCount:0,firstDate:'',lastDate:'',loadedAt:new Date().toISOString()};
    onProgress({percent:2,message:'กำลังอ่านโครงสร้าง barcode record · Log…'});
    const fields='spreadsheetId,properties(title),sheets(properties(title,gridProperties(rowCount,columnCount)))';
    const metadata=await spreadsheetRequest(`?fields=${encodeURIComponent(fields)}`,{},spreadsheetId);
    const sheet=metadata.sheets?.find(item=>item.properties?.title===config.jobOrderSheetName);
    if (!sheet) throw new Error(`ไม่พบแท็บ ${config.jobOrderSheetName} ใน ${metadata.properties?.title||'ไฟล์ต้นทาง'}`);
    const rowCount=Number(sheet.properties.gridProperties?.rowCount)||0;
    onProgress({percent:6,message:`พบข้อมูล ${new Intl.NumberFormat('th-TH').format(rowCount)} แถว กำลังอ่าน Log…`});
    const chunkSize=1000,total=Math.max(1,Math.ceil(Math.max(1,rowCount)/chunkSize)),chunks=[];
    for(let index=0;index<total;index++){
      const start=index*chunkSize+1,end=Math.min((index+1)*chunkSize,Math.max(rowCount,1));
      chunks.push({range:`'${config.jobOrderSheetName.replaceAll("'","''")}'!A${start}:H${end}`});
    }
    const values=[];let completed=0;
    for(let offset=0;offset<chunks.length;offset+=4){
      const batch=chunks.slice(offset,offset+4);
      const result=await Promise.all(batch.map(async chunk=>{
        const part=await sheetValues(chunk.range,spreadsheetId,'FORMATTED_VALUE');
        completed++;
        const percent=Math.round(6+82*completed/total);
        onProgress({percent,message:`กำลังอ่าน barcode record · Log ${new Intl.NumberFormat('th-TH').format(Math.min(completed*chunkSize,rowCount))}/${new Intl.NumberFormat('th-TH').format(rowCount)} แถว…`});
        return part;
      }));
      result.forEach(part=>values.push(...part));
    }
    if (!values.length) throw new Error(`แท็บ ${config.jobOrderSheetName} ไม่มีแถวข้อมูล`);
    onProgress({percent:91,message:'กำลังใช้กฎกรองและจัดกลุ่มรายการผลิต…'});
    const parsed=window.PL_WORKBOOK.parseBarcodeLog(values);
    onProgress({percent:96,message:'กำลังอ่านรายการโอนกะ…'});
    const transferData=await loadJobOrderShiftTransfers();
    const transfers=transferData.transfers;
    const hoursInRange=(from,to)=>{const hours=[];for(let i=0,h=((from%24)+24)%24;i<24&&h!==((to%24)+24)%24;i++,h=(h+1)%24)hours.push(h);return hours;};
    const shiftByDateLineHour=new Map();
    for(const transfer of transfers)for(const hour of hoursInRange(transfer.fromHour,transfer.toHour))shiftByDateLineHour.set(`${transfer.date}_${transfer.line}_${hour}`,transfer.targetShift);
    parsed.records.forEach(record=>{record.shift=shiftByDateLineHour.get(`${record.date}_${record.line}_${Number(record.time.slice(0,2))}`)||record.shift;});
    onProgress({percent:100,message:'โหลดข้อมูลการผลิตครบแล้ว'});
    return {...parsed,sourceTitle:`${metadata.properties?.title||'barcode record'} · ${config.jobOrderSheetName}`,sourceSpreadsheetId:spreadsheetId,sourceRange:`${config.jobOrderSheetName}!A1:H${rowCount}`,shiftTransferRules:transfers.length,shiftTransferError:transferData.error};
  }

  let jobOrderPromise=null;
  async function loadJobOrder(onProgress=()=>{}) {
    if(window.PL_DATA?.jobOrder?.status==='loaded')return window.PL_DATA.jobOrder;
    if(jobOrderPromise)return jobOrderPromise;
    jobOrderPromise=(async()=>{
      if(readLocal(rememberedJobOrderFileKey)!==config.jobOrderSpreadsheetId){
        await selectGoogleSheet(config.jobOrderSpreadsheetId,'barcode record');
        writeLocal(rememberedJobOrderFileKey,config.jobOrderSpreadsheetId);
      }
      const data=await loadJobOrderDataset(onProgress);
      return data;
    })();
    try{return await jobOrderPromise;}
    catch(error){if(/401|403|permission|access/i.test(error.message||''))removeLocal(rememberedJobOrderFileKey);throw error;}
    finally{jobOrderPromise=null;}
  }

  async function connect({ reuseAuthorization = false } = {}) {
    let tokenReceived = false;
    signIn.disabled = true;
    setMessage(reuseAuthorization ? 'กำลังเชื่อมต่อ Google ด้วยสิทธิ์เดิม…' : 'กำลังเข้าสู่ระบบและอ่านข้อมูลจากชีต…');
    try {
      await requestAccessToken(reuseAuthorization ? 'none' : 'select_account');
      tokenReceived = true;
      if (readLocal(rememberedFileKey) !== config.spreadsheetId) {
        setMessage('เลือกฐานข้อมูล Department P&L Database ใน Google Drive…');
        await selectGoogleSheet(config.spreadsheetId,'Department P&L Database');
        writeLocal(rememberedFileKey, config.spreadsheetId);
      }
      if (readLocal(rememberedJobOrderFileKey) !== config.jobOrderSpreadsheetId) {
        setMessage('เลือกไฟล์ barcode record ใน Google Drive เพื่ออ่านแท็บ Log…');
        await selectGoogleSheet(config.jobOrderSpreadsheetId,'barcode record');
      }
      setMessage('กำลังอ่านข้อมูลจาก Google Sheets…',false,0);
      window.PL_DATA = await loadDataset(progress=>setMessage(progress.message,false,progress.percent));
      window.PL_DATA.jobOrder = {status:'not-loaded',records:[],rowCount:0,firstDate:'',lastDate:'',loadedAt:''};
      window.PL_DB = {
        connected: true,
        savePlan: appendPlan,
        loadJobOrder,
      };
      setMessage('กำลังเปิดหน้าสรุป…',false,98);
      document.querySelector('#connection-status').hidden = false;
      document.querySelector('#refresh-data').hidden = false;
      document.querySelector('#connection-status').innerHTML = '<i></i>Google Sheets เชื่อมต่อแล้ว';
      const app = document.createElement('script');
      app.src = 'app.js?v=20261013i';
      app.onload = () => {
        setMessage('โหลดข้อมูลพร้อมแล้ว',false,100);
        setTimeout(()=>{gate.hidden=true;document.querySelector('#main').hidden=false;},220);
      };
      app.onerror = () => { gate.hidden = false; document.querySelector('#main').hidden = true; setMessage('เปิดหน้าเว็บไม่สำเร็จ ลองโหลดหน้าใหม่', true); };
      document.body.appendChild(app);
    } catch (error) {
      const reason = error.message ? `: ${error.message}` : '';
      const canReuseFailed = reuseAuthorization && /popup|login|required|401|403|permission|access/i.test(error.message || '');
      if (canReuseFailed) {
        needsAccountPicker = true;
        if (tokenReceived && /401|403|permission|access/i.test(error.message || '')) {
          removeLocal(rememberedFileKey);
          removeLocal(rememberedJobOrderFileKey);
        }
        setMessage(`เชื่อมต่อด้วยสิทธิ์เดิมไม่สำเร็จ${reason} กดอีกครั้งเพื่อเลือกบัญชี Google และยืนยันสิทธิ์ใหม่`, true);
      } else {
        setMessage(`เชื่อมต่อ Google Sheets ไม่สำเร็จ${reason} กดปุ่มเพื่อลองอีกครั้ง`, true);
      }
      signIn.disabled = false;
    }
  }

  if (!config.googleClientId || !config.googleApiKey || !config.googleProjectNumber || !config.spreadsheetId || !config.jobOrderSpreadsheetId || !config.jobOrderSheetName) {
    setMessage('ต้องตั้งค่า OAuth Client ID, API Key และ Project Number ใน pl-settings.js ก่อนใช้งาน');
  } else {
    loadGoogleServices().then(() => {
      // Ignore the permanent opt-out written by older builds. Reconnection is
      // started by the user so the browser can open Google's authorization UI.
      removeLocal('pl-google-auto-login-disabled-v1');
      signIn.disabled = false;
      const needsDatabase=readLocal(rememberedFileKey)!==config.spreadsheetId;
      const needsProduction=readLocal(rememberedJobOrderFileKey)!==config.jobOrderSpreadsheetId;
      setMessage(needsDatabase||needsProduction
        ? `กดปุ่มเพื่อเข้าสู่ระบบและอนุญาตไฟล์${needsDatabase?' Department P&L Database':''}${needsDatabase&&needsProduction?' และ':''}${needsProduction?' barcode record':''} ครั้งแรก`
        : 'เคยเชื่อมต่อแล้ว กดปุ่มเพื่อเปิดข้อมูลด้วยสิทธิ์เดิม โดยไม่ต้องเลือกชีตซ้ำ');
    }).catch(error => setMessage(error.message, true));
  }
  signIn.addEventListener('click', () => {
    const hasRememberedFile = readLocal(rememberedFileKey) === config.spreadsheetId;
    const reuseAuthorization = hasRememberedFile && !needsAccountPicker;
    connect({ reuseAuthorization });
  });
  document.querySelector('#refresh-data').addEventListener('click', () => {
    location.reload();
  });
})();
