// Prepara o Chatwoot para mostrar as pendências sem sair dele:
//  - uma etiqueta "pendencia" que aparece na própria conversa da lista (como etiqueta do WhatsApp Business);
//  - aba "Pendências" dentro de cada conversa (Dashboard App) abrindo o painel embutido.


export async function prepararChatwoot({ client, config, logger = console }) {
  const feito = [];
  if (config.labels.sync) {
    const existentes = new Set((await client.listLabels()).map((l) => l.title));
    const title = config.labels.pendencia;
    if (title && !existentes.has(title)) {
      await client.createLabel({
        title,
        color: '#E5484D',
        description: 'Cliente aguardando retorno da equipe (colocada e retirada pelo painel)',
        showOnSidebar: false,
      });
      feito.push(`etiqueta ${title}`);
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
