// Prepara o Chatwoot para mostrar as pendências sem sair dele:
//  - etiquetas de pendência visíveis no menu lateral (clicou, viu a lista);
//  - aba "Pendências" dentro de cada conversa (Dashboard App) abrindo o painel embutido.

const LABEL_INFO = {
  pediuAtendente: { color: '#E5484D', description: 'Cliente pediu atendente e nenhum humano respondeu' },
  retornoPrometido: { color: '#F76B15', description: 'Equipe prometeu retorno e ainda não voltou' },
  semResposta: { color: '#FFC53D', description: 'Cliente falou por último e ninguém respondeu' },
};

export async function prepararChatwoot({ client, config, logger = console }) {
  const feito = [];
  if (config.labels.sync) {
    const existentes = new Set((await client.listLabels()).map((l) => l.title));
    for (const [chave, info] of Object.entries(LABEL_INFO)) {
      const title = config.labels[chave];
      if (title && !existentes.has(title)) {
        await client.createLabel({ title, ...info });
        feito.push(`etiqueta ${title}`);
      }
    }
  }
  if (config.publicUrl) {
    const url = `${config.publicUrl}/?embed=1`;
    const apps = await client.listDashboardApps();
    if (!apps.some((a) => a.urls.some((u) => u && u.startsWith(config.publicUrl)))) {
      await client.createDashboardApp({ title: config.dashboardAppTitle, url });
      feito.push(`aba "${config.dashboardAppTitle}" nas conversas`);
    }
  }
  if (feito.length) logger.info(`[chatwoot] criado: ${feito.join(', ')}`);
  return feito;
}
