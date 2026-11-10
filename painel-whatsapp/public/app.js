const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const FLAG = {
  pediu_atendente: { label: 'Pediu atendente', cls: 'e-atendente', curto: 'Pediu atendente' },
  retorno_prometido: { label: 'Retorno prometido', cls: 'e-promessa', curto: 'Retorno' },
  sem_resposta: { label: 'Sem resposta', cls: 'e-sem', curto: 'Sem resposta' },
};
const AVATAR_CORES = ['#0F7A5C', '#2563A8', '#7E3FA0', '#B4363F', '#3D5A80', '#6B4F9E', '#1F6F8B', '#8A5A12'];
const CHECKS = '<svg aria-hidden="true" width="17" height="11" viewBox="0 0 17 11" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M1 6l3 3 6-7.5"></path><path d="M7 9l1 1 6-8.5"></path></svg>';
const ICONE_PESSOA = '<svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="8" r="4"></circle><path d="M4 21a8 8 0 0 1 16 0"></path></svg>';

const state = {
  me: null,
  aba: 'agora',
  agora: null,
  verif: null,
  filtroNumero: 'todos',
  filtroTipo: 'todos',
  busca: '',
  abertos: new Set(),
  dia: null,
  hora: null,
};

async function api(path, opts = {}) {
  const res = await fetch(path, {
    method: opts.method || 'GET',
    headers: opts.body ? { 'Content-Type': 'application/json' } : {},
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    credentials: 'same-origin',
  });
  if (res.status === 401 && !path.endsWith('/login')) {
    mostrarLogin();
    throw new Error('Sessão expirada');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.erro || `Erro ${res.status}`);
  return data;
}

function toast(msg) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.setAttribute('role', 'status');
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

// ---------- Formatação ----------
function tempo(min) {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h${String(min % 60).padStart(2, '0')}`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

function hhmm(ms) {
  return new Date(ms).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

/** Igual à lista de conversas: hora se hoje, "Ontem", ou data. */
function quando(ms) {
  const d = new Date(ms);
  const hoje = new Date();
  if (d.toDateString() === hoje.toDateString()) return hhmm(ms);
  const ontem = new Date(hoje);
  ontem.setDate(hoje.getDate() - 1);
  if (d.toDateString() === ontem.toDateString()) return 'Ontem';
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

function fone(p) {
  const d = String(p || '').replace(/\D/g, '');
  const m = d.match(/^55(\d{2})(\d{4,5})(\d{4})$/);
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : p || '';
}

function iniciais(nome) {
  const partes = String(nome || '?').trim().split(/\s+/).filter((p) => /\p{L}|\d/u.test(p));
  return ((partes[0]?.[0] || '?') + (partes.length > 1 ? partes[partes.length - 1][0] : '')).toUpperCase();
}

function corAvatar(nome) {
  let h = 0;
  for (const c of String(nome)) h = (h * 31 + c.codePointAt(0)) >>> 0;
  return AVATAR_CORES[h % AVATAR_CORES.length];
}

const autorPromessa = (f) => (f.byAuthor === 'ia' ? '✦ IA' : f.by || 'Equipe');

// ---------- Login ----------
function mostrarLogin() {
  $('#app').hidden = true;
  $('#login').hidden = false;
}

$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  $('#login-erro').textContent = '';
  const btn = e.target.querySelector('button');
  btn.disabled = true;
  try {
    await api('/api/login', { method: 'POST', body: { email: f.get('email'), senha: f.get('senha') } });
    await iniciar();
  } catch (err) {
    $('#login-erro').textContent = err.message;
  } finally {
    btn.disabled = false;
  }
});

// ---------- Navegação ----------
function irPara(aba) {
  state.aba = aba;
  for (const a of ['agora', 'verificacoes', 'ajustes']) $(`#aba-${a}`).hidden = a !== aba;
  document.querySelectorAll('.aba-btn').forEach((t) => {
    if (t.dataset.aba === aba) t.setAttribute('aria-current', 'page');
    else t.removeAttribute('aria-current');
  });
  $('#titulo').textContent = { agora: 'Pendências', verificacoes: 'Verificações', ajustes: 'Ajustes' }[aba];
  $('#btn-atualizar').hidden = aba === 'ajustes';
  $('#busca-box').hidden = aba === 'ajustes';
  $('#topo-info').textContent = '';
  if (aba === 'agora') carregarAgora();
  if (aba === 'verificacoes') carregarDia(state.dia);
  if (aba === 'ajustes') atualizarPushStatus();
  window.scrollTo(0, 0);
}
document.querySelectorAll('.aba-btn').forEach((t) => t.addEventListener('click', () => irPara(t.dataset.aba)));

$('#btn-atualizar').addEventListener('click', async () => {
  const b = $('#btn-atualizar');
  b.classList.add('girando');
  try {
    if (state.aba === 'agora') await carregarAgora(true);
    else await carregarDia(state.dia, state.hora);
  } finally {
    b.classList.remove('girando');
  }
});

$('#busca').addEventListener('input', (e) => {
  state.busca = e.target.value.trim().toLowerCase();
  if (state.aba === 'agora') desenharAgora();
  if (state.aba === 'verificacoes' && state.verif) desenharVerif();
});

const bateBusca = (i) => {
  if (!state.busca) return true;
  const alvo = [i.contactName, i.contactPhone, fone(i.contactPhone), i.assigneeName, i.inbox?.name, ...i.flags.map((f) => f.text)]
    .join(' ').toLowerCase();
  return alvo.includes(state.busca);
};

// ---------- Linha de conversa ----------
function previa(item) {
  const f = item.flags[0];
  if (f.type === 'retorno_prometido') {
    return `<span class="conv-prev">${CHECKS}<span><b>${esc(autorPromessa(f))}:</b> ${esc(f.text)}</span></span>`;
  }
  if (f.type === 'pediu_atendente') {
    return `<span class="conv-prev">${ICONE_PESSOA}<span>${esc(f.text)}</span></span>`;
  }
  return `<span class="conv-prev"><span>${esc(f.text || 'Mídia')}</span></span>`;
}

function baloes(item) {
  const partes = [...item.flags].sort((a, b) => a.since - b.since).map((f) => {
    if (f.type === 'retorno_prometido') {
      const ia = f.byAuthor === 'ia';
      return `<div class="balao out"><span class="autor" style="color:${ia ? 'var(--e-ia)' : 'var(--verde-texto)'}">${esc(autorPromessa(f))}</span>${esc(f.text)}<span class="meta">${hhmm(f.since)} ${CHECKS}</span></div>`;
    }
    return `<div class="balao in">${esc(f.text || 'Mídia')}<span class="meta">${hhmm(f.since)}</span></div>`;
  });
  const resp = item.assigneeName ? `Responsável: ${item.assigneeName}` : item.lastHumanName ? `Último atendente: ${item.lastHumanName}` : 'Sem atendente atribuído';
  return `<div class="papel"><span class="aviso-sis">Aguardando há ${tempo(item.waitingMinutes)} · ${esc(resp)}</span>${partes.join('')}</div>`;
}

function linhaConversa(item, { podeResolver }) {
  const aberto = state.abertos.has(item.id);
  const atraso = item.waitingMinutes >= 120;
  const etqs = [];
  if (item.inbox) etqs.push(`<span class="etq e-numero" style="--c:${esc(item.inbox.color.fg)};--c-d:${esc(item.inbox.color.bg)}">${esc(item.inbox.name)}</span>`);
  for (const f of item.flags) etqs.push(`<span class="etq ${FLAG[f.type].cls}">${FLAG[f.type].label}</span>`);
  if (item.aiInvolved) etqs.push('<span class="etq e-ia" title="A IA participou da conversa">✦ IA</span>');
  if (item.assigneeName) etqs.push(`<span class="etq e-resp">${esc(item.assigneeName)}</span>`);

  return `
  <li class="conv">
    <button class="conv-linha" data-abrir="${item.id}" aria-expanded="${aberto}">
      <span class="avatar" style="background:${corAvatar(item.contactName)}" aria-hidden="true">${esc(iniciais(item.contactName))}</span>
      <span class="conv-corpo">
        <span class="conv-l1">
          <span class="conv-nome">${esc(item.contactName)}</span>
          <span class="conv-hora ${atraso ? 'atraso' : ''}">${quando(item.since)}</span>
        </span>
        <span class="conv-l2">
          ${previa(item)}
          <span class="espera ${atraso ? 'atraso' : ''}" aria-label="aguardando há ${tempo(item.waitingMinutes)}">${tempo(item.waitingMinutes)}</span>
        </span>
        <span class="etqs">${etqs.join('')}</span>
      </span>
    </button>
    ${aberto ? `
    <div class="conv-detalhe">
      ${baloes(item)}
      <p class="sec pequeno">${esc(fone(item.contactPhone))}</p>
      <div class="conv-acoes">
        ${item.url ? `<a class="btn-verde btn-p" href="${esc(item.url)}" target="_blank" rel="noopener">Responder no Chatwoot</a>` : ''}
        ${podeResolver ? `<button class="btn-contorno btn-p" data-resolver="${item.id}">Marcar resolvida</button>` : ''}
      </div>
    </div>` : ''}
  </li>`;
}

function ligarLista(el, redesenhar) {
  el.querySelectorAll('[data-abrir]').forEach((b) => b.addEventListener('click', () => {
    const id = Number(b.dataset.abrir);
    if (state.abertos.has(id)) state.abertos.delete(id);
    else state.abertos.add(id);
    redesenhar();
  }));
  el.querySelectorAll('[data-resolver]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('Marcar esta conversa como resolvida no Chatwoot?')) return;
    b.disabled = true;
    try {
      await api(`/api/conversas/${b.dataset.resolver}/resolver`, { method: 'POST' });
      toast('Conversa marcada como resolvida');
      await carregarAgora();
    } catch (err) {
      toast(err.message);
      b.disabled = false;
    }
  }));
}

function vazio(titulo, texto) {
  return `<li class="vazio">
    <svg aria-hidden="true" width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"></circle><path d="M8 12.5l2.5 2.5 5.5-6"></path></svg>
    <p class="grande">${esc(titulo)}</p><p class="sec pequeno">${esc(texto)}</p></li>`;
}

// ---------- Aba Pendências ----------
async function carregarAgora(forcar = false) {
  try {
    state.agora = await api(`/api/pendencias${forcar ? '?atualizar=1' : ''}`);
    desenharAgora();
  } catch (err) {
    $('#lista-agora').innerHTML = vazio('Não foi possível carregar', err.message);
  }
}

function desenharAgora() {
  const d = state.agora;
  if (!d || state.aba !== 'agora') return;
  const t = d.totals;
  const badge = $('#tab-badge');
  badge.hidden = !t.total;
  badge.textContent = t.total;
  if ('setAppBadge' in navigator) navigator.setAppBadge(t.total).catch(() => {});
  $('#topo-info').textContent = `Atualizado ${hhmm(d.updatedAt)}`;

  const tipos = [
    { id: 'todos', nome: 'Todas', n: t.total },
    { id: 'pediu_atendente', nome: 'Pediu atendente', n: t.pediuAtendente },
    { id: 'retorno_prometido', nome: 'Retorno prometido', n: t.retornoPrometido },
    { id: 'sem_resposta', nome: 'Sem resposta', n: t.semResposta },
  ];
  $('#filtros-tipo').innerHTML = tipos.map((x) =>
    `<button class="pilula" data-tipo="${x.id}" aria-pressed="${state.filtroTipo === x.id}">${esc(x.nome)}${x.n ? ` <span class="n">${x.n}</span>` : ''}</button>`).join('');
  $('#filtros-tipo').querySelectorAll('.pilula').forEach((b) => b.addEventListener('click', () => {
    state.filtroTipo = b.dataset.tipo;
    desenharAgora();
  }));

  const nums = [{ id: 'todos', name: 'Todos os números', total: t.total }, ...t.porNumero];
  const cor = (id) => d.inboxes.find((i) => String(i.id) === String(id))?.color;
  $('#filtros-numero').innerHTML = nums.map((c) =>
    `<button class="pilula" data-id="${c.id}" aria-pressed="${String(state.filtroNumero) === String(c.id)}">${cor(c.id) ? `<span class="pt" style="--c:${esc(cor(c.id).fg)};--c-d:${esc(cor(c.id).bg)}"></span>` : ''}${esc(c.name)} <span class="n">${c.total}</span></button>`).join('');
  $('#filtros-numero').querySelectorAll('.pilula').forEach((b) => b.addEventListener('click', () => {
    state.filtroNumero = b.dataset.id;
    desenharAgora();
  }));

  const itens = d.items.filter((i) =>
    (state.filtroNumero === 'todos' || String(i.inbox?.id) === String(state.filtroNumero))
    && (state.filtroTipo === 'todos' || i.flags.some((f) => f.type === state.filtroTipo))
    && bateBusca(i));

  const lista = $('#lista-agora');
  lista.innerHTML = itens.length
    ? itens.map((i) => linhaConversa(i, { podeResolver: true })).join('')
    : vazio(t.total ? 'Nada com esse filtro' : 'Tudo respondido', t.total ? 'Tente outro filtro ou pesquisa.' : 'Nenhum cliente aguardando retorno.');
  ligarLista(lista, desenharAgora);
  $('#agora-rodape').textContent = `${d.openConversations} conversas abertas · toque numa conversa para ver as mensagens`;
}

// ---------- Aba Verificações ----------
function somarDias(iso, n) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

async function carregarDia(dia, horaEscolhida) {
  const r = await api(`/api/verificacoes${dia ? `?data=${dia}` : ''}`);
  state.dia = r.data;
  const label = new Date(`${r.data}T12:00:00Z`).toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit', timeZone: 'UTC' });
  $('#dia-label').textContent = r.data === r.hoje ? `Hoje, ${label}` : label.charAt(0).toUpperCase() + label.slice(1);
  $('#dia-proximo').disabled = r.data >= r.hoje;
  state.verif = null;

  if (!r.horarios.length) {
    $('#horarios').innerHTML = '';
    $('#verif-resumo').hidden = true;
    $('#lista-verif').innerHTML = vazio('Sem verificações neste dia', 'As verificações acontecem de segunda a sábado.');
    return;
  }
  const feitas = r.horarios.filter((h) => h.status === 'feita');
  const escolhida = horaEscolhida && r.horarios.some((h) => h.time === horaEscolhida)
    ? horaEscolhida
    : (feitas.length ? feitas[feitas.length - 1].time : r.horarios[0].time);
  state.hora = escolhida;
  const sub = { feita: 'feita', agendada: 'agendada', nao_executada: 'não executada' };
  $('#horarios').innerHTML = r.horarios.map((h) =>
    `<button class="pilula" role="tab" data-h="${h.time}" aria-selected="${h.time === escolhida}"><span class="h">${h.time}</span><span class="s">${sub[h.status]}</span></button>`).join('');
  $('#horarios').querySelectorAll('.pilula').forEach((b) => b.addEventListener('click', () => carregarDia(state.dia, b.dataset.h)));

  const st = r.horarios.find((h) => h.time === escolhida).status;
  if (st !== 'feita') {
    $('#verif-resumo').hidden = true;
    $('#lista-verif').innerHTML = st === 'agendada'
      ? vazio(`Próxima verificação às ${escolhida}`, 'A equipe recebe um aviso no celular quando a lista ficar pronta.')
      : vazio('Verificação não executada', 'O servidor estava desligado neste horário.');
    return;
  }
  try {
    state.verif = await api(`/api/verificacoes/${r.data}/${escolhida.replace(':', '')}`);
    desenharVerif();
  } catch (err) {
    $('#lista-verif').innerHTML = vazio('Erro', err.message);
  }
}

function desenharVerif() {
  const snap = state.verif;
  const t = snap.totals;
  const partes = [
    t.pediuAtendente && `${t.pediuAtendente} ${t.pediuAtendente > 1 ? 'pediram' : 'pediu'} atendente`,
    t.retornoPrometido && `${t.retornoPrometido} ${t.retornoPrometido > 1 ? 'retornos prometidos' : 'retorno prometido'}`,
    t.semResposta && `${t.semResposta} sem resposta`,
  ].filter(Boolean);
  $('#verif-resumo').hidden = false;
  $('#verif-resumo').textContent = t.total
    ? `Às ${snap.time}, ${t.total} cliente${t.total > 1 ? 's' : ''} aguardando · ${partes.join(' · ')}`
    : `Às ${snap.time}, todas as conversas estavam respondidas`;
  const itens = snap.items.filter(bateBusca);
  const lista = $('#lista-verif');
  lista.innerHTML = itens.length
    ? itens.map((i) => linhaConversa(i, { podeResolver: false })).join('')
    : vazio(t.total ? 'Nada com essa pesquisa' : 'Nenhuma pendência', t.total ? 'Tente outra pesquisa.' : 'Tudo respondido neste horário.');
  ligarLista(lista, desenharVerif);
}
$('#dia-anterior').addEventListener('click', () => carregarDia(somarDias(state.dia, -1)));
$('#dia-proximo').addEventListener('click', () => carregarDia(somarDias(state.dia, 1)));

// ---------- Notificações ----------
const ehIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
const instalado = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

function b64ToUint8(b64) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

async function atualizarPushStatus() {
  const st = $('#push-status');
  const btn = $('#btn-push');
  const teste = $('#btn-push-teste');
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    st.textContent = ehIOS && !instalado
      ? 'Primeiro adicione o app à Tela de Início e abra por lá.'
      : 'Este navegador não suporta notificações.';
    btn.hidden = true;
    teste.hidden = true;
    return;
  }
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  const ativo = sub && Notification.permission === 'granted';
  st.textContent = ativo ? 'Ativadas neste aparelho' : Notification.permission === 'denied'
    ? 'Bloqueadas. Libere em Ajustes do iPhone > Notificações > Pendências.'
    : 'Desativadas neste aparelho';
  btn.hidden = !!ativo;
  teste.hidden = !ativo;
}

$('#btn-push').addEventListener('click', async () => {
  try {
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') throw new Error('Permissão não concedida');
    const reg = await navigator.serviceWorker.ready;
    const { chave } = await api('/api/push/chave');
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToUint8(chave) });
    await api('/api/push/inscrever', { method: 'POST', body: sub.toJSON() });
    toast('Notificações ativadas');
  } catch (err) {
    toast(err.message);
  }
  atualizarPushStatus();
});

$('#btn-push-teste').addEventListener('click', async () => {
  try {
    await api('/api/push/teste', { method: 'POST' });
    toast('Teste enviado');
  } catch (err) {
    toast(err.message);
  }
});

$('#btn-sair').addEventListener('click', async () => {
  await api('/api/logout', { method: 'POST' }).catch(() => {});
  location.reload();
});

// ---------- Início ----------
async function iniciar() {
  try {
    state.me = await api('/api/me');
  } catch {
    return;
  }
  $('#login').hidden = true;
  $('#app').hidden = false;
  const u = state.me.usuario;
  $('#usuario-nome').textContent = u.name;
  $('#usuario-email').textContent = u.email;
  $('#perfil-avatar').textContent = iniciais(u.name);
  $('#horarios-txt').textContent = state.me.horarios.join(', ');
  const p = new URLSearchParams(location.search);
  if (p.get('data')) state.dia = p.get('data');
  const aba = ['agora', 'verificacoes', 'ajustes'].includes(p.get('aba')) ? p.get('aba') : 'agora';
  irPara(aba);
  if (p.get('hora') && aba === 'verificacoes') carregarDia(state.dia, p.get('hora'));
  history.replaceState(null, '', '/');
}

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});

// Atualiza sozinho a cada 2 minutos e ao voltar para o app
setInterval(() => { if (!document.hidden && state.me && state.aba === 'agora') carregarAgora(); }, 120000);
document.addEventListener('visibilitychange', () => { if (!document.hidden && state.me && state.aba === 'agora') carregarAgora(); });

fetch('/health').then((r) => r.json()).then((h) => { $('#demo-hint').hidden = !h.demo; }).catch(() => {});
iniciar().then(() => { if (!state.me) mostrarLogin(); });
