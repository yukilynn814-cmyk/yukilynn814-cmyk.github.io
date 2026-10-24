/* 房间大厅 UI：1 鬼 + 4 人类，两边分列
   进入方式：?mp=1 打开页面 → 自动弹出大厅
   依赖：net.js（window.Net）                                        */
(function(){
  if (location.search.indexOf('mp=1') < 0) return;

  const STYLE = `
  #lobby{position:fixed;inset:0;z-index:9998;display:flex;flex-direction:column;
    background:radial-gradient(1200px 700px at 50% 20%, #101a22 0%, #070a0d 60%, #040506 100%);
    color:#dfe8f2;font:14px/1.6 system-ui,"Microsoft YaHei",sans-serif}
  #lobby.hide{display:none}
  #lobby h1{margin:0;padding:22px 0 6px;text-align:center;font-size:22px;letter-spacing:3px;color:#e8f3ff}
  #lobby .sub{text-align:center;color:#7f8c99;font-size:12px;margin-bottom:10px}
  #lobby .board{flex:1;display:flex;gap:18px;justify-content:center;align-items:flex-start;padding:10px 24px 0}
  #lobby .side{flex:1;max-width:420px;background:#0d141a;border:1px solid #1e2a34;border-radius:12px;padding:12px}
  #lobby .side.ghost{border-color:#5a1f1f;background:#150c0c}
  #lobby .side h2{margin:0 0 10px;font-size:14px;letter-spacing:2px;text-align:center;color:#9fb3c6}
  #lobby .side.ghost h2{color:#e08a8a}
  #lobby .slot{display:flex;align-items:center;gap:8px;height:52px;margin-bottom:8px;
    background:#101a22;border:1px solid #22303c;border-radius:9px;padding:0 10px}
  #lobby .side.ghost .slot{background:#1a0f0f;border-color:#3a1c1c}
  #lobby .slot .dot{width:8px;height:8px;border-radius:50%;background:#2c3a46}
  #lobby .slot.on .dot{background:#54c98a;box-shadow:0 0 8px #54c98a}
  #lobby .slot .nm{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  #lobby .slot .rdy{font-size:11px;color:#54c98a;min-width:38px;text-align:right}
  #lobby .slot .me{font-size:10px;color:#7fb2ff;border:1px solid #2c4a6e;border-radius:4px;padding:0 4px}
  #lobby .foot{padding:14px 24px 22px;display:flex;justify-content:center;gap:12px;align-items:center}
  #lobby button{background:#1b2a36;color:#cfe3f5;border:1px solid #2c3f4f;border-radius:8px;
    padding:9px 22px;font-size:14px;cursor:pointer}
  #lobby button:hover{background:#243949}
  #lobby button.primary{background:#20503a;border-color:#2f7a56;color:#b9f2d2}
  #lobby button:disabled{opacity:.45;cursor:not-allowed}
  #lobby .hint{color:#6f7d8a;font-size:12px}
  `;

  const st = document.createElement('style'); st.textContent = STYLE; document.head.appendChild(st);

  const el = document.createElement('div');
  el.id = 'lobby'; el.className = 'hide';
  el.innerHTML = `
    <h1>恐 怖 走 廊 · 局 域 网 房 间</h1>
    <div class="sub" id="lbSub">正在连接主机…</div>
    <div class="board">
      <div class="side ghost">
        <h2>鬼 · 1 个位置</h2>
        <div id="lbGhost"></div>
      </div>
      <div class="side">
        <h2>人类 · 4 个位置</h2>
        <div id="lbHumans"></div>
      </div>
    </div>
    <div class="foot">
      <span class="hint" id="lbHint">人不够也可以强行开始</span>
      <button id="lbReady">准 备</button>
      <button id="lbStart" class="primary" disabled>开 始 游 戏</button>
    </div>`;
  document.body.appendChild(el);

  let ready = false;
  const $ = id => document.getElementById(id);

  function slotHTML(p, isGhost, idx){
    if(!p) return `<div class="slot"><span class="dot"></span><span class="nm" style="color:#4d5b68">空位 ${idx+1}</span></div>`;
    const me = (window.Net && p.id === Net.id) ? '<span class="me">你</span>' : '';
    return `<div class="slot on"><span class="dot"></span><span class="nm">${p.name||('玩家'+p.id)}</span>${me}
      <span class="rdy">${p.ready?'已准备':'等待中'}</span></div>`;
  }

  function render(){
    const list = (window.Net && Net.players) || [];
    const ghost = list.filter(p => p.role === 'ghost');
    const humans = list.filter(p => p.role !== 'ghost');
    let gh = '';
    for(let i=0;i<1;i++) gh += slotHTML(ghost[i], true, i);
    let hm = '';
    for(let i=0;i<4;i++) hm += slotHTML(humans[i], false, i);
    $('lbGhost').innerHTML = gh;
    $('lbHumans').innerHTML = hm;
    $('lbSub').textContent = window.Net && Net.connected
      ? `已连接 · 房间 ${list.length} / 5 人`
      : '未连接主机';
    $('lbHint').textContent = list.length >= 2 ? '人不够也可以强行开始' : '至少 2 人才能开始（也可以强行开）';
    const isHost = window.Net && list.length && list[0].id === Net.id;
    $('lbStart').disabled = !(window.Net && Net.connected && isHost);
  }

  window.addEventListener('net:open', () => { el.classList.remove('hide'); render(); });
  window.addEventListener('net:room', render);
  window.addEventListener('net:close', () => { $('lbSub').textContent = '与主机的连接断了'; });

  $('lbReady').onclick = function(){
    ready = !ready;
    this.textContent = ready ? '取 消 准 备' : '准 备';
    this.style.background = ready ? '#20503a' : '';
    try{ Net.ws.send(JSON.stringify({ t:'ready', ready })); }catch(e){}
  };
  $('lbStart').onclick = function(){
    try{ Net.ws.send(JSON.stringify({ t:'start' })); }catch(e){}
    el.classList.add('hide');
  };

  // 开局后收起大厅
  window.addEventListener('net:start', () => el.classList.add('hide'));

  setTimeout(() => { el.classList.remove('hide'); render(); }, 600);
})();
