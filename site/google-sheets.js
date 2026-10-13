'use strict';
(() => {
  const config = window.PL_CONFIG || {};
  const gate = document.querySelector('#connect-gate');
  const message = document.querySelector('#connect-message');
  const signIn = document.querySelector('#google-signin');
  let accessToken = null;
  let tokenClient = null;
  let dbMetadata = null;
  const planHeaders = ['record_id','scope_id','plan_name','saved_at','volume_pct','price_pct','raw_material_pct','labor_pct','fixed_cost_pct','initiatives_json'];

  function setMessage(text, error = false) {
    message.textContent = text;
    message.classList.toggle('error', error);
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

  function requestAccessToken() {
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
      tokenClient.requestAccessToken({ prompt: 'select_account' });
    });
  }

  function selectDatabaseFile() {
    return new Promise((resolve, reject) => {
      const view = new window.google.picker.DocsView(window.google.picker.ViewId.SPREADSHEETS)
        .setFileIds(config.spreadsheetId)
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
            if (selectedId !== config.spreadsheetId) return reject(new Error('เลือกฐานข้อมูลที่ตั้งค่าไว้ไม่สำเร็จ'));
            return resolve();
          }
          if (data.action === window.google.picker.Action.CANCEL) reject(new Error('ยกเลิกการเลือก Google Sheet'));
        })
        .build();
      picker.setVisible(true);
    });
  }

  async function sheetValues(range) {
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(config.spreadsheetId)}/values/${encodeURIComponent(range)}?valueRenderOption=UNFORMATTED_VALUE`;
    const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error?.message || `Google Sheets API ตอบกลับ ${response.status}`);
    return body.values || [];
  }

  async function spreadsheetRequest(suffix = '', options = {}) {
    const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(config.spreadsheetId)}${suffix}`, {
      ...options,
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
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
    const response = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
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

  async function loadNativeDataset(metadata) {
    const ranges = metadata.sheets.filter(s => ['BP บริษัท A','BP บริษัท A (PD)','Sale Price'].includes(s.properties.title)).map(({properties:p}) => {
      const cols = Math.min(p.gridProperties.columnCount, p.title === 'Sale Price' ? 17 : 74);
      return `${quoted(p.title)}!A1:${window.PL_WORKBOOK.columnName(cols-1)}${p.gridProperties.rowCount}`;
    });
    const query = new URLSearchParams({includeGridData:'true',fields:'sheets(properties(title),data(startRow,startColumn,rowData(values(effectiveValue))))'});
    ranges.forEach(range => query.append('ranges',range));
    const planSheet = metadata.sheets.find(s => s.properties.title === 'business_plans');
    const [grid,planRows] = await Promise.all([
      spreadsheetRequest('?' + query.toString()),
      planSheet ? sheetValues(`'business_plans'!A1:J${planSheet.properties.gridProperties.rowCount}`) : Promise.resolve([]),
    ]);
    const dataset = window.PL_WORKBOOK.nativeDataset(metadata,grid.sheets || []);
    savedPlans(planRows,dataset.year);
    return dataset;
  }

  async function loadDataset() {
    const sheetMeta = await readMetadata();
    const titles = sheetMeta.sheets.map(s => s.properties.title);
    if (titles.some(name => ['BP บริษัท A','BP บริษัท A (PD)'].includes(name))) return loadNativeDataset(sheetMeta);
    if (!titles.includes('pnl') || !titles.includes('accounts')) throw new Error('โครงสร้างชีตไม่ตรงกับตาราง P&L ที่เว็บรองรับ');
    const [pnlRows, accountRows, productRows, sourceRows, errorRows, planRows, metadataRows] = await Promise.all([
      sheetValues('pnl!A1:S'), sheetValues('accounts!A1:F'), sheetValues('products!A1:H'),
      sheetValues('source_sheets!A1:E'), sheetValues('source_errors!A1:C'),
      titles.includes('business_plans') ? sheetValues('business_plans!A1:J') : Promise.resolve([]), sheetValues('metadata!A1:B'),
    ]);
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

  async function loadJobOrderDataset() {
    if (!config.jobOrderCsvUrl) return {status:'not-configured',records:[],rowCount:0,firstDate:'',lastDate:'',loadedAt:new Date().toISOString()};
    const url = new URL(config.jobOrderCsvUrl);
    url.searchParams.set('_t',String(Date.now()));
    const response = await fetch(url.toString(), {cache:'no-store'});
    if (!response.ok) throw new Error(`Job-order Tracking ตอบกลับ ${response.status}`);
    return {...window.PL_WORKBOOK.parseJobOrderCsv(await response.text()),sourceUrl:config.jobOrderCsvUrl};
  }

  async function connect() {
    signIn.disabled = true;
    setMessage('กำลังเข้าสู่ระบบและอ่านข้อมูลจากชีต…');
    try {
      await requestAccessToken();
      setMessage('เลือกฐานข้อมูล Department P&L Database ใน Google Drive…');
      await selectDatabaseFile();
      setMessage('กำลังอ่านข้อมูลจากชีต…');
      window.PL_DATA = await loadDataset();
      try {
        window.PL_DATA.jobOrder = await loadJobOrderDataset();
      } catch (error) {
        window.PL_DATA.jobOrder = {status:'unavailable',records:[],rowCount:0,firstDate:'',lastDate:'',loadedAt:new Date().toISOString(),error:error.message||'โหลดข้อมูลรายวันไม่สำเร็จ'};
      }
      window.PL_DB = {
        connected: true,
        savePlan: appendPlan,
      };
      gate.hidden = true;
      document.querySelector('#main').hidden = false;
      document.querySelector('#connection-status').hidden = false;
      document.querySelector('#disconnect').hidden = false;
      document.querySelector('#connection-status').innerHTML = '<i></i>Google Sheets เชื่อมต่อแล้ว';
      const app = document.createElement('script');
      app.src = 'app.js';
      app.onerror = () => { gate.hidden = false; document.querySelector('#main').hidden = true; setMessage('เปิดหน้าเว็บไม่สำเร็จ ลองโหลดหน้าใหม่', true); };
      document.body.appendChild(app);
    } catch (error) {
      setMessage(error.message || 'เชื่อมต่อ Google Sheets ไม่สำเร็จ ตรวจ Client ID และสิทธิ์ในชีต', true);
      signIn.disabled = false;
    }
  }

  if (!config.googleClientId || !config.googleApiKey || !config.googleProjectNumber || !config.spreadsheetId) {
    setMessage('ต้องตั้งค่า OAuth Client ID, API Key และ Project Number ใน pl-settings.js ก่อนใช้งาน');
  } else {
    loadGoogleServices().then(() => {
      signIn.disabled = false;
      setMessage('เข้าสู่ระบบแล้วเลือกฐานข้อมูล Department P&L Database เพื่อให้สิทธิ์เฉพาะไฟล์นี้');
    }).catch(error => setMessage(error.message, true));
  }
  signIn.addEventListener('click', connect);
  document.querySelector('#disconnect').addEventListener('click', () => location.reload());
})();
