const db = require('./src/database/db.js');

(async () => {
  try {
    await db.initialize();
    await db.runSql("UPDATE notas_fiscais SET dominio_status = 'pendente', dominio_enviado_em = NULL, dominio_erro = NULL WHERE dominio_status = 'enviado'");
    console.log('✅ Status das notas resetado para pendente com sucesso! Pode tentar reenviar agora.');
    process.exit(0);
  } catch (err) {
    console.error('Erro:', err);
    process.exit(1);
  }
})();
