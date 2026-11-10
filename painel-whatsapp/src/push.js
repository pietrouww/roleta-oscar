// Notificações no celular (Web Push). No iPhone funciona com o app adicionado à Tela de Início (iOS 16.4+).
import webpush from 'web-push';

export class PushService {
  constructor({ store, config, logger = console }) {
    this.store = store;
    this.log = logger;
    let keys = config.push.publicKey && config.push.privateKey
      ? { publicKey: config.push.publicKey, privateKey: config.push.privateKey }
      : store.read('vapid.json', null);
    if (!keys) {
      keys = webpush.generateVAPIDKeys();
      store.write('vapid.json', keys);
      this.log.info('[push] chaves VAPID geradas em data/vapid.json');
    }
    this.publicKey = keys.publicKey;
    webpush.setVapidDetails(config.push.subject, keys.publicKey, keys.privateKey);
  }

  subscriptions() {
    return this.store.read('subscriptions.json', []);
  }

  subscribe(sub, user) {
    if (!sub?.endpoint) throw new Error('inscrição inválida');
    const list = this.subscriptions().filter((s) => s.sub.endpoint !== sub.endpoint);
    list.push({ sub, user: { id: user.id, name: user.name }, at: new Date().toISOString() });
    this.store.write('subscriptions.json', list);
  }

  unsubscribe(endpoint) {
    this.store.write('subscriptions.json', this.subscriptions().filter((s) => s.sub.endpoint !== endpoint));
  }

  async sendAll(payload, filter = () => true) {
    const list = this.subscriptions();
    const dead = new Set();
    await Promise.all(
      list.filter(filter).map(async (s) => {
        try {
          await webpush.sendNotification(s.sub, JSON.stringify(payload), { TTL: 3600 });
        } catch (err) {
          if (err.statusCode === 404 || err.statusCode === 410) dead.add(s.sub.endpoint);
          else this.log.error('[push]', err.statusCode || '', err.message);
        }
      }),
    );
    if (dead.size) this.store.write('subscriptions.json', list.filter((s) => !dead.has(s.sub.endpoint)));
    return list.length - dead.size;
  }
}
