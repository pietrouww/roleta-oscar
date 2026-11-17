// Diagnóstico de mensagens: roda DENTRO do container do painel (tem as mesmas variáveis do .env).
// Só lê informações. Nunca mostra senhas/tokens inteiros.
const E = process.env;
const mask = (v) => (v ? `definido (…${String(v).slice(-4)})` : 'VAZIO');
const ok = (b) => (b ? 'OK ' : 'PROBLEMA ');
const problemas = [];
const titulo = (t) => console.log(`\n===== ${t} =====`);

async function get(url, headers = {}, timeout = 15000) {
  try {
    const r = await fetch(url, { headers, signal: AbortSignal.timeout(timeout) });
    const txt = await r.text();
    let json = null;
    try { json = JSON.parse(txt); } catch { /* não é json */ }
    return { status: r.status, json, txt };
  } catch (err) {
    return { status: 0, erro: err.cause?.code || err.message };
  }
}

const CW = (E.CHATWOOT_URL || '').replace(/\/+$/, '');
const ACC = E.CHATWOOT_ACCOUNT_ID || '1';
const TOK = E.CHATWOOT_API_TOKEN;
const TOK_CEL = E.CHATWOOT_TOKEN_CELULAR || TOK;
const EVO = (E.EVOLUTION_URL || 'http://evolution:8080').replace(/\/+$/, '');
const EVO_PUB = (E.EVOLUTION_PUBLIC_URL || '').replace(/\/+$/, '');
const KEY = E.EVOLUTION_API_KEY;

titulo('CONFIGURAÇÃO (.env)');
console.log('CHATWOOT_URL ............', CW || 'VAZIO');
console.log('CHATWOOT_ACCOUNT_ID .....', ACC);
console.log('CHATWOOT_API_TOKEN ......', mask(TOK));
console.log('CHATWOOT_TOKEN_CELULAR ..', mask(E.CHATWOOT_TOKEN_CELULAR), E.CHATWOOT_TOKEN_CELULAR ? '' : '(usa o CHATWOOT_API_TOKEN)');
console.log('EVOLUTION_PUBLIC_URL ....', EVO_PUB || 'VAZIO');
console.log('EVOLUTION_API_KEY .......', mask(KEY));
if (EVO_PUB && !EVO_PUB.startsWith('https://')) problemas.push('EVOLUTION_PUBLIC_URL não começa com https:// (o Chatwoot pode não conseguir mandar as respostas).');

titulo('CHATWOOT');
for (const [nome, tok] of [['token do painel', TOK], ['token da Evolution (Celular)', TOK_CEL]]) {
  const r = await get(`${CW}/api/v1/profile`, { api_access_token: tok });
  if (r.status !== 200) {
    console.log(ok(false) + `${nome}: Chatwoot respondeu ${r.status || r.erro}`);
    problemas.push(`O ${nome} não é aceito pelo Chatwoot (${r.status || r.erro}). Gere de novo em Perfil → Token de acesso.`);
    continue;
  }
  const conta = (r.json.accounts || []).find((a) => String(a.id) === String(ACC));
  console.log(ok(!!conta && conta.role === 'administrator') + `${nome}: usuário "${r.json.name}", papel na conta ${ACC}: ${conta ? conta.role : 'NÃO PERTENCE À CONTA'}`);
  if (!conta) problemas.push(`O ${nome} é de um usuário que não pertence à conta ${ACC} (confira CHATWOOT_ACCOUNT_ID).`);
  else if (conta.role !== 'administrator') problemas.push(`O ${nome} é de um usuário "${conta.role}"; precisa ser ADMINISTRADOR para criar caixas de entrada.`);
}

const inb = await get(`${CW}/api/v1/accounts/${ACC}/inboxes`, { api_access_token: TOK });
const inboxes = inb.json?.payload || [];
console.log(`\nCaixas de entrada na conta ${ACC}: ${inboxes.length}`);
for (const i of inboxes) console.log(`  - #${i.id} "${i.name}" (${i.channel_type})${i.webhook_url ? ' webhook: ' + i.webhook_url : ''}`);
const conv = await get(`${CW}/api/v1/accounts/${ACC}/conversations?status=all`, { api_access_token: TOK });
console.log(`Conversas (todas): ${conv.json?.data?.meta?.all_count ?? '?'}`);

titulo('EVOLUTION API');
const inst = await get(`${EVO}/instance/fetchInstances`, { apikey: KEY });
if (inst.status !== 200) {
  console.log(ok(false) + `Evolution respondeu ${inst.status || inst.erro}`);
  problemas.push('O painel não consegue falar com a Evolution (confira EVOLUTION_API_KEY).');
}
const lista = Array.isArray(inst.json) ? inst.json : [];
for (const x of lista) {
  const nome = x.name || x.instanceName;
  const c = x._count || {};
  console.log(`\nNúmero "${nome}": ${x.connectionStatus} ${x.ownerJid ? '(' + x.ownerJid.split('@')[0] + ')' : ''}`);
  console.log(`  Mensagens recebidas pela Evolution: ${c.Message ?? '?'} · contatos: ${c.Contact ?? '?'} · conversas: ${c.Chat ?? '?'}`);
  if (c.Message === 0) problemas.push(`"${nome}": a Evolution não recebeu nenhuma mensagem. O problema é a conexão com o WhatsApp, não o Chatwoot (reconecte o QR Code).`);

  const cf = await get(`${EVO}/chatwoot/find/${encodeURIComponent(nome)}`, { apikey: KEY });
  const s = cf.json || {};
  if (!s || !s.enabled) {
    console.log('  ' + ok(false) + 'Integração com Chatwoot: DESLIGADA ou não configurada');
    problemas.push(`"${nome}": integração com o Chatwoot não está ligada na Evolution.`);
    continue;
  }
  const tokOk = s.token && (s.token === TOK_CEL || s.token === TOK);
  console.log(`  Integração Chatwoot: ligada · url: ${s.url} · conta: ${s.accountId} · caixa: "${s.nameInbox || nome}" · token ${tokOk ? 'confere' : 'DIFERENTE do .env'}`);
  if (String(s.accountId) !== String(ACC)) problemas.push(`"${nome}": Evolution está usando a conta ${s.accountId}, mas o .env diz ${ACC}.`);
  if (!tokOk) problemas.push(`"${nome}": o token salvo na Evolution é diferente do .env.`);
  const caixa = inboxes.find((i) => i.name === (s.nameInbox || nome));
  if (!caixa) problemas.push(`"${nome}": a caixa de entrada "${s.nameInbox || nome}" NÃO existe no Chatwoot (a Evolution não conseguiu criar).`);
  else {
    const esperado = `${EVO_PUB}/chatwoot/webhook/${encodeURIComponent(nome)}`;
    if (caixa.webhook_url && caixa.webhook_url !== esperado) problemas.push(`"${nome}": o webhook da caixa no Chatwoot é ${caixa.webhook_url}, esperado ${esperado}.`);
  }
}

titulo('CONEXÕES');
const a = await get(`${CW}/api`);
console.log(ok(a.status === 200) + `painel → Chatwoot (${CW}): ${a.status || a.erro}`);
if (EVO_PUB) {
  const b = await get(EVO_PUB);
  console.log(ok(b.status === 200) + `painel → Evolution pública (${EVO_PUB}): ${b.status || b.erro}`);
  if (b.status !== 200) problemas.push(`O endereço público da Evolution (${EVO_PUB}) não responde; o Chatwoot não vai conseguir entregar as respostas.`);
}

titulo('RESUMO');
if (problemas.length) problemas.forEach((p, i) => console.log(`${i + 1}. ${p}`));
else console.log('Nenhum problema de configuração encontrado. Veja os logs da Evolution abaixo.');
