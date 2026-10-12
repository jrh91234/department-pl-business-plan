'use strict';
(() => {
  const config = window.PL_CONFIG || {};
  const gate = document.querySelector('#connect-gate');
  const message = document.querySelector('#connect-message');
  const signIn = document.querySelector('#google-signin');
  let accessToken = null;
  let tokenClient = null;

  function setMessage(text, error = false) {
    message.textContent = text;
    message.classList.toggle('error', error);
  }

  function loadIdentityServices() {
    return new Promise((resolve, reject) => {
      if (window.google?.accounts?.oauth2) return resolve();
      const script = document.createElement('script');
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      script.defer = true;
      script.onload = resolve;
      script.onerror = () => reject(new Error('โหลด Google Identity Services ไม่สำเร็จ'));
      document.head.appendChild(script);
    });
  }

  function requestAccessToken() {
    return new Promise((resolve, reject) => {
      tokenClient = window.google.accounts.oauth2.initTokenClient({
        client_id: config.googleClientId,
        scope: 'https://www.googleapis.com/auth/spreadsheets',
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

  async function sheetValues(range) {
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(config.spreadsheetId)}/values/${encodeURIComponent(range)}`;
    const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error?.message || `Google Sheets API ตอบกลับ ${response.status}`);
    return body.values || [];
  }

  async function appendPlan(scopeId, plan) {
    const range = encodeURIComponent('business_plans!A:J');
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(config.spreadsheetId)}/values/${range}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`;
    const savedAt = plan.savedAt || new Date().toISOString();
    const row = [
      `${scopeId}-${Date.now()}-${crypto.randomUUID()}`, scopeId, 'Business Plan', savedAt,
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

  async function loadDataset() {
    const [pnlRows, accountRows, productRows, sourceRows, errorRows, planRows, metadataRows] = await Promise.all([
      sheetValues('pnl!A1:S'), sheetValues('accounts!A1:F'), sheetValues('products!A1:H'),
      sheetValues('source_sheets!A1:E'), sheetValues('source_errors!A1:C'),
      sheetValues('business_plans!A1:J'), sheetValues('metadata!A1:B'),
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
    const plans = toObjects(planRows).sort((a, b) => String(a.saved_at).localeCompare(String(b.saved_at)));
    const savedByScope = {};
    for (const plan of plans) {
      let initiatives = [];
      try { initiatives = JSON.parse(plan.initiatives_json || '[]'); } catch { initiatives = []; }
      savedByScope[plan.scope_id] = {
        savedAt: plan.saved_at,
        assumptions: {
          volume: asNumber(plan.volume_pct) ?? 0, price: asNumber(plan.price_pct) ?? 0,
          raw: asNumber(plan.raw_material_pct) ?? 0, labor: asNumber(plan.labor_pct) ?? 0,
          fixed: asNumber(plan.fixed_cost_pct) ?? 0,
        },
        initiatives: Array.isArray(initiatives) ? initiatives : [],
      };
    }
    window.PL_SAVED_BY_SCOPE = savedByScope;
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

  async function connect() {
    signIn.disabled = true;
    setMessage('กำลังเข้าสู่ระบบและอ่านข้อมูลจากชีต…');
    try {
      await requestAccessToken();
      window.PL_DATA = await loadDataset();
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

  if (!config.googleClientId || !config.spreadsheetId) {
    setMessage('ต้องตั้งค่า Google OAuth Client ID และ Spreadsheet ID ใน config.js ก่อนใช้งาน');
  } else {
    loadIdentityServices().then(() => {
      signIn.disabled = false;
      setMessage('กดปุ่มเพื่อเข้าสู่ระบบด้วย Google Account ที่มีสิทธิ์แก้ไขชีต');
    }).catch(error => setMessage(error.message, true));
  }
  signIn.addEventListener('click', connect);
  document.querySelector('#disconnect').addEventListener('click', () => location.reload());
})();
