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

  // Verifica se o usuário tem o perfil mínimo exigido
  temPerfil(perfilMinimo) {
    const hierarquia = { master: 4, admin: 3, operador: 2, viewer: 1 };
    const meu = hierarquia[this.usuario?.perfil] || 0;
    const min = hierarquia[perfilMinimo] || 0;
    return meu >= min;
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

  // Esconde elementos que o usuário não tem permissão
  _aplicarPermissoes() {
    const isMaster = this.usuario?.perfil === 'master';

    // Aba Usuários: apenas master
    const abUsuarios = document.querySelector('[data-page="usuarios"]');
    if (abUsuarios) abUsuarios.style.display = isMaster ? '' : 'none';

    // Botões de configuração global: apenas master
    document.querySelectorAll('[data-master-only]').forEach(el => {
      el.style.display = isMaster ? '' : 'none';
    });
  }
};
