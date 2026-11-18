// App de atendimento: módulo Conversas (acompanhar tudo, mídias, responder) e módulo Pendências (análise).
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const TIPO = {
  manual: { label: 'Marcada pela equipe', cls: 'e-manual' },
  pediu_atendente: { label: 'Pediu atendente', cls: 'e-atendente' },
  retorno_prometido: { label: 'Retorno prometido', cls: 'e-promessa' },
  sem_resposta: { label: 'Sem resposta', cls: 'e-sem' },
};
const URG = { alta: { label: 'Urgente', cls: 'u-alta' }, media: { label: 'Normal', cls: 'u-media' }, baixa: { label: 'Sem pressa', cls: 'u-baixa' } };
const MIDIA_NOME = { audio: 'Áudio', imagem: 'Foto', video: 'Vídeo', arquivo: 'Arquivo', local: 'Localização', contato: 'Contato' };
const AVATAR_CORES = ['#0F7A5C', '#2563A8', '#7E3FA0', '#B4363F', '#3D5A80', '#6B4F9E', '#1F6F8B', '#8A5A12'];
const CHECKS = '<svg aria-hidden="true" width="17" height="11" viewBox="0 0 17 11" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M1 6l3 3 6-7.5"></path><path d="M7 9l1 1 6-8.5"></path></svg>';
const IC_MIDIA = '<svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.5l-8.5 8.5a5.5 5.5 0 0 1-7.8-7.8l9-9a3.7 3.7 0 0 1 5.2 5.2l-9 9a1.8 1.8 0 0 1-2.6-2.6l8.3-8.3"></path></svg>';

// Aberto como aba "Pendências" dentro do Chatwoot (Dashboard App)
const EMBUTIDO = new URLSearchParams(location.search).get('embed') === '1' || window.self !== window.top;
if (EMBUTIDO) document.documentElement.classList.add('embutido');
const LARGO = window.matchMedia('(min-width: 900px)');

const state = {
  me: null,
  tela: null,
  sub: 'agora',
  conversas: [],
  inboxes: [],
  fConv: 'abertas',
  fConvNumero: 'todos',
  buscaConv: '',
  pend: null,
  fTipo: 'todos',
  fNumero: 'todos',
  verif: null,
  dia: null,
  hora: null,
  sel: new Set(), // conversas marcadas para o relatório (Verificações)
  chat: null, // { id, conv, mensagens, pendencia, marca, url, max }
  convAtualChatwoot: null,
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
  setTimeout(() => el.remove(), 3500);
}

// ---------- Formatação ----------
function tempo(min) {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h${String(min % 60).padStart(2, '0')}`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}
const hhmm = (ms) => new Date(ms).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
function mesmoDia(a, b) { return new Date(a).toDateString() === new Date(b).toDateString(); }
function diaTexto(ms) {
  const hoje = new Date();
  if (mesmoDia(ms, hoje)) return 'Hoje';
  const ontem = new Date(hoje);
  ontem.setDate(hoje.getDate() - 1);
  if (mesmoDia(ms, ontem)) return 'Ontem';
  return new Date(ms).toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' });
}
function quando(ms) {
  const t = diaTexto(ms);
  return t === 'Hoje' ? hhmm(ms) : t === 'Ontem' ? 'Ontem' : new Date(ms).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
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
const etqNumero = (inbox) => (inbox ? `<span class="etq e-numero" style="--c:${esc(inbox.color.fg)};--c-d:${esc(inbox.color.bg)}">${esc(inbox.name)}</span>` : '');
/** Texto de mensagem: seguro, com links clicáveis e *negrito* do WhatsApp. */
function textoMsg(t) {
  return esc(t)
    .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>')
    .replace(/(^|[\s(])\*([^*\n]+)\*(?=$|[\s.,!?:;)])/g, '$1<b>$2</b>');
}
function vazio(titulo, texto) {
  return `<div class="vazio">
    <svg aria-hidden="true" width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"></circle><path d="M8 12.5l2.5 2.5 5.5-6"></path></svg>
    <p class="grande">${esc(titulo)}</p><p class="sec pequeno">${esc(texto)}</p></div>`;
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
function irPara(tela) {
  state.tela = tela;
  for (const t of ['conversas', 'pendencias', 'ajustes']) $(`#tela-${t}`).hidden = t !== tela;
  $$('.nav-btn').forEach((b) => (b.dataset.tela === tela ? b.setAttribute('aria-current', 'page') : b.removeAttribute('aria-current')));
  $('#app').dataset.tela = tela;
  if (tela === 'conversas') carregarConversas();
  if (tela === 'pendencias') abrirSub(state.sub);
  if (tela === 'ajustes') abrirAjustes();
}
$$('.nav-btn').forEach((b) => b.addEventListener('click', () => {
  if (!LARGO.matches) fecharChat();
  irPara(b.dataset.tela);
}));

// =====================================================================
// MÓDULO CONVERSAS
// =====================================================================
async function carregarConversas() {
  try {
    const status = state.fConv === 'resolvidas' ? 'resolved' : 'open';
    const r = await api(`/api/conversas?status=${status}`);
    state.conversas = r.conversas;
    if (r.inboxes.length) state.inboxes = r.inboxes;
    desenharConversas();
  } catch (err) {
    $('#lista-conversas').innerHTML = `<li>${vazio('Não foi possível carregar', err.message)}</li>`;
  }
}

function previaHTML(c) {
  const p = c.preview;
  if (!p) return '<span class="conv-prev"><span>Sem mensagens</span></span>';
  const midia = p.midia ? `${IC_MIDIA}<span>${esc(p.texto || MIDIA_NOME[p.midia] || 'Arquivo')}</span>` : `<span>${esc(p.texto || '…')}</span>`;
  return `<span class="conv-prev">${p.dir === 'out' ? CHECKS : ''}${midia}</span>`;
}

function desenharConversas() {
  if (state.tela !== 'conversas') return;
  const lista = state.conversas;
  const meu = state.me.usuario.id;
  const filtros = [
    { id: 'abertas', nome: 'Abertas' },
    { id: 'naolidas', nome: 'Não lidas' },
    { id: 'pendentes', nome: 'Pendentes' },
    { id: 'minhas', nome: 'Minhas' },
    { id: 'resolvidas', nome: 'Resolvidas' },
  ];
  const conta = { naolidas: lista.filter((c) => c.unread).length, pendentes: lista.filter((c) => c.pendente).length };
  $('#filtros-conversas').innerHTML = filtros.map((f) =>
    `<button class="pilula" data-f="${f.id}" aria-pressed="${state.fConv === f.id}">${f.nome}${conta[f.id] && state.fConv !== 'resolvidas' ? ` <span class="n">${conta[f.id]}</span>` : ''}</button>`).join('');
  $$('#filtros-conversas .pilula').forEach((b) => b.addEventListener('click', () => {
    const mudouStatus = (b.dataset.f === 'resolvidas') !== (state.fConv === 'resolvidas');
    state.fConv = b.dataset.f;
    if (mudouStatus) carregarConversas();
    else desenharConversas();
  }));

  const nums = state.inboxes;
  $('#numeros-conversas').hidden = nums.length < 2;
  $('#numeros-conversas').innerHTML = [{ id: 'todos', name: 'Todos os números' }, ...nums].map((n) =>
    `<button class="pilula" data-n="${n.id}" aria-pressed="${String(state.fConvNumero) === String(n.id)}">${n.color ? `<span class="pt" style="--c:${esc(n.color.fg)};--c-d:${esc(n.color.bg)}"></span>` : ''}${esc(n.name)}</button>`).join('');
  $$('#numeros-conversas .pilula').forEach((b) => b.addEventListener('click', () => {
    state.fConvNumero = b.dataset.n;
    desenharConversas();
  }));

  const q = state.buscaConv;
  const itens = lista.filter((c) =>
    (state.fConv !== 'naolidas' || c.unread)
    && (state.fConv !== 'pendentes' || c.pendente)
    && (state.fConv !== 'minhas' || c.assigneeId === meu)
    && (state.fConvNumero === 'todos' || String(c.inbox.id) === String(state.fConvNumero))
    && (!q || [c.contactName, c.contactPhone, fone(c.contactPhone), c.preview?.texto, c.assigneeName].join(' ').toLowerCase().includes(q)));

  const naoLidas = lista.reduce((s, c) => s + (c.unread ? 1 : 0), 0);
  const b = $('#badge-conversas');
  b.hidden = !naoLidas || state.fConv === 'resolvidas';
  b.textContent = naoLidas;
  $('#conversas-info').textContent = `${lista.length} ${state.fConv === 'resolvidas' ? 'resolvidas recentes' : 'abertas'}`;

  $('#lista-conversas').innerHTML = itens.length ? itens.map((c) => `
    <li class="conv">
      <button class="conv-linha ${state.chat?.id === c.id ? 'ativa' : ''}" data-abrir="${c.id}">
        <span class="avatar" style="background:${corAvatar(c.contactName)}" aria-hidden="true">${esc(iniciais(c.contactName))}</span>
        <span class="conv-corpo">
          <span class="conv-l1"><span class="conv-nome">${esc(c.contactName)}</span><span class="conv-hora ${c.unread ? 'nova' : ''}">${quando(c.lastActivityAt)}</span></span>
          <span class="conv-l2">${previaHTML(c)}${c.unread ? `<span class="bolinha" aria-label="${c.unread} não lidas">${c.unread}</span>` : ''}</span>
          <span class="etqs">${etqNumero(c.inbox)}${c.pendente ? `<span class="etq ${TIPO[c.pendente.tipo].cls}">${TIPO[c.pendente.tipo].label} · ${tempo(c.pendente.minutos)}</span>` : ''}${c.adiada ? '<span class="etq e-resp">Adiada</span>' : ''}${c.assigneeName ? `<span class="etq e-resp">${esc(c.assigneeName)}</span>` : ''}</span>
        </span>
      </button>
    </li>`).join('') : `<li>${vazio('Nenhuma conversa', q ? 'Nada encontrado com essa pesquisa.' : 'Nada com esse filtro.')}</li>`;
  $$('#lista-conversas [data-abrir]').forEach((el) => el.addEventListener('click', () => abrirChat(Number(el.dataset.abrir))));
}
$('#busca-conversas').addEventListener('input', (e) => {
  state.buscaConv = e.target.value.trim().toLowerCase();
  desenharConversas();
});

// =====================================================================
// CONVERSA ABERTA (mensagens, mídias, responder)
// =====================================================================
function acharConversa(id) {
  return state.conversas.find((c) => c.id === id)
    || [...(state.pend?.items || []), ...(state.pend?.adiadas || []), ...(state.verif?.items || [])].find((i) => i.id === id)
    || null;
}

async function abrirChat(id) {
  if (EMBUTIDO) {
    const item = acharConversa(id);
    if (item?.url) window.open(item.url, '_top');
    return;
  }
  const conv = acharConversa(id) || { id, contactName: `Conversa ${id}`, contactPhone: '' };
  state.chat = { id, conv, mensagens: [], pendencia: null, marca: {}, url: '', max: 80 };
  $('#chat').hidden = false;
  $('#app').classList.add('tem-chat');
  $('#chat-nome').textContent = conv.contactName;
  $('#chat-avatar').textContent = iniciais(conv.contactName);
  $('#chat-avatar').style.background = corAvatar(conv.contactName);
  $('#chat-sub').textContent = [fone(conv.contactPhone), conv.inbox?.name].filter(Boolean).join(' · ');
  $('#chat-mensagens').innerHTML = '<p class="sec pequeno centro carregando">Carregando mensagens…</p>';
  $('#chat-pendencia').hidden = true;
  $('#chat-texto').value = '';
  const pode = state.me.usuario.podeResponder;
  $('#chat-como').textContent = pode ? `Respondendo como ${state.me.usuario.name}` : 'Para responder por aqui, saia e entre de novo no painel.';
  $('#chat-texto').disabled = !pode;
  $('#chat-enviar').disabled = !pode;
  desenharConversas();
  await atualizarChat(true);
}

function fecharChat() {
  // Para qualquer áudio ou vídeo tocando
  $$('#chat-mensagens audio, #chat-mensagens video').forEach((m) => m.pause());
  state.chat = null;
  $('#chat').hidden = true;
  $('#app').classList.remove('tem-chat');
  if (state.tela === 'conversas') desenharConversas();
}
$('#chat-voltar').addEventListener('click', fecharChat);

function anexoHTML(a) {
  if (a.tipo === 'imagem') return `<button class="m-foto" data-foto="${esc(a.url)}" aria-label="Ampliar foto"><img src="${esc(a.url)}" alt="Foto enviada na conversa" loading="lazy"></button>`;
  if (a.tipo === 'audio') return `<audio class="m-audio" controls preload="none" src="${esc(a.url)}"></audio>`;
  if (a.tipo === 'video') return `<video class="m-video" controls preload="metadata" playsinline src="${esc(a.url)}"></video>`;
  if (a.tipo === 'local' && a.lat != null) return `<a class="m-arquivo" href="https://www.google.com/maps?q=${encodeURIComponent(`${a.lat},${a.lng}`)}" target="_blank" rel="noopener noreferrer">Localização${a.titulo ? `: ${esc(a.titulo)}` : ''}</a>`;
  if (!a.url) return `<span class="m-arquivo">${esc(MIDIA_NOME[a.tipo] || 'Arquivo')}</span>`;
  const kb = a.tamanho ? ` · ${a.tamanho > 1048576 ? `${(a.tamanho / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(a.tamanho / 1024))} KB`}` : '';
  return `<a class="m-arquivo" href="${esc(a.url)}" target="_blank" rel="noopener">${IC_MIDIA}<span>${esc(a.nome)}<small>${kb}</small></span></a>`;
}

function mensagemHTML(m) {
  if (m.tipo === 'sistema') return `<div class="aviso-sis" data-mid="${m.id}">${esc(m.texto)}</div>`;
  const anexos = (m.anexos || []).map(anexoHTML).join('');
  const texto = m.texto ? `<span class="m-texto">${textoMsg(m.texto)}</span>` : '';
  if (m.tipo === 'nota') {
    return `<div class="balao nota" data-mid="${m.id}"><span class="autor">Nota interna · ${esc(m.autor)}</span>${anexos}${texto}<span class="meta">${hhmm(m.at)}</span></div>`;
  }
  if (m.tipo === 'recebida') return `<div class="balao in" data-mid="${m.id}">${anexos}${texto}<span class="meta">${hhmm(m.at)}</span></div>`;
  const ia = m.autorTipo === 'ia' && !m.auto;
  const falhou = m.status === 'failed';
  return `<div class="balao out ${falhou ? 'falhou' : ''} ${m.auto ? 'auto' : ''}" data-mid="${m.id}"><span class="autor ${m.auto ? 'autor-auto' : ia ? 'autor-ia' : ''}">${m.auto ? 'Resposta automática' : `${ia ? '✦ ' : ''}${esc(m.autor || 'Equipe')}`}</span>${anexos}${texto}<span class="meta">${falhou ? 'Não enviada · ' : ''}${hhmm(m.at)} ${CHECKS}</span></div>`;
}

function desenharMensagens(novas) {
  const caixa = $('#chat-mensagens');
  const antigas = state.chat.mensagens;
  const mesmoInicio = antigas.length && novas.length >= antigas.length && antigas.every((m, i) => m.id === novas[i].id);
  const noFim = caixa.scrollHeight - caixa.scrollTop - caixa.clientHeight < 120;
  if (mesmoInicio) {
    // Só acrescenta o que chegou (não mexe no que já está na tela, para não parar um áudio tocando)
    const extra = novas.slice(antigas.length);
    if (extra.length) {
      let anterior = antigas[antigas.length - 1];
      caixa.insertAdjacentHTML('beforeend', extra.map((m) => {
        const sep = !mesmoDia(anterior.at, m.at) ? `<div class="aviso-sis dia-sep">${diaTexto(m.at)}</div>` : '';
        anterior = m;
        return sep + mensagemHTML(m);
      }).join(''));
    }
    // Atualiza marca de "não enviada"
    for (const m of novas) if (m.status === 'failed') caixa.querySelector(`[data-mid="${m.id}"]`)?.classList.add('falhou');
  } else {
    let anterior = null;
    const mais = state.chat.temMais ? '<button id="chat-mais" class="btn-contorno btn-p mais">Ver mensagens anteriores</button>' : '';
    caixa.innerHTML = mais + (novas.length ? novas.map((m) => {
      const sep = !anterior || !mesmoDia(anterior.at, m.at) ? `<div class="aviso-sis dia-sep">${diaTexto(m.at)}</div>` : '';
      anterior = m;
      return sep + mensagemHTML(m);
    }).join('') : '<p class="sec pequeno centro">Nenhuma mensagem nesta conversa.</p>');
    $('#chat-mais')?.addEventListener('click', async () => {
      state.chat.max = Math.min(400, state.chat.max + 120);
      state.chat.mensagens = [];
      await atualizarChat(false, true);
    });
  }
  state.chat.mensagens = novas;
  if (!mesmoInicio || noFim) caixa.scrollTop = caixa.scrollHeight;
}

function desenharFaixaPendencia() {
  const el = $('#chat-pendencia');
  const p = state.chat.pendencia;
  if (!p) {
    el.hidden = true;
    return;
  }
  const adiada = p.adiadaAte && p.adiadaAte > Date.now();
  el.hidden = false;
  el.className = `chat-pendencia ${URG[p.urgencia]?.cls || ''}`;
  el.innerHTML = `
    <div class="cp-topo"><span class="etq ${TIPO[p.primary].cls}">${TIPO[p.primary].label}</span><span class="sec pequeno">${adiada ? `Adiada até ${mesmoDia(p.adiadaAte, Date.now()) ? '' : `${diaTexto(p.adiadaAte).toLowerCase()} `}${hhmm(p.adiadaAte)}` : `aguardando há ${tempo(p.waitingMinutes)}`}</span></div>
    ${p.resumo ? `<p class="cp-resumo">${esc(p.resumo)}</p>` : ''}
    ${p.proximoPasso ? `<p class="sec pequeno"><b>Próximo passo:</b> ${esc(p.proximoPasso)}</p>` : ''}`;
}

async function atualizarChat(primeira = false, manterTopo = false) {
  const ch = state.chat;
  if (!ch) return;
  try {
    const r = await api(`/api/conversas/${ch.id}?max=${ch.max}`);
    if (state.chat !== ch) return; // trocou de conversa enquanto carregava
    ch.temMais = r.temMais;
    ch.pendencia = r.pendencia;
    ch.marca = r.marca;
    ch.url = r.url;
    if (primeira) ch.mensagens = [];
    desenharMensagens(r.mensagens);
    if (manterTopo) $('#chat-mensagens').scrollTop = 0;
    desenharFaixaPendencia();
  } catch (err) {
    if (primeira) $('#chat-mensagens').innerHTML = vazio('Não foi possível abrir', err.message);
  }
}

// Fotos ampliadas
$('#chat-mensagens').addEventListener('click', (e) => {
  const b = e.target.closest('[data-foto]');
  if (!b) return;
  $('#foto-img').src = b.dataset.foto;
  $('#foto').showModal();
});
$('#foto').addEventListener('click', (e) => { if (e.target.id !== 'foto-img') $('#foto').close(); });

// Responder
const campo = $('#chat-texto');
campo.addEventListener('input', () => {
  campo.style.height = 'auto';
  campo.style.height = `${Math.min(campo.scrollHeight, 140)}px`;
});
campo.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && LARGO.matches) {
    e.preventDefault();
    $('#chat-form').requestSubmit();
  }
});
$('#chat-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const texto = campo.value.trim();
  if (!texto || !state.chat) return;
  $('#chat-enviar').disabled = true;
  try {
    await api(`/api/conversas/${state.chat.id}/mensagens`, { method: 'POST', body: { texto } });
    campo.value = '';
    campo.style.height = 'auto';
    await atualizarChat();
    $('#chat-mensagens').scrollTop = $('#chat-mensagens').scrollHeight;
    recarregarListas();
  } catch (err) {
    toast(err.message);
  } finally {
    $('#chat-enviar').disabled = !state.me.usuario.podeResponder;
  }
});

// ---------- Ações (conversa e pendência) ----------
function minutosAteAmanha(hora = 8, minuto = 30) {
  const a = new Date();
  const alvo = new Date(a);
  alvo.setDate(a.getDate() + 1);
  alvo.setHours(hora, minuto, 0, 0);
  return Math.round((alvo - a) / 60000);
}

async function acao(id, tipo, extra = {}) {
  const rota = {
    assumir: ['assumir'], resolver: ['resolver'], reabrir: ['reabrir'], concluir: ['concluir'], dispensar: ['dispensar'],
    adiar: ['adiar', { minutos: extra.minutos }], desadiar: ['adiar', { minutos: 0 }], marcar: ['marcar', { nota: extra.nota }],
  }[tipo];
  await api(`/api/conversas/${id}/${rota[0]}`, { method: 'POST', body: rota[1] || {} });
}

async function executar(id, tipo, extra, mensagem) {
  try {
    await acao(id, tipo, extra);
    if (mensagem) toast(mensagem);
    if (tipo === 'resolver' && state.chat?.id === id && !LARGO.matches) fecharChat();
    await recarregarListas(true);
    if (state.chat?.id === id) await atualizarChat();
  } catch (err) {
    toast(err.message);
  }
}

function recarregarListas(forcar = false) {
  const tarefas = [carregarPendencias(forcar)];
  if (state.tela === 'conversas') tarefas.push(carregarConversas());
  return Promise.all(tarefas);
}

function abrirAcoes(id) {
  const item = acharConversa(id) || {};
  const pend = [...(state.pend?.items || []), ...(state.pend?.adiadas || [])].find((i) => i.id === id) || (state.chat?.id === id ? state.chat.pendencia : null);
  const marca = state.chat?.id === id ? state.chat.marca : {};
  const adiada = pend?.adiadaAte && pend.adiadaAte > Date.now();
  const resolvida = item.status === 'resolved';
  const url = item.url || (state.chat?.id === id ? state.chat.url : '');
  const botoes = [];
  const b = (acaoId, rotulo, detalhe = '', cls = '') => botoes.push(`<button class="acao ${cls}" data-acao="${acaoId}"><span>${rotulo}</span>${detalhe ? `<small class="sec">${detalhe}</small>` : ''}</button>`);
  if (!resolvida) b('assumir', 'Assumir conversa', 'Você vira o responsável');
  if (pend && !adiada) {
    b('adiar60', 'Adiar 1 hora', 'Some da lista e volta depois');
    b('adiar180', 'Adiar 3 horas');
    b('adiarAmanha', 'Adiar até amanhã 8:30');
  }
  if (adiada) b('desadiar', 'Voltar para a lista agora', 'Cancelar o adiamento');
  if (pend?.primary === 'manual' || marca?.manual) b('concluir', 'Concluir marcação', 'Tira a pendência marcada pela equipe');
  else if (!resolvida) b('marcar', 'Marcar como pendência', 'Com uma anotação do que falta fazer');
  if (pend && pend.primary !== 'manual') b('dispensar', 'Não é pendência', 'Tira da lista até chegar mensagem nova');
  if (resolvida) b('reabrir', 'Reabrir conversa');
  else b('resolver', 'Marcar conversa como resolvida');
  if (item.contactId != null && !resolvida) b('ignorar', 'Ignorar este contato', 'Fornecedor, mensagens diárias de valores…');
  if (url) botoes.push(`<a class="acao" href="${esc(url)}" target="_blank" rel="noopener"><span>Abrir no Chatwoot</span></a>`);

  $('#acoes-titulo').textContent = item.contactName || 'Ações';
  $('#acoes-lista').innerHTML = botoes.join('');
  const folha = $('#folha-acoes');
  $$('#acoes-lista [data-acao]').forEach((el) => el.addEventListener('click', async () => {
    const a = el.dataset.acao;
    folha.close();
    if (a === 'assumir') return executar(id, 'assumir', {}, 'Conversa assumida');
    if (a === 'adiar60') return executar(id, 'adiar', { minutos: 60 }, 'Adiada por 1 hora');
    if (a === 'adiar180') return executar(id, 'adiar', { minutos: 180 }, 'Adiada por 3 horas');
    if (a === 'adiarAmanha') return executar(id, 'adiar', { minutos: minutosAteAmanha() }, 'Adiada até amanhã 8:30');
    if (a === 'desadiar') return executar(id, 'desadiar', {}, 'De volta na lista');
    if (a === 'concluir') return executar(id, 'concluir', {}, 'Marcação concluída');
    if (a === 'dispensar') return executar(id, 'dispensar', {}, 'Tirada das pendências');
    if (a === 'reabrir') return executar(id, 'reabrir', {}, 'Conversa reaberta');
    if (a === 'resolver') {
      if (!confirm('Marcar esta conversa como resolvida?')) return;
      return executar(id, 'resolver', {}, 'Conversa resolvida');
    }
    if (a === 'marcar') {
      const nota = prompt('O que falta fazer? (ex.: enviar orçamento até sexta)');
      if (nota === null) return;
      return executar(id, 'marcar', { nota }, 'Marcada como pendência');
    }
    if (a === 'ignorar') {
      if (!confirm(`${item.contactName} não vai mais entrar na análise de pendências.\n\nDá para desfazer em Ajustes → Contatos ignorados.`)) return;
      try {
        await api('/api/ignorados', { method: 'POST', body: { contactId: item.contactId, nome: item.contactName, telefone: item.contactPhone } });
        toast('Contato ignorado nas pendências');
        await recarregarListas(true);
        if (state.chat?.id === id) await atualizarChat();
      } catch (err) {
        toast(err.message);
      }
    }
  }));
  folha.showModal();
}
$('#chat-acoes').addEventListener('click', () => state.chat && abrirAcoes(state.chat.id));
$$('dialog [data-fechar]').forEach((b) => b.addEventListener('click', () => b.closest('dialog').close()));

// =====================================================================
// MÓDULO PENDÊNCIAS
// =====================================================================
function abrirSub(sub) {
  state.sub = sub;
  for (const s of ['agora', 'verificacoes', 'indicadores']) $(`#sub-${s}`).hidden = s !== sub;
  $$('#sub-pendencias button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.sub === sub)));
  if (sub === 'agora') carregarPendencias();
  if (sub === 'verificacoes') carregarDia(state.dia, state.hora);
  if (sub === 'indicadores') carregarIndicadores();
}
$$('#sub-pendencias button').forEach((b) => b.addEventListener('click', () => abrirSub(b.dataset.sub)));

$('#btn-atualizar').addEventListener('click', async () => {
  const b = $('#btn-atualizar');
  b.classList.add('girando');
  try {
    if (state.sub === 'verificacoes') await carregarDia(state.dia, state.hora);
    else if (state.sub === 'indicadores') await carregarPendencias(true).then(carregarIndicadores);
    else await carregarPendencias(true);
  } finally {
    b.classList.remove('girando');
  }
});

async function carregarPendencias(forcar = false) {
  try {
    state.pend = await api(`/api/pendencias${forcar ? '?atualizar=1' : ''}`);
    if (state.pend.inboxes.length) state.inboxes = state.pend.inboxes;
    const b = $('#badge-pendencias');
    b.hidden = !state.pend.totals.total;
    b.textContent = state.pend.totals.total;
    if ('setAppBadge' in navigator) navigator.setAppBadge(state.pend.totals.total).catch(() => {});
    desenharPendencias();
  } catch (err) {
    if (state.tela === 'pendencias' && state.sub === 'agora') $('#lista-pendencias').innerHTML = vazio('Não foi possível carregar', err.message);
  }
}

function origemHTML(item) {
  const f = item.flags.find((x) => x.type !== 'manual') || item.flags[0];
  if (!f?.text) return '';
  if (f.type === 'manual') return `<p class="origem"><span class="sec">Anotação de ${esc(f.by || 'equipe')}:</span> ${esc(f.text)}</p>`;
  const quem = f.type === 'retorno_prometido' ? (f.byAuthor === 'ia' ? '✦ IA' : f.by || 'Equipe') : 'Cliente';
  return `<p class="origem"><span class="sec">${esc(quem)} · ${quando(f.since)}${mesmoDia(f.since, Date.now()) ? '' : ` ${hhmm(f.since)}`}:</span> “${esc(f.text.slice(0, 220))}”</p>`;
}

const MOTIVO = { pergunta: 'Pergunta', pedido: 'Pedido', midia: 'Áudio ou foto' };

function cartao(item, { acoes = true, selecionavel = false } = {}) {
  const motivo = item.motivo || item.flags.find((f) => f.motivo)?.motivo;
  const adiada = item.adiadaAte && item.adiadaAte > Date.now();
  const fonte = item.fonte === 'ia' ? '<span class="etq e-ia">✦ Análise da IA</span>' : item.fonte === 'equipe' ? '' : '<span class="etq e-resp">Regra automática</span>';
  return `
  <article class="cartao ${URG[item.urgencia]?.cls || ''}" data-id="${item.id}">
    <div class="cartao-topo">
      ${selecionavel ? `<label class="cartao-sel"><input type="checkbox" data-sel="${item.id}" ${state.sel.has(item.id) ? 'checked' : ''}><span class="sr">Selecionar ${esc(item.contactName)}</span></label>` : ''}
      <span class="avatar avatar-p" style="background:${corAvatar(item.contactName)}" aria-hidden="true">${esc(iniciais(item.contactName))}</span>
      <div class="cartao-quem"><p class="cartao-nome">${esc(item.contactName)}</p><p class="sec pequeno">${[esc(fone(item.contactPhone)), item.assigneeName ? `Resp.: ${esc(item.assigneeName)}` : 'Sem responsável'].filter(Boolean).join(' · ')}</p></div>
      <span class="espera ${item.waitingMinutes >= 120 ? 'atraso' : ''}">${adiada ? `até ${hhmm(item.adiadaAte)}` : tempo(item.waitingMinutes)}</span>
    </div>
    <div class="etqs">${etqNumero(item.inbox)}${item.flags.map((f) => `<span class="etq ${TIPO[f.type].cls}">${TIPO[f.type].label}</span>`).join('')}${MOTIVO[motivo] ? `<span class="etq e-resp">${MOTIVO[motivo]}</span>` : ''}${item.urgencia === 'alta' ? '<span class="etq u-chip">Urgente</span>' : ''}${fonte}</div>
    ${item.resumo ? `<p class="resumo">${esc(item.resumo)}</p>` : ''}
    ${item.proximoPasso ? `<p class="passo"><b>Próximo passo:</b> ${esc(item.proximoPasso)}</p>` : ''}
    ${origemHTML(item)}
    ${acoes ? `<div class="cartao-acoes">
      <button class="btn-verde btn-p" data-abrir="${item.id}">${EMBUTIDO ? 'Abrir conversa' : 'Abrir e responder'}</button>
      ${adiada ? `<button class="btn-contorno btn-p" data-rapida="desadiar" data-id="${item.id}">Voltar para a lista</button>` : `<button class="btn-contorno btn-p" data-rapida="adiar" data-id="${item.id}">Adiar 1h</button>`}
      <button class="btn-contorno btn-p" data-mais="${item.id}" aria-label="Mais ações para ${esc(item.contactName)}">Mais…</button>
    </div>` : `<div class="cartao-acoes"><button class="btn-contorno btn-p" data-abrir="${item.id}">Abrir conversa</button></div>`}
  </article>`;
}

function ligarCartoes(el) {
  el.querySelectorAll('[data-abrir]').forEach((b) => b.addEventListener('click', () => abrirChat(Number(b.dataset.abrir))));
  el.querySelectorAll('[data-mais]').forEach((b) => b.addEventListener('click', () => abrirAcoes(Number(b.dataset.mais))));
  el.querySelectorAll('[data-rapida]').forEach((b) => b.addEventListener('click', () => {
    const id = Number(b.dataset.id);
    if (b.dataset.rapida === 'adiar') executar(id, 'adiar', { minutos: 60 }, 'Adiada por 1 hora');
    else executar(id, 'desadiar', {}, 'De volta na lista');
  }));
}

function desenharPendencias() {
  const d = state.pend;
  if (!d || state.tela !== 'pendencias' || state.sub !== 'agora') return;
  const t = d.totals;
  $('#resumo-agora').innerHTML = `
    <div class="tile"><span class="tile-n">${t.total}</span><span class="tile-l">aguardando</span></div>
    <div class="tile ${t.urgentes ? 'tile-alerta' : ''}"><span class="tile-n">${t.urgentes}</span><span class="tile-l">urgentes</span></div>
    <div class="tile"><span class="tile-n">${t.total ? tempo(t.maisAntigoMin) : '–'}</span><span class="tile-l">mais antiga</span></div>`;

  const tipos = [
    { id: 'todos', nome: 'Todas', n: t.total },
    { id: 'urgentes', nome: 'Urgentes', n: t.urgentes },
    { id: 'minhas', nome: 'Minhas', n: d.items.filter((i) => i.assigneeId === state.me.usuario.id).length },
    { id: 'pediu_atendente', nome: 'Pediu atendente', n: t.pediuAtendente },
    { id: 'retorno_prometido', nome: 'Retorno prometido', n: t.retornoPrometido },
    { id: 'sem_resposta', nome: 'Sem resposta', n: t.semResposta },
    { id: 'manual', nome: 'Marcadas', n: t.manual },
  ].filter((x) => x.id === 'todos' || x.n || state.fTipo === x.id);
  $('#filtros-tipo').innerHTML = tipos.map((x) => `<button class="pilula" data-tipo="${x.id}" aria-pressed="${state.fTipo === x.id}">${x.nome}${x.n ? ` <span class="n">${x.n}</span>` : ''}</button>`).join('');
  $$('#filtros-tipo .pilula').forEach((b) => b.addEventListener('click', () => { state.fTipo = b.dataset.tipo; desenharPendencias(); }));

  $('#filtros-numero').hidden = d.inboxes.length < 2;
  $('#filtros-numero').innerHTML = [{ id: 'todos', name: 'Todos os números', total: t.total }, ...t.porNumero].map((c) => {
    const cor = d.inboxes.find((i) => String(i.id) === String(c.id))?.color;
    return `<button class="pilula" data-id="${c.id}" aria-pressed="${String(state.fNumero) === String(c.id)}">${cor ? `<span class="pt" style="--c:${esc(cor.fg)};--c-d:${esc(cor.bg)}"></span>` : ''}${esc(c.name)} <span class="n">${c.total}</span></button>`;
  }).join('');
  $$('#filtros-numero .pilula').forEach((b) => b.addEventListener('click', () => { state.fNumero = b.dataset.id; desenharPendencias(); }));

  const itens = d.items.filter((i) =>
    (state.fNumero === 'todos' || String(i.inbox?.id) === String(state.fNumero))
    && (state.fTipo === 'todos'
      || (state.fTipo === 'urgentes' && i.urgencia === 'alta')
      || (state.fTipo === 'minhas' && i.assigneeId === state.me.usuario.id)
      || i.flags.some((f) => f.type === state.fTipo)));
  const lista = $('#lista-pendencias');
  lista.innerHTML = itens.length ? itens.map((i) => cartao(i)).join('')
    : vazio(t.total ? 'Nada com esse filtro' : 'Tudo em dia', t.total ? 'Escolha outro filtro.' : 'Nenhum cliente aguardando retorno.');
  ligarCartoes(lista);

  const ad = d.adiadas || [];
  $('#bloco-adiadas').hidden = !ad.length;
  $('#adiadas-titulo').textContent = `Adiadas (${ad.length})`;
  $('#lista-adiadas').innerHTML = ad.map((i) => cartao(i)).join('');
  ligarCartoes($('#lista-adiadas'));

  const ia = d.ia?.ativa ? (d.ia.pausada ? 'análise da IA em pausa (usando regras)' : 'analisado pela IA') : 'analisado por regras';
  const ign = d.ignoredConversations ? ` · ${d.ignoredConversations} fora da análise` : '';
  $('#agora-rodape').textContent = `Atualizado ${hhmm(d.updatedAt)} · ${d.openConversations} conversas abertas${ign} · ${ia}`;
  desenharConversaChatwoot();
}

// ---------- Verificações ----------
function somarDias(iso, n) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

async function carregarDia(dia, horaEscolhida) {
  let r;
  try {
    r = await api(`/api/verificacoes${dia ? `?data=${dia}` : ''}`);
  } catch (err) {
    $('#lista-verif').innerHTML = vazio('Erro', err.message);
    return;
  }
  state.dia = r.data;
  const label = new Date(`${r.data}T12:00:00Z`).toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit', timeZone: 'UTC' });
  $('#dia-label').textContent = r.data === r.hoje ? `Hoje, ${label}` : label.charAt(0).toUpperCase() + label.slice(1);
  $('#dia-proximo').disabled = r.data >= r.hoje;
  state.verif = null;
  state.sel.clear();
  $('#verif-barra').hidden = true;
  if (!r.horarios.length) {
    $('#horarios').innerHTML = '';
    $('#verif-resumo').hidden = true;
    $('#lista-verif').innerHTML = vazio('Sem verificações neste dia', 'As verificações acontecem de segunda a sábado.');
    return;
  }
  const feitas = r.horarios.filter((h) => h.status === 'feita');
  const escolhida = horaEscolhida && r.horarios.some((h) => h.time === horaEscolhida) ? horaEscolhida : (feitas.length ? feitas[feitas.length - 1].time : r.horarios[0].time);
  state.hora = escolhida;
  const sub = { feita: 'feita', agendada: 'agendada', nao_executada: 'não executada' };
  $('#horarios').innerHTML = r.horarios.map((h) => `<button class="pilula" role="tab" data-h="${h.time}" aria-selected="${h.time === escolhida}"><span class="h">${h.time}</span><span class="s">${sub[h.status]}</span></button>`).join('');
  $$('#horarios .pilula').forEach((b) => b.addEventListener('click', () => carregarDia(state.dia, b.dataset.h)));
  const st = r.horarios.find((h) => h.time === escolhida).status;
  if (st !== 'feita') {
    $('#verif-resumo').hidden = true;
    $('#lista-verif').innerHTML = st === 'agendada'
      ? vazio(`Próxima verificação às ${escolhida}`, 'A equipe recebe um aviso no celular quando a lista ficar pronta.')
      : vazio('Verificação não executada', 'O servidor estava desligado neste horário.');
    return;
  }
  try {
    const snap = await api(`/api/verificacoes/${r.data}/${escolhida.replace(':', '')}`);
    state.verif = snap;
    const t = snap.totals;
    $('#verif-resumo').hidden = false;
    $('#verif-resumo').textContent = t.total
      ? `Às ${snap.time}: ${t.total} cliente${t.total > 1 ? 's' : ''} aguardando${t.urgentes ? `, ${t.urgentes} urgente${t.urgentes > 1 ? 's' : ''}` : ''}`
      : `Às ${snap.time}, todas as conversas estavam respondidas`;
    const lista = $('#lista-verif');
    lista.innerHTML = snap.items.length ? snap.items.map((i) => cartao({ urgencia: 'media', ...i }, { acoes: false, selecionavel: true })).join('') : vazio('Nenhuma pendência', 'Tudo respondido neste horário.');
    ligarCartoes(lista);
    // Seleção para o relatório da recepção
    $('#verif-barra').hidden = !snap.items.length;
    const atualizarBarra = () => {
      const n = state.sel.size;
      $('#btn-relatorio').disabled = !n;
      $('#btn-relatorio').textContent = n ? `Gerar relatório (${n})` : 'Gerar relatório';
      $('#sel-todos').checked = snap.items.length > 0 && snap.items.every((i) => state.sel.has(i.id));
    };
    lista.querySelectorAll('[data-sel]').forEach((c) => c.addEventListener('change', () => {
      const id = Number(c.dataset.sel);
      if (c.checked) state.sel.add(id);
      else state.sel.delete(id);
      atualizarBarra();
    }));
    $('#sel-todos').onchange = (e) => {
      for (const i of snap.items) (e.target.checked ? state.sel.add(i.id) : state.sel.delete(i.id));
      lista.querySelectorAll('[data-sel]').forEach((c) => { c.checked = e.target.checked; });
      atualizarBarra();
    };
    atualizarBarra();
  } catch (err) {
    $('#lista-verif').innerHTML = vazio('Erro', err.message);
  }
}
$('#dia-anterior').addEventListener('click', () => carregarDia(somarDias(state.dia, -1)));
$('#dia-proximo').addEventListener('click', () => carregarDia(somarDias(state.dia, 1)));

// ---------- Relatório para a recepção ----------
function textoRelatorio(itens, snap) {
  const [, m, d] = snap.date.split('-');
  const linhas = ['*Clientes aguardando resposta*', `Verificação de ${d}/${m} às ${snap.time} · ${itens.length} cliente${itens.length > 1 ? 's' : ''}`, ''];
  itens.forEach((i, n) => {
    const f = i.flags.find((x) => x.type !== 'manual') || i.flags[0] || {};
    const motivo = { pergunta: 'pergunta', pedido: 'pedido', midia: 'áudio/foto' }[i.motivo || i.flags.find((x) => x.motivo)?.motivo] || '';
    const sit = i.flags.map((x) => TIPO[x.type].label.toLowerCase()).join(' e ');
    const digitos = String(i.contactPhone || '').replace(/\D/g, '');
    linhas.push(`${n + 1}. *${i.contactName}*${i.contactPhone ? ` — ${fone(i.contactPhone)}` : ''}`);
    linhas.push(`   ${i.inbox ? `Número: ${i.inbox.name} · ` : ''}${sit}${motivo ? ` (${motivo})` : ''} há ${tempo(i.waitingMinutes)}`);
    if (i.resumo) linhas.push(`   O que espera: ${i.resumo}`);
    if (i.proximoPasso) linhas.push(`   Próximo passo: ${i.proximoPasso}`);
    const txt = String(f.text || '').replace(/\s+/g, ' ').trim();
    if (txt && !i.resumo) linhas.push(`   Última mensagem: "${txt.length > 140 ? `${txt.slice(0, 140)}…` : txt}"`);
    if (i.assigneeName || i.lastHumanName) linhas.push(`   Atendente: ${i.assigneeName || i.lastHumanName}`);
    if (digitos) linhas.push(`   Chamar: https://wa.me/${digitos}`);
    linhas.push('');
  });
  linhas.push('_Gerado pelo painel de pendências_');
  return linhas.join('\n');
}
$('#btn-relatorio').addEventListener('click', () => {
  const snap = state.verif;
  if (!snap) return;
  const itens = snap.items.filter((i) => state.sel.has(i.id));
  if (!itens.length) return;
  $('#rel-texto').value = textoRelatorio(itens, snap);
  $('#rel-compartilhar').hidden = !navigator.share;
  $('#rel-dialog').showModal();
});
$('#rel-copiar').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText($('#rel-texto').value);
  } catch {
    $('#rel-texto').select();
    document.execCommand('copy');
  }
  toast('Relatório copiado');
});
$('#rel-whats').addEventListener('click', () => {
  window.open(`https://wa.me/?text=${encodeURIComponent($('#rel-texto').value)}`, '_blank', 'noopener');
});
$('#rel-compartilhar').addEventListener('click', () => {
  navigator.share({ title: 'Clientes aguardando resposta', text: $('#rel-texto').value }).catch(() => {});
});

// ---------- Indicadores ----------
function barras(titulo, linhas, total) {
  if (!linhas.length) return '';
  const max = Math.max(1, ...linhas.map((l) => l.total));
  return `<section class="ind"><h2>${esc(titulo)}</h2>${linhas.map((l) => `
    <div class="barra-linha"><span class="barra-nome">${esc(l.name)}</span><span class="barra-trilho"><span class="barra" style="width:${Math.round((l.total / max) * 100)}%"></span></span><span class="barra-n">${l.total}</span></div>`).join('')}
    ${total != null ? `<p class="sec pequeno">Total: ${total}</p>` : ''}</section>`;
}

async function carregarIndicadores() {
  const el = $('#indicadores');
  try {
    const r = await api('/api/indicadores');
    const t = r.totals;
    const porTipo = [
      { name: 'Pediu atendente', total: t.pediuAtendente },
      { name: 'Retorno prometido', total: t.retornoPrometido },
      { name: 'Sem resposta', total: t.semResposta },
      { name: 'Marcadas pela equipe', total: t.manual },
    ].filter((x) => x.total);
    const dias = r.dias.map((d) => ({
      name: new Date(`${d.data}T12:00:00Z`).toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', timeZone: 'UTC' }),
      total: d.verificacoes.length ? Math.max(...d.verificacoes.map((v) => v.total)) : 0,
      tem: d.verificacoes.length > 0,
    }));
    const temHistorico = dias.some((d) => d.tem);
    el.innerHTML = `
      <div class="tiles tiles-4">
        <div class="tile"><span class="tile-n">${t.total}</span><span class="tile-l">aguardando agora</span></div>
        <div class="tile ${t.urgentes ? 'tile-alerta' : ''}"><span class="tile-n">${t.urgentes}</span><span class="tile-l">urgentes</span></div>
        <div class="tile"><span class="tile-n">${r.adiadas}</span><span class="tile-l">adiadas</span></div>
        <div class="tile"><span class="tile-n">${r.abertas}</span><span class="tile-l">conversas abertas</span></div>
      </div>
      ${t.total ? barras('Por situação', porTipo) + barras('Por responsável', t.porAtendente) + (t.porNumero.length > 1 ? barras('Por número', t.porNumero) : '') : vazio('Tudo em dia', 'Nenhuma pendência para analisar agora.')}
      ${temHistorico ? barras('Pico de pendências nas verificações (7 dias)', dias) : '<section class="ind"><h2>Últimos 7 dias</h2><p class="sec pequeno">O histórico aparece depois das primeiras verificações (08:30, 12:00 e 17:00).</p></section>'}`;
  } catch (err) {
    el.innerHTML = vazio('Não foi possível carregar', err.message);
  }
}

// ---------- Dentro do Chatwoot: mostra se a conversa aberta lá está pendente ----------
function desenharConversaChatwoot() {
  const el = $('#conv-atual');
  if (!EMBUTIDO || !state.convAtualChatwoot || !state.pend) {
    el.hidden = true;
    return;
  }
  const item = state.pend.items.find((i) => i.id === state.convAtualChatwoot);
  el.hidden = false;
  el.className = `faixa ${item ? 'faixa-alerta' : 'faixa-ok'}`;
  el.textContent = item ? `Esta conversa está pendente há ${tempo(item.waitingMinutes)}${item.resumo ? `: ${item.resumo}` : ''}` : 'Esta conversa não tem pendência.';
}
if (EMBUTIDO) {
  window.addEventListener('message', (e) => {
    let msg = e.data;
    if (typeof msg === 'string') {
      try { msg = JSON.parse(msg); } catch { return; }
    }
    if (msg?.event === 'appContext' && msg.data?.conversation?.id) {
      state.convAtualChatwoot = Number(msg.data.conversation.id);
      desenharConversaChatwoot();
    }
  });
  try { window.parent.postMessage('chatwoot-dashboard-app:fetch-info', '*'); } catch { /* fora do Chatwoot */ }
}

// =====================================================================
// AJUSTES
// =====================================================================
function abrirAjustes() {
  atualizarPushStatus();
  carregarIgnorados();
  const ia = state.pend?.ia || state.me.ia || {};
  $('#ia-titulo').textContent = ia.ativa ? (ia.pausada ? 'Em pausa: usando regras por palavra-chave' : 'Ligada: a IA lê o contexto de cada conversa') : 'Desligada: usando regras por palavra-chave';
  $('#ia-detalhe').textContent = ia.ativa
    ? [ia.modelo && `Modelo: ${ia.modelo}`, ia.ultimoErro].filter(Boolean).join(' · ')
    : 'Para ligar, o administrador coloca a chave ANTHROPIC_API_KEY no arquivo .env do servidor.';
  const podeQr = state.me.usuario.admin && state.me.qrcode;
  $('#sec-numeros').hidden = !podeQr;
  if (podeQr) carregarNumeros();
}

// Números de WhatsApp (QR Code)
const ESTADO_TXT = { conectado: 'Conectado', conectando: 'Aguardando leitura do QR Code', desconectado: 'Desconectado' };
const ESTADO_DOT = { conectado: 'ok', conectando: 'meio', desconectado: 'off' };

async function carregarNumeros() {
  const box = $('#lista-numeros');
  try {
    const { conexoes } = await api('/api/conexoes');
    box.innerHTML = conexoes.length ? conexoes.map((c) => {
      const titulo = c.perfil || c.nome.charAt(0).toUpperCase() + c.nome.slice(1);
      const sub = c.estado === 'conectado' && c.numero ? `${fone(c.numero)} · Conectado` : ESTADO_TXT[c.estado] || c.estado;
      const acoes = c.estado === 'conectado'
        ? `<button class="link-btn vermelho" data-desconectar="${esc(c.nome)}">Desconectar</button>`
        : `<button class="btn-verde btn-p" data-conectar="${esc(c.nome)}">Conectar</button><button class="link-btn vermelho" data-remover="${esc(c.nome)}" aria-label="Remover ${esc(titulo)}">Remover</button>`;
      return `<div class="num-linha">
        <span class="avatar avatar-p" style="background:${corAvatar(c.nome)}" aria-hidden="true">${esc(iniciais(titulo))}<span class="num-dot ${ESTADO_DOT[c.estado] || 'off'}"></span></span>
        <div class="num-texto"><p>${esc(titulo)}</p><p class="sec pequeno">${esc(sub)}</p></div>
        <div class="num-acoes">${acoes}</div>
      </div>`;
    }).join('') : '<div class="linha"><p class="sec pequeno">Nenhum número conectado ainda.</p></div>';
  } catch (err) {
    box.innerHTML = `<div class="linha"><p class="sec pequeno">${esc(err.message)}</p></div>`;
    return;
  }
  box.querySelectorAll('[data-conectar]').forEach((b) => b.addEventListener('click', () => abrirQr(b.dataset.conectar)));
  box.querySelectorAll('[data-desconectar]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('Desconectar este número? As mensagens dele param de chegar até conectar de novo.')) return;
    await api(`/api/conexoes/${b.dataset.desconectar}/desconectar`, { method: 'POST' }).catch((e) => toast(e.message));
    carregarNumeros();
  }));
  box.querySelectorAll('[data-remover]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('Remover este número do painel? A caixa de entrada e as conversas continuam no Chatwoot.')) return;
    await api(`/api/conexoes/${b.dataset.remover}`, { method: 'DELETE' }).catch((e) => toast(e.message));
    carregarNumeros();
  }));
}

const qr = { nome: null, timerQr: null, timerEstado: null };
const dialogo = $('#qr-dialog');
function passoQr(qual) {
  for (const p of ['nome', 'qr', 'ok']) $(`#qr-passo-${p}`).hidden = p !== qual;
}
function pararQr() {
  clearInterval(qr.timerQr);
  clearInterval(qr.timerEstado);
  qr.timerQr = qr.timerEstado = null;
}
async function atualizarQr() {
  try {
    const r = await api(`/api/conexoes/${qr.nome}/qr`);
    if (r.estado === 'conectado') return conectou();
    if (r.qr) {
      $('#qr-img').src = r.qr;
      $('#qr-carregando').hidden = true;
    }
  } catch (err) {
    $('#qr-status').textContent = err.message;
  }
}
function conectou() {
  pararQr();
  passoQr('ok');
  carregarNumeros();
}
function abrirQr(nome) {
  pararQr();
  qr.nome = nome;
  $('#qr-titulo').textContent = 'Conectar número';
  $('#qr-img').removeAttribute('src');
  $('#qr-carregando').hidden = false;
  $('#qr-codigo').textContent = '';
  $('#qr-status').textContent = 'O código se renova sozinho a cada 30 segundos.';
  passoQr('qr');
  if (!dialogo.open) dialogo.showModal();
  atualizarQr();
  qr.timerQr = setInterval(atualizarQr, 30000);
  qr.timerEstado = setInterval(async () => {
    try {
      const { estado } = await api(`/api/conexoes/${qr.nome}/estado`);
      if (estado === 'conectado') conectou();
    } catch { /* tenta de novo */ }
  }, 3000);
}
$('#btn-novo-numero').addEventListener('click', () => {
  pararQr();
  $('#qr-titulo').textContent = 'Novo número';
  $('#qr-nome').value = '';
  $('#qr-erro-nome').textContent = '';
  passoQr('nome');
  dialogo.showModal();
  $('#qr-nome').focus();
});
$('#qr-passo-nome').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = e.target.querySelector('button');
  btn.disabled = true;
  $('#qr-erro-nome').textContent = '';
  try {
    const { nome } = await api('/api/conexoes', { method: 'POST', body: { nome: $('#qr-nome').value } });
    carregarNumeros();
    abrirQr(nome);
  } catch (err) {
    $('#qr-erro-nome').textContent = err.message;
  } finally {
    btn.disabled = false;
  }
});
$('#qr-gerar-codigo').addEventListener('click', async () => {
  const numero = $('#qr-numero').value.replace(/\D/g, '');
  if (numero.length < 10) return toast('Digite o número com DDD');
  const completo = numero.startsWith('55') ? numero : `55${numero}`;
  try {
    const r = await api(`/api/conexoes/${qr.nome}/qr?numero=${completo}`);
    $('#qr-codigo').textContent = r.codigo || 'Não foi possível gerar o código. Use o QR Code.';
  } catch (err) {
    toast(err.message);
  }
});
$('#qr-fechar').addEventListener('click', () => dialogo.close());
$('#qr-ok').addEventListener('click', () => dialogo.close());
dialogo.addEventListener('close', () => {
  pararQr();
  if (state.me?.usuario.admin && state.tela === 'ajustes') carregarNumeros();
});

// Contatos ignorados
async function carregarIgnorados() {
  const box = $('#lista-ignorados');
  try {
    const { ignorados } = await api('/api/ignorados');
    box.innerHTML = ignorados.length ? ignorados.map((x) => `<div class="num-linha">
        <span class="avatar avatar-p" style="background:${corAvatar(x.nome)}" aria-hidden="true">${esc(iniciais(x.nome))}</span>
        <div class="num-texto"><p>${esc(x.nome || 'Contato')}</p><p class="sec pequeno">${esc(fone(x.telefone))}${x.por ? ` · por ${esc(x.por)}` : ''}</p></div>
        <div class="num-acoes"><button class="link-btn" data-voltar="${esc(x.contactId)}">Analisar de novo</button></div>
      </div>`).join('')
      : '<div class="linha"><p class="sec pequeno">Nenhum contato ignorado. Use “Ignorar este contato” nas ações de uma conversa.</p></div>';
  } catch (err) {
    box.innerHTML = `<div class="linha"><p class="sec pequeno">${esc(err.message)}</p></div>`;
    return;
  }
  box.querySelectorAll('[data-voltar]').forEach((b) => b.addEventListener('click', async () => {
    await api(`/api/ignorados/${b.dataset.voltar}`, { method: 'DELETE' }).catch((e) => toast(e.message));
    toast('Contato volta a ser analisado');
    carregarIgnorados();
  }));
}

// Aparência
const midiaEscura = window.matchMedia('(prefers-color-scheme: dark)');
function lerTema() {
  try { return localStorage.getItem('tema') || 'claro'; } catch { return 'claro'; }
}
function aplicarTema() {
  const t = lerTema();
  const escuro = t === 'escuro' || (t === 'auto' && midiaEscura.matches);
  document.documentElement.classList.toggle('escuro', escuro);
  $('#cor-tema').setAttribute('content', escuro ? '#0B141A' : '#FFFFFF');
  $$('#tema-opcoes button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.tema === t)));
}
$$('#tema-opcoes button').forEach((b) => b.addEventListener('click', () => {
  try { localStorage.setItem('tema', b.dataset.tema); } catch { /* vale só nesta visita */ }
  aplicarTema();
}));
midiaEscura.addEventListener('change', aplicarTema);
aplicarTema();

// Notificações
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
    st.textContent = ehIOS && !instalado ? 'Primeiro adicione o app à Tela de Início e abra por lá.' : 'Este navegador não suporta notificações.';
    btn.hidden = true;
    teste.hidden = true;
    return;
  }
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  const ativo = sub && Notification.permission === 'granted';
  st.textContent = ativo ? 'Ativadas neste aparelho' : Notification.permission === 'denied' ? 'Bloqueadas. Libere nos ajustes do aparelho.' : 'Desativadas neste aparelho';
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

// =====================================================================
// INÍCIO
// =====================================================================
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
  if (p.get('data')) {
    state.dia = p.get('data');
    state.hora = p.get('hora');
    state.sub = 'verificacoes';
  }
  const aba = p.get('aba');
  const inicial = EMBUTIDO || aba === 'pendencias' || aba === 'verificacoes' || aba === 'agora' ? 'pendencias' : aba === 'ajustes' ? 'ajustes' : 'conversas';
  irPara(inicial);
  if (inicial !== 'pendencias') carregarPendencias();
  const conversa = Number(p.get('conversa'));
  if (conversa && !EMBUTIDO) {
    await carregarConversas().catch(() => {});
    abrirChat(conversa);
  }
  history.replaceState(null, '', EMBUTIDO ? '/?embed=1' : '/');
}

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});

// Atualizações automáticas (só com o app visível)
const visivel = () => !document.hidden && state.me;
setInterval(() => { if (visivel() && state.chat) atualizarChat(); }, 8000);
setInterval(() => { if (visivel() && state.tela === 'conversas') carregarConversas(); }, 15000);
setInterval(() => { if (visivel()) carregarPendencias(); }, 60000);
document.addEventListener('visibilitychange', () => {
  if (!visivel()) return;
  if (state.chat) atualizarChat();
  if (state.tela === 'conversas') carregarConversas();
  carregarPendencias();
});

fetch('/health').then((r) => r.json()).then((h) => { $('#demo-hint').hidden = !h.demo; }).catch(() => {});
iniciar().then(() => { if (!state.me) mostrarLogin(); });
