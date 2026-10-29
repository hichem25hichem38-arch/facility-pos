/* Vendor console for the POS activation service. */
(() => {
  'use strict';

  const API = '/functions/v1/app';
  const TOKEN_KEY = 'pos.vendor.token';
  const DAY = 86_400_000;

  const $ = (id) => document.getElementById(id);
  const state = {
    token: sessionStorage.getItem(TOKEN_KEY) || '',
    items: [],
    stats: null,
    query: '',
    status: '',
    renew: { client: null, days: 30 },
    busy: false,
  };

  const ERROR_TEXT = {
    invalid_credentials: 'مفتاح المورّد غير صحيح.',
    rate_limited: 'محاولات كثيرة. انتظر قليلاً ثم أعد المحاولة.',
    unauthorized: 'انتهت الجلسة. سجّل الدخول من جديد.',
    service_not_configured: 'الخدمة غير مهيأة بعد على الخادم.',
    not_found: 'لم يُعثر على العميل.',
    invalid_input: 'بيانات غير صالحة. تحقق من الحقول.',
    database_unavailable: 'تعذّر الوصول إلى قاعدة البيانات. أعد المحاولة.',
    internal_error: 'خطأ غير متوقع في الخادم.',
  };

  const STATUS_LABEL = {
    active: 'نشط',
    pending: 'بانتظار التفعيل',
    expired: 'منتهي',
    revoked: 'موقوف',
  };

  const EVENT_LABEL = {
    issue_code: 'إصدار كود',
    renew_code: 'كود تجديد',
    activate: 'تفعيل',
    reactivate: 'إعادة تفعيل',
    revoke: 'إيقاف',
    restore: 'استعادة',
  };

  /* ---------- helpers ---------- */

  function toast(message, isError = false) {
    const el = $('toast');
    el.textContent = message;
    el.className = isError ? 'toast error' : 'toast';
    el.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => { el.hidden = true; }, 3200);
  }

  function dateText(value) {
    if (!value) return '—';
    const at = Date.parse(value);
    if (!Number.isFinite(at)) return '—';
    return new Intl.DateTimeFormat('ar-DZ', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(at));
  }

  function daysLabel(count) {
    const n = Math.abs(count);
    if (n === 1) return 'يوم واحد';
    if (n === 2) return 'يومان';
    if (n <= 10) return `${n} أيام`;
    return `${n} يومًا`;
  }

  function relative(value) {
    if (!value) return '—';
    const at = Date.parse(value);
    if (!Number.isFinite(at)) return '—';
    const diff = Date.now() - at;
    if (diff < 60_000) return 'الآن';
    if (diff < 3_600_000) return `قبل ${Math.floor(diff / 60_000)} دقيقة`;
    if (diff < DAY) return `قبل ${Math.floor(diff / 3_600_000)} ساعة`;
    if (diff < 30 * DAY) return `قبل ${Math.floor(diff / DAY)} يوم`;
    return dateText(value);
  }

  function daysLeft(value) {
    if (!value) return null;
    const at = Date.parse(value);
    if (!Number.isFinite(at)) return null;
    return Math.ceil((at - Date.now()) / DAY);
  }

  function initial(name) {
    const clean = String(name || '?').trim();
    return clean ? clean.charAt(0) : '?';
  }

  async function api(action, body = {}, { auth = true } = {}) {
    const headers = { 'content-type': 'application/json' };
    if (auth && state.token) headers['x-vendor-token'] = state.token;
    let response;
    try {
      response = await fetch(`${API}?action=${encodeURIComponent(action)}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(20_000),
      });
    } catch {
      throw new Error('تعذّر الاتصال بالخادم. تحقق من الإنترنت.');
    }
    let data = null;
    try { data = await response.json(); } catch { /* gateway html */ }
    if (!response.ok || !data || data.ok !== true) {
      const code = data && typeof data.error === 'string' ? data.error : 'internal_error';
      if (response.status === 401 && auth) {
        logout(true);
      }
      throw new Error(ERROR_TEXT[code] || (response.status === 404 ? 'العنوان غير صحيح.' : ERROR_TEXT.internal_error));
    }
    return data;
  }

  /* ---------- auth ---------- */

  function showLogin() {
    $('loginView').hidden = false;
    $('dashView').hidden = true;
    $('logoutBtn').hidden = true;
    $('liveDot').hidden = true;
  }

  function showDashboard() {
    $('loginView').hidden = true;
    $('dashView').hidden = false;
    $('logoutBtn').hidden = false;
    $('liveDot').hidden = false;
  }

  function logout(silent = false) {
    state.token = '';
    state.items = [];
    state.stats = null;
    sessionStorage.removeItem(TOKEN_KEY);
    showLogin();
    if (!silent) toast('تم تسجيل الخروج.');
  }

  $('loginForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const key = $('apiKey').value.trim();
    const error = $('loginError');
    error.hidden = true;
    if (key.length < 8) {
      error.textContent = 'أدخل مفتاح المورّد.';
      error.hidden = false;
      return;
    }
    const btn = $('loginBtn');
    btn.disabled = true;
    btn.textContent = 'جارٍ الدخول…';
    try {
      const data = await api('vendor/login', { apiKey: key }, { auth: false });
      if (typeof data.token !== 'string' || data.token.length < 20) throw new Error('استجابة غير صالحة من الخادم.');
      state.token = data.token;
      sessionStorage.setItem(TOKEN_KEY, data.token);
      $('apiKey').value = '';
      showDashboard();
      await load();
    } catch (e) {
      error.textContent = e.message;
      error.hidden = false;
    } finally {
      btn.disabled = false;
      btn.textContent = 'دخول';
    }
  });

  $('logoutBtn').addEventListener('click', () => logout());

  /* ---------- data ---------- */

  async function load() {
    const btn = $('refreshBtn');
    btn.disabled = true;
    try {
      const data = await api('vendor/list', {});
      state.items = Array.isArray(data.items) ? data.items : [];
      state.stats = data.stats || null;
      $('lastRefresh').textContent = `آخر تحديث: ${new Date().toLocaleTimeString('ar-DZ', { hour: '2-digit', minute: '2-digit' })}`;
      render();
    } catch (e) {
      toast(e.message, true);
      if (!state.token) showLogin();
    } finally {
      btn.disabled = false;
    }
  }

  function renderStats() {
    const fallback = { total: 0, active: 0, expiringSoon: 0, expired: 0, pending: 0, revoked: 0 };
    const stats = state.stats || fallback;
    document.querySelectorAll('#stats [data-k]').forEach((el) => {
      const key = el.getAttribute('data-k');
      el.textContent = String(Number(stats[key]) || 0);
    });
  }

  function buildRow(client) {
    const tr = document.createElement('tr');

    const name = document.createElement('td');
    const wrap = document.createElement('div');
    wrap.className = 'cell-client';
    const avatar = document.createElement('span');
    avatar.className = 'avatar';
    avatar.textContent = initial(client.name);
    const info = document.createElement('div');
    const b = document.createElement('b');
    b.textContent = client.name || '—';
    const small = document.createElement('small');
    small.textContent = client.activatedAt ? `فُعّل ${dateText(client.activatedAt)}` : 'لم يُفعّل بعد';
    info.append(b, small);
    wrap.append(avatar, info);
    name.append(wrap);

    const store = document.createElement('td');
    store.textContent = client.storeName || '—';

    const phone = document.createElement('td');
    phone.className = 'mono muted-cell';
    phone.textContent = client.phone || '—';

    const device = document.createElement('td');
    const code = document.createElement('span');
    code.className = 'device mono';
    code.textContent = client.deviceId || '—';
    code.title = client.deviceId || '';
    device.append(code);

    const duration = document.createElement('td');
    duration.className = 'num muted-cell';
    duration.textContent = client.durationDays === 0 ? 'دائم' : daysLabel(client.durationDays);

    const expiry = document.createElement('td');
    const expiryBox = document.createElement('div');
    expiryBox.className = 'two-line num';
    const expiryMain = document.createElement('span');
    if (client.expiresAt) expiryMain.textContent = dateText(client.expiresAt);
    else expiryMain.textContent = client.computed === 'pending' ? '—' : 'دائم';
    expiryBox.append(expiryMain);
    if (client.expiresAt) {
      const left = daysLeft(client.expiresAt);
      const leftEl = document.createElement('small');
      leftEl.textContent = left == null ? '' : left >= 0 ? `متبقٍ ${daysLabel(left)}` : `متأخر ${daysLabel(left)}`;
      expiryBox.append(leftEl);
    }
    expiry.append(expiryBox);

    const seen = document.createElement('td');
    seen.className = 'muted-cell';
    seen.textContent = relative(client.lastSeenAt);

    const version = document.createElement('td');
    version.className = 'muted-cell mono';
    version.textContent = client.appVersion || '—';

    const status = document.createElement('td');
    const pill = document.createElement('span');
    const computed = client.computed;
    const soon = computed === 'active' && client.expiresAt && daysLeft(client.expiresAt) != null && daysLeft(client.expiresAt) <= 7;
    pill.className = `pill ${soon ? 'soon' : computed}`;
    pill.textContent = soon ? 'ينتهي قريبًا' : STATUS_LABEL[computed] || computed;
    status.append(pill);

    const actions = document.createElement('td');
    const bar = document.createElement('div');
    bar.className = 'row-actions';

    const renew = document.createElement('button');
    renew.type = 'button';
    renew.className = 'mini primary';
    renew.textContent = 'تجديد';
    renew.addEventListener('click', () => openRenew(client));
    bar.append(renew);

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = computed === 'revoked' ? 'mini' : 'mini danger';
    toggle.textContent = computed === 'revoked' ? 'استعادة' : 'إيقاف';
    toggle.addEventListener('click', () => toggleClient(client));
    bar.append(toggle);

    const events = document.createElement('button');
    events.type = 'button';
    events.className = 'mini';
    events.textContent = 'سجل';
    events.addEventListener('click', () => openEvents(client));
    bar.append(events);

    actions.append(bar);

    tr.append(name, store, phone, device, duration, expiry, seen, version, status, actions);
    return tr;
  }

  function render() {
    renderStats();
    const query = state.query.trim().toLowerCase();
    const items = state.items.filter((client) => {
      if (state.status && client.computed !== state.status) return false;
      if (!query) return true;
      return [client.name, client.phone, client.storeName, client.deviceId]
        .some((value) => String(value || '').toLowerCase().includes(query));
    });

    const body = $('rows');
    body.textContent = '';
    for (const client of items) body.append(buildRow(client));

    const isEmpty = items.length === 0;
    $('emptyState').hidden = !isEmpty;
    const table = document.querySelector('.table-scroll');
    if (table) table.hidden = isEmpty;
    if (isEmpty) {
      const empty = $('emptyState');
      const paragraph = empty.querySelector('p');
      const note = empty.querySelector('span');
      if (state.items.length > 0) {
        paragraph.textContent = 'لا نتائج مطابقة.';
        note.textContent = 'جرّب تعديل البحث أو التصفية.';
      } else {
        paragraph.textContent = 'لا يوجد عملاء بعد.';
        note.textContent = 'أصدر أول كود من مولّد الترخيص في تطبيق الحاسوب، وسيظهر العميل هنا بعد التفعيل.';
      }
    }
  }

  $('searchInput').addEventListener('input', (event) => {
    state.query = event.target.value;
    render();
  });

  $('statusFilters').addEventListener('click', (event) => {
    const button = event.target.closest('button[data-status]');
    if (!button) return;
    state.status = button.getAttribute('data-status') || '';
    document.querySelectorAll('#statusFilters .chip').forEach((chip) => {
      chip.classList.toggle('active', chip === button);
    });
    render();
  });

  $('refreshBtn').addEventListener('click', load);

  /* ---------- renew ---------- */

  function openRenew(client) {
    state.renew = { client, days: 30 };
    $('modalTitle').textContent = 'تجديد الترخيص';
    $('modalSub').textContent = `${client.name} — ${client.storeName}`;
    $('renewBody').hidden = false;
    $('codePanel').hidden = true;
    $('eventsBody').hidden = true;
    $('renewError').hidden = true;
    $('customDays').value = '';
    document.querySelectorAll('#dayOptions .day').forEach((day) => {
      day.classList.toggle('active', day.getAttribute('data-days') === '30');
    });
    $('modal').hidden = false;
  }

  function openEvents(client) {
    state.renew = { client, days: 30 };
    $('modalTitle').textContent = 'سجل العميل';
    $('modalSub').textContent = `${client.name} — ${client.deviceId}`;
    $('renewBody').hidden = true;
    $('codePanel').hidden = true;
    $('eventsBody').hidden = false;
    $('modal').hidden = false;
    loadEvents(client);
  }

  async function loadEvents(client) {
    const list = $('eventsList');
    list.textContent = '';
    const loading = document.createElement('li');
    loading.textContent = 'جارٍ التحميل…';
    list.append(loading);
    try {
      const data = await api('vendor/events', { clientId: client.id });
      list.textContent = '';
      if (!Array.isArray(data.items) || data.items.length === 0) {
        const empty = document.createElement('li');
        empty.textContent = 'لا يوجد نشاط مسجل.';
        list.append(empty);
        return;
      }
      for (const item of data.items) {
        const li = document.createElement('li');
        const label = document.createElement('b');
        label.textContent = EVENT_LABEL[item.kind] || item.kind || 'نشاط';
        const time = document.createElement('span');
        time.textContent = dateText(item.created_at);
        li.append(label, time);
        if (item.detail) {
          const detail = document.createElement('span');
          detail.textContent = item.detail;
          li.append(detail);
        }
        list.append(li);
      }
    } catch (e) {
      list.textContent = '';
      const failed = document.createElement('li');
      failed.textContent = e.message;
      list.append(failed);
    }
  }

  $('dayOptions').addEventListener('click', (event) => {
    const button = event.target.closest('button[data-days]');
    if (!button) return;
    state.renew.days = Number(button.getAttribute('data-days'));
    $('customDays').value = '';
    document.querySelectorAll('#dayOptions .day').forEach((day) => {
      day.classList.toggle('active', day === button);
    });
  });

  $('customDays').addEventListener('input', (event) => {
    const value = Number(event.target.value);
    if (Number.isInteger(value) && value > 0) {
      state.renew.days = value;
      document.querySelectorAll('#dayOptions .day').forEach((day) => day.classList.remove('active'));
    }
  });

  $('renewBtn').addEventListener('click', async () => {
    const client = state.renew.client;
    if (!client) return;
    const days = state.renew.days;
    if (!Number.isInteger(days) || days < 0 || days > 3650) {
      showRenewError('حدّد مدة صحيحة (0 = دائم، حتى 3650 يوم).');
      return;
    }
    const btn = $('renewBtn');
    btn.disabled = true;
    btn.textContent = 'جارٍ الإصدار…';
    try {
      const data = await api('vendor/renew', { clientId: client.id, durationDays: days });
      $('newCode').textContent = data.code;
      $('copyCode').dataset.code = data.code;
      $('shareCode').href = `https://wa.me/?text=${encodeURIComponent(
        `كود تجديد ترخيص ${client.storeName || 'المحل'}: ${data.code}\nأدخله في شاشة الترخيص داخل التطبيق مع اتصال بالإنترنت.`,
      )}`;
      $('renewBody').hidden = true;
      $('codePanel').hidden = false;
      await load();
    } catch (e) {
      showRenewError(e.message);
    } finally {
      btn.disabled = false;
      btn.textContent = 'إصدار كود تجديد';
    }
  });

  function showRenewError(message) {
    const error = $('renewError');
    error.textContent = message;
    error.hidden = false;
  }

  $('copyCode').addEventListener('click', async () => {
    const code = $('copyCode').dataset.code || '';
    try {
      await navigator.clipboard.writeText(code);
      toast('تم نسخ الكود.');
    } catch {
      const area = document.createElement('textarea');
      area.value = code;
      document.body.append(area);
      area.select();
      document.execCommand('copy');
      area.remove();
      toast('تم نسخ الكود.');
    }
  });

  function closeModal() {
    $('modal').hidden = true;
  }
  $('modalClose').addEventListener('click', closeModal);
  $('doneBtn').addEventListener('click', closeModal);
  $('modal').addEventListener('click', (event) => {
    if (event.target === $('modal')) closeModal();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !$('modal').hidden) closeModal();
  });

  async function toggleClient(client) {
    const revoking = client.computed !== 'revoked';
    if (!window.confirm(revoking
      ? `إيقاف ترخيص «${client.name}»؟ سيتوقف التطبيق عند فحص الترخيص التالي عند الاتصال بالخادم.`
      : `استعادة ترخيص «${client.name}»؟`)) return;
    try {
      await api(revoking ? 'vendor/revoke' : 'vendor/restore', { clientId: client.id });
      toast(revoking ? 'تم إيقاف الترخيص.' : 'تمت استعادة الترخيص.');
      await load();
    } catch (e) {
      toast(e.message, true);
    }
  }

  /* ---------- theme ---------- */

  const themeKey = 'pos.vendor.theme';
  const saved = localStorage.getItem(themeKey);
  if (saved === 'dark' || (!saved && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
    document.documentElement.dataset.theme = 'dark';
  }
  $('themeBtn').addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    localStorage.setItem(themeKey, next);
  });

  /* ---------- boot ---------- */

  if (state.token) {
    showDashboard();
    load();
  } else {
    showLogin();
  }
})();
