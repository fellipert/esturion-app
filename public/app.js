(function(){
  const ROOT = document.getElementById('esturion-root');
  const TOKEN_KEY = 'esturion_token';
  let toastTimer = null;

  const ROLE_LABEL = { cliente: 'Cliente', admin: 'Administrador', super_admin: 'Súper administrador' };

  let S = {
    loading: true,
    token: localStorage.getItem(TOKEN_KEY) || null,
    user: null,        // { id, email, role, fullName, phone, photoUrl }
    logoUrl: null,
    authTab: 'login',
    authError: '',
    tab: 'perfil',
    toast: '',
    classes: [],
    allUsers: [],        // todos los roles (para la pestaña Socios)
    paymentAlerts: [],
    paymentStatuses: [], // solo clientes (para pestaña Pagos)
    myPayment: null,
    classAttendance: {}, // classId -> [attendees]
    editingClassId: null,
    newUserRole: 'admin',
    cartera: null,
    showMorosos: false,
    myStats: null,
    myMessages: [],
    sentMessages: [],
    composeScope: 'individual',
    inviteCode: null,
  };

  function isSuper(){ return S.user && S.user.role === 'super_admin'; }
  function isAdminOrAbove(){ return S.user && (S.user.role === 'admin' || S.user.role === 'super_admin'); }

  function todayStr(){ return new Date().toISOString().slice(0,10); }
  function fmtDate(s){
    if(!s) return '—';
    const d = new Date(s+'T00:00:00');
    return d.toLocaleDateString('es-ES',{day:'2-digit',month:'short',year:'numeric'});
  }
  function escapeHtml(s){
    return String(s==null?'':s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }
  function showToast(msg){
    S.toast = msg; render();
    clearTimeout(toastTimer);
    toastTimer = setTimeout(()=>{ S.toast=''; render(); }, 2600);
  }

  async function api(path, opts={}){
    const headers = opts.headers || {};
    if(!(opts.body instanceof FormData)) headers['Content-Type'] = 'application/json';
    if(S.token) headers['Authorization'] = 'Bearer ' + S.token;
    const res = await fetch('/api' + path, { ...opts, headers });
    let data = null;
    try{ data = await res.json(); }catch(e){ data = null; }
    if(!res.ok){
      throw new Error((data && data.error) || 'Ocurrió un error inesperado.');
    }
    return data;
  }

  function resizeToBlob(file, maxDim, cb){
    const reader = new FileReader();
    reader.onload = function(e){
      const img = new Image();
      img.onload = function(){
        let w = img.width, h = img.height;
        if(w > h){ if(w>maxDim){ h = Math.round(h*maxDim/w); w = maxDim; } }
        else { if(h>maxDim){ w = Math.round(w*maxDim/h); h = maxDim; } }
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img,0,0,w,h);
        canvas.toBlob(cb, 'image/jpeg', 0.75);
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  }

  function svgAvatarPlaceholder(){
    return 'data:image/svg+xml;utf8,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="%23E4F1F3"/><circle cx="32" cy="24" r="12" fill="%234FC3C9"/><path d="M8 58c4-14 16-20 24-20s20 6 24 20" fill="%234FC3C9"/></svg>`);
  }

  // ---------- bootstrap ----------
  async function bootstrap(){
    try{
      const settings = await api('/settings/logo');
      S.logoUrl = settings.logoUrl;
    }catch(e){}
    if(S.token){
      try{
        const me = await api('/users/me');
        S.user = me.user;
      }catch(e){
        S.token = null; localStorage.removeItem(TOKEN_KEY);
      }
    }
    S.loading = false;
    if(S.user) await loadDashboardData();
    render();
  }

  async function loadDashboardData(){
    try{
      const c = await api('/classes');
      S.classes = c.classes;
    }catch(e){ S.classes = []; }
    if(isAdminOrAbove()){
      try{ const u = await api('/users'); S.allUsers = u.users; }catch(e){}
      try{ const p = await api('/payments'); S.paymentAlerts = p.alerts; S.paymentStatuses = p.members; }catch(e){}
      try{ S.cartera = await api('/payments/cartera'); }catch(e){}
      try{ const m = await api('/messages/sent'); S.sentMessages = m.messages; }catch(e){}
      if(isSuper()){ try{ const ic = await api('/settings/invite-code'); S.inviteCode = ic.inviteCode; }catch(e){} }
    } else {
      try{ const p = await api('/payments/me'); S.myPayment = p; }catch(e){}
      try{ S.myStats = await api('/classes/attendance-stats/me'); }catch(e){}
    }
    try{ const m = await api('/messages/me'); S.myMessages = m.messages; }catch(e){}
  }

  // ---------- render ----------
  function render(){
    if(S.loading){ ROOT.innerHTML = renderLoading(); return; }
    let html = renderTopbar();
    html += '<div class="es-body">';
    html += S.user ? renderDashboard() : renderAuth();
    html += '</div>';
    if(S.toast) html += `<div class="es-toast">${escapeHtml(S.toast)}</div>`;
    ROOT.innerHTML = html;
    attachHandlers();
  }

  function renderLoading(){
    return `<div style="padding:60px 20px;text-align:center;color:#5b7480;font-family:var(--font-body)">
      <div style="width:34px;height:34px;border:3px solid #cfe7ea;border-top-color:#0E8388;border-radius:50%;margin:0 auto 12px auto;animation:esspin 0.8s linear infinite"></div>
      <style>@keyframes esspin{to{transform:rotate(360deg)}}</style>
      Cargando club Esturión…
    </div>`;
  }

  function renderTopbar(){
    const logoInner = S.logoUrl
      ? `<img src="${S.logoUrl}" alt="Logo Esturión"/>`
      : `<svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="1.6"><path d="M2 14c4-3 7-3 10 0s6 3 10 0" stroke-linecap="round"/><path d="M2 9c4-3 7-3 10 0s6 3 10 0" stroke-linecap="round" opacity="0.5"/></svg>`;
    const canEditLogo = isSuper();
    const sessionHtml = S.user
      ? `<div class="es-session"><span>${escapeHtml(S.user.fullName)} <span style="opacity:0.7">· ${ROLE_LABEL[S.user.role]}</span></span><button id="es-logout-btn">Salir</button></div>`
      : `<div class="es-session es-muted" style="color:rgba(255,255,255,0.8)">Club de natación</div>`;
    return `
    <div class="es-topbar">
      <div class="es-topbar-row">
        <div class="es-brand">
          <div class="es-logo-wrap" id="es-logo-trigger" title="${canEditLogo?'Subir logo del club':'Logo del club'}">${logoInner}</div>
          <div class="es-brand-text">
            <h1>Esturión</h1>
            <span>Club de natación</span>
          </div>
        </div>
        ${sessionHtml}
      </div>
      ${canEditLogo ? '<input type="file" id="es-logo-input" accept="image/*" style="display:none"/>' : ''}
      <div class="es-wave"><svg viewBox="0 0 400 22" preserveAspectRatio="none"><path d="M0 12 Q 25 22 50 12 T 100 12 T 150 12 T 200 12 T 250 12 T 300 12 T 350 12 T 400 12 V22 H0 Z" fill="#F2FAF5"/></svg></div>
    </div>`;
  }

  // ---------- AUTH ----------
  function renderAuth(){
    const isLogin = S.authTab === 'login';
    return `
    <div class="es-auth-wrap">
      <div class="es-card">
        <div class="es-auth-tabs">
          <button data-authtab="login" class="${isLogin?'active':''}">Ingresar</button>
          <button data-authtab="register" class="${!isLogin?'active':''}">Crear cuenta</button>
        </div>
        ${isLogin ? renderLoginForm() : renderRegisterForm()}
        ${S.authError ? `<div class="es-error">${escapeHtml(S.authError)}</div>` : ''}
        ${!isLogin ? '<div class="es-hint">Las cuentas nuevas se crean como Cliente. Las cuentas de administración las asigna el súper administrador desde el panel de Socios.</div>' : ''}
      </div>
    </div>`;
  }
  function renderLoginForm(){
    return `
      <label class="es-label">Correo</label>
      <input class="es-input" type="email" id="es-login-email" placeholder="tu@correo.com"/>
      <label class="es-label">Contraseña</label>
      <input class="es-input" type="password" id="es-login-pass" placeholder="••••••••"/>
      <button class="es-btn" id="es-login-btn" style="margin-top:14px;width:100%">Ingresar</button>
    `;
  }
  function renderRegisterForm(){
    return `
      <label class="es-label">Nombre completo</label>
      <input class="es-input" id="es-reg-name" placeholder="Nombre y apellido"/>
      <label class="es-label">Correo</label>
      <input class="es-input" type="email" id="es-reg-email" placeholder="tu@correo.com"/>
      <label class="es-label">Teléfono</label>
      <input class="es-input" id="es-reg-phone" placeholder="Teléfono de contacto"/>
      <label class="es-label">Contraseña</label>
      <input class="es-input" type="password" id="es-reg-pass" placeholder="Crea una contraseña"/>
      <label class="es-label">Código de invitación</label>
      <input class="es-input" id="es-reg-invite" placeholder="Pídelo a la administración del club"/>
      <button class="es-btn" id="es-reg-btn" style="margin-top:14px;width:100%">Crear mi cuenta</button>
    `;
  }

  // ---------- DASHBOARD ----------
  function renderDashboard(){
    const tabs = isSuper()
      ? [['perfil','Mi perfil'],['clases','Clases'],['asistencia','Asistencia'],['pagos','Pagos y alertas'],['socios','Socios'],['mensajes','Mensajes']]
      : isAdminOrAbove()
        ? [['perfil','Mi perfil'],['clases','Clases'],['asistencia','Asistencia'],['pagos','Pagos y alertas'],['socios','Socios'],['mensajes','Mensajes']]
        : [['perfil','Mi perfil'],['clases','Clases'],['pagos','Mi mensualidad'],['mensajes','Mensajes']];
    let html = `<div class="es-tabs">`;
    tabs.forEach(([key,label])=>{
      html += `<button data-tab="${key}" class="${S.tab===key?'active':''}">${label}</button>`;
    });
    html += `</div>`;

    if(S.tab === 'perfil') html += renderPerfil();
    else if(S.tab === 'clases') html += isSuper() ? renderClasesSuper() : (isAdminOrAbove() ? renderClasesAdminView() : renderClasesCliente());
    else if(S.tab === 'asistencia' && isAdminOrAbove()) html += renderAsistenciaAdmin();
    else if(S.tab === 'pagos') html += isAdminOrAbove() ? renderPagosAdmin() : renderPagosCliente();
    else if(S.tab === 'socios' && isAdminOrAbove()) html += renderSocios();
    else if(S.tab === 'mensajes') html += renderMensajes();
    return html;
  }

  function renderPerfil(){
    const user = S.user;
    const avatar = user.photoUrl || svgAvatarPlaceholder();
    let html = `
    <div class="es-card" style="max-width:480px">
      <div class="es-profile-head">
        <img class="es-avatar" src="${avatar}"/>
        <div>
          <div class="name">${escapeHtml(user.fullName)}</div>
          <div class="role">${ROLE_LABEL[user.role]}</div>
        </div>
      </div>
      <input type="file" id="es-avatar-input" accept="image/*" style="display:none"/>
      <button class="es-btn secondary" id="es-avatar-trigger" style="margin-bottom:14px">Cambiar foto de perfil</button>
      <label class="es-label">Nombre completo</label>
      <input class="es-input" id="es-p-name" value="${escapeHtml(user.fullName)}"/>
      <label class="es-label">Correo</label>
      <input class="es-input" value="${escapeHtml(user.email)}" disabled style="opacity:0.6"/>
      <label class="es-label">Teléfono</label>
      <input class="es-input" id="es-p-phone" value="${escapeHtml(user.phone||'')}"/>`;
    if(user.role === 'cliente'){
      const cl = user.client || {};
      html += `
      <label class="es-label">Contacto de emergencia — nombre</label>
      <input class="es-input" id="es-p-ec-name" value="${escapeHtml(cl.emergencyContactName||'')}"/>
      <label class="es-label">Contacto de emergencia — teléfono</label>
      <input class="es-input" id="es-p-ec-phone" value="${escapeHtml(cl.emergencyContactPhone||'')}"/>`;
    }
    html += `<button class="es-btn" id="es-p-save" style="margin-top:14px">Guardar cambios</button>
    </div>`;
    if(user.role === 'cliente' && S.myStats){
      const st = S.myStats;
      html += `<div class="es-card" style="max-width:480px;margin-top:16px">
        <h2 class="es-h">Mi asistencia</h2>
        <p class="es-sub">Clases reservadas vs. asistencia real, marcada por la administración.</p>
        <div style="display:flex;gap:18px;flex-wrap:wrap;margin-top:8px">
          <div><div style="font-size:20px;font-weight:700">${st.reservadas}</div><div class="meta">Reservadas</div></div>
          <div><div style="font-size:20px;font-weight:700;color:var(--success)">${st.asistencias}</div><div class="meta">Asistencias</div></div>
          <div><div style="font-size:20px;font-weight:700;color:var(--alert)">${st.inasistencias}</div><div class="meta">Inasistencias</div></div>
          <div><div style="font-size:20px;font-weight:700">${st.porcentaje!=null? st.porcentaje+'%':'—'}</div><div class="meta">% asistencia</div></div>
        </div>
      </div>`;
    }
    return html;
  }

  // ----- Clases: super_admin (CRUD completo) -----
  function renderClasesSuper(){
    const classes = S.classes;
    let html = `<div class="es-grid">`;
    html += `<div class="es-card">
      <h2 class="es-h">Crear nueva clase</h2>
      <p class="es-sub">Publica una clase para que los clientes confirmen asistencia.</p>
      <label class="es-label">Título</label>
      <input class="es-input" id="es-c-title" placeholder="Ej. Técnica de crol — nivel 2"/>
      <label class="es-label">Fecha</label>
      <input class="es-input" type="date" id="es-c-date" value="${todayStr()}"/>
      <label class="es-label">Hora</label>
      <input class="es-input" type="time" id="es-c-time" value="18:00"/>
      <label class="es-label">Instructor/a</label>
      <input class="es-input" id="es-c-instructor" placeholder="Nombre del instructor"/>
      <button class="es-btn" id="es-c-create" style="margin-top:14px">Publicar clase</button>
    </div>`;
    html += `<div class="es-card">
      <h2 class="es-h">Clases programadas</h2>
      <p class="es-sub">${classes.length} clase(s) en el calendario.</p>`;
    if(classes.length===0){ html += renderEmpty('Aún no hay clases creadas.'); }
    else{
      classes.forEach(c=>{
        if(S.editingClassId === c.id){
          html += `<div class="es-list-item" style="flex-direction:column;align-items:stretch;gap:8px">
            <input class="es-input" id="es-edit-title-${c.id}" value="${escapeHtml(c.title)}"/>
            <div style="display:flex;gap:8px">
              <input class="es-input" type="date" id="es-edit-date-${c.id}" value="${c.date}"/>
              <input class="es-input" type="time" id="es-edit-time-${c.id}" value="${c.time.slice(0,5)}"/>
            </div>
            <input class="es-input" id="es-edit-instructor-${c.id}" value="${escapeHtml(c.instructor||'')}" placeholder="Instructor/a"/>
            <div style="display:flex;gap:8px">
              <button class="es-btn" data-saveclass="${c.id}">Guardar</button>
              <button class="es-btn secondary" data-canceledit="1">Cancelar</button>
            </div>
          </div>`;
        } else {
          html += `<div class="es-list-item">
            <div><div style="font-weight:700;font-size:13px">${escapeHtml(c.title)}</div>
            <div class="meta">${fmtDate(c.date)} · ${c.time.slice(0,5)} · ${escapeHtml(c.instructor||'Sin instructor')}</div></div>
            <div style="text-align:right">
              <span class="es-badge ok">${c.confirmedCount} confirmado(s)</span><br/>
              <a class="es-link" data-editclass="${c.id}" style="font-size:11.5px">editar</a>
              &nbsp;·&nbsp;
              <a class="es-link" data-delclass="${c.id}" style="font-size:11.5px;color:var(--alert)">eliminar</a>
            </div>
          </div>`;
        }
      });
    }
    html += `</div></div>`;
    return html;
  }

  // ----- Clases: admin (solo lectura) -----
  function renderClasesAdminView(){
    const classes = S.classes;
    let html = `<div class="es-card">
      <h2 class="es-h">Clases programadas</h2>
      <p class="es-sub">${classes.length} clase(s) en el calendario. La creación y edición de clases la gestiona el súper administrador.</p>`;
    if(classes.length===0){ html += renderEmpty('Aún no hay clases creadas.'); }
    else{
      classes.forEach(c=>{
        html += `<div class="es-list-item">
          <div><div style="font-weight:700;font-size:13px">${escapeHtml(c.title)}</div>
          <div class="meta">${fmtDate(c.date)} · ${c.time.slice(0,5)} · ${escapeHtml(c.instructor||'Sin instructor')}</div></div>
          <span class="es-badge ok">${c.confirmedCount} confirmado(s)</span>
        </div>`;
      });
    }
    html += `</div>`;
    return html;
  }

  // ----- Clases: cliente -----
  function renderClasesCliente(){
    const today = todayStr();
    const upcoming = S.classes.filter(c=> c.date >= today).sort((a,b)=> a.date.localeCompare(b.date));
    const past = S.classes.filter(c=> c.date < today).sort((a,b)=> b.date.localeCompare(a.date));
    let html = `<div class="es-card">
      <h2 class="es-h">Próximas clases</h2>
      <p class="es-sub">Confirma tu asistencia para que la administración lleve el registro.</p>`;
    if(upcoming.length===0){ html += renderEmpty('No hay clases próximas programadas todavía.'); }
    else{
      upcoming.forEach(c=>{
        html += `<div class="es-list-item">
          <div><div style="font-weight:700;font-size:13px">${escapeHtml(c.title)}</div>
          <div class="meta">${fmtDate(c.date)} · ${c.time.slice(0,5)} · ${escapeHtml(c.instructor||'Sin instructor')}</div></div>
          <button class="es-btn ${c.confirmedByMe?'secondary':''}" data-confirm="${c.id}">${c.confirmedByMe? '✓ Asistencia confirmada' : 'Confirmar asistencia'}</button>
        </div>`;
      });
    }
    html += `</div>`;
    if(past.length){
      html += `<div class="es-card" style="margin-top:16px">
        <h2 class="es-h">Historial</h2>
        <p class="es-sub">Clases pasadas y tu asistencia confirmada.</p>`;
      past.forEach(c=>{
        html += `<div class="es-list-item">
          <div><div style="font-weight:600;font-size:12.5px">${escapeHtml(c.title)}</div>
          <div class="meta">${fmtDate(c.date)} · ${c.time.slice(0,5)}</div></div>
          <span class="es-badge ${c.confirmedByMe?'ok':'bad'}">${c.confirmedByMe?'Asististe':'No confirmada'}</span>
        </div>`;
      });
      html += `</div>`;
    }
    return html;
  }

  function renderAsistenciaAdmin(){
    const classes = S.classes.slice().sort((a,b)=> b.date.localeCompare(a.date));
    let html = `<div class="es-card">
      <h2 class="es-h">Registro de asistencia por clase</h2>
      <p class="es-sub">Clientes que confirmaron asistencia para cada clase.</p>`;
    if(classes.length===0){ html += renderEmpty('No hay clases creadas todavía.'); }
    classes.forEach(c=>{
      const attendees = S.classAttendance[c.id];
      html += `<div class="es-attendance-block" data-classid="${c.id}" style="border:1px solid var(--border);border-radius:10px;padding:12px;margin-bottom:10px">
        <div class="es-flex-between">
          <div style="font-weight:700;font-size:13px">${escapeHtml(c.title)}</div>
          <span class="meta">${fmtDate(c.date)} · ${c.time.slice(0,5)}</span>
        </div>
        <div class="es-attendance-list" style="margin-top:8px">`;
      if(!attendees){
        html += `<div class="es-muted" style="font-size:12px">Cargando…</div>`;
      } else if(attendees.length===0){
        html += `<div class="es-muted" style="font-size:12px">Nadie ha confirmado aún.</div>`;
      } else {
        html += `<div style="display:flex;flex-direction:column;gap:6px">`;
        attendees.forEach(u=>{
          const state = u.attended === true ? 'asistio' : (u.attended === false ? 'no' : 'sin');
          html += `<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;background:var(--bg-alt);padding:6px 10px;border-radius:10px">
            <div style="display:flex;align-items:center;gap:6px">
              <img class="es-avatar-sm" src="${u.photo_url||svgAvatarPlaceholder()}"/>
              <span style="font-size:12px;font-weight:600">${escapeHtml(u.full_name)}</span>
            </div>
            <div style="display:flex;gap:4px">
              <button class="es-btn ${state==='asistio'?'':'secondary'}" style="padding:4px 9px;font-size:11px" data-markattend="${c.id}|${u.id}|true">Asistió</button>
              <button class="es-btn ${state==='no'?'danger':'secondary'}" style="padding:4px 9px;font-size:11px" data-markattend="${c.id}|${u.id}|false">No asistió</button>
            </div>
          </div>`;
        });
        html += `</div>`;
      }
      html += `</div></div>`;
    });
    html += `</div>`;
    return html;
  }

  function paymentBadgeClass(status){
    if(status==='bad') return 'bad';
    if(status==='warn') return 'warn';
    return 'ok';
  }

  function renderPagosAdmin(){
    const statuses = S.paymentStatuses || [];
    const alerts = S.paymentAlerts || [];
    const cartera = S.cartera;
    let html = '';
    if(alerts.length){
      html += `<div class="es-alertbar">⚠ ${alerts.length} cliente(s) con mensualidad vencida o por vencer.</div>`;
    }
    if(cartera){
      html += `<div class="es-card" style="margin-bottom:16px">
        <h2 class="es-h">Cartera</h2>
        <div style="display:flex;gap:22px;flex-wrap:wrap;margin:10px 0 6px 0">
          <div><div style="font-size:20px;font-weight:700">${cartera.clientesActivos}</div><div class="meta">Clientes activos</div></div>
          <div><div style="font-size:20px;font-weight:700;color:var(--success)">${cartera.alDia}</div><div class="meta">Al día</div></div>
          <div><div style="font-size:20px;font-weight:700;color:var(--warn)">${cartera.pendientes}</div><div class="meta">Pendientes</div></div>
          <div><div style="font-size:20px;font-weight:700;color:var(--alert)">${cartera.morosos}</div><div class="meta">Morosos</div></div>
          <div><div style="font-size:20px;font-weight:700">$${Number(cartera.carteraTotal).toLocaleString('es-CO')}</div><div class="meta">Cartera total</div></div>
        </div>
        <button class="es-btn secondary" id="es-toggle-morosos">${S.showMorosos?'Ocultar morosos':'Ver morosos'}</button>
        ${S.showMorosos ? renderMorososTable(cartera.morososList) : ''}
      </div>`;
    }
    html += `<div class="es-grid">`;
    html += `<div class="es-card">
      <h2 class="es-h">Registrar pago</h2>
      <p class="es-sub">Extiende la vigencia de la mensualidad de un cliente.</p>
      <label class="es-label">Cliente</label>
      <select class="es-input" id="es-pay-user">
        ${statuses.map(u=>`<option value="${u.id}">${escapeHtml(u.fullName)}</option>`).join('')}
      </select>
      <label class="es-label">Meses pagados</label>
      <select class="es-input" id="es-pay-months">
        <option value="1">1 mes</option>
        <option value="2">2 meses</option>
        <option value="3">3 meses</option>
      </select>
      <label class="es-label">Método de pago</label>
      <select class="es-input" id="es-pay-method">
        <option value="transferencia">Transferencia</option>
        <option value="nequi">Nequi</option>
        <option value="efectivo">Efectivo</option>
        <option value="tarjeta">Tarjeta</option>
        <option value="otro">Otro</option>
      </select>
      <label class="es-label">Monto (opcional)</label>
      <input class="es-input" id="es-pay-amount" placeholder="Ej. 180000"/>
      <button class="es-btn" id="es-pay-register" style="margin-top:14px">Registrar pago</button>
    </div>`;
    html += `<div class="es-card">
      <h2 class="es-h">Estado de mensualidades</h2>
      <p class="es-sub">${statuses.length} cliente(s) registrados.</p>`;
    if(statuses.length===0){ html += renderEmpty('Aún no hay clientes registrados.'); }
    else{
      html += `<table class="es-table"><thead><tr><th>Cliente</th><th>Vence</th><th>Estado</th></tr></thead><tbody>`;
      statuses.forEach(s=>{
        html += `<tr><td>${escapeHtml(s.fullName)}</td><td class="meta">${fmtDate(s.dueDate)}</td><td><span class="es-badge ${paymentBadgeClass(s.status)}">${s.label}</span></td></tr>`;
      });
      html += `</tbody></table>`;
    }
    html += `</div></div>`;
    return html;
  }

  function renderMorososTable(list){
    if(!list || list.length===0) return `<div class="es-muted" style="font-size:12px;margin-top:10px">No hay clientes morosos en este momento.</div>`;
    let html = `<table class="es-table" style="margin-top:12px"><thead><tr><th>Cliente</th><th>Vencimiento</th><th>Saldo</th></tr></thead><tbody>`;
    list.forEach(m=>{
      html += `<tr><td>${escapeHtml(m.fullName)}</td><td class="meta">${fmtDate(m.dueDate)}</td><td>$${Number(m.saldo).toLocaleString('es-CO')}</td></tr>`;
    });
    html += `</tbody></table>`;
    return html;
  }

  function renderPagosCliente(){
    const p = S.myPayment;
    const st = p ? p.status : { label:'Sin registro', status:'warn', dueDate:null };
    let html = '';
    if(st.status === 'bad') html += `<div class="es-alertbar">⚠ Tu mensualidad está vencida desde el ${fmtDate(st.dueDate)}. Contacta a la administración para regularizar tu pago.</div>`;
    else if(st.status === 'warn' && st.dueDate) html += `<div class="es-alertbar">⏳ Tu mensualidad vence pronto: ${fmtDate(st.dueDate)}.</div>`;
    html += `<div class="es-card">
      <h2 class="es-h">Mi mensualidad</h2>
      <div style="margin:10px 0 16px 0"><span class="es-badge ${paymentBadgeClass(st.status)}">${st.label}</span> ${st.dueDate? `<span class="meta" style="margin-left:8px">vence ${fmtDate(st.dueDate)}</span>`:''}</div>
      <h2 class="es-h" style="margin-top:18px">Historial de pagos</h2>`;
    const hist = (p && p.history) || [];
    if(hist.length===0){ html += renderEmpty('Todavía no tienes pagos registrados.'); }
    else{
      html += `<table class="es-table"><thead><tr><th>Fecha</th><th>Meses</th><th>Método</th><th>Monto</th></tr></thead><tbody>`;
      hist.forEach(h=>{
        html += `<tr><td>${fmtDate(h.paid_at)}</td><td>${h.months}</td><td>${escapeHtml(h.methodLabel||h.method||'—')}</td><td>${h.amount? escapeHtml(h.amount): '—'}</td></tr>`;
      });
      html += `</tbody></table>`;
    }
    html += `</div>`;
    return html;
  }

  // ----- Socios: admin (lectura) / super_admin (gestión completa) -----
  function renderSocios(){
    const users = S.allUsers;
    let html = '';
    if(isSuper()){
      html += `<div class="es-card" style="margin-bottom:16px">
        <h2 class="es-h">Código de invitación</h2>
        <p class="es-sub">Los nuevos clientes deben ingresarlo para poder crear su cuenta desde "Crear cuenta".</p>
        <div style="display:flex;align-items:center;gap:10px;margin-top:8px">
          <div style="font-family:var(--font-mono);font-size:18px;font-weight:700;background:var(--bg-alt);padding:8px 14px;border-radius:8px;letter-spacing:1px">${escapeHtml(S.inviteCode||'—')}</div>
          <button class="es-btn secondary" id="es-invite-regen">Generar nuevo código</button>
        </div>
        <p class="es-hint" style="margin-top:8px">Al generar uno nuevo, el código anterior deja de funcionar de inmediato — compártelo con quien quieras invitar.</p>
      </div>`;
      html += `<div class="es-card" style="margin-bottom:16px">
        <h2 class="es-h">Crear cuenta de administración</h2>
        <p class="es-sub">Da acceso a un nuevo administrador o súper administrador.</p>
        <div class="es-grid">
          <div>
            <label class="es-label">Nombre completo</label>
            <input class="es-input" id="es-nu-name" placeholder="Nombre y apellido"/>
            <label class="es-label">Correo</label>
            <input class="es-input" type="email" id="es-nu-email" placeholder="correo@ejemplo.com"/>
          </div>
          <div>
            <label class="es-label">Teléfono</label>
            <input class="es-input" id="es-nu-phone" placeholder="Opcional"/>
            <label class="es-label">Contraseña</label>
            <input class="es-input" id="es-nu-pass" placeholder="Contraseña inicial"/>
          </div>
        </div>
        <label class="es-label">Rol</label>
        <select class="es-input" id="es-nu-role">
          <option value="admin">Administrador</option>
          <option value="super_admin">Súper administrador</option>
          <option value="cliente">Cliente</option>
        </select>
        <button class="es-btn" id="es-nu-create" style="margin-top:14px">Crear cuenta</button>
      </div>`;
    }
    html += `<div class="es-card">
      <h2 class="es-h">Todos los usuarios</h2>
      <p class="es-sub">${users.length} cuenta(s) registrada(s) en el club.</p>`;
    users.forEach(u=>{
      const isMe = u.id === S.user.id;
      html += `<div class="es-list-item" style="align-items:flex-start">
        <div style="display:flex;align-items:center;gap:10px">
          <img class="es-avatar-sm" src="${u.photoUrl||svgAvatarPlaceholder()}"/>
          <div><div style="font-weight:700;font-size:13px">${escapeHtml(u.fullName)}${isMe?' <span class="meta">(tú)</span>':''}</div>
          <div class="meta">${escapeHtml(u.email)} · ${escapeHtml(u.phone||'sin teléfono')}</div></div>
        </div>`;
      if(isSuper() && !isMe){
        html += `<div style="text-align:right;display:flex;flex-direction:column;gap:6px;align-items:flex-end">
          <select class="es-input" style="width:auto;padding:5px 8px;font-size:12px" data-roleuser="${u.id}">
            <option value="cliente" ${u.role==='cliente'?'selected':''}>Cliente</option>
            <option value="admin" ${u.role==='admin'?'selected':''}>Administrador</option>
            <option value="super_admin" ${u.role==='super_admin'?'selected':''}>Súper administrador</option>
          </select>
          <div>
            <a class="es-link" data-saverole="${u.id}" style="font-size:11px">guardar rol</a>
            &nbsp;·&nbsp;
            <a class="es-link" data-deluser="${u.id}" style="font-size:11px;color:var(--alert)">eliminar</a>
          </div>
        </div>`;
      } else {
        html += `<span class="es-badge ${u.role==='cliente'?'ok':'warn'}">${ROLE_LABEL[u.role]}</span>`;
      }
      html += `</div>`;
    });
    html += `</div>`;
    return html;
  }

  function renderMensajes(){
    let html = '';
    if(isAdminOrAbove()){
      const clients = S.paymentStatuses && S.paymentStatuses.length ? S.paymentStatuses : (S.allUsers||[]).filter(u=>u.role==='cliente');
      html += `<div class="es-card" style="margin-bottom:16px">
        <h2 class="es-h">Enviar mensaje</h2>
        <p class="es-sub">A un cliente específico, a todos los de una clase, o a todo el club.</p>
        <label class="es-label">Destinatario</label>
        <select class="es-input" id="es-msg-scope">
          <option value="individual" ${S.composeScope==='individual'?'selected':''}>Un cliente</option>
          <option value="clase" ${S.composeScope==='clase'?'selected':''}>Todos los de una clase</option>
          <option value="general" ${S.composeScope==='general'?'selected':''}>Todo el club</option>
        </select>
        ${S.composeScope==='individual' ? `
          <label class="es-label">Cliente</label>
          <select class="es-input" id="es-msg-user">
            ${clients.map(u=>`<option value="${u.id}">${escapeHtml(u.fullName)}</option>`).join('')}
          </select>` : ''}
        ${S.composeScope==='clase' ? `
          <label class="es-label">Clase</label>
          <select class="es-input" id="es-msg-class">
            ${S.classes.map(c=>`<option value="${c.id}">${escapeHtml(c.title)} — ${fmtDate(c.date)}</option>`).join('')}
          </select>` : ''}
        <label class="es-label">Mensaje</label>
        <textarea class="es-input" id="es-msg-body" rows="3" placeholder="Escribe el mensaje..."></textarea>
        <button class="es-btn" id="es-msg-send" style="margin-top:14px">Enviar</button>
      </div>`;
      html += `<div class="es-card">
        <h2 class="es-h">Mensajes enviados</h2>`;
      if(!S.sentMessages || S.sentMessages.length===0){ html += renderEmpty('Todavía no has enviado mensajes.'); }
      else{
        S.sentMessages.forEach(m=>{
          const dest = m.scope==='general' ? 'Todo el club' : (m.scope==='clase' ? `Clase: ${escapeHtml(m.class_title||'')}` : escapeHtml(m.recipient_name||''));
          html += `<div class="es-list-item" style="align-items:flex-start;flex-direction:column;gap:4px">
            <div class="meta">${dest} · ${new Date(m.created_at).toLocaleString('es-ES')}</div>
            <div style="font-size:13px">${escapeHtml(m.body)}</div>
          </div>`;
        });
      }
      html += `</div>`;
    } else {
      html += `<div class="es-card">
        <h2 class="es-h">Mis mensajes</h2>
        <p class="es-sub">Avisos de la administración del club.</p>`;
      if(!S.myMessages || S.myMessages.length===0){ html += renderEmpty('No tienes mensajes todavía.'); }
      else{
        S.myMessages.forEach(m=>{
          html += `<div class="es-list-item" style="align-items:flex-start;flex-direction:column;gap:4px">
            <div class="meta">${escapeHtml(m.sender_name||'Esturión')} · ${new Date(m.created_at).toLocaleString('es-ES')}</div>
            <div style="font-size:13px">${escapeHtml(m.body)}</div>
          </div>`;
        });
      }
      html += `</div>`;
    }
    return html;
  }

  function renderEmpty(msg){
    return `<div class="es-empty"><svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="#7c95a0" stroke-width="1.5"><path d="M2 14c4-3 7-3 10 0s6 3 10 0" stroke-linecap="round"/></svg><div>${escapeHtml(msg)}</div></div>`;
  }

  // ---------- HANDLERS ----------
  function attachHandlers(){
    const logoTrigger = document.getElementById('es-logo-trigger');
    const logoInput = document.getElementById('es-logo-input');
    if(logoTrigger && logoInput){
      logoTrigger.onclick = ()=> logoInput.click();
      logoInput.onchange = (e)=>{
        const f = e.target.files[0];
        if(!f) return;
        resizeToBlob(f, 300, async (blob)=>{
          try{
            const fd = new FormData();
            fd.append('logo', blob, 'logo.jpg');
            const r = await api('/settings/logo', { method:'POST', body: fd });
            S.logoUrl = r.logoUrl;
            showToast('Logo actualizado');
            render();
          }catch(err){ showToast(err.message); }
        });
      };
    }

    const logoutBtn = document.getElementById('es-logout-btn');
    if(logoutBtn) logoutBtn.onclick = ()=>{
      S.user=null; S.token=null; localStorage.removeItem(TOKEN_KEY);
      S.tab='perfil'; S.authTab='login'; render();
    };

    document.querySelectorAll('[data-authtab]').forEach(b=>{
      b.onclick = ()=>{ S.authTab = b.getAttribute('data-authtab'); S.authError=''; render(); };
    });
    document.querySelectorAll('[data-tab]').forEach(b=>{
      b.onclick = ()=>{ S.tab = b.getAttribute('data-tab'); render(); if(S.tab==='asistencia') loadAllAttendance(); };
    });

    const loginBtn = document.getElementById('es-login-btn');
    if(loginBtn) loginBtn.onclick = async ()=>{
      const email = document.getElementById('es-login-email').value.trim();
      const password = document.getElementById('es-login-pass').value;
      try{
        const r = await api('/auth/login', { method:'POST', body: JSON.stringify({ email, password }) });
        S.token = r.token; localStorage.setItem(TOKEN_KEY, r.token);
        S.user = r.user; S.authError=''; S.tab='perfil';
        S.loading = true; render();
        await loadDashboardData();
        S.loading = false; render();
      }catch(err){ S.authError = err.message; render(); }
    };

    const regBtn = document.getElementById('es-reg-btn');
    if(regBtn) regBtn.onclick = async ()=>{
      const fullName = document.getElementById('es-reg-name').value.trim();
      const email = document.getElementById('es-reg-email').value.trim();
      const phone = document.getElementById('es-reg-phone').value.trim();
      const password = document.getElementById('es-reg-pass').value;
      const inviteCode = document.getElementById('es-reg-invite').value.trim();
      try{
        const r = await api('/auth/register', { method:'POST', body: JSON.stringify({ fullName, email, phone, password, inviteCode }) });
        S.token = r.token; localStorage.setItem(TOKEN_KEY, r.token);
        S.user = r.user; S.authError=''; S.tab='perfil';
        S.loading = true; render();
        await loadDashboardData();
        S.loading = false;
        showToast('¡Cuenta creada! Bienvenido/a al club.');
      }catch(err){ S.authError = err.message; render(); }
    };

    const avatarTrigger = document.getElementById('es-avatar-trigger');
    const avatarInput = document.getElementById('es-avatar-input');
    if(avatarTrigger && avatarInput){
      avatarTrigger.onclick = ()=> avatarInput.click();
      avatarInput.onchange = (e)=>{
        const f = e.target.files[0];
        if(!f) return;
        resizeToBlob(f, 260, async (blob)=>{
          try{
            const fd = new FormData();
            fd.append('photo', blob, 'photo.jpg');
            const r = await api('/users/me/photo', { method:'POST', body: fd });
            S.user = r.user;
            showToast('Foto de perfil actualizada');
            render();
          }catch(err){ showToast(err.message); }
        });
      };
    }
    const pSave = document.getElementById('es-p-save');
    if(pSave) pSave.onclick = async ()=>{
      try{
        const body = {
          fullName: document.getElementById('es-p-name').value.trim(),
          phone: document.getElementById('es-p-phone').value.trim(),
        };
        const ecName = document.getElementById('es-p-ec-name');
        const ecPhone = document.getElementById('es-p-ec-phone');
        if(ecName) body.emergencyContactName = ecName.value.trim();
        if(ecPhone) body.emergencyContactPhone = ecPhone.value.trim();
        const r = await api('/users/me', { method:'PUT', body: JSON.stringify(body)});
        S.user = r.user;
        showToast('Perfil guardado'); render();
      }catch(err){ showToast(err.message); }
    };

    const cCreate = document.getElementById('es-c-create');
    if(cCreate) cCreate.onclick = async ()=>{
      const title = document.getElementById('es-c-title').value.trim();
      const date = document.getElementById('es-c-date').value;
      const time = document.getElementById('es-c-time').value;
      const instructor = document.getElementById('es-c-instructor').value.trim();
      if(!title || !date || !time){ showToast('Completa título, fecha y hora.'); return; }
      try{
        await api('/classes', { method:'POST', body: JSON.stringify({ title, date, time, instructor }) });
        const c = await api('/classes'); S.classes = c.classes;
        showToast('Clase publicada'); render();
      }catch(err){ showToast(err.message); }
    };
    document.querySelectorAll('[data-editclass]').forEach(el=>{
      el.onclick = ()=>{ S.editingClassId = el.getAttribute('data-editclass'); render(); };
    });
    document.querySelectorAll('[data-canceledit]').forEach(el=>{
      el.onclick = ()=>{ S.editingClassId = null; render(); };
    });
    document.querySelectorAll('[data-saveclass]').forEach(el=>{
      el.onclick = async ()=>{
        const id = el.getAttribute('data-saveclass');
        try{
          await api('/classes/'+id, { method:'PUT', body: JSON.stringify({
            title: document.getElementById('es-edit-title-'+id).value.trim(),
            date: document.getElementById('es-edit-date-'+id).value,
            time: document.getElementById('es-edit-time-'+id).value,
            instructor: document.getElementById('es-edit-instructor-'+id).value.trim(),
          })});
          S.editingClassId = null;
          const c = await api('/classes'); S.classes = c.classes;
          showToast('Clase actualizada'); render();
        }catch(err){ showToast(err.message); }
      };
    });
    document.querySelectorAll('[data-delclass]').forEach(el=>{
      el.onclick = async ()=>{
        const id = el.getAttribute('data-delclass');
        try{
          await api('/classes/'+id, { method:'DELETE' });
          const c = await api('/classes'); S.classes = c.classes;
          showToast('Clase eliminada'); render();
        }catch(err){ showToast(err.message); }
      };
    });
    document.querySelectorAll('[data-confirm]').forEach(el=>{
      el.onclick = async ()=>{
        const classId = el.getAttribute('data-confirm');
        try{
          const r = await api('/classes/'+classId+'/confirm', { method:'POST' });
          const c = await api('/classes'); S.classes = c.classes;
          showToast(r.confirmed ? 'Asistencia confirmada' : 'Confirmación retirada');
          render();
        }catch(err){ showToast(err.message); }
      };
    });

    const payRegister = document.getElementById('es-pay-register');
    if(payRegister) payRegister.onclick = async ()=>{
      const userId = document.getElementById('es-pay-user').value;
      const months = document.getElementById('es-pay-months').value;
      const method = document.getElementById('es-pay-method').value;
      const amount = document.getElementById('es-pay-amount').value.trim();
      try{
        await api('/payments', { method:'POST', body: JSON.stringify({ userId, months, method, amount: amount || null }) });
        const p = await api('/payments'); S.paymentAlerts = p.alerts; S.paymentStatuses = p.members;
        S.cartera = await api('/payments/cartera');
        showToast('Pago registrado'); render();
      }catch(err){ showToast(err.message); }
    };

    const toggleMorosos = document.getElementById('es-toggle-morosos');
    if(toggleMorosos) toggleMorosos.onclick = ()=>{ S.showMorosos = !S.showMorosos; render(); };

    document.querySelectorAll('[data-markattend]').forEach(el=>{
      el.onclick = async ()=>{
        const [classId, userId, attendedStr] = el.getAttribute('data-markattend').split('|');
        try{
          await api(`/classes/${classId}/attendance/${userId}`, { method:'PUT', body: JSON.stringify({ attended: attendedStr === 'true' }) });
          const r = await api('/classes/'+classId+'/attendance');
          S.classAttendance[classId] = r.attendees;
          showToast('Asistencia actualizada'); render();
        }catch(err){ showToast(err.message); }
      };
    });

    const msgScope = document.getElementById('es-msg-scope');
    if(msgScope) msgScope.onchange = ()=>{ S.composeScope = msgScope.value; render(); };
    const msgSend = document.getElementById('es-msg-send');
    if(msgSend) msgSend.onclick = async ()=>{
      const scope = document.getElementById('es-msg-scope').value;
      const body = document.getElementById('es-msg-body').value.trim();
      if(!body){ showToast('Escribe el mensaje.'); return; }
      const payload = { scope, body };
      if(scope==='individual') payload.recipientUserId = document.getElementById('es-msg-user').value;
      if(scope==='clase') payload.recipientClassId = document.getElementById('es-msg-class').value;
      try{
        await api('/messages', { method:'POST', body: JSON.stringify(payload) });
        const m = await api('/messages/sent'); S.sentMessages = m.messages;
        showToast('Mensaje enviado'); render();
      }catch(err){ showToast(err.message); }
    };

    const inviteRegen = document.getElementById('es-invite-regen');
    if(inviteRegen) inviteRegen.onclick = async ()=>{
      try{
        const r = await api('/settings/invite-code', { method:'POST', body: JSON.stringify({}) });
        S.inviteCode = r.inviteCode;
        showToast('Código regenerado'); render();
      }catch(err){ showToast(err.message); }
    };

    const nuCreate = document.getElementById('es-nu-create');
    if(nuCreate) nuCreate.onclick = async ()=>{
      try{
        await api('/users', { method:'POST', body: JSON.stringify({
          fullName: document.getElementById('es-nu-name').value.trim(),
          email: document.getElementById('es-nu-email').value.trim(),
          phone: document.getElementById('es-nu-phone').value.trim(),
          password: document.getElementById('es-nu-pass').value,
          role: document.getElementById('es-nu-role').value,
        })});
        const u = await api('/users'); S.allUsers = u.users;
        showToast('Cuenta creada'); render();
      }catch(err){ showToast(err.message); }
    };
    document.querySelectorAll('[data-saverole]').forEach(el=>{
      el.onclick = async ()=>{
        const id = el.getAttribute('data-saverole');
        const role = document.querySelector(`[data-roleuser="${id}"]`).value;
        try{
          await api('/users/'+id+'/role', { method:'PUT', body: JSON.stringify({ role }) });
          const u = await api('/users'); S.allUsers = u.users;
          showToast('Rol actualizado'); render();
        }catch(err){ showToast(err.message); }
      };
    });
    document.querySelectorAll('[data-deluser]').forEach(el=>{
      el.onclick = async ()=>{
        const id = el.getAttribute('data-deluser');
        try{
          await api('/users/'+id, { method:'DELETE' });
          const u = await api('/users'); S.allUsers = u.users;
          showToast('Cuenta eliminada'); render();
        }catch(err){ showToast(err.message); }
      };
    });
  }

  async function loadAllAttendance(){
    for(const c of S.classes){
      if(S.classAttendance[c.id]) continue;
      try{
        const r = await api('/classes/'+c.id+'/attendance');
        S.classAttendance[c.id] = r.attendees;
      }catch(e){ S.classAttendance[c.id] = []; }
      render();
    }
  }

  bootstrap();
})();
