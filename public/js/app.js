const app = {
  currentPage: 'dashboard',
  currentPagina: 1,

  // ── Initialization ────────────────────────────────
  async init() {
    // Verifica autenticação antes de qualquer coisa
    const ok = await Auth.init();
    if (!ok) return;

    this.setupNavigation();
    this.setupCertUpload();
    this.loadConfig();
    this.loadDashboard();
    this.loadEmpresas(); // Preenche os selects (filtros) das outras telas
    const menuToggle = document.getElementById('menuToggle');
    if (menuToggle) {
      menuToggle.addEventListener('click', () => {
        document.getElementById('sidebar').classList.toggle('open');
      });
    }

    document.querySelectorAll('.modal-overlay').forEach(overlay => {
      overlay.addEventListener('click', (event) => {
        if (event.target === overlay) {
          overlay.classList.remove('active');
        }
      });
    });

    document.addEventListener('keyup', (event) => {
      if (event.key === 'Escape') {
        document.querySelectorAll('.modal-overlay.active').forEach(modal => modal.classList.remove('active'));
      }
    });
  },

  setupNavigation() {
    document.querySelectorAll('.nav-item').forEach(item => {
      item.addEventListener('click', (e) => {
        e.preventDefault();
        const page = item.dataset.page;
        this.navigateTo(page);
        document.getElementById('sidebar').classList.remove('open');
      });
    });
  },

  navigateTo(page) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    document.getElementById(`page-${page}`).classList.add('active');
    document.querySelector(`[data-page="${page}"]`).classList.add('active');
    this.currentPage = page;
    if (page === 'dashboard')    this.loadDashboard();
    if (page === 'notas')        this.loadNotas();
    if (page === 'config')       this.loadEmpresas();
    if (page === 'dominio')      this.loadDominioPage();
    if (page === 'agendamentos') this.carregarAgendamentos();
    if (page === 'usuarios')     this.carregarUsuarios();
  },

  // ── Config ────────────────────────────────────────
  async loadConfig() {
    try {
      const res = await fetch('/api/config');
      const config = await res.json();
      if (config && config.cnpj) {
        if (document.getElementById('cfgCnpj')) {
          document.getElementById('cfgCnpj').value = this.formatCnpj(config.cnpj);
          document.getElementById('cfgRazaoSocial').value = config.razao_social || '';
          document.getElementById('cfgUf').value = config.uf || 'SP';
          document.getElementById('cfgAmbiente').value = config.ambiente || 'producao';
        }
        if (config.certificado_nome && document.getElementById('certFileName')) {
          document.getElementById('certFileName').textContent = config.certificado_nome;
        }
        this.updateStatus(true);
        this.updateEnvBadge(config.ambiente);
      }
    } catch (err) { console.error(err); }
  },

  async saveConfig() {
    const cnpj = document.getElementById('cfgCnpj').value;
    const razao_social = document.getElementById('cfgRazaoSocial').value;
    const uf = document.getElementById('cfgUf').value;
    const ambiente = document.getElementById('cfgAmbiente').value;
    const certificado_senha = document.getElementById('cfgSenhaCert').value;

    if (!cnpj) return this.toast('CNPJ é obrigatório', 'error');

    try {
      const res = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cnpj, razao_social, uf, ambiente, certificado_senha })
      });
      const data = await res.json();
      if (data.success) {
        this.toast('Configurações salvas!', 'success');
        this.updateStatus(true);
        this.updateEnvBadge(ambiente);
      } else {
        this.toast(data.error, 'error');
      }
    } catch (err) { this.toast('Erro ao salvar', 'error'); }
  },

  setupCertUpload() {
    const input = document.getElementById('certFileInput');
    if (!input) return;
    input.addEventListener('change', async () => {
      if (!input.files.length) return;
      const formData = new FormData();
      formData.append('certificado', input.files[0]);
      try {
        const res = await fetch('/api/config/certificado', { method: 'POST', body: formData });
        const data = await res.json();
        if (data.success) {
          const fileNameEl = document.getElementById('certFileName');
          if (fileNameEl) fileNameEl.textContent = data.filename;
          this.toast('Certificado enviado!', 'success');
        } else {
          this.toast(data.error, 'error');
        }
      } catch (err) { this.toast('Erro no upload', 'error'); }
    });
  },

  // ── Dashboard ─────────────────────────────────────
  async loadDashboard() {
    try {
      const res = await fetch('/api/estatisticas');
      const stats = await res.json();
      document.getElementById('statTotal').textContent = stats.total;
      document.getElementById('statEntradas').textContent = stats.entradas.count;
      document.getElementById('statEntradasValor').textContent = this.formatCurrency(stats.entradas.valor);
      document.getElementById('statSaidas').textContent = stats.saidas.count;
      document.getElementById('statSaidasValor').textContent = this.formatCurrency(stats.saidas.valor);
      document.getElementById('statSync').textContent = stats.ultimaImportacao
        ? this.formatDate(stats.ultimaImportacao) : '—';

      const notasRes = await fetch('/api/notas?limite=10');
      const notasData = await notasRes.json();
      this.renderDashboardTable(notasData.notas);
    } catch (err) { console.error(err); }
  },

  renderDashboardTable(notas) {
    const tbody = document.getElementById('dashboardTableBody');
    if (!notas.length) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--text-muted);padding:40px">Nenhuma nota importada ainda</td></tr>';
      return;
    }
    tbody.innerHTML = notas.map(n => `
      <tr>
        <td><strong>${n.numero_nf || '—'}</strong></td>
        <td>${this.formatDate(n.data_emissao)}</td>
        <td>${this.truncate(n.emitente_nome, 30)}</td>
        <td>${this.truncate(n.destinatario_nome, 30)}</td>
        <td><strong>${this.formatCurrency(n.valor_total)}</strong></td>
        <td><span class="badge badge-${n.tipo}">${n.tipo}</span></td>
      </tr>
    `).join('');
  },

  // ── Notas ─────────────────────────────────────────
  async loadNotas(pagina = 1) {
    this.currentPagina = pagina;
    const tipo = document.getElementById('filterTipo').value;
    const busca = document.getElementById('filterBusca').value;
    const dataInicio = document.getElementById('filterDataInicio').value;
    const dataFim = document.getElementById('filterDataFim').value;

    const params = new URLSearchParams({ tipo, busca, dataInicio, dataFim, pagina, limite: 50 });

    try {
      const res = await fetch(`/api/notas?${params}`);
      const data = await res.json();
      this.renderNotasTable(data.notas);
      this.renderPagination(data);
    } catch (err) { this.toast('Erro ao carregar notas', 'error'); }
  },

  renderNotasTable(notas) {
    const tbody = document.getElementById('notasTableBody');
    if (!notas.length) {
      tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;color:var(--text-muted);padding:40px">Nenhuma nota encontrada</td></tr>';
      return;
    }
    tbody.innerHTML = notas.map(n => {
      const ds = n.dominio_status || 'pendente';
      const domBadgeClass = ds === 'enviado' ? 'dom-enviado' : ds === 'erro' ? 'dom-erro' : ds === 'enviando' ? 'dom-enviando' : 'dom-pendente';
      const domLabel = ds === 'enviado' ? '✓ Enviado' : ds === 'erro' ? '✕ Erro' : ds === 'enviando' ? '⏳ Enviando' : '● Pendente';
      const domTooltip = ds === 'erro' && n.dominio_erro ? ` title="${n.dominio_erro}"` : ds === 'enviado' && n.dominio_enviado_em ? ` title="Enviado em ${this.formatDate(n.dominio_enviado_em)}"` : '';
      return `
      <tr>
        <td><strong>${n.numero_nf || '—'}</strong></td>
        <td>${this.formatDate(n.data_emissao)}</td>
        <td class="chave-cell" title="${n.chave_acesso}">${n.chave_acesso}</td>
        <td>${this.truncate(n.emitente_nome, 25)}<br><small style="color:var(--text-muted)">${this.formatCnpj(n.emitente_cnpj)}</small></td>
        <td>${this.truncate(n.destinatario_nome, 25)}<br><small style="color:var(--text-muted)">${this.formatCnpj(n.destinatario_cnpj)}</small></td>
        <td><strong>${this.formatCurrency(n.valor_total)}</strong></td>
        <td><span class="badge badge-${n.tipo}">${n.tipo}</span></td>
        <td><span class="badge ${domBadgeClass}"${domTooltip}>${domLabel}</span></td>
        <td>
          <button class="action-btn" title="Ver XML" onclick="app.viewXml(${n.id})">
            <span class="material-icons-round" style="font-size:16px">code</span>
          </button>
          <button class="action-btn" title="Download XML" onclick="app.downloadXml(${n.id})">
            <span class="material-icons-round" style="font-size:16px">download</span>
          </button>
          ${ds !== 'enviado' ? `<button class="action-btn" title="Enviar ao Domínio" onclick="app.enviarNotaDominio(${n.id})"><span class="material-icons-round" style="font-size:16px">cloud_upload</span></button>` : ''}
        </td>
      </tr>`;
    }).join('');
  },

  renderPagination(data) {
    const container = document.getElementById('pagination');
    if (data.totalPaginas <= 1) { container.innerHTML = ''; return; }
    let html = `<button ${data.pagina <= 1 ? 'disabled' : ''} onclick="app.loadNotas(${data.pagina - 1})">← Anterior</button>`;
    const start = Math.max(1, data.pagina - 2);
    const end = Math.min(data.totalPaginas, data.pagina + 2);
    for (let i = start; i <= end; i++) {
      html += `<button class="${i === data.pagina ? 'active' : ''}" onclick="app.loadNotas(${i})">${i}</button>`;
    }
    html += `<button ${data.pagina >= data.totalPaginas ? 'disabled' : ''} onclick="app.loadNotas(${data.pagina + 1})">Próxima →</button>`;
    container.innerHTML = html;
  },

  // ── XML Viewer ────────────────────────────────────
  async viewXml(id) {
    try {
      const res = await fetch(`/api/notas/${id}`);
      const nota = await res.json();
      document.getElementById('xmlViewer').textContent = this.formatXml(nota.xml_completo || 'XML não disponível');
      document.getElementById('btnDownloadXml').onclick = () => this.downloadXml(id);
      document.getElementById('xmlModal').classList.add('active');
    } catch (err) { this.toast('Erro ao carregar XML', 'error'); }
  },

  downloadXml(id) {
    window.open(`/api/notas/${id}/xml`, '_blank');
  },

  closeModal() {
    document.getElementById('xmlModal').classList.remove('active');
  },

  // ── SEFAZ Sync ────────────────────────────────────
  async sincronizar() {
    const btn = document.getElementById('btnSincronizar');
    const status = document.getElementById('syncStatus');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Sincronizando...';
    status.classList.add('visible');
    status.textContent = '⏳ Conectando à SEFAZ...';

    try {
      const res = await fetch('/api/sefaz/sincronizar', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        status.textContent = `✅ ${data.documentosEncontrados} documento(s) encontrado(s), ${data.documentosSalvos} salvo(s). NSU: ${data.ultimoNSU}`;
        this.toast(`${data.documentosSalvos} nota(s) importada(s)!`, 'success');
        this.loadDashboard();
      } else {
        status.textContent = `❌ ${data.error}`;
        this.toast(data.error, 'error');
      }
    } catch (err) {
      status.textContent = `❌ Erro: ${err.message}`;
      this.toast('Erro na sincronização', 'error');
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<span class="material-icons-round">sync</span> Sincronizar com SEFAZ';
    }
  },

  async consultarChave() {
    const chave = document.getElementById('inputChaveNFe').value.replace(/\D/g, '');
    if (chave.length !== 44) return this.toast('Chave deve ter 44 dígitos', 'error');

    try {
      const res = await fetch('/api/sefaz/consultar-chave', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chave })
      });
      const data = await res.json();
      if (data.success) {
        this.toast('NF-e encontrada e importada!', 'success');
        document.getElementById('inputChaveNFe').value = '';
      } else {
        this.toast(data.motivo || data.error || 'NF-e não encontrada', 'error');
      }
    } catch (err) { this.toast('Erro na consulta', 'error'); }
  },

  async importarXml() {
    const xml = document.getElementById('inputXmlManual').value.trim();
    if (!xml) return this.toast('Cole o XML primeiro', 'error');

    try {
      const res = await fetch('/api/importar-xml', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ xml_content: xml })
      });
      const data = await res.json();
      if (data.success) {
        this.toast('NF-e importada com sucesso!', 'success');
        document.getElementById('inputXmlManual').value = '';
      } else {
        this.toast(data.error, 'error');
      }
    } catch (err) { this.toast('Erro ao importar', 'error'); }
  },

  // ── Importador Unificado (HUB) ──────────────────────
  async sincronizarHub() {
    const empresaId = document.getElementById('syncEmpresaHub').value;
    const btn = document.querySelector('#page-importador_nfs .hub-card:nth-child(1) button');
    const status = document.getElementById('syncStatusHub');
    
    if (!empresaId) return this.toast('Selecione uma empresa', 'error');

    btn.disabled = true;
    btn.innerHTML = '<span class="spinner" style="display:inline-block;width:14px;height:14px;border:2px solid #fff;border-radius:50%;border-top-color:transparent;animation:spin 1s linear infinite;margin-right:8px;"></span> Sincronizando...';
    status.style.display = 'block';
    status.className = 'import-status';
    status.textContent = '⏳ Conectando à SEFAZ...';

    try {
      const res = await fetch('/api/sefaz/sincronizar', { 
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ empresa_id: empresaId })
      });
      const data = await res.json();
      
      if (data.success) {
        status.textContent = `✅ ${data.documentosEncontrados} documento(s) encontrado(s), ${data.documentosSalvos} salvo(s). NSU: ${data.ultimoNSU}`;
        status.className = 'import-status success';
        this.toast(`${data.documentosSalvos} nota(s) importada(s)!`, 'success');
        this.loadDashboard();
      } else {
        status.textContent = `❌ ${data.error}`;
        status.className = 'import-status error';
        this.toast(data.error, 'error');
      }
    } catch (err) {
      status.textContent = `❌ Erro: ${err.message}`;
      status.className = 'import-status error';
      this.toast('Erro na sincronização', 'error');
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<span class="material-icons-round">sync</span> Sincronizar Entradas';
    }
  },

  async dispararTotvsHub() {
    const empresaId = document.getElementById('totvsEmpresaHub').value;
    const mes = document.getElementById('totvsMesHub').value; // Formato YYYY-MM
    const log = document.getElementById('totvsLogHub');
    const btn = document.querySelector('#page-importador_nfs .hub-card:nth-child(2) button');

    if (!empresaId) return this.toast('Selecione uma empresa', 'error');
    if (!mes) return this.toast('Selecione o mês de referência', 'error');

    btn.disabled = true;
    btn.innerHTML = '<span class="spinner" style="display:inline-block;width:14px;height:14px;border:2px solid #fff;border-radius:50%;border-top-color:transparent;animation:spin 1s linear infinite;margin-right:8px;"></span> Disparando...';
    
    log.style.display = 'block';
    log.innerHTML = '<div>Iniciando robô TOTVS...</div>';

    try {
      const res = await fetch('/api/totvs/extrair', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ empresaId, mesReferencia: mes })
      });
      const data = await res.json();

      if (data.success) {
        log.innerHTML += `<div>${data.message}</div>`;
        this.toast('Extração iniciada!', 'info');
        
        let attempts = 0;
        const interval = setInterval(async () => {
          try {
            attempts++;
            const logRes = await fetch('/api/totvs/logs');
            const logText = await logRes.text();
            if (logText) {
              const lines = logText.split('\n').filter(l => l.trim() !== '');
              const lastLines = lines.slice(-15);
              log.innerHTML = lastLines.map(l => `<div>${l}</div>`).join('');
              
              // Se encontrar a mensagem de Fim ou Erro, ou passar de 20 min (400 attempts * 3s = 1200s), para
              if (logText.includes('🏁 Fim:') || logText.includes('❌ Erro:') || attempts > 400) {
                clearInterval(interval);
                btn.disabled = false;
                btn.innerHTML = '<span class="material-icons-round">bolt</span> Disparar Robô TOTVS';
                
                const matchIgnorados = logText.match(/(\d+)\s+sem chave válida/);
                const matchPulados = logText.match(/(\d+)\s+já existiam/);
                const showDownload = (matchIgnorados && parseInt(matchIgnorados[1]) > 0) || (matchPulados && parseInt(matchPulados[1]) > 0);
                
                if (showDownload) {
                    log.innerHTML += `<div style="margin-top: 10px; padding-top: 10px; border-top: 1px dashed rgba(255,255,255,0.2);"><a href="/api/totvs/chaves-invalidas/download" target="_blank" style="color:#818cf8; text-decoration:none; font-weight:600; display:flex; align-items:center; gap:5px;"><span class="material-icons-round" style="font-size:18px;">file_download</span> Baixar Relatório de Notas (Puladas/Inválidas)</a></div>`;
                }
                
                this.loadDashboard();
              }
            }
          } catch(e) {}
        }, 3000);

      } else {
        log.innerHTML += `<div style="color:#f87171">Erro: ${data.error}</div>`;
        this.toast(data.error, 'error');
        btn.disabled = false;
        btn.innerHTML = '<span class="material-icons-round">bolt</span> Disparar Robô TOTVS';
      }
    } catch (err) {
      log.innerHTML += `<div style="color:#f87171">Erro de conexão: ${err.message}</div>`;
      this.toast('Erro ao comunicar com o servidor', 'error');
      btn.disabled = false;
      btn.innerHTML = '<span class="material-icons-round">bolt</span> Disparar Robô TOTVS';
    }
  },

  async importarManualHub(event) {
    const files = event.target.files;
    if (!files.length) return;

    const empresaId = document.getElementById('manualEmpresaHub').value;
    const status = document.getElementById('uploadStatusHub');
    
    status.style.display = 'block';
    status.className = 'upload-status';
    status.innerHTML = '⏳ Processando arquivo(s)...';

    try {
      let sucessos = 0;
      let erros = 0;

      for (let file of files) {
        if (file.name.toLowerCase().endsWith('.zip')) {
          if (!empresaId) {
            this.toast(`Arquivo ${file.name}: Selecione a empresa destino para arquivos ZIP`, 'error');
            erros++;
            continue;
          }
          const formData = new FormData();
          formData.append('file', file);
          const res = await fetch(`/api/upload-saidas/${empresaId}`, { method: 'POST', body: formData });
          const data = await res.json();
          if (data.success) {
            sucessos++;
          } else {
            erros++;
          }
        } else if (file.name.toLowerCase().endsWith('.xml')) {
          const reader = new FileReader();
          reader.onload = async (e) => {
            const xml = e.target.result;
            const res = await fetch('/api/importar-xml', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ xml_content: xml, empresa_id: empresaId })
            });
            const data = await res.json();
            if (data.success) sucessos++; else erros++;
          };
          reader.readAsText(file);
        }
      }

      // Dá um tempo para os FileReader terminarem
      setTimeout(() => {
        status.innerHTML = `Concluído: ${sucessos} com sucesso, ${erros} com erro.`;
        status.className = erros > 0 ? 'upload-status warn' : 'upload-status success';
        if (sucessos > 0) this.toast(`${sucessos} arquivo(s) importado(s)!`, 'success');
        event.target.value = ''; // reseta o input
      }, 1500);

    } catch (err) {
      status.innerHTML = `❌ Erro no processamento: ${err.message}`;
      status.className = 'upload-status error';
    }
  },

  async importarXmlPasteHub() {
    const xml = document.getElementById('xmlPasteHub').value.trim();
    const empresaId = document.getElementById('manualEmpresaHub').value;
    
    if (!xml) return this.toast('Cole o XML primeiro', 'error');

    try {
      const res = await fetch('/api/importar-xml', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ xml_content: xml, empresa_id: empresaId })
      });
      const data = await res.json();
      
      if (data.success) {
        this.toast('NF-e importada com sucesso!', 'success');
        document.getElementById('xmlPasteHub').value = '';
      } else {
        this.toast(data.error, 'error');
      }
    } catch (err) { 
      this.toast('Erro ao importar XML', 'error'); 
    }
  },

  // ── Empresas ──────────────────────────────────────
  async loadEmpresas() {
    try {
      const res = await fetch('/api/empresas');
      const empresas = await res.json();
      const grid = document.getElementById('empresasGrid');
      
      if (!empresas.length) {
        grid.innerHTML = `
          <div class="empty-empresas" style="grid-column: 1 / -1;">
            <span class="material-icons-round">business</span>
            <p>Nenhuma empresa cadastrada</p>
            <p style="font-size:13px">Clique em "Nova Empresa" para começar</p>
          </div>
        `;
        return;
      }

      grid.innerHTML = empresas.map(emp => `
        <div class="empresa-card">
          <div class="empresa-card-top">
            <div class="empresa-card-info">
              <h4>${emp.nome_fantasia || emp.razao_social || 'Empresa'}</h4>
              <div class="cnpj-badge">${this.formatCnpj(emp.cnpj)}</div>
            </div>
            <div class="empresa-card-actions">
              <button title="Editar" onclick="app.abrirModalEmpresa(${emp.id})"><span class="material-icons-round">edit</span></button>
              <button class="danger" title="Excluir" onclick="app.excluirEmpresa(${emp.id})"><span class="material-icons-round">delete</span></button>
            </div>
          </div>
          <div class="empresa-meta">
            <span class="meta-chip ${emp.ambiente === 'producao' ? 'prod' : 'homo'}">${emp.ambiente === 'producao' ? 'Produção' : 'Homolog.'}</span>
            <span class="meta-chip ${emp.tipo === 'matriz' ? 'cert-ok' : 'cert-no'}">${emp.tipo === 'matriz' ? 'Matriz' : 'Filial'}</span>
            ${emp.totvs_ativo ? '<span class="meta-chip cert-ok">TOTVS</span>' : ''}
            ${emp.dominio_ativo ? '<span class="meta-chip" style="background:rgba(168,85,247,.12);color:#c084fc">Domínio</span>' : ''}
          </div>
        </div>
      `).join('');
      
      // Update filters
      this.updateEmpresaFilters(empresas);
    } catch (err) { console.error('Erro ao carregar empresas', err); }
  },

  updateEmpresaFilters(empresas) {
    const filters = ['filterEmpresa', 'syncEmpresaHub', 'totvsEmpresaHub', 'manualEmpresaHub', 'exportEmpresa', 'dominioEmpresa', 'filterLogEmpresa'];
    filters.forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        const val = el.value;
        let html = '<option value="">Todas as Empresas</option>';
        if (id === 'syncEmpresaHub' || id === 'totvsEmpresaHub') html = ''; // No "Todas" option
        if (id === 'manualEmpresaHub') html = '<option value="">Detectar automaticamente</option>';
        
        empresas.forEach(emp => {
          html += `<option value="${emp.id}">${emp.nome_fantasia || emp.razao_social || this.formatCnpj(emp.cnpj)}</option>`;
        });
        el.innerHTML = html;
        if (val) el.value = val;
      }
    });
  },

  async abrirModalEmpresa(id = null) {
    document.getElementById('modalEmpresaId').value = id || '';
    if (!id) {
      document.getElementById('modalEmpresaTitulo').textContent = 'Nova Empresa';
      document.getElementById('modalCnpj').value = '';
      document.getElementById('modalRazaoSocial').value = '';
      document.getElementById('modalNomeFantasia').value = '';
      document.getElementById('modalUf').value = 'SP';
      document.getElementById('modalAmbiente').value = 'producao';
      document.getElementById('modalTipoMatriz').checked = true;
      document.getElementById('modalMatrizGroup').style.display = 'none';
      document.getElementById('modalCertSection').style.display = 'block';
      document.getElementById('modalSenha').value = '';
      document.getElementById('modalCertNome').textContent = 'Clique para selecionar o certificado .pfx';
      document.getElementById('modalCertInput').value = '';
      document.getElementById('modalTotvsAtivo').checked = false;
      document.getElementById('modalTotvsFields').style.display = 'none';
      document.getElementById('modalTotvsBranch').value = '';
      document.getElementById('modalDominioAtivo').checked = false;
      document.getElementById('modalDominioFields').style.display = 'none';
      document.getElementById('modalDominioIntegrationKey').value = '';
    } else {
      document.getElementById('modalEmpresaTitulo').textContent = 'Editar Empresa';
      try {
        const res = await fetch('/api/empresas');
        const empresas = await res.json();
        const emp = empresas.find(e => e.id == id);
        if (emp) {
          document.getElementById('modalCnpj').value = this.formatCnpj(emp.cnpj) || '';
          document.getElementById('modalRazaoSocial').value = emp.razao_social || '';
          document.getElementById('modalNomeFantasia').value = emp.nome_fantasia || '';
          document.getElementById('modalUf').value = emp.uf || 'SP';
          document.getElementById('modalAmbiente').value = emp.ambiente || 'producao';
          
          if (emp.tipo === 'matriz') {
            document.getElementById('modalTipoMatriz').checked = true;
            document.getElementById('modalMatrizGroup').style.display = 'none';
            document.getElementById('modalCertSection').style.display = 'block';
          } else {
            document.getElementById('modalTipoFilial').checked = true;
            await this.loadMatrizesSelect();
            document.getElementById('modalMatrizGroup').style.display = 'block';
            document.getElementById('modalMatrizId').value = emp.matriz_id || '';
            document.getElementById('modalCertSection').style.display = 'none';
          }
          
          document.getElementById('modalTotvsAtivo').checked = !!emp.totvs_ativo;
          document.getElementById('modalTotvsFields').style.display = emp.totvs_ativo ? 'block' : 'none';
          document.getElementById('modalTotvsBranch').value = emp.totvs_branch || '';
          
          document.getElementById('modalDominioAtivo').checked = !!emp.dominio_ativo;
          document.getElementById('modalDominioFields').style.display = emp.dominio_ativo ? 'block' : 'none';
          document.getElementById('modalDominioIntegrationKey').value = emp.dominio_integration_key || '';
        }
      } catch (e) { console.error(e); }
    }
    
    document.getElementById('modalTotvsAtivo').addEventListener('change', (e) => {
      document.getElementById('modalTotvsFields').style.display = e.target.checked ? 'block' : 'none';
    });

    document.getElementById('modalDominioAtivo').addEventListener('change', (e) => {
      document.getElementById('modalDominioFields').style.display = e.target.checked ? 'block' : 'none';
    });

    document.getElementsByName('modalTipo').forEach(radio => {
      radio.addEventListener('change', (e) => {
        if (e.target.value === 'filial') {
          document.getElementById('modalMatrizGroup').style.display = 'block';
          document.getElementById('modalCertSection').style.display = 'none';
          this.loadMatrizesSelect();
        } else {
          document.getElementById('modalMatrizGroup').style.display = 'none';
          document.getElementById('modalCertSection').style.display = 'block';
        }
      });
    });

    document.getElementById('modalEmpresa').classList.add('active');
  },

  fecharModalEmpresa() {
    document.getElementById('modalEmpresa').classList.remove('active');
  },

  async loadMatrizesSelect() {
     try {
       const res = await fetch('/api/matrizes');
       const matrizes = await res.json();
       const select = document.getElementById('modalMatrizId');
       select.innerHTML = '<option value="">Selecione a matriz...</option>';
       matrizes.forEach(m => {
         select.innerHTML += `<option value="${m.id}">${m.razao_social || m.nome_fantasia || this.formatCnpj(m.cnpj)}</option>`;
       });
     } catch (e) { console.error('Erro ao carregar matrizes'); }
  },

  async salvarEmpresa() {
    const id = document.getElementById('modalEmpresaId').value;
    const tipo = document.querySelector('input[name="modalTipo"]:checked').value;
    const cnpj = document.getElementById('modalCnpj').value.replace(/\D/g, '');
    const razao_social = document.getElementById('modalRazaoSocial').value;
    const nome_fantasia = document.getElementById('modalNomeFantasia').value;
    const uf = document.getElementById('modalUf').value;
    const ambiente = document.getElementById('modalAmbiente').value;
    const totvs_ativo = document.getElementById('modalTotvsAtivo').checked;
    const totvs_branch = document.getElementById('modalTotvsBranch').value;
    const dominio_ativo = document.getElementById('modalDominioAtivo').checked;
    const dominio_integration_key = document.getElementById('modalDominioIntegrationKey').value;
    let matriz_id = null;
    
    if (tipo === 'filial') {
      matriz_id = document.getElementById('modalMatrizId').value;
      if (!matriz_id) return this.toast('Selecione uma matriz para a filial', 'error');
    }

    if (!cnpj || cnpj.length !== 14) return this.toast('CNPJ inválido ou não preenchido', 'error');

    const data = {
      cnpj, razao_social, nome_fantasia, tipo, matriz_id, uf, ambiente, 
      totvs_ativo, totvs_branch,
      dominio_ativo, dominio_integration_key
    };

    try {
      const url = id ? `/api/empresas/${id}` : '/api/empresas';
      const method = id ? 'PUT' : 'POST';
      
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      const result = await res.json();
      
      if (result.success) {
        if (tipo === 'matriz') {
           const certFile = document.getElementById('modalCertInput').files[0];
           const senha = document.getElementById('modalSenha').value;
           
           if (certFile) {
             const formData = new FormData();
             formData.append('certificado', certFile);
             await fetch(`/api/empresas/${result.empresa ? result.empresa.id : id}/certificado`, { method: 'POST', body: formData });
           }
           
           if (senha) {
             await fetch(`/api/empresas/${result.empresa ? result.empresa.id : id}/senha`, {
               method: 'POST',
               headers: { 'Content-Type': 'application/json' },
               body: JSON.stringify({ senha })
             });
           }
        }
        
        this.toast('Empresa salva com sucesso!', 'success');
        this.fecharModalEmpresa();
        this.loadEmpresas();
      } else {
        this.toast(result.error, 'error');
      }
    } catch (err) { this.toast('Erro ao salvar empresa', 'error'); }
  },

  async excluirEmpresa(id) {
    if (!confirm('Tem certeza que deseja excluir esta empresa?')) return;
    try {
      const res = await fetch(`/api/empresas/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        this.toast('Empresa excluída com sucesso!', 'success');
        this.loadEmpresas();
      } else {
        this.toast(data.error, 'error');
      }
    } catch(e) {
      this.toast('Erro ao excluir empresa', 'error');
    }
  },

  // ── TOTVS Config ──────────────────────────────────
  async abrirModalTotvsConfig() {
    try {
      const res = await fetch('/api/config');
      if (res.ok) {
        const config = await res.json();
        document.getElementById('globalTotvsUrl').value = config.totvs_base_url || '';
        document.getElementById('globalTotvsUser').value = config.totvs_user || '';
        document.getElementById('globalTotvsPassword').value = config.totvs_password || '';
        document.getElementById('globalTotvsClientId').value = config.totvs_client_id || '';
        document.getElementById('globalTotvsClientSecret').value = config.totvs_client_secret || '';
        document.getElementById('globalTotvsGrantType').value = config.totvs_grant_type || 'password';
      }
    } catch(e) {}
    document.getElementById('modalTotvsConfig').classList.add('active');
  },

  fecharModalTotvsConfig() {
    document.getElementById('modalTotvsConfig').classList.remove('active');
  },

  async salvarTotvsConfigGlobal() {
    try {
       const currentConfig = {
         totvs_base_url: document.getElementById('globalTotvsUrl').value,
         totvs_user: document.getElementById('globalTotvsUser').value,
         totvs_password: document.getElementById('globalTotvsPassword').value,
         totvs_client_id: document.getElementById('globalTotvsClientId').value,
         totvs_client_secret: document.getElementById('globalTotvsClientSecret').value,
         totvs_grant_type: document.getElementById('globalTotvsGrantType').value
       };

       const res = await fetch('/api/config/totvs', {
         method: 'POST',
         headers: { 'Content-Type': 'application/json' },
         body: JSON.stringify(currentConfig)
       });
       
       const data = await res.json();
       if (data.success) {
         this.toast('Configuração TOTVS salva com sucesso.', 'success');
         this.fecharModalTotvsConfig();
       } else {
         this.toast(data.error || 'Erro ao salvar', 'error');
       }
    } catch(e) {
       this.toast('Erro ao salvar TOTVS', 'error');
    }
  },

  // ── Domínio Integration ────────────────────────────

  async loadDominioPage() {
    try {
      const empresaId = document.getElementById('dominioEmpresa').value;
      const res = await fetch(`/api/dominio/stats${empresaId ? '?empresaId=' + empresaId : ''}`);
      const stats = await res.json();
      document.getElementById('domStatTotal').textContent = stats.total || 0;
      document.getElementById('domStatEnviadas').textContent = stats.enviadas || 0;
      document.getElementById('domStatPendentes').textContent = stats.pendentes || 0;
      document.getElementById('domStatErros').textContent = stats.erros || 0;
    } catch (err) { console.error('Erro ao carregar stats Domínio:', err); }
  },

  async enviarDominio(reenviar = false) {
    const empresaId = document.getElementById('dominioEmpresa').value;
    if (!empresaId) return this.toast('Selecione uma empresa', 'error');

    const btnId = reenviar ? 'btnDominioReenviar' : 'btnDominioEnviar';
    const btn = document.getElementById(btnId);
    const log = document.getElementById('dominioLogTerminal');

    btn.disabled = true;
    const originalHtml = btn.innerHTML;
    btn.innerHTML = '<span class="spinner" style="display:inline-block;width:14px;height:14px;border:2px solid #fff;border-radius:50%;border-top-color:transparent;animation:spin 1s linear infinite;margin-right:8px;"></span> Enviando...';

    log.style.display = 'block';
    log.innerHTML = '<div>Iniciando envio para Domínio...</div>';

    try {
      const payload = {
        empresaId,
        dataInicio: document.getElementById('dominioDataInicio').value,
        dataFim: document.getElementById('dominioDataFim').value,
        tipo: document.getElementById('dominioTipo').value,
        reenviar
      };

      const res = await fetch('/api/dominio/enviar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();

      if (data.success) {
        log.innerHTML += `<div>${data.message}</div>`;
        this.toast('Envio iniciado!', 'info');

        let attempts = 0;
        const interval = setInterval(async () => {
          try {
            attempts++;
            const logRes = await fetch('/api/dominio/logs');
            const logText = await logRes.text();
            if (logText) {
              const lines = logText.split('\n').filter(l => l.trim() !== '');
              const lastLines = lines.slice(-15);
              log.innerHTML = lastLines.map(l => `<div>${l}</div>`).join('');

              if (logText.includes('🏁 Envio finalizado') || logText.includes('❌ Falha') || attempts > 300) {
                clearInterval(interval);
                btn.disabled = false;
                btn.innerHTML = originalHtml;
                this.loadDominioPage();
              }
            }
          } catch(e) {}
        }, 2000);
      } else {
        log.innerHTML += `<div style="color:#f87171">Erro: ${data.error}</div>`;
        this.toast(data.error, 'error');
        btn.disabled = false;
        btn.innerHTML = originalHtml;
      }
    } catch (err) {
      log.innerHTML += `<div style="color:#f87171">Erro de conexão: ${err.message}</div>`;
      this.toast('Erro ao comunicar com o servidor', 'error');
      btn.disabled = false;
      btn.innerHTML = originalHtml;
    }
  },

  async enviarNotaDominio(notaId) {
    if (!confirm('Enviar esta nota para o Domínio?')) return;
    try {
      const res = await fetch(`/api/dominio/enviar-nota/${notaId}`, { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        this.toast('Nota enviada ao Domínio!', 'success');
        this.loadNotas(this.currentPagina);
      } else {
        this.toast(data.error || 'Erro ao enviar', 'error');
        this.loadNotas(this.currentPagina);
      }
    } catch (err) { this.toast('Erro ao enviar nota', 'error'); }
  },

  async testarConexaoDominio() {
    const empresaId = document.getElementById('dominioEmpresa').value;
    if (!empresaId) return this.toast('Selecione uma empresa', 'error');
    
    try {
      const res = await fetch('/api/dominio/testar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ empresaId })
      });
      const data = await res.json();
      if (data.success) {
        this.toast(data.message || 'Conexão OK!', 'success');
      } else {
        this.toast(data.message || data.error || 'Falha na conexão', 'error');
      }
    } catch (err) { this.toast('Erro ao testar conexão', 'error'); }
  },

  // ── Domínio Config Global ──────────────────────────
  async abrirModalDominioConfig() {
    try {
      const res = await fetch('/api/config');
      if (res.ok) {
        const config = await res.json();
        document.getElementById('globalDominioClientId').value = config.dominio_client_id || '';
        document.getElementById('globalDominioClientSecret').value = config.dominio_client_secret || '';
        document.getElementById('globalDominioAuthUrl').value = config.dominio_auth_url || '';
        document.getElementById('globalDominioApiUrl').value = config.dominio_api_url || '';
      }
    } catch(e) {}
    document.getElementById('modalDominioConfig').classList.add('active');
  },

  fecharModalDominioConfig() {
    document.getElementById('modalDominioConfig').classList.remove('active');
  },

  async salvarDominioConfigGlobal() {
    try {
      const payload = {
        dominio_client_id: document.getElementById('globalDominioClientId').value,
        dominio_client_secret: document.getElementById('globalDominioClientSecret').value,
        dominio_auth_url: document.getElementById('globalDominioAuthUrl').value,
        dominio_api_url: document.getElementById('globalDominioApiUrl').value
      };

      const res = await fetch('/api/config/dominio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (data.success) {
        this.toast('Configuração Domínio salva com sucesso.', 'success');
        this.fecharModalDominioConfig();
      } else {
        this.toast(data.error || 'Erro ao salvar', 'error');
      }
    } catch(e) {
      this.toast('Erro ao salvar configuração Domínio', 'error');
    }
  },

  // ── Export ────────────────────────────────────────
  exportar(formato) {
    const tipo = document.getElementById('exportTipo').value;
    const dataInicio = document.getElementById('exportDataInicio').value;
    const dataFim = document.getElementById('exportDataFim').value;
    const params = new URLSearchParams({ tipo, dataInicio, dataFim });
    window.open(`/api/exportar/${formato}?${params}`, '_blank');
  },

  // ── Helpers ───────────────────────────────────────
  formatCurrency(val) {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val || 0);
  },

  formatDate(dateStr) {
    if (!dateStr) return '—';
    try {
      const d = new Date(dateStr);
      return d.toLocaleDateString('pt-BR');
    } catch { return dateStr; }
  },

  formatCron(expr) {
    if (!expr) return '—';
    const parts = expr.trim().split(/\s+/);
    if (parts.length !== 5) return expr;
    const [min, hour, dom, month, dow] = parts;
    const pad = v => v.padStart(2, '0');
    // Diário em horário fixo: "0 10 * * *" → "Diário às 10:00"
    if (dom === '*' && month === '*' && dow === '*' && !min.includes('/') && !hour.includes('/')) {
      return `Diário às ${pad(hour)}:${pad(min)}`;
    }
    // Dias da semana específicos: "0 10 * * 1-5" → "Seg-Sex às 10:00"
    const dowMap = { '0':'Dom','1':'Seg','2':'Ter','3':'Qua','4':'Qui','5':'Sex','6':'Sáb' };
    if (dom === '*' && month === '*' && dow !== '*' && !min.includes('/') && !hour.includes('/')) {
      const dias = dow.split(',').map(d => dowMap[d] || d).join(', ');
      return `${dias} às ${pad(hour)}:${pad(min)}`;
    }
    // A cada N minutos: "*/15 * * * *" → "A cada 15 min"
    if (min.startsWith('*/') && hour === '*') {
      return `A cada ${min.slice(2)} min`;
    }
    // A cada N horas: "0 */2 * * *" → "A cada 2h"
    if (hour.startsWith('*/') && dom === '*' && month === '*' && dow === '*') {
      return `A cada ${hour.slice(2)}h`;
    }
    return expr;
  },

  formatCnpj(cnpj) {
    if (!cnpj) return '—';
    cnpj = cnpj.replace(/\D/g, '');
    if (cnpj.length === 14) {
      return cnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
    }
    if (cnpj.length === 11) {
      return cnpj.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
    }
    return cnpj;
  },

  truncate(str, len) {
    if (!str) return '—';
    return str.length > len ? str.substring(0, len) + '...' : str;
  },

  formatXml(xml) {
    if (!xml) return '';
    let formatted = '';
    let indent = 0;
    xml.replace(/(>)(<)(\/*)/g, '$1\n$2$3').split('\n').forEach(line => {
      if (line.match(/^<\/\w/)) indent--;
      formatted += '  '.repeat(Math.max(indent, 0)) + line.trim() + '\n';
      if (line.match(/^<\w[^>]*[^\/]>.*$/) && !line.match(/^<\w[^>]*>.*<\/\w/)) indent++;
    });
    return formatted.trim();
  },

  updateStatus(connected) {
    const dot = document.querySelector('.status-dot');
    const text = document.querySelector('.status-text');
    if (connected) {
      dot.classList.add('connected');
      text.textContent = 'Configurado';
    } else {
      dot.classList.remove('connected');
      text.textContent = 'Desconectado';
    }
  },

  updateEnvBadge(ambiente) {
    const badge = document.getElementById('envBadge');
    if (ambiente === 'homologacao') {
      badge.textContent = 'HOMOLOGAÇÃO';
      badge.classList.add('homologacao');
    } else {
      badge.textContent = 'PRODUÇÃO';
      badge.classList.remove('homologacao');
    }
  },

  toast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    const icons = { success: 'check_circle', error: 'error', info: 'info' };
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `<span class="material-icons-round">${icons[type]}</span>${message}`;
    container.appendChild(toast);
    setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 300); }, 4000);
  },

  // ── Agendamentos ──────────────────────────────────

  async carregarAgendamentos() {
    try {
      const res  = await fetch('/api/agendamentos', { credentials: 'include' });
      const lista = await res.json();
      this.agendamentosList = lista; // Armazena a lista para uso na edição
      const grid = document.getElementById('agendamentosGrid');

      // Popula select de empresa no modal
      const sel = document.getElementById('modalAgEmpresa');
      if (sel) {
        const emp = await (await fetch('/api/empresas', { credentials: 'include' })).json();
        sel.innerHTML = '<option value="0" style="font-weight:bold;color:var(--primary)">🌐 TODAS AS EMPRESAS ATIVAS</option>' + 
                        emp.map(e => `<option value="${e.id}">${e.nome_fantasia || e.razao_social || e.cnpj}</option>`).join('');
      }

      if (!lista.length) {
        grid.innerHTML = `<div style="text-align:center;padding:60px 20px;color:var(--text-muted);grid-column:1/-1">
          <span class="material-icons-round" style="font-size:48px;opacity:.3;display:block;margin-bottom:10px">schedule</span>
          <p>Nenhum agendamento cadastrado</p>
          <p style="font-size:13px">Clique em "Novo Agendamento" para automatizar o processo.</p></div>`;
        return;
      }

      const tipoLabel = { totvs_sync: '🔄 Sync TOTVS', dominio_envio: '📤 Envio Domínio' };
      const statusColor = { sucesso: '#10b981', erro: '#ef4444', executando: '#f59e0b', in_progress: '#f59e0b', processing: '#f59e0b', pending: '#fbbf24', completed: '#10b981', failed: '#ef4444' };
      const statusLabel = { sucesso: 'Sucesso', erro: 'Erro', executando: 'Em execução', in_progress: 'Em execução', processing: 'Processando', pending: 'Aguardando', completed: 'Concluído', failed: 'Falha' };

      grid.innerHTML = lista.map(ag => `
        <div style="background:var(--card-bg,#1a2035);border:1px solid rgba(255,255,255,.07);border-radius:14px;padding:20px;position:relative">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px">
            <div>
              <div style="font-size:15px;font-weight:600;color:var(--text)">${tipoLabel[ag.tipo] || ag.tipo}</div>
              <div style="font-size:14px;font-weight:600;color:var(--text-primary);margin-top:4px">${ag.nome || 'Sem título'}</div>
              <div style="font-size:12px;color:var(--text-muted);margin-top:3px">${ag.empresa_id === null ? '🌐 <strong>Todas as Empresas</strong>' : (ag.empresa_nome || ag.empresa_cnpj || 'Empresa')}</div>
            </div>
            <div style="display:flex;gap:6px">
              <button onclick="app.executarAgendamentoAgora(${ag.id})" title="Executar Agora"
                style="background:rgba(99,102,241,.12);border:1px solid rgba(99,102,241,.2);color:#818cf8;border-radius:8px;padding:6px;cursor:pointer;display:flex;align-items:center;font-size:12px;gap:4px;transition:all .2s"
                onmouseover="this.style.background='rgba(99,102,241,.25)'" onmouseout="this.style.background='rgba(99,102,241,.12)'">
                <span class="material-icons-round" style="font-size:16px">play_arrow</span>
              </button>
              <button onclick="app.abrirModalAgendamento(${ag.id})" title="Editar"
                style="background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.08);color:var(--text-muted);border-radius:8px;padding:6px;cursor:pointer;display:flex;align-items:center;transition:all .2s"
                onmouseover="this.style.color='#e2e8f0'" onmouseout="this.style.color='var(--text-muted)'">
                <span class="material-icons-round" style="font-size:16px">edit</span>
              </button>
              <button onclick="app.excluirAgendamento(${ag.id})" title="Excluir"
                style="background:rgba(239,68,68,.05);border:1px solid rgba(239,68,68,.1);color:#f87171;border-radius:8px;padding:6px;cursor:pointer;display:flex;align-items:center;transition:all .2s"
                onmouseover="this.style.background='rgba(239,68,68,.15)'" onmouseout="this.style.background='rgba(239,68,68,.05)'">
                <span class="material-icons-round" style="font-size:16px">delete</span>
              </button>
            </div>
          </div>
          <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px">
            <span style="background:rgba(99,102,241,.1);color:#818cf8;border-radius:6px;padding:3px 10px;font-size:11px;font-weight:500" title="${ag.cron_expressao}">⏰ ${this.formatCron(ag.cron_expressao)}</span>
            ${ag.tipo === 'totvs_sync' ? `<span style="background:rgba(16,185,129,.1);color:#34d399;border-radius:6px;padding:3px 10px;font-size:11px;font-weight:500">D-${ag.dias_offset}</span>` : ''}
            <span style="border-radius:6px;padding:3px 10px;font-size:11px;font-weight:500;background:${ag.ativo ? 'rgba(16,185,129,.1)' : 'rgba(239,68,68,.08)'};color:${ag.ativo ? '#34d399' : '#f87171'}">${ag.ativo ? '● Ativo' : '○ Inativo'}</span>
          </div>
          ${ag.ultimo_run ? `<div style="font-size:11px;color:var(--text-muted)">Último run: <strong style="color:${statusColor[ag.ultimo_status] || '#94a3b8'}">${statusLabel[ag.ultimo_status] || ag.ultimo_status || '?'}</strong> em ${this.formatDate(ag.ultimo_run)}</div>` : '<div style="font-size:11px;color:var(--text-muted)">Nunca executado</div>'}
        </div>
      `).join('');

      await this.carregarLogsAgendamentos();
    } catch (err) { console.error('Erro ao carregar agendamentos:', err); }
  },

  async carregarLogsAgendamentos() {
    try {
      let url = '/api/agendamentos/logs?limite=30';
      const elEmp = document.getElementById('filterLogEmpresa');
      const elTipo = document.getElementById('filterLogTipo');
      const elStatus = document.getElementById('filterLogStatus');
      if (elEmp && elEmp.value) url += '&empresa_id=' + elEmp.value;
      if (elTipo && elTipo.value) url += '&tipo=' + elTipo.value;
      if (elStatus && elStatus.value) url += '&status=' + elStatus.value;
      
      const res  = await fetch(url, { credentials: 'include' });
      const logs = await res.json();
      const tbody = document.getElementById('logsAgendamentosBody');
      if (!tbody) return;
      if (!logs.length) {
        tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;color:var(--text-muted);padding:30px">Nenhuma execução registrada ainda</td></tr>';
        return;
      }
      const statusMap = {
        sucesso: { icon: '✅', color: '#10b981', label: 'Sucesso' },
        erro: { icon: '❌', color: '#ef4444', label: 'Erro' },
        executando: { icon: '⏳', color: '#f59e0b', label: 'Em execução pelo importador' },
        in_progress: { icon: '⏳', color: '#f59e0b', label: 'Em execução pelo importador' },
        processing: { icon: '⏳', color: '#f59e0b', label: 'Em execução' },
        pending: { icon: '⏳', color: '#fbbf24', label: 'Aguardando' },
        parcial: { icon: '⚠️', color: '#f59e0b', label: 'Parcial' },
        completed: { icon: '✅', color: '#10b981', label: 'Concluído' },
        failed: { icon: '❌', color: '#ef4444', label: 'Falha' }
      };
      const tipoMap   = { totvs_sync: '🔄 TOTVS', dominio_envio: '📤 Domínio' };
      tbody.innerHTML = logs.map(l => {
        const s = statusMap[l.status] || { icon: '?', color: '#64748b', label: l.status || 'Desconhecido' };
        const dur = l.duracao_ms ? (l.duracao_ms < 1000 ? l.duracao_ms + 'ms' : (l.duracao_ms / 1000).toFixed(1) + 's') : '—';
        const empNome = l.empresa_id === null ? '🌐 Todas as Empresas' : this.truncate(l.empresa_nome, 22);
        return `<tr>
          <td style="font-size:12px">${this.formatDate(l.executado_em)}</td>
          <td>${empNome}</td>
          <td>${tipoMap[l.tipo] || l.tipo}</td>
          <td><span style="color:${s.color};font-weight:600">${s.icon} ${s.label}</span></td>
          <td style="text-align:center">${l.notas_encontradas || 0}</td>
          <td style="text-align:center">${l.notas_inseridas || 0}</td>
          <td style="text-align:center;color:${l.notas_existentes > 0 ? '#94a3b8' : ''}">${l.notas_existentes || 0}</td>
          <td style="text-align:center">${l.notas_enviadas || 0}</td>
          <td style="text-align:center;font-family:monospace;font-size:12px">${dur}</td>
        </tr>`;
      }).join('');
    } catch (err) { console.error('Erro ao carregar logs:', err); }
  },

  abrirModalAgendamento(id = null) {
    document.getElementById('modalAgId').value = id || '';
    document.getElementById('modalAgendamentoTitulo').textContent = id ? 'Editar Agendamento' : 'Novo Agendamento';
    
    const selectTipo = document.getElementById('modalAgTipo');
    const selectEmpresa = document.getElementById('modalAgEmpresa');
    const selectOffset = document.getElementById('modalAgOffset');
    const inputHorario = document.getElementById('modalAgHorario');
    const checkAtivo = document.getElementById('modalAgAtivo');
    
    // Configura o evento do tipo para ocultar/exibir offset
    const toggleOffset = () => {
      document.getElementById('modalAgOffsetGroup').style.display = selectTipo.value === 'totvs_sync' ? 'block' : 'none';
    };
    selectTipo.onchange = toggleOffset;

    if (id && this.agendamentosList) {
      const ag = this.agendamentosList.find(a => a.id === id);
      if (ag) {
        selectEmpresa.value = ag.empresa_id === null ? '0' : ag.empresa_id;
        document.getElementById('modalAgNome').value = ag.nome || '';
        selectTipo.value = ag.tipo;
        selectOffset.value = ag.dias_offset || '2';
        checkAtivo.checked = !!ag.ativo;
        
        // Converte o cron back para time (ex: "0 6 * * *" -> "06:00")
        if (ag.cron_expressao) {
          const parts = ag.cron_expressao.split(' ');
          if (parts.length >= 2) {
            const mm = parts[0].padStart(2, '0');
            const hh = parts[1].padStart(2, '0');
            inputHorario.value = `${hh}:${mm}`;
          }
        }
      }
    } else {
      // Novo agendamento: valores padrão
      selectEmpresa.value = '0';
      document.getElementById('modalAgNome').value = '';
      selectTipo.value = 'totvs_sync';
      selectOffset.value = '2';
      inputHorario.value = '06:00';
      checkAtivo.checked = true;
    }
    
    toggleOffset();
    document.getElementById('modalAgendamento').classList.add('active');
  },

  fecharModalAgendamento() {
    document.getElementById('modalAgendamento').classList.remove('active');
  },

  async salvarAgendamento() {
    const id           = document.getElementById('modalAgId').value;
    const empresa_id   = document.getElementById('modalAgEmpresa').value;
    const nome         = document.getElementById('modalAgNome').value.trim();
    const tipo         = document.getElementById('modalAgTipo').value;
    const dias_offset  = document.getElementById('modalAgOffset').value;
    const horarioSel   = document.getElementById('modalAgHorario').value; // Ex: "06:00"
    const ativo        = document.getElementById('modalAgAtivo').checked;
    
    // Converte o valor "HH:MM" para cron "MM HH * * *"
    let cron_expressao = '0 6 * * *';
    if (horarioSel) {
      const [hh, mm] = horarioSel.split(':');
      cron_expressao = `${parseInt(mm, 10)} ${parseInt(hh, 10)} * * *`;
    }

    if (!empresa_id) return this.toast('Selecione uma empresa', 'error');
    if (!nome) return this.toast('Informe um nome para o agendamento', 'error');
    if (!cron_expressao) return this.toast('Defina o horário de execução', 'error');

    try {
      const url    = id ? `/api/agendamentos/${id}` : '/api/agendamentos';
      const method = id ? 'PUT' : 'POST';
      const res = await fetch(url, {
        method, credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ empresa_id, tipo, nome, dias_offset, cron_expressao, ativo })
      });
      const data = await res.json();
      if (data.success) {
        this.toast('Agendamento salvo!', 'success');
        this.fecharModalAgendamento();
        this.carregarAgendamentos();
      } else {
        this.toast(data.error || 'Erro ao salvar', 'error');
      }
    } catch (err) { this.toast('Erro ao salvar agendamento', 'error'); }
  },

  async excluirAgendamento(id) {
    if (!confirm('Excluir este agendamento?')) return;
    try {
      const res = await fetch(`/api/agendamentos/${id}`, { method: 'DELETE', credentials: 'include' });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Erro desconhecido ao excluir');
      }
      this.toast('Agendamento removido', 'success');
      this.carregarAgendamentos();
    } catch (err) { this.toast(err.message || 'Erro ao excluir', 'error'); }
  },

  async executarAgendamentoAgora(id) {
    if (!confirm('Executar este job agora?')) return;
    try {
      const res = await fetch(`/api/agendamentos/${id}/executar`, { method: 'POST', credentials: 'include' });
      const data = await res.json();
      this.toast(data.message || 'Job iniciado!', 'info');
      // Atualizar logs e agendamentos imediatamente para mostrar 'executando'
      this.carregarAgendamentos();
      setTimeout(() => this.carregarLogsAgendamentos(), 500); // 500ms para dar tempo do registro ser salvo no banco
      
      // Auto-atualizar após 10 e 20 segundos para ver se terminou
      setTimeout(() => { this.carregarAgendamentos(); this.carregarLogsAgendamentos(); }, 10000);
      setTimeout(() => { this.carregarAgendamentos(); this.carregarLogsAgendamentos(); }, 20000);
    } catch (err) { this.toast('Erro ao executar job', 'error'); }
  },

  // ── Usuários ────────────────────────────────────────────

  async carregarUsuarios() {
    try {
      const res    = await fetch('/api/usuarios', { credentials: 'include' });
      const lista  = await res.json();
      const tbody  = document.getElementById('usuariosTableBody');
      const badges = {
        master:   { label: '👑 Master',   bg: '#f59e0b22', color: '#f59e0b' },
        admin:    { label: '👤 Padrão',   bg: '#6366f122', color: '#818cf8' },
        operador: { label: '⚙️ Operador', bg: '#10b98122', color: '#34d399' },
        viewer:   { label: '👁️ Viewer',   bg: '#64748b22', color: '#94a3b8' }
      };
      tbody.innerHTML = lista.map(u => {
        const b = badges[u.perfil] || badges.viewer;
        return `<tr>
          <td><strong>${u.nome}</strong></td>
          <td style="font-size:12px;color:var(--text-muted)">${u.email}</td>
          <td><span style="font-size:11px;font-weight:600;padding:2px 9px;border-radius:20px;background:${b.bg};color:${b.color}">${b.label}</span></td>
          <td><span style="font-size:11px;padding:2px 9px;border-radius:20px;background:${u.ativo ? 'rgba(16,185,129,.12)' : 'rgba(239,68,68,.1)'};color:${u.ativo ? '#34d399' : '#f87171'}">${u.ativo ? 'Ativo' : 'Inativo'}</span></td>
          <td style="font-size:12px;color:var(--text-muted)">${u.ultimo_login ? this.formatDate(u.ultimo_login) : '—'}</td>
          <td>
            <button onclick="app.abrirModalUsuario(${u.id})" style="background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.08);color:var(--text-muted);border-radius:8px;padding:5px 8px;cursor:pointer;font-size:12px;display:inline-flex;align-items:center;gap:4px;transition:all .2s" onmouseover="this.style.color='#e2e8f0'" onmouseout="this.style.color='var(--text-muted)'">
              <span class="material-icons-round" style="font-size:14px">edit</span>
            </button>
            ${u.perfil !== 'master' ? `<button onclick="app.excluirUsuario(${u.id})" style="background:rgba(239,68,68,.05);border:1px solid rgba(239,68,68,.1);color:#f87171;border-radius:8px;padding:5px 8px;cursor:pointer;font-size:12px;display:inline-flex;align-items:center;gap:4px;margin-left:4px;transition:all .2s" onmouseover="this.style.background='rgba(239,68,68,.15)'" onmouseout="this.style.background='rgba(239,68,68,.05)'">
              <span class="material-icons-round" style="font-size:14px">delete</span></button>` : ''}
          </td>
        </tr>`;
      }).join('');
    } catch (err) { this.toast('Sem permissão para ver usuários', 'error'); }
  },

  async abrirModalUsuario(id = null) {
    document.getElementById('modalUId').value = id || '';
    document.getElementById('modalUsuarioTitulo').textContent = id ? 'Editar Usuário' : 'Novo Usuário';
    document.getElementById('modalUNome').value = '';
    document.getElementById('modalUEmail').value = '';
    document.getElementById('modalUSenha').value = '';
    document.getElementById('modalUPerfil').value = 'viewer';
    document.getElementById('modalUAtivo').checked = true;

    if (id) {
      try {
        const lista = await (await fetch('/api/usuarios', { credentials: 'include' })).json();
        const u = lista.find(x => x.id == id);
        if (u) {
          document.getElementById('modalUNome').value  = u.nome;
          document.getElementById('modalUEmail').value = u.email;
          document.getElementById('modalUPerfil').value = u.perfil;
          document.getElementById('modalUAtivo').checked = !!u.ativo;
        }
      } catch (_) {}
    }
    document.getElementById('modalUsuario').classList.add('active');
  },

  fecharModalUsuario() {
    document.getElementById('modalUsuario').classList.remove('active');
  },

  async salvarUsuario() {
    const id    = document.getElementById('modalUId').value;
    const nome  = document.getElementById('modalUNome').value;
    const email = document.getElementById('modalUEmail').value;
    const senha = document.getElementById('modalUSenha').value;
    const perfil = document.getElementById('modalUPerfil').value;
    const ativo  = document.getElementById('modalUAtivo').checked ? 1 : 0;

    if (!nome || !email) return this.toast('Nome e e-mail são obrigatórios', 'error');
    if (!id && !senha) return this.toast('Informe a senha para o novo usuário', 'error');

    try {
      const url    = id ? `/api/usuarios/${id}` : '/api/usuarios';
      const method = id ? 'PUT' : 'POST';
      const body   = { nome, email, perfil, ativo };
      if (senha) body.senha = senha;

      const res = await fetch(url, {
        method, credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const data = await res.json();
      if (data.success) {
        this.toast('Usuário salvo com sucesso!', 'success');
        this.fecharModalUsuario();
        this.carregarUsuarios();
      } else {
        this.toast(data.error || 'Erro ao salvar', 'error');
      }
    } catch (err) { this.toast('Erro ao salvar usuário', 'error'); }
  },

  async excluirUsuario(id) {
    if (!confirm('Excluir este usuário?')) return;
    try {
      const res  = await fetch(`/api/usuarios/${id}`, { method: 'DELETE', credentials: 'include' });
      const data = await res.json();
      if (data.success) {
        this.toast('Usuário excluído', 'success');
        this.carregarUsuarios();
      } else {
        this.toast(data.error || 'Erro ao excluir', 'error');
      }
    } catch (err) { this.toast('Erro ao excluir usuário', 'error'); }
  }

};

document.addEventListener('DOMContentLoaded', () => app.init());
