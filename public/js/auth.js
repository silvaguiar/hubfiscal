/**
 * SynkFiscal — Frontend Auth Module
 * Gerencia autenticação, proteção do dashboard e info do usuário
 */

const Auth = {
  usuario: null,

  // Inicializa: verifica token e carrega usuário logado
  async init() {
    try {
      const res = await fetch('/api/auth/me', {
        credentials: 'include',
        headers: this._headers()
      });
      if (!res.ok) {
        this._redirectLogin();
        return false;
      }
      this.usuario = await res.json();
      this._renderUserBar();
      this._aplicarPermissoes();
      return true;
    } catch (err) {
      this._redirectLogin();
      return false;
    }
  },

  _redirectLogin() {
    // Evita loop se já estiver na página de login
    if (!window.location.pathname.includes('login')) {
      window.location.replace('/login');
    }
  },

  async logout() {
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'include'
      });
    } catch (_) {}
    localStorage.removeItem('synkfiscal_token');
    localStorage.removeItem('synkfiscal_user');
    this._redirectLogin();
  },

  // Headers com token para chamadas fetch
  _headers(extra = {}) {
    const token = localStorage.getItem('synkfiscal_token');
    return {
      'Content-Type': 'application/json',
      ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
      ...extra
    };
  },

  // Verifica perfil mínimo (hierarquia de roles)
  temPerfil(perfilMinimo) {
    const hierarquia = { master: 4, admin: 3, operador: 2, viewer: 1 };
    const meu = hierarquia[this.usuario?.perfil] || 0;
    const min = hierarquia[perfilMinimo] || 0;
    return meu >= min;
  },

  // Verifica permissão granular por módulo
  // Módulos: notas | agendamentos | empresas | dominio | totvs
  // Níveis:  none | view | create | manage
  // Se o módulo não estiver configurado → assume manage (compat. com usuários antigos)
  temPermissao(modulo, nivel) {
    if (this.usuario?.perfil === 'master') return true;
    const niveis = { none: 0, view: 1, create: 2, manage: 3 };
    const perm = this.usuario?.permissoes || {};
    const userNivel = perm[modulo] !== undefined ? (niveis[perm[modulo]] ?? 0) : niveis.manage;
    return userNivel >= (niveis[nivel] ?? 0);
  },

  // Renderiza barra de usuário no topo
  _renderUserBar() {
    const el = document.getElementById('userInfoBar');
    if (!el || !this.usuario) return;

    const perfilConfig = {
      master:   { label: 'Master',   color: '#f59e0b', grad: 'linear-gradient(135deg,#f59e0b,#d97706)' },
      admin:    { label: 'Admin',    color: '#818cf8', grad: 'linear-gradient(135deg,#6366f1,#4f46e5)' },
      operador: { label: 'Operador', color: '#34d399', grad: 'linear-gradient(135deg,#10b981,#059669)' },
      viewer:   { label: 'Viewer',   color: '#94a3b8', grad: 'linear-gradient(135deg,#64748b,#475569)' }
    };
    const cfg = perfilConfig[this.usuario.perfil] || perfilConfig.viewer;
    const initials = this.usuario.nome.split(' ').filter(Boolean).map(p => p[0]).slice(0, 2).join('').toUpperCase();

    const statusBadge = this.usuario.cliente_status === 'suspenso'
      ? `<span style="background:rgba(245,158,11,.15);border:1px solid rgba(245,158,11,.35);color:#fbbf24;padding:3px 10px;border-radius:6px;font-size:11px;font-weight:700;letter-spacing:.4px;white-space:nowrap">⚠ CONTA SUSPENSA</span>`
      : this.usuario.cliente_status === 'cancelado'
      ? `<span style="background:rgba(239,68,68,.12);border:1px solid rgba(239,68,68,.3);color:#f87171;padding:3px 10px;border-radius:6px;font-size:11px;font-weight:700;letter-spacing:.4px;white-space:nowrap">✕ CONTA CANCELADA</span>`
      : '';

    el.innerHTML = `
      <div style="width:34px;height:34px;border-radius:50%;background:${cfg.grad};display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;color:#fff;flex-shrink:0;box-shadow:0 2px 10px ${cfg.color}55">${initials}</div>
      <div style="display:flex;flex-direction:column;line-height:1.25;margin-right:2px">
        <span style="font-size:13px;color:#e2e8f0;font-weight:500;white-space:nowrap">${this.usuario.nome}</span>
        <span style="font-size:10px;font-weight:700;color:${cfg.color};text-transform:uppercase;letter-spacing:.6px">${cfg.label}</span>
      </div>
      ${statusBadge}
      <div style="width:1px;height:26px;background:rgba(255,255,255,.1);margin:0 2px"></div>
      <button onclick="Auth.logout()" title="Sair"
        style="background:rgba(239,68,68,.1);border:1px solid rgba(239,68,68,.25);cursor:pointer;color:#f87171;padding:5px 12px;display:flex;align-items:center;gap:5px;border-radius:8px;font-size:12px;font-weight:600;white-space:nowrap;transition:all .2s;"
        onmouseover="this.style.background='rgba(239,68,68,.22)';this.style.borderColor='rgba(239,68,68,.5)'"
        onmouseout="this.style.background='rgba(239,68,68,.1)';this.style.borderColor='rgba(239,68,68,.25)'">
        <span class="material-icons-round" style="font-size:15px">logout</span>Sair
      </button>
    `;
  },

  // Aplica permissões na UI: oculta abas e botões conforme configuração do usuário
  _aplicarPermissoes() {
    const isMaster = this.usuario?.perfil === 'master';

    // Aba Usuários e botões exclusivos do master
    const abUsuarios = document.querySelector('[data-page="usuarios"]');
    if (abUsuarios) abUsuarios.style.display = isMaster ? '' : 'none';
    document.querySelectorAll('[data-master-only]').forEach(el => {
      el.style.display = isMaster ? '' : 'none';
    });

    if (isMaster) return; // master sempre vê tudo

    // Oculta abas cujo módulo está com none
    const abas = {
      notas:          document.querySelector('[data-page="notas"]'),
      importador_nfs: document.querySelector('[data-page="importador_nfs"]'),
      agendamentos:   document.querySelector('[data-page="agendamentos"]'),
      config:         document.querySelector('[data-page="config"]'),
      dominio:        document.querySelector('[data-page="dominio"]'),
    };
    if (abas.notas)          abas.notas.style.display          = this.temPermissao('notas', 'view')        ? '' : 'none';
    if (abas.importador_nfs) abas.importador_nfs.style.display = this.temPermissao('totvs', 'view')        ? '' : 'none';
    if (abas.agendamentos)   abas.agendamentos.style.display   = this.temPermissao('agendamentos', 'view') ? '' : 'none';
    if (abas.config)         abas.config.style.display         = this.temPermissao('empresas', 'view')     ? '' : 'none';
    if (abas.dominio)        abas.dominio.style.display        = this.temPermissao('dominio', 'view')      ? '' : 'none';

    // Oculta botões de ação marcados com data-perm="modulo:nivel"
    document.querySelectorAll('[data-perm]').forEach(el => {
      const [mod, niv] = (el.dataset.perm || '').split(':');
      el.style.display = this.temPermissao(mod, niv) ? '' : 'none';
    });
  }
};
