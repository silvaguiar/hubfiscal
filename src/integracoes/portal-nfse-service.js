const PortalNfseClient = require('./portal-nfse');

class PortalNfseService {
  constructor(db) {
    this.db = db;
    this.logId = null;
    this.logBuffer = '';
    this.lastDbFlush = 0;
  }

  writeLog(msg) {
    const time = new Date().toLocaleTimeString('pt-BR');
    const line = `[${time}] ${msg}\n`;
    this.logBuffer += line;
    console.log(line.trim());
    if (this.logId && Date.now() - this.lastDbFlush >= 3000) {
      this.db.updateLogExecucao(this.logId, { detalhes: this.logBuffer }).catch(() => {});
      this.lastDbFlush = Date.now();
    }
  }

  async sincronizar(empresaId, dataInicio, dataFim, logId = null) {
    const inicio = Date.now();
    this.logId = logId;

    if (!this.logId) {
      this.logId = await this.db.registrarLogExecucao({
        empresa_id: empresaId || null,
        tipo: 'portal_nfse',
        status: 'executando',
        notas_encontradas: 0,
        notas_inseridas: 0,
        detalhes: 'Iniciando sincronização Portal Nacional NFS-e...',
        duracao_ms: 0
      });
    }

    let empresas = [];

    if (empresaId) {
      const emp = await this.db.getEmpresaById(parseInt(empresaId));
      if (!emp) throw new Error('Empresa não encontrada.');
      empresas = [emp];
    } else {
      const todas = await this.db.getEmpresas();
      empresas = todas.filter(e => e.nfse_ativo == 1 || e.nfse_ativo === true || e.nfse_ativo === 'true');
      if (empresas.length === 0) throw new Error('Nenhuma empresa com Portal NFS-e ativo.');
    }

    this.writeLog(`📋 ${empresas.length} empresa(s) | Período: ${dataInicio} → ${dataFim}`);

    let totalEncontradas = 0;
    let totalSalvas = 0;
    const resultados = [];

    for (let i = 0; i < empresas.length; i++) {
      const empresa = empresas[i];

      // Filial reutiliza certificado da matriz (mesmo padrão do SEFAZ NF-e)
      let certBase64 = empresa.certificado_arquivo;
      let certSenha = empresa.certificado_senha;
      if (empresa.tipo === 'filial' && empresa.matriz_id) {
        const matriz = await this.db.getEmpresaById(empresa.matriz_id);
        if (matriz) {
          certBase64 = matriz.certificado_arquivo;
          certSenha = matriz.certificado_senha;
        }
      }

      if (!certBase64 || !certSenha) {
        this.writeLog(`⚠️ ${empresa.razao_social || empresa.cnpj}: sem certificado. Pulando.`);
        resultados.push({ empresa: empresa.razao_social || empresa.cnpj, erro: 'sem_certificado' });
        continue;
      }

      try {
        const client = new PortalNfseClient({
          cnpj: empresa.cnpj,
          ambiente: empresa.ambiente || 'producao',
          certificadoBase64: certBase64,
          certificadoSenha: certSenha
        });

        const documentos = await client.consultarTudo(dataInicio, dataFim, 0, (msg) => this.writeLog(msg));
        totalEncontradas += documentos.length;

        let salvas = 0;
        if (documentos.length > 0) {
          salvas = await this.db.insertNotas(documentos, empresa.id);
          totalSalvas += salvas;
        }

        await this.db.runSql(
          'UPDATE empresas SET nfse_ultimo_sync = CURRENT_TIMESTAMP WHERE id = ?',
          [empresa.id]
        );

        this.writeLog(`✅ ${empresa.razao_social || empresa.cnpj}: ${documentos.length} encontradas, ${salvas} salvas.`);
        resultados.push({ empresa: empresa.razao_social || empresa.cnpj, encontradas: documentos.length, salvas });

      } catch (err) {
        this.writeLog(`❌ ${empresa.razao_social || empresa.cnpj}: ${err.message}`);
        resultados.push({ empresa: empresa.razao_social || empresa.cnpj, erro: err.message });
      }

      // Delay entre empresas para não sobrecarregar o portal
      if (i < empresas.length - 1) await new Promise(r => setTimeout(r, 1500));
    }

    // Mantém o log de texto completo (com linhas [debug]) e embute o resumo no final
    this.writeLog(`##CONCLUIDO## ${JSON.stringify({ dataInicio, dataFim, totalEncontradas, totalSalvas, resultados })}`);
    await this.db.updateLogExecucao(this.logId, {
      status: 'sucesso',
      notas_encontradas: totalEncontradas,
      notas_inseridas: totalSalvas,
      detalhes: this.logBuffer,
      duracao_ms: Date.now() - inicio
    });

    return { encontradas: totalEncontradas, salvas: totalSalvas, resultados };
  }
}

module.exports = PortalNfseService;
