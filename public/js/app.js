const app = {
  currentPage: 'dashboard',
  currentPagina: 1,

  // ── Initialization ────────────────────────────────
  init() {
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
    if (page === 'dashboard') this.loadDashboard();
    if (page === 'notas') this.loadNotas();
    if (page === 'config') this.loadEmpresas();
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
      tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:var(--text-muted);padding:40px">Nenhuma nota encontrada</td></tr>';
      return;
    }
    tbody.innerHTML = notas.map(n => `
      <tr>
        <td><strong>${n.numero_nf || '—'}</strong></td>
        <td>${this.formatDate(n.data_emissao)}</td>
        <td class="chave-cell" title="${n.chave_acesso}">${n.chave_acesso}</td>
        <td>${this.truncate(n.emitente_nome, 25)}<br><small style="color:var(--text-muted)">${this.formatCnpj(n.emitente_cnpj)}</small></td>
        <td>${this.truncate(n.destinatario_nome, 25)}<br><small style="color:var(--text-muted)">${this.formatCnpj(n.destinatario_cnpj)}</small></td>
        <td><strong>${this.formatCurrency(n.valor_total)}</strong></td>
        <td><span class="badge badge-${n.tipo}">${n.tipo}</span></td>
        <td>
          <button class="action-btn" title="Ver XML" onclick="app.viewXml(${n.id})">
            <span class="material-icons-round" style="font-size:16px">code</span>
          </button>
          <button class="action-btn" title="Download XML" onclick="app.downloadXml(${n.id})">
            <span class="material-icons-round" style="font-size:16px">download</span>
          </button>
        </td>
      </tr>
    `).join('');
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
          </div>
        </div>
      `).join('');
      
      // Update filters
      this.updateEmpresaFilters(empresas);
    } catch (err) { console.error('Erro ao carregar empresas', err); }
  },

  updateEmpresaFilters(empresas) {
    const filters = ['filterEmpresa', 'syncEmpresaHub', 'totvsEmpresaHub', 'manualEmpresaHub', 'exportEmpresa'];
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
        }
      } catch (e) { console.error(e); }
    }
    
    document.getElementById('modalTotvsAtivo').addEventListener('change', (e) => {
      document.getElementById('modalTotvsFields').style.display = e.target.checked ? 'block' : 'none';
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
    let matriz_id = null;
    
    if (tipo === 'filial') {
      matriz_id = document.getElementById('modalMatrizId').value;
      if (!matriz_id) return this.toast('Selecione uma matriz para a filial', 'error');
    }

    if (!cnpj || cnpj.length !== 14) return this.toast('CNPJ inválido ou não preenchido', 'error');

    const data = {
      cnpj, razao_social, nome_fantasia, tipo, matriz_id, uf, ambiente, totvs_ativo, totvs_branch
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
  }
};

document.addEventListener('DOMContentLoaded', () => app.init());
