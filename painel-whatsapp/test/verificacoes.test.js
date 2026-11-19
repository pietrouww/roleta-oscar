// Verificações de hora em hora e o acompanhamento do que continua pendente entre elas.
import test from 'node:test';
import assert from 'node:assert/strict';
import { expandirHorarios } from '../src/config.js';
import { Scheduler, avancar } from '../src/scheduler.js';

const quieto = { error() {}, info() {} };
const item = (id) => ({ id, contactName: `Cliente ${id}`, flags: [], waitingMinutes: 10 });

test('horários: faixa com intervalo vira lista; horários soltos continuam valendo', () => {
  assert.deepEqual(expandirHorarios(['08:00-18:00/60']), ['08:00', '09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00', '18:00']);
  assert.deepEqual(expandirHorarios(['08:30', '12:00', '17:00']), ['08:30', '12:00', '17:00']);
  assert.deepEqual(expandirHorarios(['12:00', '08:00-09:00/30', '08:30']), ['08:00', '08:30', '09:00', '12:00']);
});

test('acompanhamento: conta em quantas verificações a conversa apareceu e tira quem foi resolvido', () => {
  let a = avancar(null, [item(1), item(2)], [], { date: '2026-11-18', time: '09:00', at: '2026-11-18T12:00:00.000Z' });
  assert.deepEqual(a.ultima, { date: '2026-11-18', time: '09:00', at: '2026-11-18T12:00:00.000Z', total: 2, novas: 2, resolvidas: 0 });
  a = avancar(a, [item(2), item(3)], [], { date: '2026-11-18', time: '10:00', at: '2026-11-18T13:00:00.000Z' });
  assert.equal(a.conv[1], undefined, 'a 1 foi respondida: sai');
  assert.deepEqual(a.conv[2], { primeira: '2026-11-18T12:00:00.000Z', vezes: 2, ultima: '2026-11-18T13:00:00.000Z' });
  assert.equal(a.conv[3].vezes, 1);
  assert.deepEqual({ novas: a.ultima.novas, resolvidas: a.ultima.resolvidas }, { novas: 1, resolvidas: 1 });
  // Adiada: continua acompanhada, sem contar a verificação
  a = avancar(a, [item(3)], [item(2)], { date: '2026-11-18', time: '11:00', at: '2026-11-18T14:00:00.000Z' });
  assert.equal(a.conv[2].vezes, 2);
  assert.equal(a.ultima.resolvidas, 0);
});

function agenda({ itens = [], adiadas = [], dados = {}, times = ['08:00', '09:00', '10:00'] } = {}) {
  const arquivos = { ...dados };
  const snaps = {};
  const enviados = [];
  const store = {
    read: (n, d) => (n in arquivos ? arquivos[n] : d),
    write: (n, v) => { arquivos[n] = v; },
    saveCheck: (d, t, v) => { (snaps[d] ||= {})[t] = v; },
    getCheck: (d, t) => snaps[d]?.[t] || null,
    listChecks: (d) => Object.keys(snaps[d] || {}).sort(),
    listCheckDays: () => Object.keys(snaps).sort(),
  };
  const estado = { itens, adiadas };
  const engine = { scan: async () => ({ items: estado.itens, adiadas: estado.adiadas, totals: { total: estado.itens.length, urgentes: 0 }, inboxes: [] }) };
  const config = { checks: { times, days: '1-6' }, timezone: 'America/Sao_Paulo', live: { intervalMinutes: 5, alertWindow: '07:00-19:00' }, rules: { promiseAlertMinutes: 120 } };
  const s = new Scheduler({ engine, store, push: { sendAll: async (m) => enviados.push(m) }, config, logger: quieto });
  return { s, estado, arquivos, snaps, enviados };
}

test('verificação: só o que já foi verificado e continua pendente entra na lista', async () => {
  const a = agenda({ itens: [item(1), item(2)] });
  await a.s.runCheck('09:00');
  assert.equal(a.enviados.length, 1);
  assert.match(a.enviados[0].title, /Verificação das 09:00: 2 pendências/);
  assert.match(a.enviados[0].body, /2 novas/);
  assert.equal(a.enviados[0].tag, 'verificacao');
  // Agora: a 1 foi respondida, a 2 continua e chegou a 3 (ainda não verificada)
  const agora = { items: [item(2), item(3)], adiadas: [] };
  const v = a.s.verificadasPendentes(agora);
  assert.deepEqual(v.itens.map((i) => i.id), [2]);
  assert.equal(v.itens[0].verificacao.vezes, 1);
  assert.equal(v.aindaNaoVerificadas, 1);
  assert.equal(v.ultima.time, '09:00');
});

test('verificação sem pendências não manda aviso; avisa uma vez quando a lista zera', async () => {
  const a = agenda({ itens: [] });
  await a.s.runCheck('09:00');
  assert.equal(a.enviados.length, 0);
  a.estado.itens = [item(5)];
  await a.s.runCheck('10:00');
  a.estado.itens = [];
  await a.s.runCheck('11:00');
  assert.equal(a.enviados.length, 2);
  assert.match(a.enviados[1].body, /Tudo respondido/);
  await a.s.runCheck('12:00');
  assert.equal(a.enviados.length, 2, 'continua vazio: sem aviso');
});

test('acompanhamento começa das verificações já guardadas', () => {
  const a = agenda();
  a.snaps['2026-11-17'] = { '17:00': { createdAt: '2026-11-17T20:00:00.000Z', items: [item(7)] } };
  a.snaps['2026-11-18'] = { '08:30': { createdAt: '2026-11-18T11:30:00.000Z', items: [item(7), item(8)] } };
  const v = a.s.verificadasPendentes({ items: [item(7), item(8), item(9)], adiadas: [] });
  assert.deepEqual(v.itens.map((i) => [i.id, i.verificacao.vezes]), [[7, 2], [8, 1]], 'a mais antiga vem primeiro');
  assert.equal(v.itens[0].verificacao.primeira, '2026-11-17T20:00:00.000Z');
});

test('próxima verificação: ainda hoje, ou no próximo dia útil', () => {
  const a = agenda({ times: ['08:00', '12:00', '18:00'] });
  // quarta 18/11/2026 10:00 em São Paulo (13:00 UTC)
  assert.deepEqual(a.s.proxima(new Date('2026-11-18T13:00:00Z')), { date: '2026-11-18', time: '12:00' });
  // sábado 21/11/2026 19:00 em São Paulo: domingo não tem; vai para segunda
  assert.deepEqual(a.s.proxima(new Date('2026-11-21T22:00:00Z')), { date: '2026-11-23', time: '08:00' });
});
