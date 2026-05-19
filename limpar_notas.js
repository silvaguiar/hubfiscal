const db = require('./src/database/db');

(async () => {
  await db.initialize();
  console.log('Apagando notas fiscais...');
  
  await db.runSql('DELETE FROM notas_fiscais');
  
  // Opcional: zerar também o contador de sincronização da SEFAZ
  // await db.runSql("UPDATE empresas SET ultimo_nsu='000000000000000'");
  
  console.log('✅ Todas as notas foram apagadas do banco de dados com sucesso!');
  process.exit(0);
})();
