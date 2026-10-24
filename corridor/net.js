/* 局域网客户端：连主机、发自己的位置、收别人的位置
   用法：页面里 <script src="net.js"></script>
   游戏里调用 Net.tick(player) 每帧一次即可                       */
(function(){
  const Net = {
    ws: null, id: 0, role: null, players: [], connected: false,
    _lastSend: 0, _remotes: new Map(),

    connect(name){
      if(this.ws) return;
      const proto = location.protocol === 'https:' ? 'wss://' : 'ws://';
      const url = proto + location.host + '/ws';
      let ws;
      try { ws = new WebSocket(url); } catch(e){ console.warn('联机不可用', e); return; }
      this.ws = ws;
      ws.onopen = () => {
        this.connected = true;
        ws.send(JSON.stringify({ t:'join', name: name || ('玩家'+Math.floor(Math.random()*90+10)) }));
        window.dispatchEvent(new CustomEvent('net:open'));
      };
      ws.onmessage = (ev) => {
        let m; try { m = JSON.parse(ev.data); } catch(e){ return; }
        if(m.t === 'welcome'){ this.id = m.id; this.role = m.role; }
        else if(m.t === 'room'){ this.players = m.players; window.dispatchEvent(new CustomEvent('net:room',{detail:m})); }
        else if(m.t === 'pos'){ this._onPos(m); }
        else if(m.t === 'start'){ window.dispatchEvent(new CustomEvent('net:start',{detail:m})); }
      };
      ws.onclose = () => { this.connected = false; window.dispatchEvent(new CustomEvent('net:close')); };
      ws.onerror = () => {};
    },

    sendPos(x, z, yaw){
      if(!this.connected) return;
      const now = performance.now();
      if(now - this._lastSend < 66) return;     // 15 次/秒
      this._lastSend = now;
      this.ws.send(JSON.stringify({ t:'pos', x:+x.toFixed(2), z:+z.toFixed(2), yaw:+yaw.toFixed(2) }));
    },

    _onPos(m){
      let r = this._remotes.get(m.id);
      if(!r) return;
      r.tx = m.x; r.tz = m.z; r.tyaw = m.yaw;
    },

    // 在场景里为其他玩家建一个简单的替身
    attach(scene, THREE){
      this._scene = scene; this._THREE = THREE;
    },
    _syncAvatars(){
      if(!this._scene || !this._THREE) return;
      const alive = new Set();
      for(const p of this.players){
        if(p.id === this.id) continue;
        alive.add(p.id);
        let r = this._remotes.get(p.id);
        if(!r){
          const g = new this._THREE.Group();
          const body = new this._THREE.Mesh(
            new this._THREE.CapsuleGeometry ? new this._THREE.CapsuleGeometry(0.30, 0.95, 6, 10)
                                           : new this._THREE.CylinderGeometry(0.30, 0.30, 1.5, 10),
            new this._THREE.MeshStandardMaterial({ color: p.role==='ghost' ? 0x9a1f1f : 0x4a6478, roughness:.8 }));
          body.position.y = 0.95; g.add(body);
          this._scene.add(g);
          r = { obj:g, tx:p.x||0, tz:p.z||0, tyaw:0, x:p.x||0, z:p.z||0 };
          this._remotes.set(p.id, r);
        }
        // 平滑插值，避免一跳一跳
        r.x += (r.tx - r.x) * 0.25;
        r.z += (r.tz - r.z) * 0.25;
        r.obj.position.set(r.x, 0, r.z);
        r.obj.rotation.y += ((r.tyaw - r.obj.rotation.y + Math.PI*3) % (Math.PI*2) - Math.PI) * 0.2;
      }
      for(const [id,r] of this._remotes){
        if(!alive.has(id)){ try{ this._scene.remove(r.obj); }catch(e){} this._remotes.delete(id); }
      }
    },

    tick(player){
      if(!this.connected) return;
      this.sendPos(player.x, player.z, player.yaw);
      this._syncAvatars();
    }
  };
  window.Net = Net;
})();
