const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');
const SefazClient = require('../sefaz/client');
const TotvsService = require('../integracoes/totvs-service');
const DominioService = require('../integracoes/dominio-service');

module.exports = function (db, upload) {

  // ── Estatísticas ─────────────────────────────────────

  router.get('/estatisticas', (req, res) => {
    try {
      const { empresaId } = req.query;
      const stats = db.getEstatisticas(empresaId ? parseInt(empresaId) : null);
      res.json(stats);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // ── Configuração Legada (compatibilidade) ─────────────

  router.get('/config', (req, res) => {
    try {
      const config = db.getConfig();
      if (config && config.certificado_senha) config.certificado_senha = '••••••';
      res.json(config || {});
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  router.post('/config', (req, res) => {
    try {
      const configData = req.body;
      if (!configData.cnpj) return res.status(400).json({ error: 'CNPJ é obrigatório' });
      const config = db.saveConfig(configData);
      config.certificado_senha = config.certificado_senha ? '••••••' : '';
      res.json({ success: true, config });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  router.post('/config/totvs', (req, res) => {
    try {
      db.saveTotvsGlobalConfig(req.body);
      res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  router.get('/totvs/chaves-invalidas/download', (req, res) => {
    try {
      const filePath = path.join(__dirname, '..', '..', 'data', 'totvs_invalidas.txt');
      if (fs.existsSync(filePath)) {
        res.download(filePath, 'totvs_notas_sem_chave.txt');
      } else {
        res.status(404).send('Nenhum relatório de notas inválidas foi gerado ainda.');
      }
    } catch(err) { res.status(500).send(err.message); }
  });

  // ── Matrizes (para seleção em filiais) ──────────────

  router.get('/matrizes', (req, res) => {
    try {
      const matrizes = db.getMatrizes();
      res.json(matrizes);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // ── Empresas (multi-CNPJ) ─────────────────────────────

  router.get('/empresas', (req, res) => {
    try {
      const empresas = db.getEmpresas();
      // Mask passwords
      empresas.forEach(e => { if (e.certificado_senha) e.certificado_senha = '••••••'; });
      res.json(empresas);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  router.get('/empresas/:id', (req, res) => {
    try {
      const empresa = db.getEmpresaById(parseInt(req.params.id));
      if (!empresa) return res.status(404).json({ error: 'Empresa não encontrada' });
      empresa.certificado_senha = empresa.certificado_senha ? '••••••' : '';
      res.json(empresa);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  router.post('/empresas', (req, res) => {
    try {
      const { 
        cnpj, razao_social, nome_fantasia, tipo, matriz_id, uf, ambiente, certificado_senha,
        totvs_base_url, totvs_user, totvs_password, totvs_client_id, totvs_client_secret, totvs_branch, totvs_grant_type, totvs_ativo,
        dominio_integration_key, dominio_ativo, dominio_client_id, dominio_client_secret, dominio_auth_url, dominio_api_url
      } = req.body;
      if (!cnpj) return res.status(400).json({ error: 'CNPJ é obrigatório' });
      const empresa = db.createEmpresa({ 
        cnpj, razao_social, nome_fantasia, tipo, matriz_id, uf, ambiente, certificado_senha,
        totvs_base_url, totvs_user, totvs_password, totvs_client_id, totvs_client_secret, totvs_branch, totvs_grant_type, totvs_ativo,
        dominio_integration_key, dominio_ativo, dominio_client_id, dominio_client_secret, dominio_auth_url, dominio_api_url
      });
      empresa.certificado_senha = empresa.certificado_senha ? '••••••' : '';
      res.json({ success: true, empresa });
    } catch (err) {
      if (err.message.includes('UNIQUE')) return res.status(409).json({ error: 'CNPJ já cadastrado' });
      res.status(500).json({ error: err.message });
    }
  });

  router.put('/empresas/:id', (req, res) => {
    try {
      const { 
        razao_social, nome_fantasia, tipo, matriz_id, uf, ambiente,
        totvs_base_url, totvs_user, totvs_password, totvs_client_id, totvs_client_secret, totvs_branch, totvs_grant_type, totvs_ativo,
        dominio_integration_key, dominio_ativo, dominio_client_id, dominio_client_secret, dominio_auth_url, dominio_api_url
      } = req.body;
      const empresa = db.updateEmpresa(parseInt(req.params.id), {
        razao_social, nome_fantasia, tipo, matriz_id, uf, ambiente,
        totvs_base_url, totvs_user, totvs_password, totvs_client_id, totvs_client_secret, totvs_branch, totvs_grant_type, totvs_ativo,
        dominio_integration_key, dominio_ativo, dominio_client_id, dominio_client_secret, dominio_auth_url, dominio_api_url
      });
      empresa.certificado_senha = empresa.certificado_senha ? '••••••' : '';
      res.json({ success: true, empresa });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  router.delete('/empresas/:id', (req, res) => {
    try {
      db.deleteEmpresa(parseInt(req.params.id));
      res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // Upload certificado por empresa
  router.post('/empresas/:id/certificado', upload.single('certificado'), (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const empresa = db.getEmpresaById(id);
      if (!empresa) return res.status(404).json({ error: 'Empresa não encontrada' });
      if (!req.file) return res.status(400).json({ error: 'Arquivo .pfx não enviado' });

      // Salvar certificado com nome específico da empresa
      const certDir = path.join(__dirname, '..', '..', 'uploads');
      if (!fs.existsSync(certDir)) fs.mkdirSync(certDir, { recursive: true });

      const certFileName = `certificado_${empresa.cnpj}.pfx`;
      const certPath = path.join(certDir, certFileName);

      // req.file já foi salvo pelo multer como 'certificado.pfx', mover para nome específico
      const tmpPath = path.join(certDir, req.file.filename || 'certificado.pfx');
      fs.renameSync(tmpPath, certPath);

      db.updateEmpresaCertificado(id, req.file.originalname, certFileName);
      res.json({ success: true, filename: req.file.originalname, message: 'Certificado salvo com sucesso' });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // Atualizar senha do certificado
  router.post('/empresas/:id/senha', (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { senha } = req.body;
      if (!senha) return res.status(400).json({ error: 'Senha não informada' });
      db.updateEmpresaSenha(id, senha);
      res.json({ success: true, message: 'Senha atualizada' });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // ── Upload de Certificado (legado) ─────────────────────

  router.post('/config/certificado', upload.single('certificado'), (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: 'Arquivo .pfx não enviado' });
      const config = db.getConfig();
      if (config) db.saveConfig({ ...config, certificado_nome: req.file.originalname });
      res.json({ success: true, filename: req.file.originalname, message: 'Certificado salvo com sucesso' });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // ── Notas Fiscais ─────────────────────────────────────

  router.get('/notas', (req, res) => {
    try {
      const { tipo, busca, dataInicio, dataFim, pagina, limite, empresaId, modelo } = req.query;
      const result = db.getNotas({
        tipo, busca, modelo, dataInicio, dataFim,
        empresaId: empresaId ? parseInt(empresaId) : null,
        pagina: parseInt(pagina) || 1,
        limite: parseInt(limite) || 50
      });
      res.json(result);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  router.get('/notas/:id', (req, res) => {
    try {
      const nota = db.getNotaById(parseInt(req.params.id));
      if (!nota) return res.status(404).json({ error: 'Nota não encontrada' });
      res.json(nota);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  router.get('/notas/:id/xml', (req, res) => {
    try {
      const nota = db.getNotaById(parseInt(req.params.id));
      if (!nota) return res.status(404).json({ error: 'Nota não encontrada' });
      res.set('Content-Type', 'application/xml');
      res.set('Content-Disposition', `attachment; filename="NFe_${nota.chave_acesso}.xml"`);
      res.send(nota.xml_completo);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  router.delete('/notas/:id', (req, res) => {
    try {
      db.deleteNota(parseInt(req.params.id));
      res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // ── Importação Manual de XML ──────────────────────────

  router.post('/importar-xml', (req, res) => {
    try {
      const { xml_content, empresa_id } = req.body;
      if (!xml_content) return res.status(400).json({ error: 'Conteúdo XML não fornecido' });
      
      const xmlParser = require('../sefaz/xml-parser');
      const info = xmlParser.getChaveAcessoFromXml(xml_content);
      if (info && info.chave) {
        const existente = db.getNotaByChave(info.chave);
        if (existente) {
          return res.json({ success: true, message: 'Nota já existente no banco. Pulada.', pulada: true });
        }
      }

      const empresa = empresa_id ? db.getEmpresaById(parseInt(empresa_id)) : db.getConfig();
      const cnpj = empresa ? empresa.cnpj : '';
      const parsed = xmlParser.parseNFeXml(xml_content, cnpj);
      if (!parsed) return res.status(400).json({ error: 'Não foi possível interpretar o XML' });
      
      parsed.xml_completo = xml_content;
      const success = db.insertNota(parsed, empresa ? empresa.id : null);
      
      if (success) {
        res.json({ success: true, nota: parsed, message: 'NF-e importada com sucesso' });
      } else {
        res.status(500).json({ error: 'Erro ao salvar NF-e no banco' });
      }
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // ── Sincronização SEFAZ ──────────────────────────────

  // Diagnóstico
  router.get('/sefaz/status', (req, res) => {
    try {
      const { empresaId } = req.query;
      const empresa = empresaId ? db.getEmpresaById(parseInt(empresaId)) : db.getConfig();
      if (!empresa) return res.json({ configurado: false });

      const certFile = empresa.certificado_arquivo || 'certificado.pfx';
      const certPath = path.join(__dirname, '..', '..', 'uploads', certFile);
      const certExiste = fs.existsSync(certPath);

      res.json({
        configurado: !!empresa.cnpj,
        cnpj: empresa.cnpj, uf: empresa.uf, ambiente: empresa.ambiente,
        ultimoNSU: empresa.ultimo_nsu,
        certificado: {
          existe: certExiste,
          nome: empresa.certificado_nome,
          tamanhoBytes: certExiste ? fs.statSync(certPath).size : 0,
          senhaConfigurada: !!empresa.certificado_senha
        }
      });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // Reset NSU
  router.post('/sefaz/reset-nsu', (req, res) => {
    try {
      const { nsu, empresa_id } = req.body;
      const nsuFormatado = String(nsu || '0').replace(/\D/g, '').padStart(15, '0');
      if (empresa_id) {
        db.updateEmpresaNSU(parseInt(empresa_id), nsuFormatado);
      } else {
        db.updateUltimoNSU(nsuFormatado);
      }
      res.json({ success: true, ultimoNSU: nsuFormatado });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // Sincronizar empresa específica ou padrão
  router.post('/sefaz/sincronizar', async (req, res) => {
    try {
      const { empresa_id } = req.body;
      const empresa = empresa_id ? db.getEmpresaById(parseInt(empresa_id)) : db.getConfig();

      if (!empresa || !empresa.cnpj) {
        return res.status(400).json({ error: 'Configure o CNPJ antes de sincronizar' });
      }

      // ── Resolver certificado (filial usa cert da matriz) ──
      const resolveCert = (emp) => {
        if (emp.tipo === 'filial' && emp.matriz_id) {
          const matriz = db.getEmpresaById(emp.matriz_id);
          if (matriz) {
            return {
              certFile: matriz.certificado_arquivo || `certificado_${matriz.cnpj}.pfx`,
              certSenha: matriz.certificado_senha,
              certNome: matriz.certificado_nome,
              via: `Matriz: ${matriz.razao_social || matriz.cnpj}`
            };
          }
        }
        return {
          certFile: emp.certificado_arquivo || 'certificado.pfx',
          certSenha: emp.certificado_senha,
          certNome: emp.certificado_nome,
          via: 'Próprio'
        };
      };

      const cert = resolveCert(empresa);
      const certPath = path.join(__dirname, '..', '..', 'uploads', cert.certFile);

      if (!fs.existsSync(certPath)) {
        const msg = empresa.tipo === 'filial' && empresa.matriz_id
          ? `Certificado da matriz não encontrado. Verifique se a matriz possui um .pfx carregado.`
          : `Certificado digital não encontrado. Faça o upload do arquivo .pfx`;
        return res.status(400).json({ error: msg });
      }
      if (!cert.certSenha) {
        const msg = empresa.tipo === 'filial' && empresa.matriz_id
          ? `Senha do certificado da matriz não configurada.`
          : `Senha do certificado não configurada`;
        return res.status(400).json({ error: msg });
      }

      const client = new SefazClient({
        cnpj: empresa.cnpj,
        uf: empresa.uf,
        ambiente: empresa.ambiente,
        certificadoPath: certPath,
        certificadoSenha: cert.certSenha
      });
      console.log(`🔐 Cert via: ${cert.via} | Consultando CNPJ: ${empresa.cnpj}`);

      const result = await client.sincronizarTudo(empresa.ultimo_nsu);

      let savedCount = 0;
      if (result.documentos.length > 0) {
        savedCount = db.insertNotas(result.documentos, empresa.id);
      }

      if (result.ultimoNSU && result.ultimoNSU !== '000000000000000') {
        db.updateEmpresaNSU(empresa.id, result.ultimoNSU);
      }

      let message = 'Sincronização concluída';
      let consumoIndevido = false;

      if (result.documentos.length > 0) {
        message = `${savedCount} nota(s) importada(s) com sucesso`;
      } else if (result.ultimoNSU && result.ultimoNSU !== empresa.ultimo_nsu && result.ultimoNSU !== '000000000000000') {
        message = `⚠️ SEFAZ: Consumo indevido. NSU ${result.ultimoNSU} salvo. Aguarde ~1 hora e sincronize novamente.`;
        consumoIndevido = true;
      } else {
        message = 'Nenhum documento novo encontrado';
      }

      res.json({ success: true, message, consumoIndevido, documentosEncontrados: result.documentos.length, documentosSalvos: savedCount, ultimoNSU: result.ultimoNSU, totalRequests: result.totalRequests });
    } catch (err) {
      console.error('Erro na sincronização:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // Sincronizar TODAS as empresas
  router.post('/sefaz/sincronizar-todas', async (req, res) => {
    try {
      const empresas = db.getEmpresas();
      const resultados = [];

      for (const empresa of empresas) {
        const certFile = empresa.certificado_arquivo || 'certificado.pfx';
        const certPath = path.join(__dirname, '..', '..', 'uploads', certFile);

        if (!fs.existsSync(certPath) || !empresa.certificado_senha) {
          resultados.push({ empresa: empresa.razao_social || empresa.cnpj, status: 'sem_certificado' });
          continue;
        }

        try {
          const client = new SefazClient({
            cnpj: empresa.cnpj, uf: empresa.uf, ambiente: empresa.ambiente,
            certificadoPath: certPath, certificadoSenha: empresa.certificado_senha
          });

          const result = await client.sincronizarTudo(empresa.ultimo_nsu);
          const savedCount = result.documentos.length > 0 ? db.insertNotas(result.documentos, empresa.id) : 0;
          if (result.ultimoNSU && result.ultimoNSU !== '000000000000000') {
            db.updateEmpresaNSU(empresa.id, result.ultimoNSU);
          }
          resultados.push({ empresa: empresa.razao_social || empresa.cnpj, cnpj: empresa.cnpj, salvos: savedCount, nsu: result.ultimoNSU });
        } catch (e) {
          resultados.push({ empresa: empresa.razao_social || empresa.cnpj, cnpj: empresa.cnpj, erro: e.message });
        }

        // Delay entre empresas para não sobrecarregar a SEFAZ
        if (empresas.indexOf(empresa) < empresas.length - 1) {
          await new Promise(r => setTimeout(r, 2000));
        }
      }

      res.json({ success: true, resultados });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  router.post('/sefaz/consultar-chave', async (req, res) => {
    try {
      const { chave, empresa_id } = req.body;
      if (!chave || chave.length !== 44) return res.status(400).json({ error: 'Chave de acesso inválida (deve ter 44 dígitos)' });
      const empresa = empresa_id ? db.getEmpresaById(parseInt(empresa_id)) : db.getConfig();
      if (!empresa) return res.status(400).json({ error: 'Configure o CNPJ primeiro' });

      const certFile = empresa.certificado_arquivo || 'certificado.pfx';
      const certPath = path.join(__dirname, '..', '..', 'uploads', certFile);
      if (!fs.existsSync(certPath)) return res.status(400).json({ error: 'Certificado digital não encontrado' });

      const client = new SefazClient({
        cnpj: empresa.cnpj, uf: empresa.uf, ambiente: empresa.ambiente,
        certificadoPath: certPath, certificadoSenha: empresa.certificado_senha
      });

      const result = await client.consultarChaveNFe(chave);
      if (result.chave_acesso) {
        result.xml_completo = result.xml_completo || '';
        db.insertNota(result, empresa.id);
        res.json({ success: true, nota: result });
      } else {
        res.json({ success: false, status: result.status, motivo: result.motivo });
      }
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // ── Importação Manual de Saídas (ZIP) ─────────────────

  const AdmZip = require('adm-zip');

  router.post('/upload-saidas/:empresaId', upload.single('file'), async (req, res) => {
    try {
      const empresaId = req.params.empresaId;
      const empresa = db.getEmpresaById(empresaId);
      
      if (!empresa) return res.status(404).json({ error: 'Empresa não encontrada' });
      if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo .zip enviado' });

      console.log(`\n📦 Iniciando extração de ZIP de Saídas para CNPJ: ${empresa.cnpj}`);
      
      const zip = new AdmZip(req.file.buffer);
      const zipEntries = zip.getEntries();
      
      let xmlsEncontrados = 0;
      let notasSalvas = 0;
      
      const documentos = [];

      for (const entry of zipEntries) {
        if (!entry.isDirectory && entry.entryName.toLowerCase().endsWith('.xml')) {
          xmlsEncontrados++;
          const xmlContent = entry.getData().toString('utf8');
          
          let parsed = xmlParser.parseNFeXml(xmlContent, empresa.cnpj);
          if (!parsed) parsed = xmlParser.parseResNFe(xmlContent, empresa.cnpj);

          if (parsed) {
            // Força o tipo como saída, caso o parser não consiga determinar sozinho pela estrutura do XML de terceiros
            if (parsed.emitente_cnpj === empresa.cnpj.replace(/\D/g, '')) {
               parsed.tipo = 'saida';
            }
            parsed.xml_completo = xmlContent;
            parsed.schema_type = parsed.schema_type || 'procNFe';
            parsed.nsu = ''; // Upload manual não tem NSU
            
            documentos.push(parsed);
          }
        }
      }

      if (documentos.length > 0) {
        notasSalvas = db.insertNotas(documentos, empresa.id);
      }

      console.log(`✅ Extração concluída. ${xmlsEncontrados} XMLs lidos. ${notasSalvas} notas salvas/atualizadas.`);
      
      res.json({
        success: true,
        encontrados: xmlsEncontrados,
        processados: documentos.length,
        salvos: notasSalvas
      });

    } catch (err) {
      console.error('Erro ao processar ZIP de Saídas:', err);
      res.status(500).json({ error: 'Erro interno ao processar o arquivo ZIP: ' + err.message });
    }
  });





  // ── Integração TOTVS ──────────────────────────────────
  router.get('/totvs/logs', (req, res) => {
    try {
      const fs = require('fs');
      const logPath = path.join(__dirname, '..', '..', 'totvs_sync.log');
      if (fs.existsSync(logPath)) {
        res.send(fs.readFileSync(logPath, 'utf8'));
      } else {
        res.send('Aguardando início do processo...');
      }
    } catch (err) { res.status(500).send(err.message); }
  });

  router.post('/totvs/extrair', express.json(), async (req, res) => {
    try {
      const { empresaId, mesReferencia } = req.body;
      const service = new TotvsService(db);
      
      // Envia resposta imediata para evitar timeout
      res.json({ success: true, message: 'Extração TOTVS iniciada em segundo plano.' });

      service.extrair(empresaId, mesReferencia)
        .then(result => {
          console.log(`[TOTVS] Finalizado para empresa ${empresaId}:`, result);
        })
        .catch(err => {
          console.error(`[TOTVS] Erro na extração para empresa ${empresaId}:`, err.message);
        });

    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Integração Domínio (Thomson Reuters) ──────────────

  // Estatísticas Domínio
  router.get('/dominio/stats', (req, res) => {
    try {
      const { empresaId } = req.query;
      const stats = db.getDominioStats(empresaId ? parseInt(empresaId) : null);
      res.json(stats);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // Testar conexão Domínio
  router.post('/dominio/testar', async (req, res) => {
    try {
      const { empresaId } = req.body;
      if (!empresaId) return res.status(400).json({ error: 'Selecione uma empresa' });
      const service = new DominioService(db);
      const result = await service.testarConexao(parseInt(empresaId));
      res.json(result);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // Enviar notas para Domínio (background)
  router.post('/dominio/enviar', async (req, res) => {
    try {
      const { empresaId, dataInicio, dataFim, tipo, reenviar } = req.body;
      if (!empresaId) return res.status(400).json({ error: 'Selecione uma empresa' });
      
      const service = new DominioService(db);
      
      // Retorna imediato para evitar timeout
      res.json({ success: true, message: 'Envio para Domínio iniciado em segundo plano.' });
      
      service.enviar(parseInt(empresaId), { dataInicio, dataFim, tipo, reenviar })
        .then(result => {
          console.log(`[DOMÍNIO] Finalizado para empresa ${empresaId}:`, result);
        })
        .catch(err => {
          console.error(`[DOMÍNIO] Erro no envio para empresa ${empresaId}:`, err.message);
        });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Enviar nota individual para Domínio
  router.post('/dominio/enviar-nota/:notaId', async (req, res) => {
    try {
      const notaId = parseInt(req.params.notaId);
      const nota = db.getNotaById(notaId);
      if (!nota) return res.status(404).json({ error: 'Nota não encontrada' });
      if (!nota.xml_completo) return res.status(400).json({ error: 'Nota sem XML disponível' });

      const empresa = nota.empresa_id ? db.getEmpresaById(nota.empresa_id) : null;
      if (!empresa || !empresa.dominio_ativo) {
        return res.status(400).json({ error: 'Integração Domínio não ativa para esta empresa' });
      }

      const globalConfig = db.getConfig() || {};
      const DominioClient = require('../integracoes/dominio');
      const client = new DominioClient({
        dominio_client_id: empresa.dominio_client_id || globalConfig.dominio_client_id || '',
        dominio_client_secret: empresa.dominio_client_secret || globalConfig.dominio_client_secret || '',
        dominio_integration_key: empresa.dominio_integration_key || '',
        dominio_auth_url: empresa.dominio_auth_url || globalConfig.dominio_auth_url || '',
        dominio_api_url: empresa.dominio_api_url || globalConfig.dominio_api_url || ''
      });

      db.updateDominioStatus(notaId, 'enviando');
      const result = await client.enviarXml(nota.xml_completo, {
        chave: nota.chave_acesso,
        tipo: nota.tipo,
        numero: nota.numero_nf
      });

      if (result.success) {
        db.updateDominioStatus(notaId, 'enviado', null, result.batchId);
        res.json({ success: true, message: 'Nota enviada ao Domínio com sucesso!' });
      } else {
        db.updateDominioStatus(notaId, 'erro', result.error);
        res.json({ success: false, error: result.error });
      }
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Logs Domínio
  router.get('/dominio/logs', (req, res) => {
    try {
      const logPath = path.join(__dirname, '..', '..', 'dominio_sync.log');
      if (fs.existsSync(logPath)) {
        res.send(fs.readFileSync(logPath, 'utf8'));
      } else {
        res.send('Aguardando início do processo...');
      }
    } catch (err) { res.status(500).send(err.message); }
  });

  // Salvar config global Domínio
  router.post('/config/dominio', (req, res) => {
    try {
      db.saveDominioGlobalConfig(req.body);
      res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // ── Exportação ───────────────────────────────────────

  router.get('/exportar/:formato', (req, res) => {
    try {
      const { formato } = req.params;
      const { tipo, dataInicio, dataFim, empresaId, modelo } = req.query;
      const notas = db.getAllNotasForExport({ tipo, dataInicio, dataFim, empresaId: empresaId ? parseInt(empresaId) : null, modelo });

      if (notas.length === 0) return res.status(404).json({ error: 'Nenhuma nota encontrada para exportar' });

      if (formato === 'csv') {
        const header = 'Chave Acesso;Numero NF;Serie;Data Emissao;Valor Total;Emitente CNPJ;Emitente Nome;Destinatario CNPJ;Destinatario Nome;Tipo;Situacao\n';
        const rows = notas.map(n => `${n.chave_acesso};${n.numero_nf};${n.serie};${n.data_emissao};${n.valor_total};${n.emitente_cnpj};${n.emitente_nome};${n.destinatario_cnpj};${n.destinatario_nome};${n.tipo};${n.situacao}`).join('\n');
        res.set('Content-Type', 'text/csv; charset=utf-8');
        res.set('Content-Disposition', `attachment; filename="notas_fiscais_${Date.now()}.csv"`);
        res.send('\ufeff' + header + rows);
      } else if (formato === 'xlsx') {
        const data = notas.map(n => ({
          'Chave de Acesso': n.chave_acesso.toString(), 
          'Número NF': n.numero_nf, 
          'Série': n.serie,
          'Data Emissão': n.data_emissao, 
          'Valor Total': n.valor_total,
          'Emitente CNPJ': n.emitente_cnpj, 
          'Emitente Nome': n.emitente_nome,
          'Destinatário CNPJ': n.destinatario_cnpj, 
          'Destinatário Nome': n.destinatario_nome,
          'Tipo': n.tipo, 
          'Situação': n.situacao
        }));
        
        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.json_to_sheet(data);
        
        // Força o formato de TEXTO em todas as células da primeira coluna (Chave de Acesso)
        Object.keys(ws).forEach(key => {
          if (key.startsWith('A')) { // Coluna A é a Chave de Acesso
            ws[key].z = '@'; // Formato de texto no Excel
            ws[key].t = 's'; // Tipo string no objeto XLSX
          }
        });

        ws['!cols'] = [{ wch: 50 }, { wch: 12 }, { wch: 6 }, { wch: 22 }, { wch: 14 }, { wch: 18 }, { wch: 40 }, { wch: 18 }, { wch: 40 }, { wch: 10 }, { wch: 12 }];
        XLSX.utils.book_append_sheet(wb, ws, 'Notas Fiscais');
        res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.set('Content-Disposition', `attachment; filename="notas_fiscais_${Date.now()}.xlsx"`);
        res.send(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
      } else if (formato === 'json') {
        res.set('Content-Disposition', `attachment; filename="notas_fiscais_${Date.now()}.json"`);
        res.json(notas.map(n => ({ chave_acesso: n.chave_acesso, numero_nf: n.numero_nf, serie: n.serie, data_emissao: n.data_emissao, valor_total: n.valor_total, emitente_cnpj: n.emitente_cnpj, emitente_nome: n.emitente_nome, destinatario_cnpj: n.destinatario_cnpj, destinatario_nome: n.destinatario_nome, tipo: n.tipo, situacao: n.situacao })));
      } else if (formato === 'xml') {
        let xmlOutput = '<?xml version="1.0" encoding="UTF-8"?>\n<notasFiscais>\n';
        notas.forEach(n => { if (n.xml_completo) xmlOutput += `  <nota chave="${n.chave_acesso}">\n    ${n.xml_completo}\n  </nota>\n`; });
        xmlOutput += '</notasFiscais>';
        res.set('Content-Type', 'application/xml');
        res.set('Content-Disposition', `attachment; filename="notas_fiscais_${Date.now()}.xml"`);
        res.send(xmlOutput);
      } else {
        res.status(400).json({ error: 'Formato inválido. Use: csv, xlsx, json ou xml' });
      }
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  return router;
};
