const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const FLAG = {
  pediu_atendente: { label: 'Pediu atendente', cls: 'b-atendente' },
  retorno_prometido: { label: 'Retorno prometido', cls: 'b-promessa' },
  sem_resposta: { label: 'Sem resposta', cls: 'b-sem' },
};

const state = {
  me: null,
  aba: 'agora',
  agora: null,
  filtroNumero: 'todos',
  filtroTipo: null,
  dia: null,
  hoje: null,
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

function tempo(min) {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h${String(min % 60).padStart(2, '0')}`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}

function fone(p) {
  const d = String(p || '').replace(/\D/g, '');
  const m = d.match(/^55(\d{2})(\d{4,5})(\d{4})$/);
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : p || '';
}

function hora(ms) {
  const d = new Date(ms);
  const hoje = new Date();
  const hh = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === hoje.toDateString()) return `hoje ${hh}`;
  const ontem = new Date(hoje); ontem.setDate(hoje.getDate() - 1);
  if (d.toDateString() === ontem.toDateString()) return `ontem ${hh}`;
  return `${d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} ${hh}`;
}

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
  document.querySelectorAll('.tab').forEach((t) => {
    if (t.dataset.aba === aba) t.setAttribute('aria-current', 'page');
    else t.removeAttribute('aria-current');
  });
  $('#titulo').textContent = { agora: 'Pendências', verificacoes: 'Verificações', ajustes: 'Ajustes' }[aba];
  $('#btn-atualizar').hidden = aba === 'ajustes';
  if (aba === 'ajustes') $('#subtitulo').textContent = '';
  if (aba === 'agora') carregarAgora();
  if (aba === 'verificacoes') carregarDia(state.dia);
  if (aba === 'ajustes') atualizarPushStatus();
  window.scrollTo(0, 0);
}
document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => irPara(t.dataset.aba)));

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

// ---------- Cartões ----------
function cartao(item, { podeResolver }) {
  const tags = [];
  if (item.inbox) tags.push(`<span class="badge" style="background:${esc(item.inbox.color.bg)};color:${esc(item.inbox.color.fg)}">${esc(item.inbox.name)}</span>`);
  for (const f of item.flags) tags.push(`<span class="badge ${FLAG[f.type].cls}">${FLAG[f.type].label}</span>`);
  if (item.aiInvolved) tags.push('<span class="badge b-ia" title="A IA participou da conversa">IA</span>');

  const citacoes = item.flags.map((f) => {
    if (f.type === 'retorno_prometido') {
      const quem = f.byAuthor === 'ia' ? 'IA' : f.by || 'Equipe';
      return `<p class="citacao"><span class="quem">${esc(quem)} prometeu · ${esc(hora(f.since))}</span>“${esc(f.text)}”</p>`;
    }
    const rot = f.type === 'pediu_atendente' ? 'Cliente pediu atendente' : 'Cliente';
    return `<p class="citacao"><span class="quem">${rot} · ${esc(hora(f.since))}</span>“${esc(f.text || '[mídia]')}”</p>`;
  }).join('');

  const resp = item.assigneeName ? `Resp.: ${item.assigneeName}` : item.lastHumanName ? `Último: ${item.lastHumanName}` : 'Sem atendente';
  return `
  <article class="card item">
    <div class="item-top">
      <div>
        <p class="item-nome">${esc(item.contactName)}</p>
        <p class="item-fone">${esc(fone(item.contactPhone))}</p>
      </div>
      <span class="espera ${item.waitingMinutes >= 120 ? 'alta' : ''}">há ${tempo(item.waitingMinutes)}</span>
    </div>
    <div class="tags">${tags.join('')}<span class="badge b-neutro">${esc(resp)}</span></div>
    ${citacoes}
    <div class="item-acoes">
      ${item.url ? `<a class="btn btn-primary btn-sm" href="${esc(item.url)}" target="_blank" rel="noopener">Abrir no Chatwoot</a>` : '<span></span>'}
      ${podeResolver ? `<button class="btn btn-ghost btn-sm" data-resolver="${item.id}">Marcar resolvida</button>` : ''}
    </div>
  </article>`;
}

function vazio(titulo, texto) {
  return `<div class="card vazio"><p class="grande">${esc(titulo)}</p><p class="muted small">${esc(texto)}</p></div>`;
}

function resumoHTML(totals, ativo) {
  const b = (tipo, num, lbl, cls) =>
    `<button data-tipo="${tipo}" aria-pressed="${ativo === tipo}"><span class="num ${cls}">${num}</span><span class="lbl">${lbl}</span></button>`;
  return b('pediu_atendente', totals.pediuAtendente, 'pediram atendente', 'atendente')
    + b('retorno_prometido', totals.retornoPrometido, 'retornos prometidos', 'promessa')
    + b('sem_resposta', totals.semResposta, 'sem resposta', 'sem');
}

// ---------- Aba Agora ----------
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
  if (!d) return;
  const badge = $('#tab-badge');
  badge.hidden = !d.totals.total;
  badge.textContent = d.totals.total;
  if ('setAppBadge' in navigator) navigator.setAppBadge(d.totals.total).catch(() => {});

  $('#resumo').innerHTML = resumoHTML(d.totals, state.filtroTipo);
  $('#resumo').querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
    state.filtroTipo = state.filtroTipo === b.dataset.tipo ? null : b.dataset.tipo;
    desenharAgora();
  }));

  const chips = [{ id: 'todos', name: 'Todos', total: d.totals.total }, ...d.totals.porNumero];
  $('#filtros').innerHTML = chips.map((c) =>
    `<button class="chip" data-id="${c.id}" aria-pressed="${String(state.filtroNumero) === String(c.id)}">${esc(c.name)}<span class="cnt">${c.total}</span></button>`).join('');
  $('#filtros').querySelectorAll('.chip').forEach((b) => b.addEventListener('click', () => {
    state.filtroNumero = b.dataset.id;
    desenharAgora();
  }));

  const itens = d.items.filter((i) =>
    (state.filtroNumero === 'todos' || String(i.inbox?.id) === String(state.filtroNumero))
    && (!state.filtroTipo || i.flags.some((f) => f.type === state.filtroTipo)));

  $('#agora-info').textContent = `Atualizado ${hora(d.updatedAt)} · ${d.openConversations} conversas abertas`;
  $('#subtitulo').textContent = d.totals.total
    ? `${d.totals.total} conversa${d.totals.total > 1 ? 's' : ''} aguardando a equipe`
    : 'Nenhuma conversa aguardando';
  $('#lista-agora').innerHTML = itens.length
    ? itens.map((i) => cartao(i, { podeResolver: true })).join('')
    : vazio('Tudo em dia', 'Nenhuma conversa pendente com esse filtro.');
  $('#lista-agora').querySelectorAll('[data-resolver]').forEach((b) => b.addEventListener('click', async () => {
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

// ---------- Aba Verificações ----------
function somarDias(iso, n) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

async function carregarDia(dia, horaEscolhida) {
  const r = await api(`/api/verificacoes${dia ? `?data=${dia}` : ''}`);
  state.dia = r.data;
  state.hoje = r.hoje;
  const label = new Date(`${r.data}T12:00:00Z`).toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit', timeZone: 'UTC' });
  $('#dia-label').textContent = r.data === r.hoje ? `Hoje, ${label}` : label;
  $('#dia-proximo').disabled = r.data >= r.hoje;
  $('#subtitulo').textContent = `Seg a sáb · ${(state.me?.horarios || []).join(' · ')}`;

  if (!r.horarios.length) {
    $('#horarios').innerHTML = '';
    $('#verif-resumo').innerHTML = '';
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
    `<button role="tab" data-h="${h.time}" aria-selected="${h.time === escolhida}"><span class="h">${h.time}</span><span class="s">${sub[h.status]}</span></button>`).join('');
  $('#horarios').querySelectorAll('button').forEach((b) => b.addEventListener('click', () => carregarDia(state.dia, b.dataset.h)));

  const st = r.horarios.find((h) => h.time === escolhida).status;
  if (st !== 'feita') {
    $('#verif-resumo').innerHTML = '';
    $('#lista-verif').innerHTML = st === 'agendada'
      ? vazio(`Próxima verificação às ${escolhida}`, 'A equipe recebe um aviso no celular quando a lista ficar pronta.')
      : vazio('Verificação não executada', 'O servidor estava desligado neste horário.');
    return;
  }
  try {
    const snap = await api(`/api/verificacoes/${r.data}/${escolhida.replace(':', '')}`);
    $('#verif-resumo').innerHTML = resumoHTML(snap.totals, null);
    $('#verif-resumo').querySelectorAll('button').forEach((b) => { b.disabled = true; b.style.cursor = 'default'; });
    $('#lista-verif').innerHTML = snap.items.length
      ? `<p class="muted small info">Retrato das ${escolhida}: quem estava aguardando naquele momento.</p>` + snap.items.map((i) => cartao(i, { podeResolver: false })).join('')
      : vazio('Nenhuma pendência', `Às ${escolhida} todas as conversas estavam respondidas.`);
  } catch (err) {
    $('#lista-verif').innerHTML = vazio('Erro', err.message);
  }
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
      ? 'No iPhone, primeiro adicione o app à Tela de Início (veja abaixo) e abra por lá.'
      : 'Este navegador não suporta notificações.';
    btn.hidden = true;
    teste.hidden = true;
    return;
  }
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  const ativo = sub && Notification.permission === 'granted';
  st.textContent = ativo ? 'Notificações ativadas neste aparelho.' : Notification.permission === 'denied'
    ? 'Notificações bloqueadas. Libere em Ajustes do iPhone > Notificações > Pendências.'
    : 'Notificações desativadas neste aparelho.';
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
  $('#usuario-nome').textContent = `${state.me.usuario.name} (${state.me.usuario.email})`;
  $('#horarios-txt').textContent = state.me.horarios.join(', ');
  const p = new URLSearchParams(location.search);
  if (p.get('data')) state.dia = p.get('data');
  irPara(['agora', 'verificacoes', 'ajustes'].includes(p.get('aba')) ? p.get('aba') : 'agora');
  if (p.get('hora') && state.aba === 'verificacoes') carregarDia(state.dia, p.get('hora'));
  history.replaceState(null, '', '/');
}

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});

// Atualiza sozinho a cada 2 minutos e ao voltar para o app
setInterval(() => { if (!document.hidden && state.me && state.aba === 'agora') carregarAgora(); }, 120000);
document.addEventListener('visibilitychange', () => { if (!document.hidden && state.me && state.aba === 'agora') carregarAgora(); });

fetch('/health').then((r) => r.json()).then((h) => { $('#demo-hint').hidden = !h.demo; }).catch(() => {});
iniciar().then(() => { if (!state.me) mostrarLogin(); });
