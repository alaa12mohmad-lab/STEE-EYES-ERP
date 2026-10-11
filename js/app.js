/* واجهة النظام — الدخول، اختيار الشركة، شجرة الحسابات.
   كل الكتابة تمر بقاعدة البيانات (RLS + القيود)؛ الواجهة تمنع الخطأ مبكرًا وتشرحه بالعربي. */
(function (root) {
  'use strict';
  var R = root.AccRules;
  var L = R.LABELS;

  var COLS = ['code', 'name', 'parent_id', 'account_type', 'is_postable', 'is_active', 'manara_code', 'is_internal_only',
    'income_level', 'bs_section', 'cashflow_class', 'cashflow_line', 'party_rule', 'party_kind', 'project_rule',
    'cost_center_rule', 'equipment_rule', 'is_cash_account', 'is_control_account', 'is_advance_account',
    'is_noncash_adjustment', 'vat_role'];

  function esc(s) {
    return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function opts(map, sel, withBlank) {
    var h = withBlank ? '<option value="">— اختر —</option>' : '';
    Object.keys(map).forEach(function (k) { h += '<option value="' + esc(k) + '"' + (k === sel ? ' selected' : '') + '>' + esc(map[k]) + '</option>'; });
    return h;
  }
  function natCmp(a, b) { return String(a.code).localeCompare(String(b.code), 'en', { numeric: true }); }
  function store(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } }

  function blankAccount(parent) {
    return {
      code: '', name: '', parent_id: parent ? parent.id : null, account_type: parent ? parent.account_type : 'asset',
      is_postable: true, is_active: true, manara_code: null, is_internal_only: false, income_level: null, bs_section: null,
      cashflow_class: null, cashflow_line: null, party_rule: 'forbidden', party_kind: 'any', project_rule: 'forbidden',
      cost_center_rule: 'forbidden', equipment_rule: 'forbidden', is_cash_account: false, is_control_account: false,
      is_advance_account: false, is_noncash_adjustment: false, vat_role: 'none'
    };
  }

  function create(sb, rootEl, doc) {
    doc = doc || root.document;
    var NAV = [['entry', 'قيد اليومية'], ['entries', 'سجل القيود'], ['accounts', 'الحسابات'], ['roles', 'ربط الأدوار'], ['projects', 'المشاريع'], ['cost_centers', 'مراكز التكلفة'], ['parties', 'الأطراف']];
    var S = { view: 'accounts', cur: undefined, pages: [], pg: { id: null, no: null, entries: [], reversed: {} }, reg: null, hl: null, ent: null, entries: [], entLines: {}, openE: null, rev: null, parties: [], projects: [], ccs: [], rows: [], roleMap: {}, gform: null, user: null, companies: null, company: null, accounts: [], moved: {}, open: {}, q: '', form: null, formId: null, formErrs: [], busy: false, err: '' };

    function $(sel) { return rootEl.querySelector(sel); }
    function toast(msg) {
      var t = doc.getElementById('toast'); if (!t) return;
      t.textContent = msg; t.hidden = false;
      clearTimeout(toast._t); toast._t = setTimeout(function () { t.hidden = true; }, 3500);
    }
    function theme() {
      var cur = doc.documentElement.getAttribute('data-theme') || 'auto';
      var nx = cur === 'dark' ? 'light' : 'dark';
      doc.documentElement.setAttribute('data-theme', nx); store('theme', nx);
    }
    var saved = store('theme'); if (saved) doc.documentElement.setAttribute('data-theme', saved);

    /* ---------- شاشات ---------- */
    function topbar() {
      return '<div class="top"><h1>نظام الحسابات</h1>' +
        (S.company ? '<span class="chip">' + esc(S.company.name) + '</span><span class="chip">' + esc(S.company.role === 'admin' ? 'مدير' : S.company.role === 'accountant' ? 'محاسب' : S.company.role === 'entry' ? 'مدخل بيانات' : 'مشاهدة') + '</span>' : '') +
        '<span class="sp"></span>' +
        (S.company ? NAV.map(function (n) { return '<button class="sm' + (S.view === n[0] ? ' pri' : '') + '" data-act="nav" data-id="' + n[0] + '">' + n[1] + '</button>'; }).join('') : '') +
        (S.company ? '<button data-act="switch" class="sm">تغيير الشركة</button>' : '') +
        '<button data-act="theme" class="sm" title="الوضع الداكن/الفاتح">◐</button>' +
        (S.user ? '<button data-act="logout" class="sm">خروج</button>' : '') + '</div>';
    }

    function viewLogin() {
      rootEl.innerHTML = topbar() + '<div class="wrap"><form class="card center" data-form="login"><h2>تسجيل الدخول</h2>' +
        '<label for="em">الإيميل</label><input id="em" name="email" type="email" autocomplete="username" required dir="ltr">' +
        '<label for="pw">كلمة السر</label><input id="pw" name="password" type="password" autocomplete="current-password" required dir="ltr">' +
        (S.err ? '<div class="err">' + esc(S.err) + '</div>' : '') +
        '<div class="mf"><button class="pri" type="submit"' + (S.busy ? ' disabled' : '') + '>' + (S.busy ? 'جارٍ الدخول…' : 'دخول') + '</button></div></form></div>';
    }

    function viewCompanies() {
      var h = topbar() + '<div class="wrap"><h2>اختر الشركة</h2>';
      if (S.err) h += '<div class="err">' + esc(S.err) + '</div>';
      if (!S.companies.length) {
        h += '<div class="card"><p>حسابك مسجَّل لكن مفيش شركة مربوطة بيه. شغّل الكود ده مرة واحدة في Supabase ← SQL Editor (غيّر اسم الشركة):</p>' +
          '<div class="box">' + esc(
            "do $$ declare c uuid; u uuid;\nbegin\n  select id into u from auth.users where email = '" + (S.user ? S.user.email : 'YOUR@EMAIL') + "';\n" +
            "  insert into companies(name, tax_regime) values ('اسم الشركة','zakat') returning id into c;\n" +
            "  insert into user_company_roles(user_id, company_id, role) values (u, c, 'admin');\nend $$;") +
          '</div><p class="mut">tax_regime: zakat أو income_tax. بعدها اضغط تحديث.</p><button data-act="reload" class="pri">تحديث</button></div>';
      } else {
        h += '<div class="list">' + S.companies.map(function (c) {
          return '<button class="co card" data-act="pick" data-id="' + esc(c.id) + '"><strong>' + esc(c.name) + '</strong><span class="chip">' +
            esc(c.role === 'admin' ? 'مدير' : c.role === 'accountant' ? 'محاسب' : c.role === 'entry' ? 'مدخل بيانات' : 'مشاهدة') + '</span></button>';
        }).join('') + '</div>';
      }
      rootEl.innerHTML = h + '</div>';
    }

    function flags(a) {
      var f = [];
      if (a.is_cash_account) f.push('نقدية'); if (a.is_control_account) f.push('رقابة'); if (a.is_advance_account) f.push('دفعات مقدمة');
      if (a.is_noncash_adjustment) f.push('تسوية غير نقدية'); if (a.is_internal_only) f.push('داخلي');
      if (a.party_rule !== 'forbidden') f.push('طرف: ' + L.rule[a.party_rule]);
      if (a.project_rule !== 'forbidden') f.push('مشروع: ' + L.rule[a.project_rule]);
      if (a.cost_center_rule !== 'forbidden') f.push('مركز: ' + L.rule[a.cost_center_rule]);
      if (a.equipment_rule !== 'forbidden') f.push('معدة: ' + L.rule[a.equipment_rule]);
      return f.map(function (x) { return '<span class="chip">' + esc(x) + '</span>'; }).join('');
    }

    function childrenMap() {
      var m = {};
      S.accounts.forEach(function (a) { (m[a.parent_id || 'root'] = m[a.parent_id || 'root'] || []).push(a); });
      Object.keys(m).forEach(function (k) { m[k].sort(natCmp); });
      return m;
    }

    function treeRows() {
      var m = childrenMap(), q = S.q.trim().toLowerCase(), out = [], canW = canWrite();
      var match = {};
      if (q) {
        S.accounts.forEach(function (a) {
          if ((a.code + ' ' + a.name + ' ' + (a.manara_code || '')).toLowerCase().indexOf(q) >= 0) {
            var x = a; while (x) { match[x.id] = true; x = x.parent_id ? S.accounts.filter(function (p) { return p.id === x.parent_id; })[0] : null; }
          }
        });
      }
      function walk(pid, depth) {
        (m[pid] || []).forEach(function (a) {
          if (q && !match[a.id]) return;
          var kids = m[a.id] || [], isOpen = q ? true : S.open[a.id] !== false;
          var grp = !a.is_postable;
          out.push('<div class="row' + (grp ? ' grp' : '') + (a.is_active ? '' : ' off') + '" style="padding-inline-start:' + (0.75 + depth * 1.4) + 'rem">' +
            '<span class="tg" data-act="tog" data-id="' + esc(a.id) + '">' + (kids.length ? (isOpen ? '▾' : '◂') : '') + '</span>' +
            '<span class="code">' + esc(a.code) + '</span><span class="nm">' + esc(a.name) +
            ' <span class="chip">' + esc(L.type[a.account_type]) + '</span>' +
            (grp ? '<span class="chip">مجمّع</span>' : '') + (a.is_active ? '' : '<span class="chip w">معطّل</span>') +
            (a.manara_code ? '<span class="chip">منارة ' + esc(a.manara_code) + '</span>' : '') + flags(a) + '</span>' +
            (canW ? '<span class="act">' +
              (grp ? '<button class="sm" data-act="add" data-id="' + esc(a.id) + '">+ فرعي</button>' : '') +
              '<button class="sm" data-act="edit" data-id="' + esc(a.id) + '">تعديل</button>' +
              '<button class="sm" data-act="active" data-id="' + esc(a.id) + '">' + (a.is_active ? 'تعطيل' : 'تفعيل') + '</button>' +
              (!kids.length && !S.moved[a.id] ? '<button class="sm danger" data-act="del" data-id="' + esc(a.id) + '">حذف</button>' : '') +
              '</span>' : '') + '</div>');
          if (kids.length && isOpen) walk(a.id, depth + 1);
        });
      }
      walk('root', 0);
      return out;
    }

    function canWrite() { return S.company && (S.company.role === 'admin' || S.company.role === 'accountant'); }

    function viewAccounts() {
      var rows = treeRows();
      rootEl.innerHTML = topbar() + '<div class="wrap"><div class="bar"><h2 style="margin:0">شجرة الحسابات</h2><span class="sp"></span>' +
        '<input type="search" id="q" placeholder="بحث بالكود أو الاسم" value="' + esc(S.q) + '">' +
        (canWrite() ? '<button class="pri" data-act="add" data-id="">+ حساب جديد</button>' : '<span class="chip">عرض فقط</span>') + '</div>' +
        (S.err ? '<div class="err">' + esc(S.err) + '</div>' : '') +
        '<div class="tree">' + (rows.length ? rows.join('') : '<div class="empty">' + (S.accounts.length ? 'لا نتائج' : 'الشجرة فاضية. ابدأ بإضافة حساب مجمّع (مثل: الأصول) ثم الحسابات الفرعية تحته.') + '</div>') + '</div></div>';
      if (S.form) renderModal();
    }

    function renderModal() {
      var f = S.form, parent = f.parent_id ? byId(f.parent_id) : null, locked = S.formId && S.moved[S.formId];
      var pl = R.isPL(f.account_type);
      var groups = S.accounts.filter(function (a) { return !a.is_postable && a.id !== S.formId; }).sort(natCmp);
      var lines = R.lineOptions(f.account_type, f.cashflow_class);
      var lineMap = {}; lines.forEach(function (k) { lineMap[k] = L.cfLine[k]; });
      var typeMap = {}; Object.keys(L.type).forEach(function (k) { typeMap[k] = L.type[k]; });
      var bsMap = {}; (R.BS_BY_TYPE[f.account_type] || []).forEach(function (k) { bsMap[k] = L.bs[k]; });
      var cfcMap = { operating: L.cfClass.operating, investing: L.cfClass.investing, financing: L.cfClass.financing };
      if (f.is_cash_account) cfcMap = { cash: L.cfClass.cash };
      var post = f.is_postable, bal = post && !pl;
      var h = '<div class="modal"><form class="card" data-form="acc"><h2>' + (S.formId ? 'تعديل حساب' : 'حساب جديد') + '</h2>';
      if (locked) h += '<div class="mut" style="font-size:.85rem">الحساب عليه حركات: الكود والنوع ونوع التجميع مقفولين.</div>';
      h += '<div class="g2"><div><label>الكود</label><input name="code" value="' + esc(f.code) + '" dir="ltr"' + (locked ? ' disabled' : '') + '></div>' +
        '<div><label>الاسم</label><input name="name" value="' + esc(f.name) + '"></div>' +
        '<div><label>الحساب الأب</label><select name="parent_id"' + (locked ? ' disabled' : '') + '><option value="">— بدون (مستوى أعلى) —</option>' +
        groups.map(function (g) { return '<option value="' + esc(g.id) + '"' + (g.id === f.parent_id ? ' selected' : '') + '>' + esc(g.code + ' ' + g.name) + '</option>'; }).join('') + '</select></div>' +
        '<div><label>النوع</label><select name="account_type"' + (locked || parent ? ' disabled' : '') + '>' + opts(typeMap, f.account_type) + '</select></div></div>';
      h += '<div class="chk"><input type="checkbox" name="is_postable" id="f_post"' + (post ? ' checked' : '') + (locked ? ' disabled' : '') + '><label for="f_post" style="margin:0">يقبل الإدخال المباشر (حساب تفصيلي). لو مش متعلّم = حساب مجمّع</label></div>';
      if (post) {
        h += '<fieldset><legend>المنارة</legend><div class="g2"><div><label>كود المنارة</label><input name="manara_code" value="' + esc(f.manara_code || '') + '" dir="ltr"></div>' +
          '<div class="chk" style="align-self:end"><input type="checkbox" name="is_internal_only" id="f_int"' + (f.is_internal_only ? ' checked' : '') + '><label for="f_int" style="margin:0">تحليلي داخلي (ليس له كود في المنارة)</label></div></div></fieldset>';
        h += '<fieldset><legend>القوائم المالية</legend><div class="g2">';
        if (pl) h += '<div><label>مستوى قائمة الدخل</label><select name="income_level">' + opts(L.income, f.income_level, true) + '</select></div>';
        else h += '<div><label>تبويب الميزانية</label><select name="bs_section">' + opts(bsMap, f.bs_section, true) + '</select></div>' +
          '<div><label>تصنيف التدفق النقدي</label><select name="cashflow_class"' + (f.is_cash_account ? ' disabled' : '') + '>' + opts(cfcMap, f.cashflow_class, true) + '</select></div>';
        h += '<div><label>بند التدفق (للطريقة المباشرة)</label><select name="cashflow_line">' + opts(lineMap, f.cashflow_line, true) + '</select></div></div></fieldset>';
        h += '<fieldset><legend>قواعد الإدخال على هذا الحساب</legend><div class="g2">' +
          '<div><label>الطرف (عميل/مورد…)</label><select name="party_rule"' + (f.is_control_account ? ' disabled' : '') + '>' + opts(L.rule, f.party_rule) + '</select></div>' +
          '<div><label>نوع الطرف</label><select name="party_kind">' + opts(L.partyKind, f.party_kind) + '</select></div>' +
          '<div><label>المشروع</label><select name="project_rule">' + opts(L.rule, f.project_rule) + '</select></div>' +
          '<div><label>مركز التكلفة</label><select name="cost_center_rule">' + opts(L.rule, f.cost_center_rule) + '</select></div>' +
          '<div><label>المعدة</label><select name="equipment_rule">' + opts(L.rule, f.equipment_rule) + '</select></div>' +
          '<div><label>ضريبة القيمة المضافة</label><select name="vat_role">' + opts(L.vat, f.vat_role) + '</select></div></div></fieldset>';
        if (bal) {
          h += '<fieldset><legend>خصائص خاصة</legend>' +
            (f.account_type === 'asset' ? chk('is_cash_account', 'حساب نقدية (صندوق/بنك)', f) : '') +
            (f.account_type !== 'equity' ? chk('is_control_account', 'حساب رقابة (عملاء/موردين) — يشترط طرفًا', f) + chk('is_advance_account', 'حساب دفعات مقدمة', f) +
              ((f.account_type === 'asset' || f.account_type === 'liability') ? chk('is_noncash_adjustment', 'تسوية غير نقدية (إهلاك/مخصص…)', f) : '') : '') + '</fieldset>';
        }
      }
      h += '<div class="chk"><input type="checkbox" name="is_active" id="f_act"' + (f.is_active ? ' checked' : '') + '><label for="f_act" style="margin:0">الحساب نشط</label></div>';
      if (S.formErrs.length) h += '<div class="errs"><ul>' + S.formErrs.map(function (e) { return '<li>' + esc(e) + '</li>'; }).join('') + '</ul></div>';
      h += '<div class="mf"><button type="button" data-act="cancel">إلغاء</button><button class="pri" type="submit"' + (S.busy ? ' disabled' : '') + '>' + (S.busy ? 'جارٍ الحفظ…' : 'حفظ') + '</button></div></form></div>';
      var old = $('.modal'); if (old) old.remove();
      rootEl.insertAdjacentHTML('beforeend', h);
    }
    function chk(n, t, f) { return '<div class="chk"><input type="checkbox" name="' + n + '" id="f_' + n + '"' + (f[n] ? ' checked' : '') + '><label for="f_' + n + '" style="margin:0">' + esc(t) + '</label></div>'; }
    function byId(id) { return S.accounts.filter(function (a) { return a.id === id; })[0] || null; }

    /* ---------- بيانات ---------- */
    function fail(e) { S.err = R.translateDbError(e); }

    function loadCompanies() {
      S.err = '';
      return sb.from('user_company_roles').select('company_id,role').eq('user_id', S.user.id).eq('active', true).then(function (r) {
        if (r.error) throw r.error;
        var roles = r.data || [];
        if (!roles.length) { S.companies = []; return; }
        return sb.from('companies').select('id,name').in('id', roles.map(function (x) { return x.company_id; })).then(function (c) {
          if (c.error) throw c.error;
          var rm = {}; roles.forEach(function (x) { rm[x.company_id] = x.role; });
          S.companies = (c.data || []).map(function (x) { return { id: x.id, name: x.name, role: rm[x.id] }; }).sort(function (a, b) { return a.name.localeCompare(b.name, 'ar'); });
        });
      });
    }

    function loadAccounts() {
      var id = S.company.id;
      return Promise.all([
        sb.from('accounts').select('*').eq('company_id', id).order('code'),
        sb.from('v_trial_balance').select('account_id,total_debit,total_credit').eq('company_id', id)
      ]).then(function (rs) {
        if (rs[0].error) throw rs[0].error;
        S.accounts = rs[0].data || [];
        S.moved = {};
        ((rs[1].data) || []).forEach(function (x) { if (Number(x.total_debit) !== 0 || Number(x.total_credit) !== 0) S.moved[x.account_id] = true; });
        /* الأب يحمل «حركات» إن كان أحد أبنائه كذلك — لا حاجة؛ الأب المجمّع لا يقبل حركات */
      });
    }

    function enterCompany(id) {
      S.company = S.companies.filter(function (c) { return c.id === id; })[0]; if (!S.company) return Promise.resolve();
      store('company', id); S.q = ''; S.form = null; S.err = ''; S.ent = null; S.cur = undefined; S.pages = []; S.reg = null;
      S.view = 'accounts';
      return loadAccounts().then(viewAccounts, function (e) { fail(e); viewAccounts(); });
    }

    function route() {
      if (!S.user) return viewLogin();
      if (!S.company) return viewCompanies();
      return render();
    }
    function render() {
      return ({ entry: viewEntry, entries: viewEntries, accounts: viewAccounts, roles: viewRoles, projects: viewList, cost_centers: viewList, parties: viewList }[S.view] || viewAccounts)();
    }
    function go(v) {
      S.view = v; S.q = ''; S.err = ''; S.form = null; S.gform = null;
      return loadView().then(render, function (e) { fail(e); render(); });
    }
    function loadView() {
      var id = S.company.id;
      if (S.view === 'accounts') return loadAccounts();
      if (S.view === 'entry' || S.view === 'entries') return Promise.all([loadAccounts(),
        sb.from('projects').select('id,code,name,status').eq('company_id', id).order('code'),
        sb.from('cost_centers').select('id,code,name,active').eq('company_id', id).order('code'),
        sb.from('party_companies').select('party_id,active,parties(id,name,kind,active)').eq('company_id', id), loadPages()]).then(function (r) {
        for (var i = 1; i < 4; i++) if (r[i].error) throw r[i].error;
        S.projects = r[1].data || []; S.ccs = r[2].data || [];
        S.parties = (r[3].data || []).filter(function (x) { return x.active && x.parties && x.parties.active; }).map(function (x) { return x.parties; }).sort(function (a, b) { return a.name.localeCompare(b.name, 'ar'); });
        if (S.view === 'entries') { regInit(); return runRegister(); }
        if (S.cur === undefined) S.cur = null;
        if (!S.ent) S.ent = loadDraft(S.cur) || newSheet();
        return loadPageContent(S.cur);
      });
      if (S.view === 'roles') return Promise.all([loadAccounts(), sb.from('account_roles').select('role_code,account_id').eq('company_id', id)]).then(function (r) {
        if (r[1].error) throw r[1].error;
        S.roleMap = {}; (r[1].data || []).forEach(function (x) { S.roleMap[x.role_code] = x.account_id; });
      });
      if (S.view === 'projects' || S.view === 'cost_centers') return sb.from(S.view).select('*').eq('company_id', id).order('code').then(function (r) {
        if (r.error) throw r.error; S.rows = r.data || [];
      });
      if (S.view === 'parties') return Promise.all([
        sb.from('party_companies').select('party_id,manara_account_code,active,parties(*)').eq('company_id', id),
        sb.from('parties').select('id,name,kind')
      ]).then(function (r) {
        if (r[0].error) throw r[0].error; if (r[1].error) throw r[1].error;
        S.rows = (r[0].data || []).filter(function (x) { return x.parties; }).map(function (x) {
          return Object.assign({}, x.parties, { manara_account_code: x.manara_account_code, pc_active: x.active });
        }).sort(function (a, b) { return a.name.localeCompare(b.name, 'ar'); });
        var linked = {}; S.rows.forEach(function (x) { linked[x.id] = true; });
        S.unlinked = (r[1].data || []).filter(function (x) { return !linked[x.id]; });
      });
      return Promise.resolve();
    }

    function afterLogin(user) {
      S.user = user; S.company = null; S.err = '';
      return loadCompanies().then(function () {
        var last = store('company');
        if (last && S.companies.some(function (c) { return c.id === last; })) return enterCompany(last);
        if (S.companies.length === 1) return enterCompany(S.companies[0].id);
        route();
      }, function (e) { fail(e); S.companies = S.companies || []; route(); });
    }

    function start() {
      return sb.auth.getSession().then(function (r) {
        var s = r.data && r.data.session;
        if (s) return afterLogin(s.user);
        route();
      }, function () { route(); });
    }

    /* ---------- أحداث ---------- */
    function readForm(form) {
      var f = Object.assign({}, S.form);
      Array.prototype.forEach.call(form.elements, function (el) {
        if (!el.name || el.disabled) return;
        if (el.type === 'checkbox') f[el.name] = el.checked;
        else f[el.name] = el.value === '' ? (el.tagName === 'SELECT' ? null : el.value) : el.value;
      });
      return f;
    }

    function submitAccount(form) {
      var f = R.normalize(readForm(form));
      if (S.formId && S.moved[S.formId]) { var o = byId(S.formId); f.code = o.code; f.account_type = o.account_type; f.is_postable = o.is_postable; f.parent_id = o.parent_id; }
      var parent = f.parent_id ? byId(f.parent_id) : null;
      if (parent) f.account_type = parent.account_type;
      f.code = (f.code || '').trim(); f.name = (f.name || '').trim();
      S.form = f; S.formErrs = R.validate(f, parent);
      var dup = S.accounts.some(function (a) { return a.id !== S.formId && a.code === f.code; });
      if (dup) S.formErrs.push('الكود مستخدم من قبل في هذه الشركة');
      if (S.formErrs.length) return renderModal();
      var payload = {}; COLS.forEach(function (k) { payload[k] = f[k] === undefined ? null : f[k]; });
      S.busy = true; renderModal();
      var q = S.formId ? sb.from('accounts').update(payload).eq('id', S.formId).eq('company_id', S.company.id)
        : sb.from('accounts').insert(Object.assign({ company_id: S.company.id }, payload));
      return q.then(function (r) {
        S.busy = false;
        if (r.error) { S.formErrs = [R.translateDbError(r.error)]; return renderModal(); }
        S.form = null; toast('تم الحفظ');
        return loadAccounts().then(viewAccounts);
      }, function (e) { S.busy = false; S.formErrs = [R.translateDbError(e)]; renderModal(); });
    }

    function onClick(ev) {
      var t = ev.target.closest('[data-act]'); if (!t) return;
      var act = t.getAttribute('data-act'), id = t.getAttribute('data-id');
      if (act === 'theme') return theme();
      if (act === 'logout') return sb.auth.signOut().then(function () { S.user = null; S.company = null; store('company', ''); S.err = ''; route(); });
      if (act === 'nav') return go(id);
      if (act === 'sh-addentry') { var le = S.ent.entries[S.ent.entries.length - 1]; S.ent.entries.push(blankEntry(le && le.date)); saveDraft(); return viewEntry({ e: S.ent.entries.length - 1, l: 0, f: 'acc' }); }
      if (act === 'sh-delentry') { var de = S.ent.entries[+id]; if (root.confirm && entryUsed(de) && !root.confirm('حذف هذا القيد من الورقة؟')) return; S.ent.entries.splice(+id, 1); if (!S.ent.entries.length) S.ent.entries.push(blankEntry()); saveDraft(); return viewEntry(); }
      if (act === 'sh-addline') { var nl = addLine(+id); saveDraft(); return viewEntry({ e: +id, l: nl, f: 'acc' }); }
      if (act === 'sh-delline') { var pr = id.split(':'); S.ent.entries[+pr[0]].lines.splice(+pr[1], 1); saveDraft(); return viewEntry(); }
      if (act === 'sh-save') return saveAll();
      if (act === 'sh-hidelog') { S.ent.saved = []; return viewEntry(); }
      if (act === 'sh-clear') { if (root.confirm && S.ent.entries.some(entryUsed) && !root.confirm('تفريغ القيود الجديدة؟')) return; S.ent = newSheet(); clearDraft(); return viewEntry(); }
      if (act === 'eopen') { S.reg.open[id] = !S.reg.open[id]; return viewEntries(); }
      if (act === 'pg-first' || act === 'pg-prev' || act === 'pg-next' || act === 'pg-last') return navTo(act.slice(3));
      if (act === 'pg-new') return openPage(null);
      if (act === 'pg-print') return root.print && root.print();
      if (act === 'pg-csv') return download('قيد-' + S.cur + '.csv', entriesCsv(S.pg.entries));
      if (act === 'reg-page') { S.view = 'entry'; return Promise.resolve(loadView()).then(function () { return openPage(+id, t.getAttribute('data-e')); }); }
      if (act === 'reg-clear') { S.reg.f = blankRegF(); S.reg.p = 0; return runRegister().then(viewEntries); }
      if (act === 'reg-prev' || act === 'reg-next') { S.reg.p += act === 'reg-next' ? 1 : -1; return runRegister().then(viewEntries, function (e) { fail(e); viewEntries(); }); }
      if (act === 'reg-csv') return download('سجل-القيود.csv', entriesCsv(S.reg.rows.map(function (e) { return Object.assign({}, e, { lines: S.reg.lines[e.id] || [] }); })));
      if (act === 'erev') { S.rev = { id: id, date: today(), reason: '', err: '' }; return renderRev(); }
      if (act === 'revcancel') { S.rev = null; return S.view === 'entries' ? viewEntries() : viewEntry(); }
      if (act === 'gadd') return openG(null);
      if (act === 'gedit') return openG(id);
      if (act === 'gcancel') { S.gform = null; return render(); }
      if (act === 'switch') { S.company = null; S.form = null; store('company', ''); return route(); }
      if (act === 'reload') return loadCompanies().then(route, function (e) { fail(e); route(); });
      if (act === 'pick') return enterCompany(id);
      if (act === 'tog') { S.open[id] = S.open[id] === false; return viewAccounts(); }
      if (act === 'cancel') { S.form = null; S.formErrs = []; return viewAccounts(); }
      if (act === 'add') { var p = id ? byId(id) : null; S.formId = null; S.form = blankAccount(p); S.formErrs = []; return renderModal(); }
      if (act === 'edit') { var a = byId(id); S.formId = id; S.form = Object.assign({}, a); S.formErrs = []; return renderModal(); }
      if (act === 'active') {
        var ac = byId(id);
        return sb.from('accounts').update({ is_active: !ac.is_active }).eq('id', id).eq('company_id', S.company.id).then(function (r) {
          if (r.error) { fail(r.error); return viewAccounts(); }
          S.err = ''; return loadAccounts().then(viewAccounts);
        });
      }
      if (act === 'del') {
        var d = byId(id);
        if (!root.confirm || !root.confirm('حذف الحساب ' + d.code + ' ' + d.name + '؟')) return;
        return sb.from('accounts').delete().eq('id', id).eq('company_id', S.company.id).then(function (r) {
          if (r.error) { fail(r.error); return viewAccounts(); }
          S.err = ''; toast('تم الحذف'); return loadAccounts().then(viewAccounts);
        });
      }
    }

    function onChange(ev) {
      var el = ev.target, form = el.form; if (el.closest && el.closest('[data-sheet]') || el.name === 'sheettype') return sheetChange(el);
      if (!form || form.getAttribute('data-form') !== 'acc') return;
      var f = readForm(form), prevType = S.form.account_type;
      var parent = f.parent_id ? byId(f.parent_id) : null;
      if (parent) f.account_type = parent.account_type;
      if (el.name === 'account_type' && f.account_type !== prevType) { f.bs_section = null; f.cashflow_class = null; f.cashflow_line = null; f.income_level = null; }
      S.form = R.normalize(f); S.formErrs = [];
      renderModal();
    }

    function onSubmit(ev) {
      var form = ev.target, kind = form.getAttribute('data-form'); if (!kind) return;
      ev.preventDefault();
      if (kind === 'acc') return submitAccount(form);
      if (kind === 'rev') return submitRev(form);
      if (kind === 'regf') { readRegF(form); S.reg.p = 0; S.err = ''; return runRegister().then(viewEntries, function (e) { fail(e); viewEntries(); }); }
      if (kind === 'gen') return submitG(form);
      if (kind === 'roles') return saveRoles(form);
      if (kind === 'link') return linkParty(form);
      if (kind === 'login') {
        if (S.busy) return;
        var email = form.elements.email.value.trim(), pw = form.elements.password.value;
        S.busy = true; S.err = '';
        return sb.auth.signInWithPassword({ email: email, password: pw }).then(function (r) {
          S.busy = false;
          if (r.error) { fail(r.error); return viewLogin(); }
          return afterLogin(r.data.user);
        }, function (e) { S.busy = false; fail(e); viewLogin(); });
      }
    }

    function onInput(ev) {
      if (ev.target.closest && ev.target.closest('[data-sheet]')) return sheetInput(ev.target);
      if (ev.target.id === 'q') { S.q = ev.target.value; var pos = ev.target.selectionStart; render(); var q = $('#q'); if (q) { q.focus(); try { q.setSelectionRange(pos, pos); } catch (e) { } } }
    }

    /* ---------- ربط الأدوار ---------- */
    var ROLES = [
      ['ar_control', 'العملاء (رقابة)', function (a) { return a.is_control_account; }],
      ['ap_control', 'الموردون (رقابة)', function (a) { return a.is_control_account; }],
      ['cash', 'الصندوق', function (a) { return a.is_cash_account; }],
      ['bank', 'البنك', function (a) { return a.is_cash_account; }],
      ['custody', 'العهد', function (a) { return a.account_type === 'asset'; }],
      ['vat_input', 'ضريبة المدخلات', function (a) { return a.vat_role === 'input'; }],
      ['vat_output', 'ضريبة المخرجات', function (a) { return a.vat_role === 'output'; }],
      ['vat_payable', 'ضريبة القيمة المضافة المستحقة', function (a) { return a.account_type === 'liability'; }],
      ['payroll_payable', 'رواتب مستحقة', function (a) { return a.account_type === 'liability'; }],
      ['customer_advance', 'فلوس واصلة من العميل (دفعات مقدمة)', function (a) { return a.is_advance_account; }],
      ['supplier_advance_unregistered', 'دفعات مقدمة لغير المسجلين', function (a) { return a.is_advance_account; }],
      ['depreciation_expense', 'مصروف الإهلاك', function (a) { return a.account_type === 'expense'; }],
      ['accumulated_depreciation', 'مجمع الإهلاك', function (a) { return a.account_type === 'asset'; }]
    ];
    function viewRoles() {
      var post = S.accounts.filter(function (a) { return a.is_postable && a.is_active; }).sort(natCmp);
      var h = topbar() + '<div class="wrap"><h2>ربط الأدوار بالحسابات</h2><p class="mut">الأدوار دي بتستخدمها القوالب السريعة (فاتورة، سند صرف…) لتعرف تقيّد على أي حساب. الحسابات المقترحة بتظهر أولًا.</p>';
      if (S.err) h += '<div class="err">' + esc(S.err) + '</div>';
      h += '<form data-form="roles" class="card">';
      ROLES.forEach(function (r) {
        var cur = S.roleMap[r[0]] || '', sug = post.filter(r[2]), rest = post.filter(function (a) { return !r[2](a); });
        function o(a) { return '<option value="' + esc(a.id) + '"' + (a.id === cur ? ' selected' : '') + '>' + esc(a.code + ' ' + a.name) + '</option>'; }
        h += '<label>' + esc(r[1]) + '</label><select name="' + r[0] + '"' + (canWrite() ? '' : ' disabled') + '><option value="">— غير مربوط —</option>' +
          (sug.length ? '<optgroup label="مقترحة">' + sug.map(o).join('') + '</optgroup>' : '') +
          '<optgroup label="باقي الحسابات">' + rest.map(o).join('') + '</optgroup></select>';
      });
      if (canWrite()) h += '<div class="mf"><button class="pri" type="submit">حفظ الربط</button></div>';
      rootEl.innerHTML = h + '</form></div>';
    }
    function saveRoles(form) {
      var rows = [], clear = [];
      ROLES.forEach(function (r) {
        var v = form.elements[r[0]].value;
        if (v) rows.push({ company_id: S.company.id, role_code: r[0], account_id: v }); else if (S.roleMap[r[0]]) clear.push(r[0]);
      });
      var ops = [];
      if (rows.length) ops.push(sb.from('account_roles').upsert(rows, { onConflict: 'company_id,role_code' }));
      clear.forEach(function (c) { ops.push(sb.from('account_roles').delete().eq('company_id', S.company.id).eq('role_code', c)); });
      return Promise.all(ops).then(function (rs) {
        var bad = rs.filter(function (x) { return x.error; })[0];
        if (bad) { fail(bad.error); return viewRoles(); }
        S.err = ''; toast('تم حفظ الربط'); return loadView().then(viewRoles);
      }, function (e) { fail(e); viewRoles(); });
    }

    /* ---------- قوائم بسيطة: مشاريع / مراكز تكلفة / أطراف ---------- */
    var PARTY_KIND = { customer: 'عميل', supplier: 'مورد', employee: 'موظف', partner: 'شريك' };
    var CFG = {
      projects: {
        title: 'المشاريع', one: 'مشروع', table: 'projects',
        fields: [
          { k: 'code', l: 'الكود', req: 1, dir: 'ltr' }, { k: 'name', l: 'الاسم', req: 1 },
          { k: 'status', l: 'الحالة', sel: { active: 'نشط', closed: 'مغلق' }, def: 'active' },
          { k: 'budget_amount', l: 'الميزانية التقديرية (اختياري)', num: 1 }],
        line: function (x) { return '<span class="chip' + (x.status === 'active' ? ' g' : '') + '">' + (x.status === 'active' ? 'نشط' : 'مغلق') + '</span>' + (x.budget_amount !== null && x.budget_amount !== undefined ? '<span class="chip">ميزانية ' + esc(Number(x.budget_amount).toLocaleString('en')) + '</span>' : ''); },
        off: function (x) { return x.status === 'closed'; }
      },
      cost_centers: {
        title: 'مراكز التكلفة', one: 'مركز تكلفة', table: 'cost_centers',
        fields: [{ k: 'code', l: 'الكود', req: 1, dir: 'ltr' }, { k: 'name', l: 'الاسم', req: 1 }, { k: 'active', l: 'نشط', bool: 1, def: true }],
        line: function (x) { return x.active ? '' : '<span class="chip w">معطّل</span>'; },
        off: function (x) { return !x.active; }
      },
      parties: {
        title: 'الأطراف (عملاء، موردون، موظفون، شركاء)', one: 'طرف', table: 'parties', shared: 1,
        fields: [
          { k: 'name', l: 'الاسم', req: 1 }, { k: 'kind', l: 'النوع', sel: PARTY_KIND, def: 'customer', req: 1 },
          { k: 'vat_number', l: 'الرقم الضريبي (15 رقم، اختياري)', dir: 'ltr' }, { k: 'cr_number', l: 'السجل التجاري (اختياري)', dir: 'ltr' },
          { k: 'address', l: 'العنوان (اختياري)' },
          { k: 'manara_account_code', l: 'كود الطرف في المنارة (لهذه الشركة)', dir: 'ltr', pc: 1 },
          { k: 'pc_active', l: 'نشط في هذه الشركة', bool: 1, def: true, pc: 1 }],
        line: function (x) { return '<span class="chip">' + esc(PARTY_KIND[x.kind] || x.kind) + '</span>' + (x.vat_number ? '<span class="chip">ض ' + esc(x.vat_number) + '</span>' : '') + (x.manara_account_code ? '<span class="chip">منارة ' + esc(x.manara_account_code) + '</span>' : '') + (x.pc_active ? '' : '<span class="chip w">معطّل</span>'); },
        off: function (x) { return !x.pc_active; }
      }
    };
    function viewList() {
      var c = CFG[S.view], q = S.q.trim().toLowerCase(), w = canWrite();
      var rows = S.rows.filter(function (x) { return !q || ((x.code || '') + ' ' + x.name + ' ' + (x.vat_number || '')).toLowerCase().indexOf(q) >= 0; });
      if (c.table !== 'parties') rows = rows.slice().sort(natCmp);
      var h = topbar() + '<div class="wrap"><div class="bar"><h2 style="margin:0">' + esc(c.title) + '</h2><span class="sp"></span>' +
        '<input type="search" id="q" placeholder="بحث" value="' + esc(S.q) + '">' + (w ? '<button class="pri" data-act="gadd">+ ' + esc(c.one) + ' جديد</button>' : '<span class="chip">عرض فقط</span>') + '</div>';
      if (S.err) h += '<div class="err">' + esc(S.err) + '</div>';
      if (c.shared && w && S.unlinked && S.unlinked.length) {
        h += '<form data-form="link" class="bar"><select name="pid" style="max-width:320px"><option value="">ربط طرف موجود في شركة أخرى…</option>' +
          S.unlinked.map(function (x) { return '<option value="' + esc(x.id) + '">' + esc(x.name + ' — ' + (PARTY_KIND[x.kind] || x.kind)) + '</option>'; }).join('') + '</select><button class="sm" type="submit">ربط</button></form>';
      }
      h += '<div class="tree">' + (rows.length ? rows.map(function (x) {
        return '<div class="row' + (c.off(x) ? ' off' : '') + '">' + (x.code !== undefined ? '<span class="code">' + esc(x.code) + '</span>' : '') +
          '<span class="nm">' + esc(x.name) + ' ' + c.line(x) + '</span>' +
          (w ? '<span class="act"><button class="sm" data-act="gedit" data-id="' + esc(x.id) + '">تعديل</button></span>' : '') + '</div>';
      }).join('') : '<div class="empty">لا يوجد بيانات بعد.</div>') + '</div></div>';
      rootEl.innerHTML = h;
      if (S.gform) renderGModal();
    }
    function renderGModal() {
      var c = CFG[S.view], f = S.gform, h = '<div class="modal"><form class="card" data-form="gen"><h2>' + (f.id ? 'تعديل ' : 'جديد: ') + esc(c.one) + '</h2>';
      if (c.shared && f.id) h += '<div class="mut" style="font-size:.85rem">بيانات الاسم والنوع والرقم الضريبي مشتركة بين الشركات.</div>';
      c.fields.forEach(function (fd) {
        var v = f.data[fd.k];
        if (fd.bool) h += '<div class="chk"><input type="checkbox" name="' + fd.k + '" id="g_' + fd.k + '"' + (v ? ' checked' : '') + '><label for="g_' + fd.k + '" style="margin:0">' + esc(fd.l) + '</label></div>';
        else if (fd.sel) h += '<label>' + esc(fd.l) + '</label><select name="' + fd.k + '">' + opts(fd.sel, v) + '</select>';
        else h += '<label>' + esc(fd.l) + '</label><input name="' + fd.k + '" value="' + esc(v === null || v === undefined ? '' : v) + '"' + (fd.num ? ' inputmode="decimal"' : '') + (fd.dir ? ' dir="' + fd.dir + '"' : '') + '>';
      });
      if (f.errs.length) h += '<div class="errs"><ul>' + f.errs.map(function (e) { return '<li>' + esc(e) + '</li>'; }).join('') + '</ul></div>';
      h += '<div class="mf"><button type="button" data-act="gcancel">إلغاء</button><button class="pri" type="submit"' + (S.busy ? ' disabled' : '') + '>حفظ</button></div></form></div>';
      var old = $('.modal'); if (old) old.remove();
      rootEl.insertAdjacentHTML('beforeend', h);
    }
    function openG(id) {
      var c = CFG[S.view], d = {};
      c.fields.forEach(function (fd) { d[fd.k] = fd.def !== undefined ? fd.def : ''; });
      if (id) { var r = S.rows.filter(function (x) { return x.id === id; })[0]; c.fields.forEach(function (fd) { d[fd.k] = r[fd.k] === null || r[fd.k] === undefined ? '' : r[fd.k]; }); }
      S.gform = { id: id || null, data: d, errs: [] }; renderGModal();
    }
    function submitG(form) {
      var c = CFG[S.view], d = {}, errs = [];
      c.fields.forEach(function (fd) {
        var el = form.elements[fd.k]; if (!el) return;
        var v = fd.bool ? el.checked : String(el.value).trim();
        d[fd.k] = v;
        if (fd.req && !v) errs.push(fd.l + ' مطلوب');
      });
      if (c.table === 'projects') {
        if (d.budget_amount !== '' && (isNaN(Number(d.budget_amount)) || Number(d.budget_amount) < 0)) errs.push('الميزانية يجب أن تكون رقمًا صفرًا أو أكثر');
      }
      if (c.table === 'parties' && d.vat_number && !/^3[0-9]{13}3$/.test(d.vat_number)) errs.push('الرقم الضريبي 15 رقمًا يبدأ وينتهي بـ 3');
      if (d.code !== undefined && S.rows.some(function (x) { return x.id !== S.gform.id && x.code === d.code; })) errs.push('الكود مستخدم من قبل');
      S.gform.data = d; S.gform.errs = errs;
      if (errs.length) return renderGModal();
      var id = S.gform.id, cid = S.company.id, main = {}, pc = {};
      c.fields.forEach(function (fd) { var v = d[fd.k]; if (!fd.bool && v === '') v = null; if (fd.num && v !== null) v = Number(v); (fd.pc ? pc : main)[fd.k] = v; });
      var p;
      if (c.table === 'parties') {
        var pcRow = { manara_account_code: pc.manara_account_code, active: pc.pc_active };
        if (id) p = sb.from('parties').update(main).eq('id', id).then(function (r) {
          if (r.error) return r; return sb.from('party_companies').update(pcRow).eq('party_id', id).eq('company_id', cid);
        });
        else p = sb.from('parties').insert(main).select().single().then(function (r) {
          if (r.error) return r; return sb.from('party_companies').insert(Object.assign({ party_id: r.data.id, company_id: cid }, pcRow));
        });
      } else if (c.table === 'cost_centers') {
        p = id ? sb.from('cost_centers').update(main).eq('id', id).eq('company_id', cid) : sb.from('cost_centers').insert(Object.assign({ company_id: cid }, main));
      } else {
        p = id ? sb.from(c.table).update(main).eq('id', id).eq('company_id', cid) : sb.from(c.table).insert(Object.assign({ company_id: cid }, main));
      }
      S.busy = true; renderGModal();
      return Promise.resolve(p).then(function (r) {
        S.busy = false;
        if (r.error) { S.gform.errs = [R.translateDbError(r.error)]; return renderGModal(); }
        S.gform = null; toast('تم الحفظ'); return loadView().then(render);
      }, function (e) { S.busy = false; S.gform.errs = [R.translateDbError(e)]; renderGModal(); });
    }
    function linkParty(form) {
      var pid = form.elements.pid.value; if (!pid) return;
      return sb.from('party_companies').insert({ party_id: pid, company_id: S.company.id }).then(function (r) {
        if (r.error) { fail(r.error); return render(); }
        S.err = ''; toast('تم الربط'); return loadView().then(render);
      });
    }

    /* ---------- ورقة القيود: أكثر من قيد في الصفحة (شكل إكسيل) ---------- */
    var uid = 0, ROWF = ['acc', 'party', 'project', 'cc', 'debit', 'credit'];
    function fmt(n) { return Number(n || 0).toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
    function today() { var d = new Date(); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
    function normNum(v) {
      return String(v === null || v === undefined ? '' : v).replace(/[٠-٩]/g, function (c) { return c.charCodeAt(0) - 1632; }).replace(/[۰-۹]/g, function (c) { return c.charCodeAt(0) - 1776; })
        .replace(/[٫]/g, '.').replace(/[٬,\s]/g, '');
    }
    function pnum(v) { var n = Number(normNum(v)); return isNaN(n) ? 0 : n; }
    function blankLine() { return { acc: '', party: '', payee: '', project: '', cc: '', debit: '', credit: '' }; }
    function blankEntry(date) { return { k: ++uid, date: date || today(), desc: '', in_manara: false, manara_no: '', lines: [blankLine(), blankLine()], errs: [] }; }
    function newSheet() { return { type: 'regular', entries: [blankEntry()], saved: [], busy: false }; }
    function draftKey(no) { return 'draft:' + S.company.id + ':' + (no === undefined ? (S.cur === null || S.cur === undefined ? 'new' : S.cur) : (no === null ? 'new' : no)); }
    function saveDraft() { try { if (S.ent.entries.some(entryUsed)) localStorage.setItem(draftKey(), JSON.stringify({ type: S.ent.type, entries: S.ent.entries })); else localStorage.removeItem(draftKey()); } catch (e) { } }
    function clearDraft(no) { try { localStorage.removeItem(draftKey(no)); } catch (e) { } }
    function loadDraft(no) {
      try {
        var d = JSON.parse(localStorage.getItem(draftKey(no)) || 'null');
        if (d && d.entries && d.entries.length) { d.entries.forEach(function (e) { e.k = ++uid; e.errs = []; }); return { type: d.type || 'regular', entries: d.entries, saved: [], busy: false }; }
      } catch (e) { }
      return null;
    }
    function accIdx() {
      if (S._ai && S._ai.src === S.accounts) return S._ai;
      var ai = { src: S.accounts, list: postables(), byCode: {}, byFull: {} };
      ai.list.forEach(function (a) { ai.byCode[a.code] = a; ai.byFull[a.code + ' ' + a.name] = a; });
      return (S._ai = ai);
    }
    function postables() { return S.accounts.filter(function (a) { return a.is_postable && a.is_active; }).sort(natCmp); }
    function resolveAcc(txt) { txt = String(txt || '').trim(); if (!txt) return null; var ai = accIdx(); return ai.byFull[txt] || ai.byCode[txt.split(/\s+/)[0]] || null; }
    function kindOk(a, p) { return !a || a.party_kind === 'any' || p.kind === a.party_kind; }
    function resolveParty(txt, a) { txt = String(txt || '').trim(); if (!txt) return null; return S.parties.filter(function (p) { return p.name === txt && kindOk(a, p); })[0] || null; }
    function resolveCode(list, txt) {
      txt = String(txt || '').trim(); if (!txt) return null;
      return list.filter(function (x) { return x.code + ' ' + x.name === txt; })[0] || list.filter(function (x) { return x.code === txt.split(/\s+/)[0]; })[0] || null;
    }
    function actProjects() { return S.projects.filter(function (x) { return x.status === 'active'; }); }
    function actCCs() { return S.ccs.filter(function (x) { return x.active; }); }
    function lineUsed(l) { return !!(String(l.acc).trim() || pnum(l.debit) || pnum(l.credit)); }
    function entryUsed(e) { return !!(String(e.desc).trim() || e.lines.some(lineUsed)); }
    function entryDiff(e) {
      var d = 0, c = 0; e.lines.forEach(function (l) { d += Math.round(pnum(l.debit) * 100); c += Math.round(pnum(l.credit) * 100); });
      return { d: d / 100, c: c / 100, diff: (d - c) / 100 };
    }
    function sheetStats() {
      var n = 0, bad = 0, d = 0, c = 0;
      S.ent.entries.forEach(function (e) { if (!entryUsed(e)) return; n++; var t = entryDiff(e); d += t.d; c += t.c; if (t.diff !== 0 || t.d === 0) bad++; });
      return { n: n, bad: bad, d: d, c: c };
    }
    function badge(e) {
      var t = entryDiff(e), ok = t.diff === 0 && t.d > 0;
      return '<span id="eb-' + e.k + '" class="chip ' + (ok ? 'g' : (entryUsed(e) ? 'w' : '')) + '">' + (ok ? 'متوازن ✓' : (entryUsed(e) ? 'الفرق ' + fmt(t.diff) : 'فارغ')) + '</span>';
    }
    function cellInput(ei, li, f, v, extra) {
      return '<input data-e="' + ei + '" data-l="' + li + '" data-f="' + f + '" value="' + esc(v) + '"' + (extra || '') + ' autocomplete="off">';
    }
    function canRev() { return S.company.role === 'admin' || S.company.role === 'accountant'; }
    var TYPE_AR = { regular: 'عادي', opening: 'افتتاحي', reversal: 'عكسي', closing: 'إقفال', adjustment: 'تسوية' };
    function savedBody(en) {
      var ls = en.lines, n = ls.length, rv = S.pg.reversed[en.id];
      var h = '<tbody class="saved' + (S.hl === en.id ? ' hl' : '') + '" data-entry="' + esc(en.id) + '">';
      ls.forEach(function (l, i) {
        h += '<tr' + (i === 0 ? ' class="first"' : '') + '>';
        if (i === 0) {
          h += '<td rowspan="' + n + '" class="en"><div class="en-n">' + esc(en.fiscal_year + '/' + en.entry_no) + '</div>' +
            (en.entry_type !== 'regular' ? '<div class="chip">' + esc(TYPE_AR[en.entry_type] || en.entry_type) + '</div>' : '') +
            (rv ? '<div class="chip w">معكوس</div>' : '') + (en.in_manara ? '<div class="chip g">منارة' + (en.manara_no ? ' ' + esc(en.manara_no) : '') + '</div>' : '') +
            (canRev() && en.entry_type !== 'reversal' && !rv ? '<div><button class="sm" data-act="erev" data-id="' + esc(en.id) + '">عكس</button></div>' : '') + '</td>' +
            '<td rowspan="' + n + '" class="ed ro">' + esc(en.entry_date) + '</td>';
        }
        h += '<td class="ro">' + esc(l.account_code + ' ' + l.account_name) + '</td><td class="ro">' + esc(l.party_name || l.payee_name || '') + '</td><td class="ro">' + esc(l.project_code || '') + '</td><td class="ro">' + esc(l.cost_center_code || '') + '</td>' +
          '<td class="ro num">' + (Number(l.debit) ? fmt(l.debit) : '') + '</td><td class="ro num">' + (Number(l.credit) ? fmt(l.credit) : '') + '</td>';
        if (i === 0) h += '<td rowspan="' + n + '" class="edesc ro">' + esc(en.description) + '</td>';
        h += '<td class="ops"></td></tr>';
      });
      return h + '</tbody>';
    }
    function pageBar() {
      var ns = pageNos(), cur = S.cur, f = navNo('first'), p = navNo('prev'), n = navNo('next'), l = navNo('last');
      function b(act, txt, dis) { return '<button class="sm" data-act="' + act + '"' + (dis ? ' disabled' : '') + '>' + txt + '</button>'; }
      return '<div class="pagebar"><strong>قيد رقم</strong>' +
        b('pg-first', '⇥ الأول', f === null || f === cur) + b('pg-prev', '→ السابق', p === null) +
        '<input id="pgno" class="pgno" inputmode="numeric" dir="ltr" value="' + (cur === null ? '' : esc(cur)) + '" placeholder="جديد" title="اكتب رقم القيد واضغط Enter">' +
        '<span class="mut">من ' + (ns.length ? ns[ns.length - 1] : 0) + (cur === null ? ' · صفحة جديدة، ستأخذ الرقم ' + ((ns.length ? ns[ns.length - 1] : 0) + 1) + ' عند أول حفظ' : '') + '</span>' +
        b('pg-next', 'التالي ←', n === null) + b('pg-last', 'الأخير ⇤', l === null || l === cur) +
        b('pg-new', '+ صفحة جديدة', cur === null) +
        '<span class="sp"></span><input id="entsearch" class="entsearch" dir="ltr" placeholder="بحث برقم القيد: 37 أو 2026/37" title="اكتب رقم القيد واضغط Enter">' +
        b('pg-print', 'طباعة', false) + b('pg-csv', 'CSV', !S.pg.entries.length) + '</div>';
    }
    function viewEntry(focus) {
      var Sh = S.ent;
      if (S.company.role === 'viewer') { rootEl.innerHTML = topbar() + '<div class="wrap"><div class="empty">صلاحيتك عرض فقط.</div></div>'; return; }
      var canType = canRev(), kinds = ['any', 'customer', 'supplier', 'employee', 'partner'];
      var h = topbar() + '<div class="wrap wide" data-sheet><datalist id="acclist">' + accIdx().list.map(function (a) { return '<option value="' + esc(a.code + ' ' + a.name) + '">'; }).join('') + '</datalist>' +
        kinds.map(function (k) { return '<datalist id="pl_' + k + '">' + S.parties.filter(function (p) { return k === 'any' || p.kind === k; }).map(function (p) { return '<option value="' + esc(p.name) + '">'; }).join('') + '</datalist>'; }).join('') +
        '<datalist id="projlist">' + actProjects().map(function (p) { return '<option value="' + esc(p.code + ' ' + p.name) + '">'; }).join('') + '</datalist>' +
        '<datalist id="cclist">' + actCCs().map(function (p) { return '<option value="' + esc(p.code + ' ' + p.name) + '">'; }).join('') + '</datalist>';
      h += pageBar();
      if (S.err) h += '<div class="err">' + esc(S.err) + '</div>';
      h += '<div class="sheetbar"><strong>إدخال قيود جديدة</strong>' +
        (canType ? '<select name="sheettype" style="width:auto"><option value="regular">قيود عادية</option><option value="opening"' + (Sh.type === 'opening' ? ' selected' : '') + '>قيود افتتاحية</option><option value="adjustment"' + (Sh.type === 'adjustment' ? ' selected' : '') + '>قيود تسوية</option></select>' : '') +
        '<span id="sh-stats" class="chip"></span><span class="sp"></span>' +
        '<button class="sm" data-act="sh-addentry">+ قيد جديد</button><button class="sm" data-act="sh-clear">تفريغ الجديد</button>' +
        '<button class="pri" data-act="sh-save" id="sh-save"' + (Sh.busy ? ' disabled' : '') + '>' + (Sh.busy ? 'جارٍ الحفظ…' : 'حفظ القيود الجديدة') + '</button></div>';
      if (Sh.saved.length || Sh.note) {
        h += '<div class="okbox"><button class="sm" style="float:left" data-act="sh-hidelog">إخفاء</button>' +
          (Sh.saved.length ? '<strong>تم حفظ ' + Sh.saved.length + ' قيد:</strong> ' + Sh.saved.map(function (x) { return '<span class="chip g">' + esc(x.no) + '</span>'; }).join('') : '') +
          Sh.saved.filter(function (x) { return x.warns && x.warns.length; }).map(function (x) { return '<div class="mut">⚠ ' + esc(x.no) + ': ' + esc(x.warns.join('؛ ')) + '</div>'; }).join('') +
          (Sh.note ? '<div class="mut">⚠ ' + esc(Sh.note) + '</div>' : '') + '</div>';
      }
      h += '<div class="sheetwrap"><table class="sheet"><thead><tr><th>القيد</th><th>التاريخ</th><th>الحساب</th><th>الطرف</th><th>المشروع</th><th>مركز التكلفة</th><th>مدين</th><th>دائن</th><th>البيان</th><th></th></tr></thead>';
      S.pg.entries.forEach(function (en) { h += savedBody(en); });
      Sh.entries.forEach(function (e, ei) {
        var n = e.lines.length;
        h += '<tbody class="draft">';
        e.lines.forEach(function (l, li) {
          var a = resolveAcc(l.acc), pd = !a || a.party_rule === 'forbidden', jd = !a || a.project_rule === 'forbidden', cd = !a || a.cost_center_rule === 'forbidden';
          var pOk = !l.party || resolveParty(l.party, a), jOk = !l.project || resolveCode(S.projects, l.project), cOk = !l.cc || resolveCode(S.ccs, l.cc);
          h += '<tr' + (li === 0 ? ' class="first"' : '') + '>';
          if (li === 0) {
            h += '<td rowspan="' + n + '" class="en"><div class="en-n">جديد</div>' + badge(e) +
              '<div><button class="sm danger" data-act="sh-delentry" data-id="' + ei + '" title="حذف القيد من الورقة">✕</button></div>' +
              (e.errs.length ? '<ul class="eerr">' + e.errs.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>' : '') + '</td>' +
              '<td rowspan="' + n + '" class="ed"><input type="date" data-e="' + ei + '" data-ef="date" value="' + esc(e.date) + '"></td>';
          }
          h += '<td>' + cellInput(ei, li, 'acc', l.acc, ' list="acclist" class="' + (l.acc && !a ? 'bad' : '') + '"') + '</td>' +
            '<td>' + cellInput(ei, li, 'party', l.party, ' list="pl_' + (a ? a.party_kind : 'any') + '"' + (pd ? ' disabled' : '') + ' class="' + (pOk ? '' : 'bad') + '" placeholder="' + (a && a.party_rule === 'required' ? 'مطلوب' : '') + '"') +
            cellInput(ei, li, 'payee', l.payee, ' placeholder="اسم المستلم"' + (a && a.is_advance_account && !l.party ? '' : ' hidden')) + '</td>' +
            '<td>' + cellInput(ei, li, 'project', l.project, ' list="projlist"' + (jd ? ' disabled' : '') + ' class="' + (jOk ? '' : 'bad') + '" placeholder="' + (a && a.project_rule === 'required' ? 'مطلوب' : '') + '"') + '</td>' +
            '<td>' + cellInput(ei, li, 'cc', l.cc, ' list="cclist"' + (cd ? ' disabled' : '') + ' class="' + (cOk ? '' : 'bad') + '" placeholder="' + (a && a.cost_center_rule === 'required' ? 'مطلوب' : '') + '"') + '</td>' +
            '<td>' + cellInput(ei, li, 'debit', l.debit, ' inputmode="decimal" dir="ltr" class="num"') + '</td>' +
            '<td>' + cellInput(ei, li, 'credit', l.credit, ' inputmode="decimal" dir="ltr" class="num"') + '</td>';
          if (li === 0) {
            h += '<td rowspan="' + n + '" class="edesc"><textarea data-e="' + ei + '" data-ef="desc" rows="1" placeholder="بيان القيد">' + esc(e.desc) + '</textarea>' +
              '<label class="mn"><input type="checkbox" data-e="' + ei + '" data-ef="in_manara"' + (e.in_manara ? ' checked' : '') + '> منارة</label>' +
              (e.in_manara ? '<input data-e="' + ei + '" data-ef="manara_no" dir="ltr" placeholder="رقم المنارة" value="' + esc(e.manara_no) + '" class="mno">' : '') + '</td>';
          }
          h += '<td class="ops">' + (n > 2 ? '<button class="sm" data-act="sh-delline" data-id="' + ei + ':' + li + '" title="حذف السطر">−</button>' : '') +
            (li === n - 1 ? '<button class="sm" data-act="sh-addline" data-id="' + ei + '" title="إضافة سطر">+</button>' : '') + '</td></tr>';
        });
        h += '</tbody>';
      });
      h += '</table></div><p class="mut" style="font-size:.82rem">القيود المحفوظة (بالخلفية الخضراء) لا تُعدّل، وتصحيحها بزر «عكس». Enter ينقلك للخلية التالية، وعند آخر سطر في قيد غير متوازن يضيف سطرًا بالفرق تلقائيًا. المسودة (الجديد) تتحفظ تلقائيًا لكل صفحة على هذا المتصفح.</p></div>';
      rootEl.innerHTML = h;
      refreshSheet();
      if (focus) focusCell(focus);
    }
    function focusCell(f) {
      var el = f.ef ? rootEl.querySelector('[data-e="' + f.e + '"][data-ef="' + f.ef + '"]') : rootEl.querySelector('[data-e="' + f.e + '"][data-l="' + f.l + '"][data-f="' + f.f + '"]');
      if (el && !el.disabled) { el.focus(); if (el.select && el.type !== 'date') { try { el.select(); } catch (x) { } } }
      return el;
    }
    function refreshSheet() {
      var st = sheetStats(), s = $('#sh-stats'); if (!s) return;
      s.textContent = st.n + ' قيد · مدين ' + fmt(st.d) + ' · دائن ' + fmt(st.c) + (st.bad ? ' · غير متوازن/ناقص: ' + st.bad : '');
      s.className = 'chip ' + (st.n && !st.bad ? 'g' : (st.bad ? 'w' : ''));
      S.ent.entries.forEach(function (e) { var b = rootEl.querySelector('#eb-' + e.k); if (b) { b.outerHTML = badge(e); } });
    }
    function sheetInput(el) {
      var Sh = S.ent, ei = el.getAttribute('data-e'); if (ei === null) return; var e = Sh.entries[+ei]; if (!e) return;
      var ef = el.getAttribute('data-ef');
      if (ef) { if (ef !== 'in_manara') e[ef] = el.value; saveDraft(); return; }
      var l = e.lines[+el.getAttribute('data-l')], f = el.getAttribute('data-f'); if (!l) return;
      l[f] = el.value;
      if ((f === 'debit' || f === 'credit') && pnum(el.value) > 0) {
        var o = f === 'debit' ? 'credit' : 'debit';
        if (l[o] !== '') { l[o] = ''; var oe = rootEl.querySelector('[data-e="' + ei + '"][data-l="' + el.getAttribute('data-l') + '"][data-f="' + o + '"]'); if (oe) oe.value = ''; }
      }
      if (f === 'debit' || f === 'credit') refreshSheet();
      saveDraft();
    }
    function nextField(a, f, l) {
      var i = ROWF.indexOf(f);
      for (var j = i + 1; j < ROWF.length; j++) {
        var k = ROWF[j];
        if (k === 'party' && (!a || a.party_rule === 'forbidden')) continue;
        if (k === 'project' && (!a || a.project_rule === 'forbidden')) continue;
        if (k === 'cc' && (!a || a.cost_center_rule === 'forbidden')) continue;
        if (k === 'credit' && f === 'debit' && pnum(l.debit) > 0) continue;
        return k;
      }
      return null;
    }
    function addLine(ei) {
      var e = S.ent.entries[ei], t = entryDiff(e), l = blankLine();
      if (t.diff > 0) l.credit = String(t.diff); else if (t.diff < 0) l.debit = String(-t.diff);
      e.lines.push(l); return e.lines.length - 1;
    }
    function cell(ei, li, f) { return rootEl.querySelector('[data-e="' + ei + '"][data-l="' + li + '"][data-f="' + f + '"]'); }
    function updateRowDom(ei, li) {
      var l = S.ent.entries[ei].lines[li], a = resolveAcc(l.acc), m = { acc: ['', 0], party: ['party_rule', 1], project: ['project_rule', 1], cc: ['cost_center_rule', 1] };
      var el = cell(ei, li, 'acc'); if (el) { el.value = l.acc; el.classList.toggle('bad', !!l.acc && !a); }
      [['party', 'party_rule'], ['project', 'project_rule'], ['cc', 'cost_center_rule']].forEach(function (x) {
        var c = cell(ei, li, x[0]); if (!c) return;
        c.disabled = !a || a[x[1]] === 'forbidden'; c.value = l[x[0]]; c.placeholder = a && a[x[1]] === 'required' ? 'مطلوب' : '';
        if (x[0] === 'party') c.setAttribute('list', 'pl_' + (a ? a.party_kind : 'any'));
        c.classList.remove('bad');
      });
      var py = cell(ei, li, 'payee'); if (py) { py.value = l.payee; py.hidden = !(a && a.is_advance_account && !l.party); }
    }
    function sheetKey(ev) {
      var el = ev.target; if (ev.key !== 'Enter' || !el.getAttribute || el.tagName === 'TEXTAREA' || el.getAttribute('data-f') === null) return;
      var Sh = S.ent, ei = +el.getAttribute('data-e'), li = +el.getAttribute('data-l'), f = el.getAttribute('data-f'), e = Sh.entries[ei]; if (!e) return;
      ev.preventDefault();
      if (f === 'acc' && el.value !== (e.lines[li].acc)) { e.lines[li].acc = el.value; }
      var l = e.lines[li], a = resolveAcc(l.acc);
      if (f === 'acc') { canon(l); a = resolveAcc(l.acc); }
      var nf = nextField(a, f, l);
      if (nf) { if (f === 'acc') { saveDraft(); updateRowDom(ei, li); } focusCell({ e: ei, l: li, f: nf }); return; }
      /* نهاية السطر */
      if (li < e.lines.length - 1) return viewEntry({ e: ei, l: li + 1, f: 'acc' });
      var t = entryDiff(e);
      if (t.diff !== 0) { var nl = addLine(ei); saveDraft(); return viewEntry({ e: ei, l: nl, f: 'acc' }); }
      if (ei < Sh.entries.length - 1) return viewEntry({ e: ei + 1, l: 0, f: 'acc' });
      Sh.entries.push(blankEntry(e.date)); saveDraft(); viewEntry({ e: ei + 1, l: 0, f: 'acc' });
    }
    function canon(l) {
      var a = resolveAcc(l.acc);
      if (a) {
        l.acc = a.code + ' ' + a.name;
        if (a.party_rule === 'forbidden') { l.party = ''; l.payee = ''; } else if (l.party && !resolveParty(l.party, a)) l.party = '';
        if (a.project_rule === 'forbidden') l.project = '';
        if (a.cost_center_rule === 'forbidden') l.cc = '';
      } else { l.party = l.project = l.cc = l.payee = ''; }
    }
    function sheetChange(el) {
      var Sh = S.ent;
      if (el.name === 'sheettype') { Sh.type = el.value; return saveDraft(); }
      if (el.getAttribute('data-e') === null) return;
      var ei = +el.getAttribute('data-e'), e = Sh.entries[ei]; if (!e) return;
      var ef = el.getAttribute('data-ef');
      if (ef) { if (ef === 'in_manara') { e.in_manara = el.checked; if (!el.checked) e.manara_no = ''; saveDraft(); return viewEntry({ e: ei, ef: ef }); } e[ef] = el.value; return saveDraft(); }
      var li = +el.getAttribute('data-l'), f = el.getAttribute('data-f'), l = e.lines[li]; if (!l) return;
      if (f === 'acc') { l.acc = el.value; canon(l); saveDraft(); return updateRowDom(ei, li); }
      if (f === 'debit' || f === 'credit') { var n = pnum(el.value); l[f] = n ? String(n) : ''; el.value = l[f]; refreshSheet(); return saveDraft(); }
      l[f] = el.value;
      var a2 = resolveAcc(l.acc), ok = true;
      if (f === 'party') { var p = resolveParty(el.value, a2); ok = !el.value || !!p; if (p) { l.party = p.name; el.value = p.name; } }
      if (f === 'project') { var j = resolveCode(S.projects, el.value); ok = !el.value || !!j; if (j) { l.project = j.code + ' ' + j.name; el.value = l.project; } }
      if (f === 'cc') { var c = resolveCode(S.ccs, el.value); ok = !el.value || !!c; if (c) { l.cc = c.code + ' ' + c.name; el.value = l.cc; } }
      el.classList.toggle('bad', !ok); if (f === 'party') { var py = cell(ei, li, 'payee'); if (py) py.hidden = !(a2 && a2.is_advance_account && !l.party); } saveDraft();
    }
    function validateOne(e) {
      var errs = [], lines = [];
      if (!e.date) errs.push('تاريخ القيد مطلوب');
      if (!String(e.desc).trim()) errs.push('بيان القيد مطلوب');
      if (!e.in_manara && String(e.manara_no).trim()) errs.push('رقم المنارة بدون تأشير «منارة»');
      e.lines.forEach(function (l, i) {
        if (!lineUsed(l)) return;
        var n = 'السطر ' + (i + 1) + ': ', a = resolveAcc(l.acc);
        if (!a) return errs.push(n + 'اختر حسابًا من القائمة');
        var d = pnum(l.debit), c = pnum(l.credit);
        if ((d > 0) === (c > 0)) errs.push(n + 'ادخل مدين أو دائن (واحد فقط)');
        if (Math.round(d * 100) / 100 !== d || Math.round(c * 100) / 100 !== c) errs.push(n + 'المبلغ بحد أقصى خانتين عشريتين');
        var p = l.party ? resolveParty(l.party, a) : null, pj = l.project ? resolveCode(S.projects, l.project) : null, cc = l.cc ? resolveCode(S.ccs, l.cc) : null;
        if (l.party && !p) errs.push(n + 'الطرف غير موجود أو لا يناسب الحساب');
        if (l.project && !pj) errs.push(n + 'المشروع غير موجود');
        if (l.cc && !cc) errs.push(n + 'مركز التكلفة غير موجود');
        if (a.party_rule === 'required' && !p) errs.push(n + 'الحساب ' + a.code + ' يتطلب طرفًا');
        if (a.project_rule === 'required' && !pj) errs.push(n + 'الحساب ' + a.code + ' يتطلب مشروعًا');
        if (a.cost_center_rule === 'required' && !cc) errs.push(n + 'الحساب ' + a.code + ' يتطلب مركز تكلفة');
        if (a.equipment_rule === 'required') errs.push(n + 'الحساب ' + a.code + ' يتطلب معدة (شاشة المعدات لم تُضف بعد)');
        if (a.is_advance_account && !p && !String(l.payee).trim()) errs.push(n + 'الدفعة المقدمة بلا طرف تحتاج اسم المستلم');
        lines.push({ account_id: a.id, debit: d, credit: c, party_id: p ? p.id : null, payee_name: !p && l.payee ? String(l.payee).trim() : null, project_id: pj ? pj.id : null, cost_center_id: cc ? cc.id : null });
      });
      if (lines.length < 2) errs.push('القيد يحتاج سطرين على الأقل');
      var t = entryDiff(e); if (t.diff !== 0) errs.push('القيد غير متوازن: الفرق ' + fmt(t.diff));
      return { errs: errs, lines: lines };
    }
    function saveAll() {
      var Sh = S.ent; if (Sh.busy) return;
      var list = Sh.entries.filter(entryUsed), bad = 0, res = [];
      Sh.entries.forEach(function (e) { e.errs = []; });
      if (!list.length) return toast('مفيش قيود جديدة للحفظ');
      list.forEach(function (e) { var v = validateOne(e); e.errs = v.errs; res.push(v); if (v.errs.length) bad++; });
      if (bad) { viewEntry(); toast('فيه ' + bad + ' قيد محتاج تصحيح. لم يُحفظ شيء.'); var first = rootEl.querySelector('.eerr'); if (first && first.scrollIntoView) first.scrollIntoView({ block: 'center' }); return; }
      Sh.busy = true; Sh.saved = []; Sh.note = ''; viewEntry();
      var i = 0, pageId = S.pg.id, pageNo = S.pg.no, unlinked = [], oldCur = S.cur;
      function ensurePage() {
        if (pageId) return Promise.resolve();
        return Promise.resolve(sb.rpc('create_entry_page', { p_company: S.company.id })).then(function (r) {
          if (r.error) throw r.error; pageId = r.data.page_id; pageNo = r.data.page_no;
        });
      }
      function finish(stopped) {
        Sh.busy = false;
        if (unlinked.length) Sh.note = 'قيود اتحفظت لكن ما اتربطتش بصفحة (تلاقيها في سجل القيود): ' + unlinked.join('، ');
        var movedPage = pageNo && pageNo !== oldCur;
        if (movedPage) { clearDraft(oldCur); S.cur = pageNo; }
        if (!Sh.entries.length) Sh.entries.push(blankEntry());
        saveDraft();
        var p = pageId ? loadPages().then(function () { return loadPageContent(S.cur); }) : Promise.resolve();
        return p.then(function () { viewEntry(); toast(stopped ? 'توقف الحفظ عند قيد فيه خطأ. اللي قبله اتحفظ.' : 'تم حفظ ' + Sh.saved.length + ' قيد في قيد رقم ' + pageNo); },
          function (e) { fail(e); viewEntry(); });
      }
      function next() {
        if (i >= list.length) return finish(false);
        var e = list[i];
        var payload = { company_id: S.company.id, entry_date: e.date, description: String(e.desc).trim(), entry_type: Sh.type, voucher_type: 'journal',
          in_manara: !!e.in_manara, manara_no: e.in_manara ? (String(e.manara_no).trim() || null) : null, lines: res[i].lines };
        return Promise.resolve(sb.rpc('post_entry', { p: payload })).then(function (r) {
          if (r.error) { e.errs = [R.translateDbError(r.error)]; return finish(true); }
          var d = r.data || {}, no = d.fiscal_year + '/' + d.entry_no;
          Sh.saved.push({ no: no, warns: d.warnings || [] });
          Sh.entries = Sh.entries.filter(function (x) { return x.k !== e.k; });
          i++;
          return ensurePage().then(function () { return sb.rpc('add_page_entry', { p_page: pageId, p_entry: d.entry_id }); })
            .then(function (r2) { if (r2 && r2.error) unlinked.push(no); }, function () { unlinked.push(no); })
            .then(next);
        }, function (er) { e.errs = [R.translateDbError(er)]; return finish(true); });
      }
      return next();
    }

    /* ---------- صفحات القيد: التنقل والاسترجاع ---------- */
    function pageNos() { return S.pages.map(function (p) { return p.page_no; }).sort(function (a, b) { return a - b; }); }
    function loadPages() {
      return sb.from('entry_pages').select('id,page_no').eq('company_id', S.company.id).order('page_no').then(function (r) {
        if (r.error) throw r.error; S.pages = r.data || [];
      });
    }
    function emptyPg() { return { id: null, no: null, entries: [], reversed: {} }; }
    function loadPageContent(no) {
      S.pg = emptyPg();
      if (no === null || no === undefined) return Promise.resolve();
      var pg = S.pages.filter(function (x) { return x.page_no === no; })[0];
      if (!pg) { S.cur = null; return Promise.resolve(); }
      S.pg.id = pg.id; S.pg.no = no;
      return sb.from('entry_page_items').select('entry_id,seq').eq('page_id', pg.id).order('seq').then(function (r) {
        if (r.error) throw r.error;
        var items = r.data || []; if (!items.length) return;
        var ids = items.map(function (x) { return x.entry_id; });
        return Promise.all([
          sb.from('journal_entries').select('*').in('id', ids),
          sb.from('v_ledger').select('*').in('entry_id', ids).order('line_no'),
          sb.from('journal_entries').select('reverses_entry_id').in('reverses_entry_id', ids)
        ]).then(function (rs) {
          rs.forEach(function (x) { if (x.error) throw x.error; });
          var em = {}; (rs[0].data || []).forEach(function (e) { e.lines = []; em[e.id] = e; });
          (rs[1].data || []).forEach(function (l) { if (em[l.entry_id]) em[l.entry_id].lines.push(l); });
          (rs[2].data || []).forEach(function (x) { S.pg.reversed[x.reverses_entry_id] = true; });
          S.pg.entries = items.map(function (it) { return em[it.entry_id]; }).filter(function (e) { return e && e.lines.length; });
        });
      });
    }
    function openPage(no, hl) {
      S.cur = (no === undefined ? null : no); S.hl = hl || null; S.err = '';
      S.ent = loadDraft(S.cur) || newSheet();
      return loadPageContent(S.cur).then(function () { S.ent = S.cur === null && S.ent ? S.ent : (S.ent || newSheet()); viewEntry(); scrollHl(); }, function (e) { fail(e); viewEntry(); });
    }
    function scrollHl() {
      if (!S.hl) return;
      var el = rootEl.querySelector('tbody.hl'); if (el && el.scrollIntoView) el.scrollIntoView({ block: 'center' });
      var id = S.hl; setTimeout(function () { if (S.hl === id) { S.hl = null; var x = rootEl.querySelector('tbody.hl'); if (x) x.classList.remove('hl'); } }, 3500);
    }
    function navNo(dir) {
      var ns = pageNos(), cur = S.cur, last = ns.length ? ns[ns.length - 1] : null;
      if (dir === 'first') return ns.length ? ns[0] : null;
      if (dir === 'last') return last;
      if (dir === 'prev') { if (cur === null) return last; var p = ns.filter(function (n) { return n < cur; }); return p.length ? p[p.length - 1] : null; }
      if (dir === 'next') { if (cur === null) return null; var q = ns.filter(function (n) { return n > cur; }); return q.length ? q[0] : 'new'; }
      return null;
    }
    function navTo(dir) { var n = navNo(dir); if (n === null) return; return openPage(n === 'new' ? null : n); }
    function jumpPage(txt) {
      txt = normNum(txt).trim(); if (!txt) return openPage(null);
      var n = parseInt(txt, 10);
      if (!/^\d+$/.test(txt) || !S.pages.some(function (p) { return p.page_no === n; })) { toast('لا توجد صفحة بالرقم ' + txt); var i = $('#pgno'); if (i) i.value = S.cur === null ? '' : S.cur; return; }
      return openPage(n);
    }
    function parseEntryNo(txt) {
      var m = normNum(txt).trim().match(/^(?:(\d{4})[\/\-])?(\d+)$/);
      return m ? { fy: m[1] ? +m[1] : null, no: +m[2] } : null;
    }
    function findEntry(txt) {
      var pe = parseEntryNo(txt); if (!txt.trim()) return;
      if (!pe) return toast('اكتب رقم القيد مثل 37 أو 2026/37');
      var q = sb.from('journal_entries').select('id,fiscal_year,entry_no').eq('company_id', S.company.id).eq('entry_no', pe.no);
      if (pe.fy) q = q.eq('fiscal_year', pe.fy);
      return q.order('fiscal_year', { ascending: false }).limit(1).then(function (r) {
        if (r.error) { fail(r.error); return viewEntry(); }
        var e = (r.data || [])[0]; if (!e) return toast('لا يوجد قيد بهذا الرقم');
        return sb.from('entry_page_items').select('page_id').eq('entry_id', e.id).then(function (r2) {
          var it = (r2.data || [])[0], pg = it && S.pages.filter(function (x) { return x.id === it.page_id; })[0];
          if (pg) return openPage(pg.page_no, e.id);
          regInit(); S.reg.f = blankRegF(); S.reg.f.no = e.fiscal_year + '/' + e.entry_no; S.reg.p = 0;
          toast('القيد ده مش داخل صفحة، فتحته في سجل القيود'); return go('entries');
        });
      });
    }
    function csvCell(v) { v = String(v === null || v === undefined ? '' : v); return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
    function entriesCsv(entries) {
      var rows = [['رقم القيد', 'التاريخ', 'النوع', 'الحساب', 'الطرف', 'المشروع', 'مركز التكلفة', 'مدين', 'دائن', 'البيان', 'رقم المنارة']];
      entries.forEach(function (e) {
        (e.lines || []).forEach(function (l) {
          rows.push([e.fiscal_year + '/' + e.entry_no, e.entry_date, TYPE_AR[e.entry_type] || e.entry_type, l.account_code + ' ' + l.account_name, l.party_name || l.payee_name || '',
            l.project_code || '', l.cost_center_code || '', Number(l.debit) || '', Number(l.credit) || '', e.description, e.manara_no || '']);
        });
      });
      return '﻿' + rows.map(function (r) { return r.map(csvCell).join(','); }).join('\r\n');
    }
    function download(name, text) {
      try {
        var b = new root.Blob([text], { type: 'text/csv;charset=utf-8' }), a = doc.createElement('a');
        a.href = root.URL.createObjectURL(b); a.download = name; doc.body.appendChild(a); a.click();
        setTimeout(function () { try { root.URL.revokeObjectURL(a.href); a.remove(); } catch (e) { } }, 500);
      } catch (e) { toast('تعذّر التنزيل'); }
    }

    /* ---------- سجل القيود (بحث وفلترة) ---------- */
    var PAGE_SZ = 50, ID_CAP = 250;
    function blankRegF() { return { no: '', page: '', from: '', to: '', type: '', text: '', acc: '', party: '', project: '', amount: '' }; }
    function regInit() { if (!S.reg) S.reg = { f: blankRegF(), p: 0, sort: 'desc', rows: [], count: 0, lines: {}, pageOf: {}, reversed: {}, open: {}, note: '' }; }
    function uniq(a) { var m = {}, o = []; a.forEach(function (x) { if (!m[x]) { m[x] = 1; o.push(x); } }); return o; }
    function runRegister() {
      var G = S.reg, f = G.f, cid = S.company.id; G.note = '';
      function empty() { G.rows = []; G.count = 0; G.lines = {}; G.pageOf = {}; G.reversed = {}; }
      var accO = f.acc.trim() ? resolveAcc(f.acc) : null, partyO = f.party.trim() ? S.parties.filter(function (p) { return p.name === f.party.trim(); })[0] : null,
        projO = f.project.trim() ? resolveCode(S.projects, f.project) : null, amt = f.amount.trim() ? pnum(f.amount) : 0;
      if (f.acc.trim() && !accO) { empty(); G.note = 'الحساب غير موجود. اختر من القائمة.'; return Promise.resolve(); }
      if (f.party.trim() && !partyO) { empty(); G.note = 'الطرف غير موجود. اختر من القائمة.'; return Promise.resolve(); }
      if (f.project.trim() && !projO) { empty(); G.note = 'المشروع غير موجود. اختر من القائمة.'; return Promise.resolve(); }
      if (f.amount.trim() && !(amt > 0)) { empty(); G.note = 'المبلغ غير صحيح.'; return Promise.resolve(); }
      var pe = f.no.trim() ? parseEntryNo(f.no) : null;
      if (f.no.trim() && !pe) { empty(); G.note = 'رقم القيد مثل 37 أو 2026/37.'; return Promise.resolve(); }
      var needLines = accO || partyO || projO || amt;
      var pLines = !needLines ? Promise.resolve(null) : (function () {
        var q = sb.from('v_ledger').select('entry_id').eq('company_id', cid);
        if (accO) q = q.eq('account_id', accO.id); if (partyO) q = q.eq('party_id', partyO.id); if (projO) q = q.eq('project_id', projO.id);
        if (amt) q = q.or('debit.eq.' + amt + ',credit.eq.' + amt);
        return q.limit(3000).then(function (r) { if (r.error) throw r.error; return uniq((r.data || []).map(function (x) { return x.entry_id; })); });
      })();
      var pPage = !f.page.trim() ? Promise.resolve(null) : (function () {
        var no = parseInt(normNum(f.page), 10), pg = S.pages.filter(function (x) { return x.page_no === no; })[0];
        if (!pg) return Promise.resolve([]);
        return sb.from('entry_page_items').select('entry_id').eq('page_id', pg.id).then(function (r) { if (r.error) throw r.error; return (r.data || []).map(function (x) { return x.entry_id; }); });
      })();
      return Promise.all([pLines, pPage]).then(function (a) {
        var ids = a[0] && a[1] ? a[0].filter(function (x) { return a[1].indexOf(x) >= 0; }) : (a[0] || a[1]);
        if (ids && !ids.length) return empty();
        if (ids && ids.length > ID_CAP) { ids = ids.slice(0, ID_CAP); G.note = 'النتائج كثيرة جدًا؛ عرضنا أول ' + ID_CAP + ' فقط. ضيّق البحث (تاريخ أو رقم).'; }
        var q = sb.from('journal_entries').select('*', { count: 'exact' }).eq('company_id', cid);
        if (ids) q = q.in('id', ids);
        if (pe) { if (pe.fy) q = q.eq('fiscal_year', pe.fy); q = q.eq('entry_no', pe.no); }
        if (f.from) q = q.gte('entry_date', f.from); if (f.to) q = q.lte('entry_date', f.to);
        if (f.type) q = q.eq('entry_type', f.type);
        if (f.text.trim()) q = q.ilike('description', '%' + f.text.trim().replace(/[%,()*\\]/g, ' ') + '%');
        var asc = G.sort === 'asc';
        q = q.order('fiscal_year', { ascending: asc }).order('entry_no', { ascending: asc }).range(G.p * PAGE_SZ, G.p * PAGE_SZ + PAGE_SZ - 1);
        return q.then(function (r) {
          if (r.error) throw r.error;
          G.rows = r.data || []; G.count = (r.count === null || r.count === undefined) ? G.rows.length : r.count;
          G.lines = {}; G.pageOf = {}; G.reversed = {};
          var eids = G.rows.map(function (x) { return x.id; }); if (!eids.length) return;
          return Promise.all([
            sb.from('v_ledger').select('*').in('entry_id', eids).order('line_no'),
            sb.from('entry_page_items').select('entry_id,page_id').in('entry_id', eids),
            sb.from('journal_entries').select('reverses_entry_id').in('reverses_entry_id', eids)
          ]).then(function (rs) {
            rs.forEach(function (x) { if (x.error) throw x.error; });
            (rs[0].data || []).forEach(function (l) { (G.lines[l.entry_id] = G.lines[l.entry_id] || []).push(l); });
            var pn = {}; S.pages.forEach(function (p) { pn[p.id] = p.page_no; });
            (rs[1].data || []).forEach(function (x) { G.pageOf[x.entry_id] = pn[x.page_id]; });
            (rs[2].data || []).forEach(function (x) { G.reversed[x.reverses_entry_id] = true; });
          });
        });
      });
    }
    function regTotal(id) { var t = 0; (S.reg.lines[id] || []).forEach(function (l) { t += Number(l.debit) || 0; }); return t; }
    function viewEntries() {
      var G = S.reg, f = G.f, pages = Math.max(1, Math.ceil(G.count / PAGE_SZ));
      function inp(n, label, extra) { return '<div><label>' + label + '</label><input name="' + n + '" value="' + esc(f[n]) + '"' + (extra || '') + '></div>'; }
      var h = topbar() + '<div class="wrap wide"><datalist id="acclist">' + accIdx().list.map(function (a) { return '<option value="' + esc(a.code + ' ' + a.name) + '">'; }).join('') + '</datalist>' +
        '<datalist id="pl_any">' + S.parties.map(function (p) { return '<option value="' + esc(p.name) + '">'; }).join('') + '</datalist>' +
        '<datalist id="projlist">' + S.projects.map(function (p) { return '<option value="' + esc(p.code + ' ' + p.name) + '">'; }).join('') + '</datalist>' +
        '<h2>سجل القيود</h2><form data-form="regf" class="card"><div class="g5">' +
        inp('no', 'رقم القيد', ' dir="ltr" placeholder="37 أو 2026/37"') + inp('page', 'رقم صفحة القيد', ' dir="ltr" inputmode="numeric"') +
        '<div><label>من تاريخ</label><input type="date" name="from" value="' + esc(f.from) + '"></div><div><label>إلى تاريخ</label><input type="date" name="to" value="' + esc(f.to) + '"></div>' +
        '<div><label>النوع</label><select name="type"><option value="">الكل</option>' + Object.keys(TYPE_AR).map(function (k) { return '<option value="' + k + '"' + (f.type === k ? ' selected' : '') + '>' + TYPE_AR[k] + '</option>'; }).join('') + '</select></div>' +
        inp('text', 'البيان يحتوي') + inp('acc', 'الحساب', ' list="acclist"') + inp('party', 'الطرف', ' list="pl_any"') + inp('project', 'المشروع', ' list="projlist"') + inp('amount', 'المبلغ (مدين أو دائن)', ' dir="ltr" inputmode="decimal"') +
        '</div><div class="mf" style="justify-content:flex-start;align-items:center"><button class="pri" type="submit">بحث</button><button type="button" data-act="reg-clear">مسح</button>' +
        '<select name="sort" style="width:auto"><option value="desc">الأحدث أولًا</option><option value="asc"' + (G.sort === 'asc' ? ' selected' : '') + '>الأقدم أولًا</option></select>' +
        '<span class="sp"></span><button type="button" data-act="reg-csv"' + (G.rows.length ? '' : ' disabled') + '>تصدير النتائج CSV</button></div></form>';
      if (S.err) h += '<div class="err">' + esc(S.err) + '</div>';
      if (G.note) h += '<div class="errs" style="color:var(--warn);border-color:var(--warn)">' + esc(G.note) + '</div>';
      h += '<p class="mut">' + G.count + ' قيد' + (G.count > PAGE_SZ ? ' · صفحة ' + (G.p + 1) + ' من ' + pages : '') + '</p>';
      h += '<div class="sheetwrap"><table class="reg"><thead><tr><th></th><th>رقم القيد</th><th>التاريخ</th><th>البيان</th><th>النوع</th><th>صفحة القيد</th><th>المبلغ</th><th></th></tr></thead><tbody>';
      if (!G.rows.length) h += '<tr><td colspan="8" class="empty">لا توجد قيود مطابقة.</td></tr>';
      G.rows.forEach(function (e) {
        var open = G.open[e.id], rv = G.reversed[e.id], pg = G.pageOf[e.id];
        h += '<tr class="' + (rv ? 'off' : '') + '"><td class="tg" data-act="eopen" data-id="' + esc(e.id) + '">' + (open ? '▾' : '◂') + '</td><td class="code">' + esc(e.fiscal_year + '/' + e.entry_no) + '</td><td class="code">' + esc(e.entry_date) + '</td>' +
          '<td>' + esc(e.description) + (rv ? '<span class="chip w">معكوس</span>' : '') + (e.in_manara ? '<span class="chip g">منارة' + (e.manara_no ? ' ' + esc(e.manara_no) : '') + '</span>' : '') + '</td>' +
          '<td>' + (e.entry_type !== 'regular' ? '<span class="chip">' + esc(TYPE_AR[e.entry_type] || e.entry_type) + '</span>' : '') + '</td>' +
          '<td>' + (pg ? '<button class="sm" data-act="reg-page" data-id="' + esc(pg) + '" data-e="' + esc(e.id) + '">قيد ' + esc(pg) + '</button>' : '<span class="mut">—</span>') + '</td>' +
          '<td class="num">' + fmt(regTotal(e.id)) + '</td><td>' + (canRev() && e.entry_type !== 'reversal' && !rv ? '<button class="sm" data-act="erev" data-id="' + esc(e.id) + '">عكس</button>' : '') + '</td></tr>';
        if (open) {
          h += '<tr class="subrow"><td colspan="8"><table class="lines"><thead><tr><th>الحساب</th><th>الطرف</th><th>مشروع</th><th>مركز</th><th>مدين</th><th>دائن</th></tr></thead><tbody>' +
            (G.lines[e.id] || []).map(function (l) { return '<tr><td>' + esc(l.account_code + ' ' + l.account_name) + '</td><td>' + esc(l.party_name || l.payee_name || '') + '</td><td>' + esc(l.project_code || '') + '</td><td>' + esc(l.cost_center_code || '') + '</td><td class="num">' + (Number(l.debit) ? fmt(l.debit) : '') + '</td><td class="num">' + (Number(l.credit) ? fmt(l.credit) : '') + '</td></tr>'; }).join('') + '</tbody></table></td></tr>';
        }
      });
      h += '</tbody></table></div>';
      if (G.count > PAGE_SZ) h += '<div class="bar" style="margin-top:.6rem"><button class="sm" data-act="reg-prev"' + (G.p === 0 ? ' disabled' : '') + '>→ السابق</button><span class="mut">صفحة ' + (G.p + 1) + ' من ' + pages + '</span><button class="sm" data-act="reg-next"' + (G.p + 1 >= pages ? ' disabled' : '') + '>التالي ←</button></div>';
      rootEl.innerHTML = h + '</div>';
      if (S.rev) renderRev();
    }
    function readRegF(form) {
      var f = blankRegF(); Object.keys(f).forEach(function (k) { if (form.elements[k]) f[k] = String(form.elements[k].value).trim(); });
      S.reg.f = f; S.reg.sort = form.elements.sort.value;
    }
    function entryById(id) { return S.pg.entries.concat(S.reg ? S.reg.rows : []).filter(function (x) { return x.id === id; })[0]; }
    function renderRev() {
      var e = entryById(S.rev.id); if (!e) { S.rev = null; return; }
      var h = '<div class="modal"><form class="card" data-form="rev"><h2>عكس القيد ' + esc(e.fiscal_year + '/' + e.entry_no) + '</h2>' +
        '<p class="mut">بيتعمل قيد عكسي بنفس الأسطر، والقيد الأصلي يفضل كما هو. القيد العكسي يتسجل في نفس صفحة القيد.</p>' +
        '<label>تاريخ القيد العكسي</label><input type="date" name="date" value="' + esc(S.rev.date) + '"><label>سبب العكس</label><input name="reason" value="' + esc(S.rev.reason) + '">' +
        (S.rev.err ? '<div class="errs"><ul><li>' + esc(S.rev.err) + '</li></ul></div>' : '') +
        '<div class="mf"><button type="button" data-act="revcancel">إلغاء</button><button class="pri" type="submit">عكس القيد</button></div></form></div>';
      var old = $('.modal'); if (old) old.remove(); rootEl.insertAdjacentHTML('beforeend', h);
    }
    function submitRev(form) {
      var date = form.elements.date.value, reason = form.elements.reason.value.trim(), id = S.rev.id;
      S.rev.date = date; S.rev.reason = reason;
      if (!date || !reason) { S.rev.err = 'التاريخ وسبب العكس مطلوبان'; return renderRev(); }
      return Promise.resolve(sb.rpc('reverse_entry', { p_entry: id, p_date: date, p_reason: reason })).then(function (r) {
        if (r.error) { S.rev.err = R.translateDbError(r.error); return renderRev(); }
        var newId = r.data && r.data.entry_id;
        return sb.from('entry_page_items').select('page_id').eq('entry_id', id).then(function (q) {
          var it = (q.data || [])[0];
          return (it && newId) ? sb.rpc('add_page_entry', { p_page: it.page_id, p_entry: newId }) : null;
        }).then(function () { S.rev = null; toast('تم عكس القيد'); return loadView().then(render); },
          function () { S.rev = null; toast('تم العكس (ولم يُربط بالصفحة)'); return loadView().then(render); });
      }, function (e) { S.rev.err = R.translateDbError(e); renderRev(); });
    }

    rootEl.addEventListener('click', onClick);
    rootEl.addEventListener('change', onChange);
    rootEl.addEventListener('submit', onSubmit);
    rootEl.addEventListener('input', onInput);
    rootEl.addEventListener('keydown', function (ev) {
      var el = ev.target;
      if (ev.key === 'Enter' && el.id === 'pgno') { ev.preventDefault(); return jumpPage(el.value); }
      if (ev.key === 'Enter' && el.id === 'entsearch') { ev.preventDefault(); return findEntry(el.value); }
      if (el.closest && el.closest('[data-sheet]')) sheetKey(ev);
    });
    return { start: start, state: S };
  }

  var api = { create: create, esc: esc };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.AccApp = api;

  /* تشغيل تلقائي في المتصفح */
  if (typeof document !== 'undefined' && root.document && root.APP_CONFIG && !root.__NO_AUTOSTART__) {
    var cfg = root.APP_CONFIG, el = document.getElementById('app');
    if (!root.supabase || !cfg || /YOUR-/.test(cfg.SUPABASE_URL + cfg.SUPABASE_ANON_KEY)) {
      el.innerHTML = '<div class="wrap"><div class="card center"><h2>الإعداد ناقص</h2><p>افتح ملف <b>js/config.js</b> وضع رابط المشروع ومفتاح anon (publishable) من Supabase، ثم ارفعه من جديد.</p></div></div>';
    } else {
      var client = root.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
      create(client, el, document).start();
    }
  }
})(typeof window !== 'undefined' ? window : globalThis);
