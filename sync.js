/* 学习工具 · 云端同步模块（Supabase）
   用法：<script src="sync.js" data-app="应用名" data-keys="key1,前缀*"></script>
   - 拦截页面对指定 localStorage 键的写入，自动上传到云端
   - 登录后若云端更新，写回本地并刷新页面 */
(function () {
  const SUPABASE_URL = 'https://tqjpvxamsuswhvoeaaqb.supabase.co';
  const SUPABASE_ANON_KEY = 'sb_publishable_6yopqEEB6H6KneKsVMApeA_6QyKf--b';
  if (SUPABASE_URL.indexOf('__') === 0) return; // 未配置时不启用

  const me = document.currentScript;
  const APP = me.dataset.app;
  const PATTERNS = (me.dataset.keys || '').split(',').map(s => s.trim()).filter(Boolean);
  const TS_KEY = '__sync_ts_' + APP;
  const match = k => PATTERNS.some(p => p.endsWith('*') ? k.startsWith(p.slice(0, -1)) : k === p);

  const ls = window.localStorage;
  const rawSet = Storage.prototype.setItem, rawRemove = Storage.prototype.removeItem;
  let applying = false, client = null, user = null, timer = null, busy = false, dirty = false;

  const localTs = () => +(ls.getItem(TS_KEY) || 0);
  const setTs = t => rawSet.call(ls, TS_KEY, String(t));
  function collect() {
    const d = {};
    for (let i = 0; i < ls.length; i++) { const k = ls.key(i); if (match(k)) d[k] = ls.getItem(k); }
    return d;
  }
  function onLocalChange() { if (applying) return; setTs(Date.now()); schedule(); }
  Storage.prototype.setItem = function (k, v) { rawSet.call(this, k, v); if (this === ls && match(k)) onLocalChange(); };
  Storage.prototype.removeItem = function (k) { rawRemove.call(this, k); if (this === ls && match(k)) onLocalChange(); };

  function schedule() { if (!user) return; clearTimeout(timer); timer = setTimeout(push, 1500); }
  async function push() {
    if (!user) return;
    if (busy) { dirty = true; return; }
    busy = true; status('正在同步…');
    const { error } = await client.from('progress').upsert({ user_id: user.id, app: APP, data: collect(), updated_at: new Date(localTs() || Date.now()).toISOString() });
    busy = false;
    status(error ? '同步失败，稍后自动重试' : '已同步');
    if (error) { clearTimeout(timer); timer = setTimeout(push, 10000); }
    if (dirty) { dirty = false; push(); }
  }
  async function pull() {
    if (!user) return;
    const { data, error } = await client.from('progress').select('data,updated_at').eq('user_id', user.id).eq('app', APP).maybeSingle();
    if (error) { status('同步失败，稍后自动重试'); return; }
    const remoteTs = data ? Date.parse(data.updated_at) : 0;
    if (data && remoteTs > localTs()) {
      applying = true;
      Object.keys(collect()).forEach(k => { if (!(k in data.data)) rawRemove.call(ls, k); });
      Object.entries(data.data).forEach(([k, v]) => rawSet.call(ls, k, v));
      setTs(remoteTs); applying = false;
      if (!sessionStorage.getItem('__sync_reload_' + APP)) { sessionStorage.setItem('__sync_reload_' + APP, '1'); location.reload(); return; }
      sessionStorage.removeItem('__sync_reload_' + APP);
      status('已同步');
    } else if (localTs() > remoteTs || !data) { await push(); }
    else status('已同步');
  }

  /* ---------- 界面 ---------- */
  const css = `.sy-btn{position:fixed;right:14px;bottom:14px;z-index:9999;border:1px solid #e0ddd5;background:#fff;color:#2d3142;border-radius:20px;padding:7px 14px;font:13px -apple-system,"PingFang SC",sans-serif;box-shadow:0 2px 10px rgba(0,0,0,.08);cursor:pointer}
  .sy-pan{position:fixed;right:14px;bottom:58px;z-index:9999;width:280px;max-width:calc(100vw - 28px);background:#fff;border:1px solid #e0ddd5;border-radius:14px;padding:14px;font:14px/1.6 -apple-system,"PingFang SC",sans-serif;color:#2d3142;box-shadow:0 6px 24px rgba(0,0,0,.12)}
  .sy-pan input{width:100%;box-sizing:border-box;border:1px solid #d8d5cc;border-radius:9px;padding:8px 10px;font:inherit;margin:8px 0}
  .sy-pan button{border:0;background:#2d3142;color:#fff;border-radius:9px;padding:8px 12px;font:inherit;cursor:pointer;width:100%}
  .sy-pan button.ghost{background:none;color:#7a7f8c;border:1px solid #e0ddd5;margin-top:8px}
  .sy-pan small{color:#7a7f8c;display:block}`;
  const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
  const btn = document.createElement('button'); btn.className = 'sy-btn'; btn.textContent = '☁ 登录同步';
  const pan = document.createElement('div'); pan.className = 'sy-pan'; pan.hidden = true;
  document.body.appendChild(btn); document.body.appendChild(pan);
  btn.onclick = () => { pan.hidden = !pan.hidden; render(); };
  function status(t) { btn.textContent = user ? '☁ ' + t : '☁ 登录同步'; }
  function render(msg) {
    if (user) {
      pan.innerHTML = `<b>已登录</b><small>${user.email}</small><small style="margin-top:6px">学习记录会自动保存到云端。在其他设备上用同一个邮箱登录，就能接着学。</small><button class="ghost" id="sy-out">退出登录</button>`;
      pan.querySelector('#sy-out').onclick = async () => { await client.auth.signOut(); user = null; status(); render(); };
    } else {
      pan.innerHTML = `<b>登录后跨设备同步</b><small>输入邮箱，我们会发一封登录邮件，点里面的链接就登录了，不用设密码。</small>
        <input id="sy-mail" type="email" placeholder="name@example.com" autocomplete="email"><button id="sy-go">发送登录邮件</button><small id="sy-msg" style="margin-top:6px">${msg || ''}</small>`;
      pan.querySelector('#sy-go').onclick = async () => {
        const email = pan.querySelector('#sy-mail').value.trim(), m = pan.querySelector('#sy-msg');
        if (!/^\S+@\S+\.\S+$/.test(email)) { m.textContent = '请输入正确的邮箱'; return; }
        m.textContent = '发送中…';
        const { error } = await client.auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin + location.pathname } });
        m.textContent = error ? '发送失败：' + (/rate/i.test(error.message) ? '发送太频繁，请过几分钟再试' : error.message) : '已发送！请到邮箱里点登录链接（用这台设备打开）。';
      };
    }
  }

  /* ---------- 启动 ---------- */
  function start() {
    client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    client.auth.onAuthStateChange((ev, session) => {
      const was = user && user.id; user = session ? session.user : null;
      if (user && user.id !== was) { status('正在同步…'); pull(); if (!pan.hidden) render(); }
      if (!user) status();
    });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') pull(); });
  }
  if (window.supabase && window.supabase.createClient) start();
  else {
    const s = document.createElement('script');
    s.src = 'supabase.js';
    s.onload = start; s.onerror = () => { btn.textContent = '☁ 同步暂不可用'; };
    document.head.appendChild(s);
  }
})();
