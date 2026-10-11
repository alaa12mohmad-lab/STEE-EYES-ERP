/* الفواتير والسندات والمرفقات
   القيد بيتولّد تلقائيًا من حسابات "ربط الأدوار" (العملاء/الموردين/الضريبة/النقدية) ويتسجل عبر post_entry فقط. */
(function (root) {
  'use strict';
  var KIND_AR = { purchase: 'مشتريات', sales: 'مبيعات', purchase_return: 'مرتجع مشتريات', sales_return: 'مرتجع مبيعات' };
  var ST_AR = { open: 'مفتوحة', partial: 'مسددة جزئيًا', paid: 'مسددة', cancelled: 'ملغاة' };
  var VCH_AR = { pay_supplier: 'سند صرف لمورد (سداد فواتير)', recv_customer: 'سند قبض من عميل (تحصيل فواتير)', pay_expense: 'سند صرف مصروف مباشر' };
  var PAGE_SZ = 50, VAT_RATE = 0.15;

  function r2(n) { return Math.round((Number(n) || 0) * 100) / 100; }
  function num(v) { var s = String(v === null || v === undefined ? '' : v).replace(/[,\s]/g, '').replace(/[٠-٩]/g, function (d) { return '٠١٢٣٤٥٦٧٨٩'.indexOf(d); }); if (s === '') return null; var n = Number(s); return isFinite(n) ? n : NaN; }
  function fmt(n) { return Number(n || 0).toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function cents(n) { return Math.round(n * 100); }

  /* ---------- بناء القيود (دوال نقية، تُختبر على قاعدة حقيقية) ---------- */
  function dimsOf(acc, row) {
    var o = {};
    if (acc.project_rule !== 'forbidden' && row.project) o.project_id = row.project;
    if (acc.cost_center_rule !== 'forbidden' && row.cc) o.cost_center_id = row.cc;
    if (acc.equipment_rule !== 'forbidden' && row.eq) o.equipment_id = row.eq;
    if (row.payee) o.payee_name = row.payee;
    return o;
  }
  function checkDims(acc, row, out, label) {
    if (acc.project_rule === 'required' && !row.project) out.push(label + ': الحساب ' + acc.code + ' يتطلب مشروعًا');
    if (acc.cost_center_rule === 'required' && !row.cc) out.push(label + ': الحساب ' + acc.code + ' يتطلب مركز تكلفة');
    if (acc.equipment_rule === 'required' && !row.eq) out.push(label + ': الحساب ' + acc.code + ' يتطلب معدة');
  }
  /* f: {kind,partyId,no,date,due,edate,desc,manara,manaraNo,vat,dist:[{acc:accountObj,amt,project,cc,eq}]} ; roles: {ap,ar,vin,vout} (ids) */
  function buildInvoice(companyId, f, roles, attIds) {
    var purchase = f.kind === 'purchase', net = 0, lines = [];
    f.dist.forEach(function (d) { net = r2(net + d.amt); });
    var vat = r2(f.vat || 0), total = r2(net + vat);
    var inv = { kind: f.kind, party_id: f.partyId, invoice_no: String(f.no).trim(), invoice_date: f.date, due_date: f.due || null, net: net, vat: vat, total: total };
    if (purchase) {
      f.dist.forEach(function (d) { var l = Object.assign({ account_id: d.acc.id, debit: d.amt, credit: 0 }, dimsOf(d.acc, d)); if (d.acc.party_rule !== 'forbidden') l.party_id = f.partyId; lines.push(l); });
      if (vat > 0) lines.push({ account_id: roles.vin, debit: vat, credit: 0 });
      lines.push({ account_id: roles.ap, debit: 0, credit: total, party_id: f.partyId, invoice_ref: true });
    } else {
      lines.push({ account_id: roles.ar, debit: total, credit: 0, party_id: f.partyId, invoice_ref: true });
      f.dist.forEach(function (d) { var l = Object.assign({ account_id: d.acc.id, debit: 0, credit: d.amt }, dimsOf(d.acc, d)); if (d.acc.party_rule !== 'forbidden') l.party_id = f.partyId; lines.push(l); });
      if (vat > 0) lines.push({ account_id: roles.vout, debit: 0, credit: vat });
    }
    return { company_id: companyId, entry_date: f.edate || f.date, description: f.desc, voucher_type: 'invoice', in_manara: !!f.manara,
      manara_no: f.manara ? (String(f.manaraNo || '').trim() || null) : null, attachment_ids: attIds || [], invoice: inv, lines: lines };
  }
  /* f: {type,date,partyId,cash(accountObj),amount,desc,manara,manaraNo,allocs:[{invoice_id,amount}],dist:[...]} */
  function buildVoucher(companyId, f, roles, attIds) {
    var lines = [], allocs = [], amount = r2(f.amount), voucher = f.type === 'recv_customer' ? 'receipt' : 'payment';
    if (f.type === 'pay_supplier') {
      lines.push({ account_id: roles.ap, debit: amount, credit: 0, party_id: f.partyId });
      lines.push({ account_id: f.cash.id, debit: 0, credit: amount });
      f.allocs.forEach(function (a) { allocs.push({ line_no: 1, invoice_id: a.invoice_id, amount: r2(a.amount) }); });
    } else if (f.type === 'recv_customer') {
      lines.push({ account_id: f.cash.id, debit: amount, credit: 0 });
      lines.push({ account_id: roles.ar, debit: 0, credit: amount, party_id: f.partyId });
      f.allocs.forEach(function (a) { allocs.push({ line_no: 2, invoice_id: a.invoice_id, amount: r2(a.amount) }); });
    } else {
      var sum = 0;
      f.dist.forEach(function (d) { sum = r2(sum + d.amt); lines.push(Object.assign({ account_id: d.acc.id, debit: d.amt, credit: 0 }, dimsOf(d.acc, d))); });
      lines.push({ account_id: f.cash.id, debit: 0, credit: sum });
    }
    return { company_id: companyId, entry_date: f.date, description: f.desc, voucher_type: voucher, in_manara: !!f.manara,
      manara_no: f.manara ? (String(f.manaraNo || '').trim() || null) : null, attachment_ids: attIds || [], lines: lines, allocations: allocs };
  }
  /* توزيع تلقائي: الأقدم أولًا. open: [{invoice_id, remaining, invoice_date}] */
  function autoAlloc(open, amount, voucherDate) {
    var left = cents(amount), out = {};
    open.slice().sort(function (a, b) { return a.invoice_date < b.invoice_date ? -1 : a.invoice_date > b.invoice_date ? 1 : 0; }).forEach(function (o) {
      if (left <= 0 || (voucherDate && o.invoice_date > voucherDate)) return;
      var take = Math.min(left, cents(o.remaining)); if (take > 0) { out[o.invoice_id] = take / 100; left -= take; }
    });
    return out;
  }

  function create(ctx) {
    var S = ctx.S, sb = ctx.sb, esc = ctx.esc, rootEl = ctx.rootEl;
    var D = { loaded: false, roles: {}, parties: [], projects: [], ccs: [], equip: [], msg: null, err: '', busy: false, modal: null };
    var I = null, V = null;

    /* ---------- تحميل ---------- */
    function load() {
      var id = S.company.id;
      return Promise.all([
        sb.from('account_roles').select('role_code,account_id').eq('company_id', id),
        sb.from('projects').select('id,code,name,status').eq('company_id', id).order('code'),
        sb.from('cost_centers').select('id,code,name,active').eq('company_id', id).order('code'),
        sb.from('party_companies').select('party_id,active,parties(id,name,kind,active,vat_number)').eq('company_id', id),
        sb.from('equipment').select('id,code,name,sold_date').eq('owner_company_id', id).order('code')
      ]).then(function (r) {
        for (var i = 0; i < 4; i++) if (r[i].error) throw r[i].error;
        D.roles = {}; (r[0].data || []).forEach(function (x) { D.roles[x.role_code] = x.account_id; });
        D.projects = (r[1].data || []).filter(function (p) { return p.status === 'active'; });
        D.ccs = (r[2].data || []).filter(function (c) { return c.active; });
        D.parties = (r[3].data || []).filter(function (x) { return x.active && x.parties && x.parties.active; }).map(function (x) { return x.parties; })
          .sort(function (a, b) { return a.name.localeCompare(b.name, 'ar'); });
        D.equip = r[4].error ? [] : (r[4].data || []).filter(function (e) { return !e.sold_date; });
        D.loaded = true; D.err = '';
      });
    }
    function reset() { D.loaded = false; D.msg = null; D.err = ''; D.modal = null; I = null; V = null; }

    /* ---------- أدوات ---------- */
    function acc(id) { return S.accounts.filter(function (a) { return a.id === id; })[0]; }
    function postables() { return S.accounts.filter(function (a) { return a.is_postable && a.is_active; }).sort(function (a, b) { return String(a.code).localeCompare(String(b.code), 'en', { numeric: true }); }); }
    function distAccounts(kind) {
      return postables().filter(function (a) {
        if (a.is_cash_account || a.is_control_account || a.is_advance_account || a.vat_role !== 'none') return false;
        return kind === 'sales' ? (a.account_type === 'revenue' || a.account_type === 'asset') : (a.account_type === 'expense' || a.account_type === 'asset');
      });
    }
    function findAcc(txt, list) {
      txt = String(txt || '').trim(); if (!txt) return null;
      var code = txt.split(/\s+/)[0];
      return list.filter(function (a) { return (a.code + ' ' + a.name) === txt; })[0] || list.filter(function (a) { return a.code === code; })[0] || null;
    }
    function partiesOf(kind) { var k = kind === 'sales' ? 'customer' : 'supplier'; return D.parties.filter(function (p) { return p.kind === k; }); }
    function findParty(name, kind) { name = String(name || '').trim(); return partiesOf(kind).filter(function (p) { return p.name === name; })[0] || null; }
    function canWrite() { return S.company.role === 'admin' || S.company.role === 'accountant' || S.company.role === 'entry'; }
    function canRev() { return S.company.role === 'admin' || S.company.role === 'accountant'; }
    function opt(v, t, sel) { return '<option value="' + esc(v) + '"' + (sel ? ' selected' : '') + '>' + esc(t) + '</option>'; }
    function msgBlock() {
      var h = '';
      if (D.err) h += '<div class="errs"><ul><li>' + esc(D.err) + '</li></ul></div>';
      if (D.msg) h += '<div class="okbox">' + D.msg.map(esc).join('<br>') + '</div>';
      return h;
    }
    function rolesMissing(need) {
      var names = { ap: ['ap_control', 'الموردون (رقابة)'], ar: ['ar_control', 'العملاء (رقابة)'], vin: ['vat_input', 'ضريبة المدخلات'], vout: ['vat_output', 'ضريبة المخرجات'] }, miss = [];
      need.forEach(function (n) { if (!D.roles[names[n][0]]) miss.push(names[n][1]); });
      return miss;
    }
    function roleIds() { return { ap: D.roles.ap_control, ar: D.roles.ar_control, vin: D.roles.vat_input, vout: D.roles.vat_output }; }

    /* ---------- المرفقات ---------- */
    function hex(buf) { var a = new Uint8Array(buf), s = ''; for (var i = 0; i < a.length; i++) s += ('0' + a[i].toString(16)).slice(-2); return s; }
    function uuid() { return (root.crypto && root.crypto.randomUUID) ? root.crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) { var r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); }); }
    function uploadFile(file) {
      if (file._id) return Promise.resolve(file._id);
      var cid = S.company.id;
      return Promise.resolve(file.arrayBuffer()).then(function (buf) { return root.crypto.subtle.digest('SHA-256', buf); }).then(function (h) {
        var hash = hex(h), ext = (String(file.name).split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5) || 'bin';
        var path = cid + '/' + uuid() + '.' + ext;
        return sb.storage.from('attachments').upload(path, file, { contentType: file.type || 'application/octet-stream', upsert: false }).then(function (r) {
          if (r.error) throw r.error;
          return sb.from('attachments').insert({ company_id: cid, storage_path: path, sha256: hash, mime: file.type || null, size_bytes: file.size }).select('id').single();
        });
      }).then(function (r) { if (r.error) throw r.error; file._id = r.data.id; return file._id; });
    }
    function uploadAll(files) {
      var ids = [], p = Promise.resolve();
      files.forEach(function (f) { p = p.then(function () { return uploadFile(f); }).then(function (id) { ids.push(id); }); });
      return p.then(function () { return ids; });
    }
    function addFiles(list, files) {
      var bad = [];
      Array.prototype.forEach.call(list, function (f) {
        if (f.size > 10485760) bad.push(f.name + ' (أكبر من 10MB)');
        else if (!/^(image\/|application\/pdf)/.test(f.type)) bad.push(f.name + ' (نوع غير مدعوم: PDF أو صورة فقط)');
        else files.push(f);
      });
      return bad;
    }
    function filesBlock(files, required) {
      return '<fieldset><legend>المرفقات' + (required ? ' (إجباري)' : '') + '</legend><input type="file" data-dfile multiple accept="image/*,application/pdf">' +
        '<div>' + files.map(function (f, i) { return '<span class="chip">' + esc(f.name) + ' · ' + Math.ceil(f.size / 1024) + 'KB <a href="#" data-act="dc-delfile" data-id="' + i + '">✕</a></span>'; }).join('') + '</div></fieldset>';
    }
    function showAttachments(ownerType, ownerId, title) {
      D.modal = { title: title, items: null, err: '' }; renderModal();
      return sb.from('attachments').select('id,storage_path,mime,size_bytes,uploaded_at').eq('owner_type', ownerType).eq('owner_id', ownerId).order('uploaded_at').then(function (r) {
        if (r.error) throw r.error;
        return Promise.all((r.data || []).map(function (a) {
          return sb.storage.from('attachments').createSignedUrl(a.storage_path, 600).then(function (u) { return Object.assign({ url: u.data && u.data.signedUrl }, a); });
        }));
      }).then(function (items) { D.modal.items = items; renderModal(); }, function (e) { D.modal.err = ctx.translate(e); D.modal.items = []; renderModal(); });
    }
    function renderModal() {
      var old = rootEl.querySelector('.modal'); if (old) old.remove();
      var m = D.modal; if (!m) return;
      var h = '<div class="modal"><div class="card"><h2>' + esc(m.title) + '</h2>';
      if (m.rev) {
        h += '<form data-form="dc-rev"><p class="mut">يتعمل قيد عكسي بنفس الأسطر ويتفك أي تخصيص تابع للقيد.</p><label>تاريخ العكس</label><input type="date" name="date" value="' + esc(m.rev.date) + '"><label>السبب</label><input name="reason" value="' + esc(m.rev.reason) + '">' +
          (m.err ? '<div class="errs"><ul><li>' + esc(m.err) + '</li></ul></div>' : '') + '<div class="mf"><button type="button" data-act="dc-close">إلغاء</button><button class="pri" type="submit">عكس</button></div></form>';
      } else {
        if (m.err) h += '<div class="err">' + esc(m.err) + '</div>';
        if (m.items === null) h += '<p class="mut">جارٍ التحميل…</p>';
        else if (!m.items.length) h += '<p class="empty">لا توجد مرفقات.</p>';
        else h += m.items.map(function (a, i) { return '<p><a target="_blank" rel="noopener" href="' + esc(a.url || '#') + '">مرفق ' + (i + 1) + '</a> <span class="mut">' + esc(a.mime || '') + ' · ' + Math.ceil((a.size_bytes || 0) / 1024) + 'KB · ' + esc(String(a.uploaded_at).slice(0, 10)) + '</span></p>'; }).join('');
        h += '<div class="mf"><button data-act="dc-close">إغلاق</button></div>';
      }
      rootEl.insertAdjacentHTML('beforeend', h + '</div></div>');
    }

    /* ---------- صفوف التوزيع (مشترك بين الفاتورة وسند المصروف) ---------- */
    function blankRow() { return { acc: '', amt: '', project: '', cc: '', eq: '' }; }
    function distHtml(rows, kind, which) {
      var list = distAccounts(kind);
      var h = '<datalist id="dl_dist_' + which + '">' + list.map(function (a) { return '<option value="' + esc(a.code + ' ' + a.name) + '">'; }).join('') + '</datalist>' +
        '<table class="lines"><thead><tr><th>الحساب</th><th>المبلغ (قبل الضريبة)</th><th>المشروع</th><th>مركز التكلفة</th><th>المعدة</th><th></th></tr></thead><tbody>';
      rows.forEach(function (r, i) {
        var a = findAcc(r.acc, list);
        h += '<tr data-row="' + i + '"><td class="w-acc"><input data-df="acc" list="dl_dist_' + which + '" value="' + esc(r.acc) + '" placeholder="كود أو اسم الحساب"></td>' +
          '<td><input data-df="amt" class="num" dir="ltr" inputmode="decimal" value="' + esc(r.amt) + '"></td>' +
          '<td><select data-df="project"' + dis(a, 'project_rule') + '><option value="">—</option>' + D.projects.map(function (p) { return opt(p.id, p.code + ' ' + p.name, p.id === r.project); }).join('') + '</select></td>' +
          '<td><select data-df="cc"' + dis(a, 'cost_center_rule') + '><option value="">—</option>' + D.ccs.map(function (p) { return opt(p.id, p.code + ' ' + p.name, p.id === r.cc); }).join('') + '</select></td>' +
          '<td><select data-df="eq"' + dis(a, 'equipment_rule') + '><option value="">—</option>' + D.equip.map(function (p) { return opt(p.id, p.code + ' ' + p.name, p.id === r.eq); }).join('') + '</select></td>' +
          '<td>' + (rows.length > 1 ? '<button type="button" class="sm" data-act="dc-delrow" data-id="' + i + '">−</button>' : '') + '</td></tr>';
      });
      return h + '</tbody></table><button type="button" class="sm" data-act="dc-addrow">+ بند</button>';
    }
    function dis(a, rule) { return !a || a[rule] === 'forbidden' ? ' disabled' : ''; }
    function syncRow(tr, rows, kind) {
      var i = +tr.getAttribute('data-row'), r = rows[i], a = findAcc(r.acc, distAccounts(kind));
      [['project', 'project_rule'], ['cc', 'cost_center_rule'], ['eq', 'equipment_rule']].forEach(function (p) {
        var el = tr.querySelector('[data-df=' + p[0] + ']'); if (!el) return;
        var off = !a || a[p[1]] === 'forbidden'; el.disabled = off; if (off) { el.value = ''; r[p[0]] = ''; }
      });
    }
    function readDist(rows, kind, errs, prefix) {
      var list = distAccounts(kind), out = [];
      rows.forEach(function (r, i) {
        if (!String(r.acc).trim() && !String(r.amt).trim()) return;
        var label = prefix + ' بند ' + (i + 1), a = findAcc(r.acc, list), n = num(r.amt);
        if (!a) { errs.push(label + ': اختر الحساب من القائمة'); return; }
        if (n === null || isNaN(n) || n <= 0) { errs.push(label + ': المبلغ لازم يكون أكبر من صفر'); return; }
        if (cents(n) !== Math.round(cents(n))) { errs.push(label + ': خانتين عشريتين بحد أقصى'); return; }
        checkDims(a, r, errs, label);
        out.push({ acc: a, amt: r2(n), project: r.project, cc: r.cc, eq: r.eq, payee: r.payee });
      });
      return out;
    }

    /* =================== الفواتير =================== */
    function blankI() {
      var t = ctx.today();
      return { tab: 'list', f: { kind: 'purchase', party: '', no: '', date: t, due: '', edate: '', desc: '', manara: false, manaraNo: '', vat: '', vatEdited: false, dist: [blankRow()], files: [] },
        flt: { kind: '', status: '', party: '', text: '', from: '', to: '' }, p: 0, rows: [], count: 0, entries: {} };
    }
    function loadInvoices() {
      var F = I.flt, q = sb.from('v_invoice_status').select('*', { count: 'exact' }).eq('company_id', S.company.id);
      if (F.kind) q = q.eq('kind', F.kind);
      if (F.status === 'overdue') q = q.gt('days_overdue', 0); else if (F.status) q = q.eq('status', F.status);
      if (F.party) { var p = D.parties.filter(function (x) { return x.name === F.party; })[0]; q = q.eq('party_id', p ? p.id : '00000000-0000-0000-0000-000000000000'); }
      if (F.text) q = q.ilike('invoice_no', '%' + F.text.replace(/[%_]/g, '') + '%');
      if (F.from) q = q.gte('invoice_date', F.from);
      if (F.to) q = q.lte('invoice_date', F.to);
      q = q.order('invoice_date', { ascending: false }).order('invoice_no').range(I.p * PAGE_SZ, I.p * PAGE_SZ + PAGE_SZ - 1);
      return q.then(function (r) {
        if (r.error) throw r.error;
        I.rows = r.data || []; I.count = r.count === null || r.count === undefined ? I.rows.length : r.count; I.entries = {};
        var ids = I.rows.map(function (x) { return x.entry_id; }).filter(Boolean); if (!ids.length) return;
        return sb.from('journal_entries').select('id,fiscal_year,entry_no').in('id', ids).then(function (e) { (e.data || []).forEach(function (x) { I.entries[x.id] = x.fiscal_year + '/' + x.entry_no; }); });
      });
    }
    function initInvoices() { if (!I) I = blankI(); return load().then(function () { return I.tab === 'list' ? loadInvoices() : null; }); }

    function viewInvoices() {
      if (!I) I = blankI();
      var h = ctx.topbar() + '<div class="wrap wide"><div class="bar"><h2 style="margin:0">الفواتير</h2><span class="sp"></span>' +
        '<button class="sm' + (I.tab === 'list' ? ' pri' : '') + '" data-act="dc-itab" data-id="list">السجل</button>' +
        (canWrite() ? '<button class="sm' + (I.tab === 'new' ? ' pri' : '') + '" data-act="dc-itab" data-id="new">+ فاتورة جديدة</button>' : '<span class="chip">عرض فقط</span>') + '</div>' + msgBlock();
      h += I.tab === 'new' ? invForm() : invList();
      rootEl.innerHTML = h + '</div>'; renderModal();
    }
    function invList() {
      var F = I.flt, pages = Math.max(1, Math.ceil(I.count / PAGE_SZ));
      function inp(n, label, extra) { return '<div><label>' + label + '</label><input name="' + n + '" value="' + esc(F[n]) + '"' + (extra || '') + '></div>'; }
      var h = '<datalist id="dl_ip">' + D.parties.map(function (p) { return '<option value="' + esc(p.name) + '">'; }).join('') + '</datalist>' +
        '<form class="card" data-form="dc-iflt"><div class="g5"><div><label>النوع</label><select name="kind"><option value="">الكل</option>' + Object.keys(KIND_AR).map(function (k) { return opt(k, KIND_AR[k], F.kind === k); }).join('') + '</select></div>' +
        '<div><label>الحالة</label><select name="status"><option value="">الكل</option>' + Object.keys(ST_AR).map(function (k) { return opt(k, ST_AR[k], F.status === k); }).join('') + opt('overdue', 'متأخرة عن الاستحقاق', F.status === 'overdue') + '</select></div>' +
        inp('party', 'الطرف', ' list="dl_ip"') + inp('text', 'رقم الفاتورة يحتوي') +
        '<div><label>من تاريخ</label><input type="date" name="from" value="' + esc(F.from) + '"></div><div><label>إلى تاريخ</label><input type="date" name="to" value="' + esc(F.to) + '"></div></div>' +
        '<div class="mf" style="justify-content:flex-start"><button class="pri" type="submit">بحث</button><button type="button" data-act="dc-iclear">مسح</button></div></form>';
      h += '<p class="mut">' + I.count + ' فاتورة' + (I.count > PAGE_SZ ? ' · صفحة ' + (I.p + 1) + ' من ' + pages : '') + '</p><div class="sheetwrap"><table class="reg"><thead><tr><th>التاريخ</th><th>رقم الفاتورة</th><th>النوع</th><th>الطرف</th><th>الإجمالي</th><th>المسدد</th><th>المتبقي</th><th>الاستحقاق</th><th>الحالة</th><th>القيد</th><th></th></tr></thead><tbody>';
      if (!I.rows.length) h += '<tr><td colspan="11" class="empty">لا توجد فواتير.</td></tr>';
      I.rows.forEach(function (x) {
        var ret = x.kind === 'purchase_return' || x.kind === 'sales_return', st = x.status;
        h += '<tr class="' + (st === 'cancelled' ? 'off' : '') + '"><td class="code">' + esc(x.invoice_date) + '</td><td>' + esc(x.invoice_no) + '</td><td>' + esc(KIND_AR[x.kind] || x.kind) + '</td><td>' + esc(x.party_name) + '</td>' +
          '<td class="num">' + fmt(x.total) + '</td><td class="num">' + fmt(x.allocated) + '</td><td class="num">' + fmt(x.remaining) + '</td><td class="code">' + esc(x.due_date || '') + (x.days_overdue ? ' <span class="chip w">متأخرة ' + x.days_overdue + ' يوم</span>' : '') + '</td>' +
          '<td><span class="chip' + (st === 'paid' ? ' g' : st === 'cancelled' ? ' w' : '') + '">' + esc(ST_AR[st] || st) + '</span></td><td class="code">' + esc(I.entries[x.entry_id] || '') + '</td><td style="white-space:nowrap">' +
          '<button class="sm" data-act="dc-iatt" data-id="' + esc(x.invoice_id) + '" data-t="' + esc(x.invoice_no) + '">مرفقات</button> ' +
          (canWrite() && !ret && (st === 'open' || st === 'partial') ? '<button class="sm" data-act="dc-ipay" data-id="' + esc(x.invoice_id) + '">' + (x.kind === 'purchase' ? 'سداد' : 'تحصيل') + '</button> ' : '') +
          (canRev() && st === 'open' ? '<button class="sm danger" data-act="dc-irev" data-id="' + esc(x.entry_id) + '" data-t="' + esc(x.invoice_no) + '">إلغاء</button>' : '') + '</td></tr>';
      });
      h += '</tbody></table></div>';
      if (I.count > PAGE_SZ) h += '<div class="bar" style="margin-top:.6rem"><button class="sm" data-act="dc-iprev"' + (I.p === 0 ? ' disabled' : '') + '>→ السابق</button><span class="mut">صفحة ' + (I.p + 1) + ' من ' + pages + '</span><button class="sm" data-act="dc-inext"' + (I.p + 1 >= pages ? ' disabled' : '') + '>التالي ←</button></div>';
      return h + '<p class="mut">الإلغاء بيتم بقيد عكسي، ومتاح للفاتورة اللي عليها سداد صفر فقط. فاتورة عليها سداد: فُكّ التخصيص أولًا.</p>';
    }
    function invTotals(f) {
      var net = 0; f.dist.forEach(function (d) { var n = num(d.amt); if (n && !isNaN(n) && n > 0) net = r2(net + n); });
      var vat = f.vatEdited ? (num(f.vat) || 0) : r2(net * VAT_RATE);
      return { net: net, vat: r2(vat), total: r2(net + vat) };
    }
    function invForm() {
      var f = I.f, miss = rolesMissing(f.kind === 'purchase' ? ['ap', 'vin'] : ['ar', 'vout']), t = invTotals(f), p = findParty(f.party, f.kind);
      var h = '<form class="card" data-form="dc-inv" data-docs="inv">';
      if (miss.length) h += '<div class="errs">لازم تربط الحسابات دي من شاشة "ربط الأدوار" قبل ما تسجل فاتورة: ' + esc(miss.join('، ')) + '</div>';
      h += '<datalist id="dl_pp">' + partiesOf(f.kind).map(function (x) { return '<option value="' + esc(x.name) + '">'; }).join('') + '</datalist>' +
        '<div class="g5"><div><label>نوع الفاتورة</label><select data-ff="kind">' + opt('purchase', 'مشتريات (من مورد)', f.kind === 'purchase') + opt('sales', 'مبيعات (لعميل)', f.kind === 'sales') + '</select></div>' +
        '<div><label>' + (f.kind === 'purchase' ? 'المورد' : 'العميل') + '</label><input data-ff="party" list="dl_pp" value="' + esc(f.party) + '"><div class="mut" id="pinfo" style="font-size:.78rem">' + partyInfo(p, f.kind) + '</div></div>' +
        '<div><label>رقم الفاتورة</label><input data-ff="no" dir="ltr" value="' + esc(f.no) + '"></div>' +
        '<div><label>تاريخ الفاتورة</label><input type="date" data-ff="date" value="' + esc(f.date) + '"></div>' +
        '<div><label>تاريخ الاستحقاق</label><input type="date" data-ff="due" value="' + esc(f.due) + '"></div>' +
        '<div><label>تاريخ القيد (اختياري)</label><input type="date" data-ff="edate" value="' + esc(f.edate) + '"></div></div>' +
        '<fieldset><legend>توزيع الفاتورة على الحسابات (' + (f.kind === 'purchase' ? 'مصروف / أصل' : 'إيراد') + ')</legend>' + distHtml(f.dist, f.kind, 'inv') + '</fieldset>' +
        '<div class="g5"><div><label>صافي الفاتورة</label><input id="t_net" disabled value="' + fmt(t.net) + '"></div>' +
        '<div><label>الضريبة (15% تلقائي — عدّلها لو مختلفة)</label><input data-ff="vat" class="num" dir="ltr" inputmode="decimal" value="' + esc(f.vatEdited ? f.vat : (t.vat ? t.vat.toFixed(2) : '')) + '" placeholder="0.00"></div>' +
        '<div><label>الإجمالي</label><input id="t_total" disabled value="' + fmt(t.total) + '"></div></div>' +
        '<label>البيان (اختياري — يتولّد تلقائيًا)</label><input data-ff="desc" value="' + esc(f.desc) + '">' +
        '<label class="chk"><input type="checkbox" data-ff="manara"' + (f.manara ? ' checked' : '') + '> اتسجلت في المنارة</label>' + (f.manara ? '<label>رقم القيد في المنارة</label><input data-ff="manaraNo" value="' + esc(f.manaraNo) + '">' : '') +
        filesBlock(f.files, f.kind === 'purchase');
      h += '<div class="mf"><button type="button" data-act="dc-itab" data-id="list">إلغاء</button><button class="pri" type="submit"' + (D.busy ? ' disabled' : '') + '>' + (D.busy ? 'جارٍ الحفظ…' : 'حفظ الفاتورة وإنشاء القيد') + '</button></div></form>';
      return h;
    }
    function partyInfo(p, kind) {
      if (!p) return '';
      return p.vat_number ? 'الرقم الضريبي: ' + esc(p.vat_number) : (kind === 'purchase' ? '<span style="color:var(--warn)">بدون رقم ضريبي — ما ينفعش ضريبة مدخلات</span>' : '');
    }
    function updateTotals() {
      var t = invTotals(I.f), a = rootEl.querySelector('#t_net'), b = rootEl.querySelector('#t_total'), v = rootEl.querySelector('[data-ff=vat]');
      if (a) a.value = fmt(t.net); if (b) b.value = fmt(t.total);
      if (v && !I.f.vatEdited && doc().activeElement !== v) v.value = t.vat ? t.vat.toFixed(2) : '';
    }
    function doc() { return ctx.doc || root.document; }

    function submitInvoice() {
      var f = I.f, errs = [], miss = rolesMissing(f.kind === 'purchase' ? ['ap', 'vin'] : ['ar', 'vout']);
      if (miss.length) errs.push('اربط الأدوار الناقصة أولًا: ' + miss.join('، '));
      var p = findParty(f.party, f.kind); if (!p) errs.push('اختر ' + (f.kind === 'purchase' ? 'المورد' : 'العميل') + ' من القائمة');
      if (!String(f.no).trim()) errs.push('رقم الفاتورة مطلوب');
      if (!f.date) errs.push('تاريخ الفاتورة مطلوب');
      if (f.due && f.date && f.due < f.date) errs.push('الاستحقاق قبل تاريخ الفاتورة');
      var edate = f.edate || f.date; if (f.date && edate < f.date) errs.push('تاريخ القيد قبل تاريخ الفاتورة');
      var dist = readDist(f.dist, f.kind, errs, 'الفاتورة'); if (!dist.length && !errs.length) errs.push('أضف بندًا واحدًا على الأقل');
      var t = invTotals(f), vat = t.vat; if (f.vatEdited) { var vn = num(f.vat); if (vn === null) vn = 0; if (isNaN(vn) || vn < 0) errs.push('الضريبة غير صحيحة'); else vat = r2(vn); }
      if (p && f.kind === 'purchase' && vat > 0 && !p.vat_number) errs.push('المورد بدون رقم ضريبي: لا يمكن احتساب ضريبة مدخلات');
      if (f.kind === 'purchase' && !f.files.length) errs.push('المرفق إجباري على فواتير المشتريات');
      if (f.manara && !String(f.manaraNo).trim()) errs.push('رقم المنارة مطلوب');
      if (errs.length) { D.err = errs.join(' — '); D.msg = null; return viewInvoices(); }
      D.err = ''; D.busy = true; viewInvoices();
      var ff = Object.assign({}, f, { partyId: p.id, dist: dist, vat: vat, edate: edate, desc: String(f.desc).trim() || ((f.kind === 'purchase' ? 'فاتورة مشتريات ' : 'فاتورة مبيعات ') + String(f.no).trim() + ' - ' + p.name) });
      return uploadAll(f.files).then(function (ids) {
        var payload = buildInvoice(S.company.id, ff, roleIds(), ids);
        return Promise.resolve(sb.rpc('post_entry', { p: payload }));
      }).then(function (r) {
        D.busy = false;
        if (r.error) throw r.error;
        var d = r.data, msg = ['تم حفظ الفاتورة — قيد ' + d.fiscal_year + '/' + d.entry_no];
        (d.warnings || []).forEach(function (w) { msg.push(w); });
        return ctx.linkEntry(d.entry_id).then(function (pg) {
          if (pg) msg.push('اتسجل في قيد رقم ' + pg); else msg.push('اتحفظ لكن ما اتربطش بصفحة قيود (هتلاقيه في سجل القيود).');
          D.msg = msg; I = blankI(); return loadInvoices();
        });
      }).then(viewInvoices, function (e) { D.busy = false; D.err = ctx.translate(e); viewInvoices(); });
    }

    /* =================== السندات =================== */
    function blankV(type, partyName) {
      return { tab: 'new', f: { type: type || 'pay_supplier', date: ctx.today(), party: partyName || '', cash: '', amount: '', desc: '', manara: false, manaraNo: '', dist: [blankRow()], files: [] },
        open: [], alloc: {}, rows: [], count: 0, p: 0, lines: {} };
    }
    function initVouchers() {
      return load().then(function () {
        if (!V) V = blankV();
        return V.tab === 'list' ? loadVouchers() : loadOpenInv();
      });
    }
    function vKind(t) { return t === 'recv_customer' ? 'sales' : 'purchase'; }
    function loadOpenInv() {
      var f = V.f; V.open = []; if (f.type === 'pay_expense') return Promise.resolve();
      var p = findParty(f.party, vKind(f.type)); if (!p) return Promise.resolve();
      return sb.from('v_invoice_status').select('invoice_id,invoice_no,invoice_date,due_date,total,remaining,status').eq('company_id', S.company.id).eq('party_id', p.id).eq('kind', vKind(f.type)).in('status', ['open', 'partial']).order('invoice_date').then(function (r) {
        if (r.error) throw r.error; V.open = r.data || [];
      });
    }
    function loadVouchers() {
      return sb.from('journal_entries').select('id,fiscal_year,entry_no,entry_date,description,voucher_type', { count: 'exact' }).eq('company_id', S.company.id).in('voucher_type', ['payment', 'receipt'])
        .order('entry_date', { ascending: false }).order('entry_no', { ascending: false }).range(V.p * PAGE_SZ, V.p * PAGE_SZ + PAGE_SZ - 1).then(function (r) {
          if (r.error) throw r.error; V.rows = r.data || []; V.count = r.count === null || r.count === undefined ? V.rows.length : r.count; V.lines = {};
          var ids = V.rows.map(function (x) { return x.id; }); if (!ids.length) return;
          return sb.from('v_ledger').select('entry_id,debit').in('entry_id', ids).then(function (l) { (l.data || []).forEach(function (x) { V.lines[x.entry_id] = (V.lines[x.entry_id] || 0) + Number(x.debit); }); });
        });
    }
    function viewVouchers() {
      if (!V) V = blankV();
      var h = ctx.topbar() + '<div class="wrap wide"><div class="bar"><h2 style="margin:0">السندات</h2><span class="sp"></span>' +
        '<button class="sm' + (V.tab === 'list' ? ' pri' : '') + '" data-act="dc-vtab" data-id="list">السجل</button>' +
        (canWrite() ? '<button class="sm' + (V.tab === 'new' ? ' pri' : '') + '" data-act="dc-vtab" data-id="new">+ سند جديد</button>' : '<span class="chip">عرض فقط</span>') + '</div>' + msgBlock();
      h += V.tab === 'new' ? vchForm() : vchList();
      rootEl.innerHTML = h + '</div>'; renderModal();
    }
    function vchList() {
      var pages = Math.max(1, Math.ceil(V.count / PAGE_SZ));
      var h = '<p class="mut">' + V.count + ' سند' + (V.count > PAGE_SZ ? ' · صفحة ' + (V.p + 1) + ' من ' + pages : '') + '</p><div class="sheetwrap"><table class="reg"><thead><tr><th>القيد</th><th>التاريخ</th><th>النوع</th><th>البيان</th><th>المبلغ</th><th></th></tr></thead><tbody>';
      if (!V.rows.length) h += '<tr><td colspan="6" class="empty">لا توجد سندات.</td></tr>';
      V.rows.forEach(function (e) {
        h += '<tr><td class="code">' + esc(e.fiscal_year + '/' + e.entry_no) + '</td><td class="code">' + esc(e.entry_date) + '</td><td>' + (e.voucher_type === 'receipt' ? 'قبض' : 'صرف') + '</td><td>' + esc(e.description) + '</td><td class="num">' + fmt(V.lines[e.id]) + '</td><td style="white-space:nowrap">' +
          '<button class="sm" data-act="dc-vatt" data-id="' + esc(e.id) + '" data-t="' + esc(e.fiscal_year + '/' + e.entry_no) + '">مرفقات</button> ' +
          (canRev() ? '<button class="sm danger" data-act="dc-irev" data-id="' + esc(e.id) + '" data-t="' + esc(e.fiscal_year + '/' + e.entry_no) + '">عكس</button>' : '') + '</td></tr>';
      });
      h += '</tbody></table></div>';
      if (V.count > PAGE_SZ) h += '<div class="bar" style="margin-top:.6rem"><button class="sm" data-act="dc-vprev"' + (V.p === 0 ? ' disabled' : '') + '>→ السابق</button><span class="mut">صفحة ' + (V.p + 1) + ' من ' + pages + '</span><button class="sm" data-act="dc-vnext"' + (V.p + 1 >= pages ? ' disabled' : '') + '>التالي ←</button></div>';
      return h;
    }
    function allocSum() { var s = 0; Object.keys(V.alloc).forEach(function (k) { s = r2(s + (Number(V.alloc[k]) || 0)); }); return s; }
    function vchForm() {
      var f = V.f, cashAccs = postables().filter(function (a) { return a.is_cash_account; }), isE = f.type === 'pay_expense', miss = isE ? [] : rolesMissing([f.type === 'pay_supplier' ? 'ap' : 'ar']);
      var h = '<form class="card" data-form="dc-vch" data-docs="vch">';
      if (miss.length) h += '<div class="errs">اربط الدور ده من "ربط الأدوار" الأول: ' + esc(miss.join('، ')) + '</div>';
      h += '<datalist id="dl_vp">' + (isE ? '' : partiesOf(vKind(f.type)).map(function (x) { return '<option value="' + esc(x.name) + '">'; }).join('')) + '</datalist><div class="g5">' +
        '<div><label>نوع السند</label><select data-vf="type">' + Object.keys(VCH_AR).map(function (k) { return opt(k, VCH_AR[k], f.type === k); }).join('') + '</select></div>' +
        '<div><label>التاريخ</label><input type="date" data-vf="date" value="' + esc(f.date) + '"></div>' +
        (isE ? '' : '<div><label>' + (f.type === 'pay_supplier' ? 'المورد' : 'العميل') + '</label><input data-vf="party" list="dl_vp" value="' + esc(f.party) + '"></div>') +
        (isE ? '<div><label>المستلم (اسم)</label><input data-vf="payee" value="' + esc(f.payee || '') + '"></div>' : '') + '<div><label>' + (f.type === 'recv_customer' ? 'يُودَع في (صندوق/بنك)' : 'يُصرف من (صندوق/بنك)') + '</label><select data-vf="cash"><option value="">— اختر —</option>' + cashAccs.map(function (a) { return opt(a.id, a.code + ' ' + a.name, a.id === f.cash); }).join('') + '</select></div>' +
        (isE ? '' : '<div><label>المبلغ</label><input data-vf="amount" class="num" dir="ltr" inputmode="decimal" value="' + esc(f.amount) + '"></div>') + '</div>';
      if (isE) h += '<fieldset><legend>المصروفات المدفوعة</legend>' + distHtml(f.dist, 'purchase', 'vch') + '</fieldset>';
      else h += '<fieldset id="allocbox"><legend>تخصيص على الفواتير المفتوحة</legend>' + allocHtml() + '</fieldset>';
      h += '<label>البيان (اختياري — يتولّد تلقائيًا)</label><input data-vf="desc" value="' + esc(f.desc) + '">' +
        '<label class="chk"><input type="checkbox" data-vf="manara"' + (f.manara ? ' checked' : '') + '> اتسجل في المنارة</label>' + (f.manara ? '<label>رقم القيد في المنارة</label><input data-vf="manaraNo" value="' + esc(f.manaraNo) + '">' : '') +
        filesBlock(f.files, f.type !== 'recv_customer') +
        '<div class="mf"><button type="button" data-act="dc-vtab" data-id="list">إلغاء</button><button class="pri" type="submit"' + (D.busy ? ' disabled' : '') + '>' + (D.busy ? 'جارٍ الحفظ…' : 'حفظ السند وإنشاء القيد') + '</button></div></form>';
      return h;
    }
    function allocHtml() {
      var f = V.f;
      if (!findParty(f.party, vKind(f.type))) return '<p class="mut">اختر الطرف الأول عشان تظهر فواتيره المفتوحة.</p>';
      if (!V.open.length) return '<p class="mut">لا توجد فواتير مفتوحة لهذا الطرف. المبلغ هيتسجل على حسابه (غير مخصص).</p>';
      var amt = num(f.amount) || 0, s = allocSum(), left = r2(amt - s);
      var h = '<table class="lines"><thead><tr><th>الفاتورة</th><th>التاريخ</th><th>الاستحقاق</th><th>الإجمالي</th><th>المتبقي</th><th>تخصيص</th></tr></thead><tbody>';
      V.open.forEach(function (o) {
        var late = o.invoice_date > f.date;
        h += '<tr><td>' + esc(o.invoice_no) + '</td><td class="code">' + esc(o.invoice_date) + '</td><td class="code">' + esc(o.due_date || '') + '</td><td class="num">' + fmt(o.total) + '</td><td class="num">' + fmt(o.remaining) + '</td>' +
          '<td><input data-al="' + esc(o.invoice_id) + '" class="num" dir="ltr" inputmode="decimal" value="' + (V.alloc[o.invoice_id] ? esc(V.alloc[o.invoice_id]) : '') + '"' + (late ? ' disabled title="الفاتورة بتاريخ بعد السند"' : '') + '></td></tr>';
      });
      return h + '</tbody></table><div class="bar"><button type="button" class="sm" data-act="dc-auto">توزيع تلقائي (الأقدم أولًا)</button><button type="button" class="sm" data-act="dc-clearalloc">مسح التخصيص</button>' +
        '<span id="allocsum" class="mut">' + allocSummary(amt, s, left) + '</span></div>';
    }
    function allocSummary(amt, s, left) { return 'المخصص ' + fmt(s) + ' من ' + fmt(amt) + (left > 0 ? ' — الباقي ' + fmt(left) + ' يتسجل على حساب الطرف بدون تخصيص' : left < 0 ? ' — التخصيص أكبر من المبلغ!' : ''); }
    function updateAllocSum() {
      var el = rootEl.querySelector('#allocsum'); if (!el) return;
      var amt = num(V.f.amount) || 0, s = allocSum(); el.textContent = allocSummary(amt, s, r2(amt - s));
    }

    function submitVoucher() {
      var f = V.f, errs = [], isE = f.type === 'pay_expense', p = null, dist = [];
      if (!isE) { var miss = rolesMissing([f.type === 'pay_supplier' ? 'ap' : 'ar']); if (miss.length) errs.push('اربط الدور الناقص: ' + miss.join('، ')); p = findParty(f.party, vKind(f.type)); if (!p) errs.push('اختر الطرف من القائمة'); }
      if (!f.date) errs.push('التاريخ مطلوب');
      var cash = acc(f.cash); if (!cash) errs.push('اختر حساب الصندوق/البنك');
      var amount = 0;
      if (isE) { dist = readDist(f.dist, 'purchase', errs, 'السند'); if (!dist.length && !errs.length) errs.push('أضف بندًا واحدًا على الأقل'); dist.forEach(function (d) { amount = r2(amount + d.amt); if (String(f.payee || '').trim()) d.payee = String(f.payee).trim(); }); }
      else { var n = num(f.amount); if (n === null || isNaN(n) || n <= 0) errs.push('المبلغ لازم يكون أكبر من صفر'); else amount = r2(n); }
      var allocs = [];
      if (!isE) {
        var tot = 0;
        V.open.forEach(function (o) {
          var a = num(V.alloc[o.invoice_id]); if (!a) return;
          if (isNaN(a) || a < 0) { errs.push('تخصيص غير صحيح على ' + o.invoice_no); return; }
          if (cents(a) > cents(o.remaining)) errs.push('التخصيص على ' + o.invoice_no + ' أكبر من المتبقي (' + fmt(o.remaining) + ')');
          if (o.invoice_date > f.date) errs.push('الفاتورة ' + o.invoice_no + ' بتاريخ بعد السند');
          tot += cents(a); allocs.push({ invoice_id: o.invoice_id, amount: a });
        });
        if (amount && tot > cents(amount)) errs.push('إجمالي التخصيص أكبر من مبلغ السند');
      }
      if (f.type !== 'recv_customer' && !f.files.length) errs.push('المرفق إجباري على سندات الصرف');
      if (f.manara && !String(f.manaraNo).trim()) errs.push('رقم المنارة مطلوب');
      if (errs.length) { D.err = errs.join(' — '); D.msg = null; return viewVouchers(); }
      D.err = ''; D.busy = true; viewVouchers();
      var desc = String(f.desc).trim() || (f.type === 'pay_supplier' ? 'سداد للمورد ' + p.name : f.type === 'recv_customer' ? 'تحصيل من العميل ' + p.name : 'سند صرف مصروفات');
      var ff = { type: f.type, date: f.date, partyId: p && p.id, cash: cash, amount: amount, desc: desc, manara: f.manara, manaraNo: f.manaraNo, allocs: allocs, dist: dist };
      return uploadAll(f.files).then(function (ids) { return sb.rpc('post_entry', { p: buildVoucher(S.company.id, ff, roleIds(), ids) }); }).then(function (r) {
        D.busy = false; if (r.error) throw r.error;
        var d = r.data, msg = ['تم حفظ السند — قيد ' + d.fiscal_year + '/' + d.entry_no];
        (d.warnings || []).forEach(function (w) { msg.push(w); });
        return ctx.linkEntry(d.entry_id).then(function (pg) {
          msg.push(pg ? 'اتسجل في قيد رقم ' + pg : 'اتحفظ لكن ما اتربطش بصفحة قيود (هتلاقيه في سجل القيود).');
          D.msg = msg; V = blankV(); V.tab = 'list'; return loadVouchers();
        });
      }).then(viewVouchers, function (e) { D.busy = false; D.err = ctx.translate(e); viewVouchers(); });
    }

    /* =================== أحداث =================== */
    function cur() { return S.view === 'invoices' ? I : V; }
    function rowsOf(el) { return el.closest('[data-docs=inv]') ? I.f.dist : V.f.dist; }
    function input(el) {
      if (!I && !V) return;
      var df = el.getAttribute('data-df'), ff = el.getAttribute('data-ff'), vf = el.getAttribute('data-vf'), al = el.getAttribute('data-al');
      if (df) {
        var tr = el.closest('tr'), rows = rowsOf(el), i = +tr.getAttribute('data-row'); rows[i][df] = el.value;
        if (df === 'acc') syncRow(tr, rows, S.view === 'invoices' ? I.f.kind : 'purchase');
        if (S.view === 'invoices') updateTotals(); else if (V.f.type === 'pay_expense') { /* لا شيء */ }
        return;
      }
      if (ff) {
        if (el.type === 'checkbox') { I.f[ff] = el.checked; return viewInvoices(); }
        I.f[ff] = el.value; if (ff === 'vat') { I.f.vatEdited = el.value !== ''; updateTotals(); }
        if (ff === 'party') { var pi = rootEl.querySelector('#pinfo'); if (pi) pi.innerHTML = partyInfo(findParty(el.value, I.f.kind), I.f.kind); }
        return;
      }
      if (vf) {
        if (el.type === 'checkbox') { V.f[vf] = el.checked; return viewVouchers(); }
        V.f[vf] = el.value; if (vf === 'amount') updateAllocSum();
        return;
      }
      if (al) { V.alloc[al] = el.value; updateAllocSum(); }
    }
    function change(el) {
      if (el.hasAttribute('data-dfile')) {
        var files = S.view === 'invoices' ? I.f.files : V.f.files, bad = addFiles(el.files, files);
        D.err = bad.length ? 'اتتجاهلت: ' + bad.join('، ') : ''; return S.view === 'invoices' ? viewInvoices() : viewVouchers();
      }
      var ff = el.getAttribute('data-ff'), vf = el.getAttribute('data-vf');
      if (ff === 'kind') { I.f.kind = el.value; I.f.party = ''; I.f.dist = [blankRow()]; I.f.vatEdited = false; I.f.vat = ''; I.f.files = I.f.files; return viewInvoices(); }
      if (vf === 'type') { var old = V.f; V.f.type = el.value; V.f.party = ''; V.alloc = {}; V.open = []; V.f.dist = [blankRow()]; return viewVouchers(); }
      if (vf === 'party' || vf === 'date') { V.f[vf] = el.value; V.alloc = {}; return loadOpenInv().then(viewVouchers, function (e) { D.err = ctx.translate(e); viewVouchers(); }); }
      if (el.getAttribute('data-df') === 'acc') return;
      input(el);
    }
    function click(act, id, t) {
      if (act === 'dc-close') { D.modal = null; return renderModal(); }
      if (act === 'dc-itab') { D.msg = null; D.err = ''; I.tab = id; return (id === 'list' ? loadInvoices() : Promise.resolve()).then(viewInvoices, function (e) { D.err = ctx.translate(e); viewInvoices(); }); }
      if (act === 'dc-vtab') { D.msg = null; D.err = ''; V.tab = id; return (id === 'list' ? loadVouchers() : loadOpenInv()).then(viewVouchers, function (e) { D.err = ctx.translate(e); viewVouchers(); }); }
      if (act === 'dc-iclear') { I.flt = blankI().flt; I.p = 0; return loadInvoices().then(viewInvoices); }
      if (act === 'dc-iprev' || act === 'dc-inext') { I.p += act === 'dc-inext' ? 1 : -1; return loadInvoices().then(viewInvoices); }
      if (act === 'dc-vprev' || act === 'dc-vnext') { V.p += act === 'dc-vnext' ? 1 : -1; return loadVouchers().then(viewVouchers); }
      if (act === 'dc-iatt') return showAttachments('invoice', id, 'مرفقات الفاتورة ' + t);
      if (act === 'dc-vatt') return showAttachments('entry', id, 'مرفقات القيد ' + t);
      if (act === 'dc-irev') { D.modal = { title: 'عكس / إلغاء القيد ' + t, rev: { id: id, date: ctx.today(), reason: '' }, items: [], err: '' }; return renderModal(); }
      if (act === 'dc-addrow') { var rows = S.view === 'invoices' ? I.f.dist : V.f.dist; rows.push(blankRow()); return S.view === 'invoices' ? viewInvoices() : viewVouchers(); }
      if (act === 'dc-delrow') { var rr = S.view === 'invoices' ? I.f.dist : V.f.dist; rr.splice(+id, 1); return S.view === 'invoices' ? (updateTotals(), viewInvoices()) : viewVouchers(); }
      if (act === 'dc-delfile') { (S.view === 'invoices' ? I.f.files : V.f.files).splice(+id, 1); return S.view === 'invoices' ? viewInvoices() : viewVouchers(); }
      if (act === 'dc-auto') {
        var amt = num(V.f.amount); if (!amt || isNaN(amt) || amt <= 0) { D.err = 'اكتب مبلغ السند الأول'; return viewVouchers(); }
        V.alloc = autoAlloc(V.open, amt, V.f.date); D.err = ''; return viewVouchers();
      }
      if (act === 'dc-clearalloc') { V.alloc = {}; return viewVouchers(); }
      if (act === 'dc-ipay') {
        var row = I.rows.filter(function (x) { return x.invoice_id === id; })[0]; if (!row) return;
        V = blankV(row.kind === 'sales' ? 'recv_customer' : 'pay_supplier', row.party_name); V.f.amount = String(row.remaining);
        D.msg = null; D.err = ''; S.view = 'vouchers';
        return loadOpenInv().then(function () { V.alloc[id] = row.remaining; viewVouchers(); }, function (e) { D.err = ctx.translate(e); viewVouchers(); });
      }
    }
    function submit(form) {
      var k = form.getAttribute('data-form');
      if (k === 'dc-inv') return submitInvoice();
      if (k === 'dc-vch') return submitVoucher();
      if (k === 'dc-iflt') { var F = I.flt; ['kind', 'status', 'party', 'text', 'from', 'to'].forEach(function (n) { F[n] = String(form.elements[n].value).trim(); }); I.p = 0; D.err = ''; return loadInvoices().then(viewInvoices, function (e) { D.err = ctx.translate(e); viewInvoices(); }); }
      if (k === 'dc-rev') {
        var date = form.elements.date.value, reason = form.elements.reason.value.trim(), m = D.modal;
        m.rev.date = date; m.rev.reason = reason;
        if (!date || !reason) { m.err = 'التاريخ والسبب مطلوبين'; return renderModal(); }
        return Promise.resolve(sb.rpc('reverse_entry', { p_entry: m.rev.id, p_date: date, p_reason: reason })).then(function (r) {
          if (r.error) throw r.error;
          return ctx.linkEntry(r.data.entry_id, m.rev.id).then(function () { D.modal = null; D.msg = ['تم العكس']; return S.view === 'invoices' ? loadInvoices().then(viewInvoices) : loadVouchers().then(viewVouchers); });
        }).then(null, function (e) { m.err = ctx.translate(e); renderModal(); });
      }
    }
    return { init: function (v) { return v === 'invoices' ? initInvoices() : initVouchers(); }, view: function (v) { return v === 'invoices' ? viewInvoices() : viewVouchers(); },
      click: click, input: input, change: change, submit: submit, reset: reset };
  }

  var api = { create: create, buildInvoice: buildInvoice, buildVoucher: buildVoucher, autoAlloc: autoAlloc };
  root.AccDocs = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
