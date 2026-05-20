/**
 * HubFiscal — Frontend Auth Module
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
    localStorage.removeItem('hubfiscal_token');
    localStorage.removeItem('hubfiscal_user');
    this._redirectLogin();
  },

  // Headers com token para chamadas fetch
  _headers(extra = {}) {
    const token = localStorage.getItem('hubfiscal_token');
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

    const badges = {
      master:   { label: '👑 Master',  bg: '#f59e0b22', color: '#f59e0b' },
      admin:    { label: '👤 Padrão',  bg: '#6366f122', color: '#818cf8' },
      operador: { label: '⚙️ Operador', bg: '#10b98122', color: '#34d399' },
      viewer:   { label: '👁️ Viewer',  bg: '#64748b22', color: '#94a3b8' }
    };
    const badge = badges[this.usuario.perfil] || badges.viewer;

    el.innerHTML = `
      <span style="font-size:13px;color:#94a3b8;margin-right:6px;">${this.usuario.nome}</span>
      <span style="font-size:11px;font-weight:600;padding:2px 9px;border-radius:20px;background:${badge.bg};color:${badge.color};">${badge.label}</span>
      <button onclick="Auth.logout()" title="Sair"
        style="background:none;border:none;cursor:pointer;color:#64748b;padding:6px;display:flex;align-items:center;margin-left:4px;border-radius:8px;transition:all .2s;"
        onmouseover="this.style.background='rgba(255,255,255,.06)'" onmouseout="this.style.background='none'">
        <span class="material-icons-round" style="font-size:18px;">logout</span>
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
