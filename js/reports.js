/* القوائم المالية — كل الأرقام تأتي جاهزة من دوال قاعدة البيانات، والشاشة تعرضها فقط */
(function (root) {
  'use strict';
  var TYPES = [
    ['tb', 'ميزان المراجعة'], ['is', 'قائمة الدخل'], ['bs', 'المركز المالي (الميزانية)'],
    ['cfd', 'التدفقات النقدية — الطريقة المباشرة'], ['cfi', 'التدفقات النقدية — الطريقة غير المباشرة'],
    ['eq', 'التغير في حقوق الملكية'], ['st', 'كشف حساب']
  ];
  var TITLE = {}; TYPES.forEach(function (t) { TITLE[t[0]] = t[1]; });

  function create(ctx) {
    var S = ctx.S, sb = ctx.sb, esc = ctx.esc, $ = ctx.$;
    var R = { f: null, model: null, err: '', busy: false };

    function pad(n) { return (n < 10 ? '0' : '') + n; }
    function init() {
      if (R.f) return;
      var t = ctx.today(), y = t.slice(0, 4);
      R.f = { rtype: 'tb', from: y + '-01-01', to: t, compare: false, hidezero: true, acc: '' };
    }
    function shiftYear(s) {
      var y = +s.slice(0, 4) - 1, md = s.slice(5);
      if (md === '02-29') md = '02-28';
      return y + '-' + md;
    }
    function money(n) {
      n = Number(n || 0); if (Math.abs(n) < 0.005) n = 0;
      var s = Math.abs(n).toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      return n < 0 ? '(' + s + ')' : s;
    }
    function rawNum(n) { n = Number(n || 0); return Math.abs(n) < 0.005 ? 0 : Math.round(n * 100) / 100; }

    /* ---------- بناء نماذج العرض: {cols, rows:[{cls, cells:[{v,num}]}], notes:[{t,bad}]} ---------- */
    function row(cls, cells) { return { cls: cls, cells: cells }; }
    function T(v) { return { v: v }; }
    function N(v) { return { v: v, num: true }; }

    function buildTB(data, f) {
      var rows = [], to = [0, 0, 0, 0];
      data.forEach(function (r) {
        var o = Number(r.opening_balance), d = Number(r.period_debit), c = Number(r.period_credit), cl = Number(r.closing_balance);
        to[0] += o; to[1] += d; to[2] += c; to[3] += cl;
        if (f.hidezero && !o && !d && !c && !cl) return;
        rows.push(row('', [T(r.code), T(r.name), N(o), N(d), N(c), N(cl)]));
      });
      rows.push(row('tot', [T(''), T('الإجمالي'), N(to[0]), N(to[1]), N(to[2]), N(to[3])]));
      var ok = Math.abs(to[1] - to[2]) < 0.005 && Math.abs(to[3]) < 0.005 && Math.abs(to[0]) < 0.005;
      return { cols: ['الكود', 'الحساب', 'رصيد أول المدة', 'حركة مدين', 'حركة دائن', 'رصيد آخر المدة'], nums: [2, 3, 4, 5], rows: rows,
        notes: [ok ? { t: 'الميزان متوازن: إجمالي المدين = إجمالي الدائن، ومجموع الأرصدة صفر.', ok: true } :
          { t: 'تحذير: الميزان غير متوازن (فرق الحركة ' + money(to[1] - to[2]) + ' / مجموع الأرصدة ' + money(to[3]) + '). راجع فحص السلامة.', bad: true }] };
    }
    function buildLevels(data, f, cmp) {
      var rows = [], bad = [];
      data.forEach(function (r) {
        var a = r.amount === null ? null : Number(r.amount), p = r.prev_amount === null || r.prev_amount === undefined ? null : Number(r.prev_amount);
        var cells = [T((r.code ? r.code + ' ' : '') + r.name), N(a)]; if (cmp) cells.push(N(p));
        var cls = r.kind === 'header' ? 'h' : r.kind === 'account' ? 'ind' : r.kind === 'section_total' ? 'st' : r.kind === 'check' ? 'chk' : 'tot';
        if (r.kind === 'subtotal') cls = 'sub';
        if (r.kind === 'account' && f.hidezero && !a && !p) return;
        if (r.kind === 'check' && (Math.abs(a || 0) > 0.004 || Math.abs(p || 0) > 0.004)) bad.push(r.name);
        rows.push(row(cls, cells));
      });
      var cols = ['البند', 'المبلغ']; if (cmp) cols.push('الفترة السابقة');
      return { cols: cols, nums: cmp ? [1, 2] : [1], rows: rows, notes: bad.length ? [{ t: 'تحذير: ' + bad[0] + ' — القائمة غير متوازنة.', bad: true }] : [] };
    }
    var GROUP = { net_profit: null, adjustment: 'تسويات لبنود غير نقدية', working_capital: 'التغير في رأس المال العامل', investing: 'الأنشطة الاستثمارية', financing: 'الأنشطة التمويلية' };
    function buildCF(data, f, indirect) {
      var rows = [], last = null;
      data.forEach(function (r) {
        var a = Number(r.amount), k = r.kind;
        if (indirect && k in GROUP && k !== last && GROUP[k]) rows.push(row('h', [T(GROUP[k]), N(null)]));
        if (indirect && k in GROUP) last = k;
        if (!indirect && k === 'line' && f.hidezero && !a) return;
        if (indirect && k !== 'net_profit' && k in GROUP && f.hidezero && !a) return;
        var cls = k === 'header' ? 'h' : (k === 'section_total') ? 'st' : (k === 'net_change' || k === 'closing_cash') ? 'tot' : (k === 'opening_cash') ? 'sub' : 'ind';
        rows.push(row(cls, [T((r.code ? r.code + ' ' : '') + r.label), N(k === 'header' ? null : a)]));
      });
      return { cols: ['البند', 'المبلغ'], nums: [1], rows: rows, notes: [] };
    }
    function buildEQ(data) {
      var rows = [];
      data.forEach(function (r) {
        rows.push(row(r.kind === 'total' ? 'tot' : '', [T(r.code || ''), T(r.name), N(r.opening), N(r.additions), N(r.deductions), N(r.closing)]));
      });
      return { cols: ['الكود', 'البند', 'رصيد أول المدة', 'إضافات', 'خصومات', 'رصيد آخر المدة'], nums: [2, 3, 4, 5], rows: rows, notes: [] };
    }

    /* ---------- التشغيل ---------- */
    function findAcc(txt) {
      txt = String(txt || '').trim(); if (!txt) return null;
      var cands = S.accounts.filter(function (a) { return a.is_postable; });
      var ex = cands.filter(function (a) { return (a.code + ' ' + a.name) === txt || a.code === txt || a.name === txt; });
      return ex[0] || null;
    }
    function readF(form) {
      var f = R.f, e = form.elements;
      f.rtype = e.rtype.value; f.from = e.from ? e.from.value : f.from; f.to = e.to.value;
      f.compare = !!(e.compare && e.compare.checked); f.hidezero = !!(e.hidezero && e.hidezero.checked);
      f.acc = e.acc ? e.acc.value : f.acc;
    }
    function rpc(fn, args) {
      return Promise.resolve(sb.rpc(fn, args)).then(function (r) { if (r.error) throw r.error; return r.data || []; });
    }
    function run() {
      var f = R.f, cid = S.company.id, t = f.rtype;
      R.err = ''; R.model = null;
      if (!f.to || (t !== 'bs' && !f.from)) { R.err = 'حدد التاريخ.'; view(); return Promise.resolve(); }
      if (t !== 'bs' && f.from > f.to) { R.err = 'تاريخ البداية بعد النهاية.'; view(); return Promise.resolve(); }
      var period = t === 'bs' ? 'كما في ' + f.to : 'من ' + f.from + ' إلى ' + f.to;
      var p;
      if (t === 'tb') p = rpc('fn_trial_balance', { p_company: cid, p_from: f.from, p_to: f.to }).then(function (d) { return buildTB(d, f); });
      else if (t === 'is') p = rpc('fn_income_statement', f.compare ? { p_company: cid, p_from: f.from, p_to: f.to, p_prev_from: shiftYear(f.from), p_prev_to: shiftYear(f.to) } : { p_company: cid, p_from: f.from, p_to: f.to })
        .then(function (d) { return buildLevels(d, f, f.compare); });
      else if (t === 'bs') p = rpc('fn_balance_sheet', f.compare ? { p_company: cid, p_as_of: f.to, p_prev_as_of: shiftYear(f.to) } : { p_company: cid, p_as_of: f.to })
        .then(function (d) { return buildLevels(d, f, f.compare); });
      else if (t === 'cfd' || t === 'cfi') p = Promise.all([
        rpc(t === 'cfd' ? 'fn_cash_flow_direct' : 'fn_cash_flow_indirect', { p_company: cid, p_from: f.from, p_to: f.to }),
        rpc('fn_cash_flow_check', { p_company: cid, p_from: f.from, p_to: f.to })]).then(function (r) {
        var m = buildCF(r[0], f, t === 'cfi'), dm = {}; r[1].forEach(function (x) { dm[x.metric] = x; });
        var nc = dm.net_change, ac = dm.actual_cash_change;
        if (nc && ac) {
          var ok = Math.abs(Number(nc.direct_amount) - Number(nc.indirect_amount)) < 0.005 && Math.abs(Number(nc.direct_amount) - Number(ac.direct_amount)) < 0.005;
          m.notes.push(ok ? { t: 'مطابقة: الطريقة المباشرة = غير المباشرة = التغير الفعلي في النقدية (' + money(ac.direct_amount) + ').', ok: true } :
            { t: 'تحذير: التدفقات لا تتطابق — مباشر ' + money(nc.direct_amount) + ' / غير مباشر ' + money(nc.indirect_amount) + ' / فعلي ' + money(ac.direct_amount) + '. القفل مرفوض لحد ما تتصلح.', bad: true });
        }
        return m;
      });
      else if (t === 'eq') p = rpc('fn_equity_changes', { p_company: cid, p_from: f.from, p_to: f.to }).then(buildEQ);
      else if (t === 'st') {
        var a = findAcc(f.acc); if (!a) { R.err = 'اختر الحساب من القائمة (حساب فرعي قابل للترحيل).'; view(); return Promise.resolve(); }
        period += ' — ' + a.code + ' ' + a.name;
        p = Promise.all([rpc('fn_trial_balance', { p_company: cid, p_from: f.from, p_to: f.to }),
          sb.from('v_ledger').select('entry_date,fiscal_year,entry_no,line_no,description,line_description,party_name,payee_name,project_code,debit,credit')
            .eq('account_id', a.id).gte('entry_date', f.from).lte('entry_date', f.to)
            .order('entry_date').order('fiscal_year').order('entry_no').order('line_no').range(0, 4999)]).then(function (r) {
          if (r[1].error) throw r[1].error;
          var op = 0; r[0].forEach(function (x) { if (x.account_id === a.id) op = Number(x.opening_balance); });
          var bal = op, td = 0, tc = 0, rows = [row('sub', [T(''), T(''), T('رصيد أول المدة'), T(''), T(''), N(null), N(null), N(op)])];
          var ls = r[1].data || [];
          ls.forEach(function (l) {
            var d = Number(l.debit), c = Number(l.credit); bal += d - c; td += d; tc += c;
            rows.push(row('', [T(l.entry_date), T(l.fiscal_year + '/' + l.entry_no), T([l.description, l.line_description].filter(Boolean).join(' — ')),
              T(l.party_name || l.payee_name || ''), T(l.project_code || ''), N(d || null), N(c || null), N(bal)]));
          });
          rows.push(row('tot', [T(''), T(''), T('الإجمالي / رصيد آخر المدة'), T(''), T(''), N(td), N(tc), N(bal)]));
          return { cols: ['التاريخ', 'رقم القيد', 'البيان', 'الطرف', 'مشروع', 'مدين', 'دائن', 'الرصيد'], nums: [5, 6, 7], rows: rows,
            notes: ls.length >= 5000 ? [{ t: 'تم عرض أول 5000 حركة فقط؛ ضيّق الفترة.', bad: true }] : [] };
        });
      }
      R.busy = true; view();
      return p.then(function (m) { R.busy = false; m.title = TITLE[t]; m.period = period; R.model = m; },
        function (e) { R.busy = false; R.err = ctx.translate(e); }).then(view);
    }

    /* ---------- العرض ---------- */
    function cell(c, isNum) {
      if (c.v === null || c.v === undefined || c.v === '') return '<td></td>';
      return c.num || isNum ? '<td class="num">' + money(c.v) + '</td>' : '<td>' + esc(c.v) + '</td>';
    }
    function view() {
      init();
      var f = R.f, t = f.rtype, m = R.model;
      var accs = S.accounts.filter(function (a) { return a.is_postable && a.is_active !== false; });
      var h = ctx.topbar() + '<div class="wrap wide"><h2>القوائم المالية</h2>' +
        '<datalist id="rp_acc">' + accs.map(function (a) { return '<option value="' + esc(a.code + ' ' + a.name) + '">'; }).join('') + '</datalist>' +
        '<form class="card rpform" data-form="rp"><div class="g5">' +
        '<div><label>القائمة</label><select name="rtype">' + TYPES.map(function (x) { return '<option value="' + x[0] + '"' + (x[0] === t ? ' selected' : '') + '>' + x[1] + '</option>'; }).join('') + '</select></div>' +
        (t === 'bs' ? '' : '<div><label>من تاريخ</label><input type="date" name="from" value="' + esc(f.from) + '"></div>') +
        '<div><label>' + (t === 'bs' ? 'كما في تاريخ' : 'إلى تاريخ') + '</label><input type="date" name="to" value="' + esc(f.to) + '"></div>' +
        (t === 'st' ? '<div><label>الحساب</label><input name="acc" list="rp_acc" value="' + esc(f.acc) + '" placeholder="الكود أو الاسم"></div>' : '') +
        '</div><div class="mf" style="justify-content:flex-start;align-items:center">' +
        '<button class="pri" type="submit"' + (R.busy ? ' disabled' : '') + '>' + (R.busy ? 'جارٍ التحميل…' : 'عرض') + '</button>' +
        (t === 'is' || t === 'bs' ? '<label class="chk" style="margin:0"><input type="checkbox" name="compare"' + (f.compare ? ' checked' : '') + '> مقارنة بنفس الفترة من السنة السابقة</label>' : '') +
        (t !== 'st' && t !== 'eq' ? '<label class="chk" style="margin:0"><input type="checkbox" name="hidezero"' + (f.hidezero ? ' checked' : '') + '> إخفاء الأصفار</label>' : '') +
        '<span class="sp"></span><button type="button" data-act="rp-print"' + (m ? '' : ' disabled') + '>طباعة / PDF</button>' +
        '<button type="button" data-act="rp-csv"' + (m ? '' : ' disabled') + '>تصدير Excel (CSV)</button></div></form>';
      if (R.err) h += '<div class="err">' + esc(R.err) + '</div>';
      if (m) {
        h += '<div class="card rpout"><div class="rphead"><strong>' + esc(S.company.name) + '</strong><div>' + esc(m.title) + '</div><div>' + esc(m.period) + '</div></div>';
        m.notes.forEach(function (n) { h += '<div class="' + (n.bad ? 'errs' : 'okbox') + '">' + esc(n.t) + '</div>'; });
        h += '<div class="sheetwrap"><table class="reg rp"><thead><tr>' + m.cols.map(function (c, i) { return '<th' + (m.nums.indexOf(i) >= 0 ? ' class="num"' : '') + '>' + esc(c) + '</th>'; }).join('') + '</tr></thead><tbody>';
        if (!m.rows.length) h += '<tr><td colspan="' + m.cols.length + '" class="empty">لا توجد بيانات في هذه الفترة.</td></tr>';
        m.rows.forEach(function (r) { h += '<tr class="' + r.cls + '">' + r.cells.map(function (c, i) { return cell(c, m.nums.indexOf(i) >= 0); }).join('') + '</tr>'; });
        h += '</tbody></table></div><p class="mut rpnote">الأرقام بين أقواس سالبة. القوائم تُحسب مباشرة من القيود المرحّلة؛ تقدير الزكاة والضريبة تقديري وليس إقرارًا.</p></div>';
      }
      ctx.rootEl.innerHTML = h + '</div>';
    }
    function csv() {
      var m = R.model; if (!m) return;
      var rows = [[S.company.name], [m.title], [m.period], [], m.cols];
      m.rows.forEach(function (r) { rows.push(r.cells.map(function (c, i) { return c.num || m.nums.indexOf(i) >= 0 ? (c.v === null || c.v === '' ? '' : rawNum(c.v)) : (c.v || ''); })); });
      ctx.download(m.title + '.csv', '﻿' + rows.map(function (r) { return r.map(ctx.csvCell).join(','); }).join('\r\n'));
    }
    function click(act) {
      if (act === 'rp-print') return root.print && root.print();
      if (act === 'rp-csv') return csv();
    }
    function submit(form) { readF(form); return run(); }
    function change(el) {
      if (el.name !== 'rtype') return;
      readF(el.form); R.model = null; R.err = ''; view();
    }
    return { view: view, click: click, submit: submit, change: change, init: init };
  }
  root.AccReports = { create: create };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.AccReports;
})(typeof window !== 'undefined' ? window : globalThis);
