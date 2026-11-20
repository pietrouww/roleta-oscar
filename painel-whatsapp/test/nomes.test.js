// Nome dos contatos: preencher quem aparece só com número, a partir da agenda dos celulares,
// do cadastro externo e do nome de perfil do WhatsApp. Nunca troca um nome que já existe.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Nomes, semNome, chaveTelefone } from '../src/nomes.js';

const quieto = { error() {}, info() {} };

test('sem nome: número, ponto, emoji e "Sem nome"; com nome: qualquer coisa com letras', () => {
  for (const n of ['', '.', '554198634279', '+55 41 9863-4279', '♛ 🇧🇷 🇮🇱', 'Sem nome', 'A']) assert.equal(semNome(n), true, n);
  for (const n of ['Ary', 'iPlay Parts', 'Zé', 'Maria ♡']) assert.equal(semNome(n), false, n);
});

test('chave do telefone iguala com e sem 55, com e sem o nono dígito, e o formato do WhatsApp', () => {
  const k = chaveTelefone('+5541992721758');
  assert.equal(k, '4192721758');
  assert.equal(chaveTelefone('554192721758@s.whatsapp.net'), k);
  assert.equal(chaveTelefone('(41) 9272-1758'), k);
  assert.equal(chaveTelefone('554192721758:26@s.whatsapp.net'), k);
  assert.equal(chaveTelefone('123'), '');
});

function cenario({ contatos = {}, mensagens = {}, externos = null } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nomes-'));
  if (externos) fs.writeFileSync(path.join(dir, 'nomes-externos.json'), JSON.stringify(externos));
  const gravados = [];
  const chamadas = { contatos: 0, mensagens: 0 };
  const evolution = {
    configured: true,
    list: async () => [{ nome: 'laboratorio' }, { nome: 'atendimento' }],
    contacts: async (inst) => { chamadas.contatos++; return contatos[inst] || []; },
    recentMessages: async (inst, jid) => { chamadas.mensagens++; return mensagens[jid] || []; },
  };
  const client = { updateContact: async (id, dados) => gravados.push([id, dados.name]) };
  return { nomes: new Nomes({ evolution, client, dataDir: dir, logger: quieto }), gravados, chamadas, dir };
}
const conv = (contactId, contactName, tel) => ({ id: 100 + contactId, contactId, contactName, contactPhone: tel, contactIdentifier: `${tel.replace(/\D/g, '')}@s.whatsapp.net` });

test('preenche pela agenda do celular, depois pelo cadastro externo, depois pelo nome de perfil', async () => {
  const c = cenario({
    contatos: {
      laboratorio: [{ remoteJid: '554184607609@s.whatsapp.net', pushName: 'Felipe Fornecedor 2' }, { remoteJid: '123@lid', pushName: 'Ignorado' }, { remoteJid: '554100000000@s.whatsapp.net', pushName: '554100000000' }],
    },
    externos: { '41988617958': 'Alyson Pereira', '5541984607609': 'Nome do Cadastro' },
    mensagens: { '559291333638@s.whatsapp.net': [{ key: { fromMe: true }, pushName: 'Loja' }, { key: { fromMe: false }, pushName: 'Kamila Nascimento' }] },
  });
  const feitos = await c.nomes.preencher([
    conv(1, '554184607609', '+554184607609'), // agenda (ganha do cadastro)
    conv(2, '554188617958', '+554188617958'), // cadastro externo
    conv(3, '.', '+559291333638'), // nome de perfil
    conv(4, '554100000000', '+554100000000'), // nada em lugar nenhum
    conv(5, 'Maria ♡', '+554191253783'), // já tem nome: não mexe
    conv(1, '554184607609', '+554184607609'), // mesmo contato em outra conversa: uma vez só
  ]);
  assert.equal(feitos, 3);
  assert.deepEqual(c.gravados, [[1, 'Felipe Fornecedor 2'], [2, 'Alyson Pereira'], [3, 'Kamila Nascimento']]);
  assert.equal(c.chamadas.contatos, 2, 'a agenda é lida uma vez por número e guardada');
});

test('quem não tem nome em lugar nenhum não é procurado de novo a cada rodada; cadastro novo reabre a busca', async () => {
  const c = cenario({ externos: {} });
  const lista = [conv(4, '554100000000', '+554100000000')];
  assert.equal(await c.nomes.preencher(lista), 0);
  const antes = c.chamadas.mensagens;
  assert.equal(await c.nomes.preencher(lista), 0);
  assert.equal(c.chamadas.mensagens, antes, 'não consulta de novo logo em seguida');
  // O cadastro externo foi atualizado: a busca recomeça e acha
  const arq = path.join(c.dir, 'nomes-externos.json');
  fs.writeFileSync(arq, JSON.stringify({ '554100000000': 'Cliente Novo' }));
  fs.utimesSync(arq, new Date(), new Date(Date.now() + 5000));
  assert.equal(await c.nomes.preencher(lista), 1);
  assert.deepEqual(c.gravados, [[4, 'Cliente Novo']]);
});

test('arquivo de cadastro inválido ou falha na agenda não derrubam o preenchimento', async () => {
  const c = cenario({ mensagens: { '559291333638@s.whatsapp.net': [{ key: { fromMe: false }, pushName: 'Kamila' }] } });
  fs.writeFileSync(path.join(c.dir, 'nomes-externos.json'), '{ isto não é json');
  c.nomes.evolution.contacts = async () => { throw new Error('fora do ar'); };
  assert.equal(await c.nomes.preencher([conv(3, '.', '+559291333638')]), 1);
  assert.deepEqual(c.gravados, [[3, 'Kamila']]);
});
