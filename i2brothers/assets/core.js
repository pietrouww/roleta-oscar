/* =========================================================================
   i2Brothers — Núcleo compartilhado (catálogo público + área administrativa)
   ========================================================================= */

const I2 = (() => {
  'use strict';

  const STORAGE_KEY = 'i2b:catalogo:v1';
  const AUTH_KEY = 'i2b:auth:v1';

  /* ---------- Taxas padrão (Mastercard / Visa) — tabela da maquineta ------ */
  const TAXAS_PADRAO = {
    debito: 0.85,
    credito: {
      1: 2.89, 2: 4.22, 3: 4.83, 4: 5.44, 5: 6.05, 6: 6.64,
      7: 7.24, 8: 7.82, 9: 8.41, 10: 8.98, 11: 9.56, 12: 10.12
    }
  };

  const CONFIG_PADRAO = {
    acrescimo: 500,
    modoJuros: 'repasse',           // 'repasse' (valor / (1 - taxa)) | 'acrescimo' (valor * (1 + taxa))
    maxParcelas: 12,
    whatsapp: '5541992277477',      // número que recebe as consultas de disponibilidade
    telefone: '4131522212',         // telefone fixo da loja
    email: 'i2brothers@icloud.com',
    endereco: 'Rua Lothário Boutin, 49 — Loja 5',
    cidade: 'Pinheirinho, Curitiba — PR',
    loja: 'i2Brothers — Assistência Apple',
    atualizadoEm: '',               // ISO date (YYYY-MM-DD)
    garantiaNovo: '1 ano de garantia Apple',
    garantiaSeminovo: '3 meses de garantia da loja',
    // Resumo (SHA-256) da senha da página de configuração. A senha em si nunca
    // é gravada: o catalogo.json fica público na hospedagem, e o que está aqui
    // qualquer um consegue ler.
    senhaHash: '3676ea21edae3af175f03087b8aea883624bd1b3dbfeb655a5a0c1b7637b784c',
    estiloImagem: 'ilustracao',     // 'ilustracao' (padrão, uniforme) | 'foto' (material da Apple)
    taxas: JSON.parse(JSON.stringify(TAXAS_PADRAO))
  };

  /* ---------- Catálogo vazio ------------------------------------------- */
  const catalogoVazio = () => ({
    config: JSON.parse(JSON.stringify(CONFIG_PADRAO)),
    aparelhos: []
  });

  /* ---------- Cores conhecidas (PT-BR -> slug Apple) -------------------- */
  const CORES = [
    // Titânio
    ['titanio natural', 'naturaltitanium', '#b6b1a9'],
    ['titânio natural', 'naturaltitanium', '#b6b1a9'],
    ['natural', 'naturaltitanium', '#b6b1a9'],
    ['titanio deserto', 'deserttitanium', '#bfa48f'],
    ['titânio deserto', 'deserttitanium', '#bfa48f'],
    ['deserto', 'deserttitanium', '#bfa48f'],
    ['titanio preto', 'blacktitanium', '#3b3b3d'],
    ['titânio preto', 'blacktitanium', '#3b3b3d'],
    ['titanio branco', 'whitetitanium', '#e7e5e2'],
    ['titânio branco', 'whitetitanium', '#e7e5e2'],
    ['titanio azul', 'bluetitanium', '#3d4a56'],
    ['titânio azul', 'bluetitanium', '#3d4a56'],
    // Linha 17 / Air
    ['laranja cosmico', 'cosmicorange', '#e2683a'],
    ['laranja cósmico', 'cosmicorange', '#e2683a'],
    ['laranja', 'cosmicorange', '#e2683a'],
    ['azul profundo', 'deepblue', '#3c4a63'],
    ['lavanda', 'lavender', '#d9cfe8'],
    ['sálvia', 'sage', '#c9d3c2'],
    ['salvia', 'sage', '#c9d3c2'],
    ['azul nevoa', 'mistblue', '#c3d3e2'],
    ['azul névoa', 'mistblue', '#c3d3e2'],
    ['azul celeste', 'skyblue', '#c9d8e6'],
    ['branco nuvem', 'cloudwhite', '#f0efeb'],
    ['dourado claro', 'lightgold', '#e6d4b4'],
    ['preto espacial', 'spaceblack', '#38383a'],
    // Clássicas
    ['ultramarino', 'ultramarine', '#a3b4e8'],
    ['verde-azulado', 'teal', '#b5d2ce'],
    ['rosa', 'pink', '#f0d5da'],
    ['branco', 'white', '#f5f5f7'],
    ['preto', 'black', '#2f3033'],
    ['azul', 'blue', '#adc2d9'],
    ['verde', 'green', '#b8cfc4'],
    ['amarelo', 'yellow', '#ecdfae'],
    ['roxo', 'purple', '#d8cde4'],
    ['roxo profundo', 'deeppurple', '#5b4d63'],
    ['meia-noite', 'midnight', '#2c2f36'],
    ['estelar', 'starlight', '#efe8dd'],
    ['prata', 'silver', '#e4e4e6'],
    ['prateado', 'silver', '#e4e4e6'],
    ['dourado', 'gold', '#e6d3b3'],
    ['grafite', 'graphite', '#575452'],
    ['vermelho', 'red', '#ba3a35'],
    ['product red', 'red', '#ba3a35'],
    ['azul sierra', 'sierrablue', '#a7c1d9'],
    ['verde alpino', 'alpinegreen', '#54645a'],
    ['bordo', 'burgundy', '#6f2c3e'],
    ['bordô', 'burgundy', '#6f2c3e'],
    ['vinho', 'burgundy', '#6f2c3e'],
    ['glacial', 'glacier', '#dfe4e8'],
    ['branco glacial', 'glacier', '#dfe4e8'],
    ['rosa suave', 'softpink', '#f3dbe2'],
    ['rosa claro', 'softpink', '#f3dbe2'],
    ['coral', 'coral', '#f08a7e'],
    ['cinza espacial', 'spacegray', '#4a4a4c'],
    ['ouro rosa', 'rosegold', '#e8c0b4'],
    ['verde meia-noite', 'midnightgreen', '#4e5851'],
    ['azul pacifico', 'pacificblue', '#2d4d5c'],
    ['azul pacífico', 'pacificblue', '#2d4d5c']
  ];

  /* ---------- Fotos dos aparelhos ---------------------------------------
     O índice vem de assets/fotos.js (gerado por ferramentas/fotos.py):
       familia -> { padrao: cor, cores: { cor: { base, lados } } }
     Cada aparelho tem duas fotos, "<base>-verso.webp" e "<base>-frente.webp",
     na mesma tela e no mesmo tamanho. Modelos em que a Apple só publica uma
     vista aproveitável ficam com uma foto só.                              */
  /* Raiz do site, deduzida de onde este arquivo foi carregado. É o que permite
     que a página de configuração fique numa subpasta e mesmo assim encontre os
     arquivos (assets/ e catalogo.json) na raiz da publicação.                */
  const BASE = (() => {
    try {
      const src = (typeof document !== 'undefined' && document.currentScript && document.currentScript.src) || '';
      return src ? src.replace(/[^/]*$/, '').replace(/assets\/$/, '') : '';
    } catch (e) { return ''; }
  })();
  const LOCAL = BASE + 'assets/iphones/';
  const FOTOS = (typeof I2_FOTOS !== 'undefined') ? I2_FOTOS
              : (typeof globalThis !== 'undefined' && globalThis.I2_FOTOS) ? globalThis.I2_FOTOS : {};

  // Como o cliente escreve o modelo -> família do índice.
  const APELIDOS = {
    'iphone se': 'iphone se 3',
    'iphone se 2a geracao': 'iphone se 2',
    'iphone se 2 geracao': 'iphone se 2',
    'iphone se 3a geracao': 'iphone se 3',
    'iphone se 3 geracao': 'iphone se 3'
  };

  // Ordem de busca: do nome mais específico para o mais genérico.
  const FAMILIAS = Object.keys(FOTOS).concat(Object.keys(APELIDOS))
    .sort((a, b) => b.length - a.length);

  /* ---------- Normalização ---------------------------------------------- */
  const semAcento = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
  const norm = (s) => semAcento(String(s || '')).toLowerCase().replace(/\s+/g, ' ').trim();

  /** Trecho do texto que nomeia a família, como foi escrito na lista. */
  function trechoFamilia(modelo) {
    const m = norm(modelo);
    for (const f of FAMILIAS) {
      if (m.includes(norm(f))) return f;
    }
    return null;
  }

  /** Família no índice de fotos (já resolvendo apelidos). */
  function familiaDe(modelo) {
    const f = trechoFamilia(modelo);
    return f ? (APELIDOS[f] || f) : null;          // null: modelo sem foto
  }

  function corSlug(cor) {
    const c = norm(cor);
    if (!c) return null;
    let melhor = null;
    for (const [nome, slug] of CORES) {
      const n = norm(nome);
      if (c === n) return slug;
      if (c.includes(n) && (!melhor || n.length > melhor[1])) melhor = [slug, n.length];
    }
    return melhor ? melhor[0] : null;
  }

  function corHex(cor) {
    const c = norm(cor);
    let melhor = null;
    for (const [nome, , hex] of CORES) {
      const n = norm(nome);
      if (c === n) return hex;
      if (c.includes(n) && (!melhor || n.length > melhor[1])) melhor = [hex, n.length];
    }
    return melhor ? melhor[0] : '#c9c9ce';
  }

  /* ---------- Render SVG de fallback ------------------------------------ */
  function svgAparelho(cor, temNotch) {
    const hex = corHex(cor);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 460">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${hex}"/>
      <stop offset="55%" stop-color="${hex}" stop-opacity="0.82"/>
      <stop offset="100%" stop-color="#000" stop-opacity="0.22"/>
    </linearGradient>
  </defs>
  <rect x="64" y="24" width="192" height="412" rx="34" fill="url(#g)" stroke="rgba(0,0,0,.18)" stroke-width="2"/>
  <rect x="73" y="33" width="174" height="394" rx="27" fill="#0b0b0d"/>
  ${temNotch
      ? '<rect x="136" y="44" width="48" height="13" rx="6.5" fill="#1d1d1f"/>'
      : '<rect x="120" y="33" width="80" height="20" rx="0 0 12 12" fill="#0b0b0d"/>'}
  <rect x="86" y="70" width="148" height="330" rx="16" fill="rgba(255,255,255,.05)"/>
</svg>`;
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  }

  /* ---------- Resolução das fotos --------------------------------------- */
  function entradaDe(ap) {
    const fam = familiaDe(ap.modelo);
    const familia = fam ? FOTOS[fam] : null;
    if (!familia) return null;
    const cor = corSlug(ap.cor);
    return familia.cores[cor] || familia.cores[familia.padrao] || null;
  }

  const DESENHO = (typeof I2_DESENHO !== 'undefined') ? I2_DESENHO
                : (typeof globalThis !== 'undefined' && globalThis.I2_DESENHO) ? globalThis.I2_DESENHO : null;

  /** Desenho padronizado do aparelho — mesma pose, mesma tela, tamanho real. */
  function desenhosDe(ap) {
    const fam = familiaDe(ap.modelo);
    if (!DESENHO || !fam || !DESENHO.ESPECS[fam]) return null;
    const cor = corHex(ap.cor);
    return ['verso', 'frente'].map(lado => ({ lado, src: DESENHO.svg(fam, cor, lado) }));
  }

  /** Fotos do material oficial da Apple, quando houver para o modelo e a cor. */
  function fotosApple(ap) {
    const entrada = entradaDe(ap);
    if (!entrada) return null;
    return ['verso', 'frente']
      .filter(lado => entrada.lados.indexOf(lado) >= 0)
      .map(lado => ({ lado, src: LOCAL + entrada.base + '-' + lado + '.webp' }));
  }

  /**
   * Imagens do aparelho, na ordem em que o catálogo mostra: traseira e tela.
   * Por padrão são os desenhos padronizados — todos na mesma pose e no mesmo
   * enquadramento. Com estiloImagem 'foto', usa o material da Apple onde existir.
   */
  function fotosDe(ap, config) {
    if (ap.imagem) return [{ lado: 'foto', src: ap.imagem }];
    const estilo = (config && config.estiloImagem) || CONFIG_PADRAO.estiloImagem;
    const lista = estilo === 'foto'
      ? (fotosApple(ap) || desenhosDe(ap))
      : (desenhosDe(ap) || fotosApple(ap));
    return lista || [{ lado: 'ilustracao', src: svgAparelho(ap.cor, true) }];
  }

  /** Imagem principal — a que aparece no card e nas listagens. */
  function fotoPrincipal(ap, config) {
    return fotosDe(ap, config)[0].src;
  }

  const ROTULO_LADO = { verso: 'Traseira', frente: 'Tela', foto: 'Foto', ilustracao: 'Ilustração' };

  /* ---------- Formatação ------------------------------------------------- */
  const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
  const money = (v) => BRL.format(Number(v) || 0);
  const pct = (v) => (Number(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '%';

  function dataBR(iso) {
    if (!iso) return '';
    const [a, m, d] = String(iso).split('-');
    if (!a || !m || !d) return iso;
    return `${d}/${m}/${a}`;
  }

  /* ---------- Preço / parcelamento --------------------------------------- */
  function precoAVista(ap, config) {
    const base = Number(ap.custo) || 0;
    const acr = ap.acrescimo === undefined || ap.acrescimo === null || ap.acrescimo === ''
      ? (Number(config.acrescimo) || 0)
      : (Number(ap.acrescimo) || 0);
    return base + acr;
  }

  function aplicaTaxa(valor, taxa, modo) {
    const t = (Number(taxa) || 0) / 100;
    if (modo === 'acrescimo') return valor * (1 + t);
    const d = 1 - t;
    return d > 0 ? valor / d : valor;
  }

  function simular(valor, config) {
    const cfg = config || CONFIG_PADRAO;
    const taxas = cfg.taxas || TAXAS_PADRAO;
    const modo = cfg.modoJuros || 'repasse';
    const max = Number(cfg.maxParcelas) || 12;
    const linhas = [];

    linhas.push({
      tipo: 'debito', rotulo: 'Débito', n: 1, taxa: taxas.debito,
      total: aplicaTaxa(valor, taxas.debito, modo),
      parcela: aplicaTaxa(valor, taxas.debito, modo)
    });

    for (let n = 1; n <= max; n++) {
      const taxa = taxas.credito[n];
      if (taxa === undefined) continue;
      const total = aplicaTaxa(valor, taxa, modo);
      linhas.push({
        tipo: 'credito', rotulo: n === 1 ? '1x (à vista no crédito)' : `${n}x`,
        n, taxa, total, parcela: total / n
      });
    }
    return linhas;
  }

  function melhorParcela(valor, config) {
    const linhas = simular(valor, config).filter(l => l.tipo === 'credito');
    return linhas.length ? linhas[linhas.length - 1] : null;
  }

  /* ---------- Parser de lista colada ------------------------------------ */
  const CAPACIDADES = ['64gb', '128gb', '256gb', '512gb', '1tb', '2tb'];

  function parseLinha(linha, categoria) {
    const bruto = String(linha).trim();
    if (!bruto) return null;

    // separadores aceitos: | ; TAB ou " - " no fim
    let partes = bruto.split(/\s*[|;\t]\s*/).filter(Boolean);
    let texto, valorTxt;

    if (partes.length >= 2) {
      valorTxt = partes[partes.length - 1];
      texto = partes.slice(0, -1).join(' ');
      if (!/\d/.test(valorTxt)) { texto = partes.join(' '); valorTxt = ''; }
    } else {
      const m = bruto.match(/^(.*?)[\s\-–—=:]+(r?\$?\s*[\d.,]+)\s*$/i);
      if (m) { texto = m[1]; valorTxt = m[2]; }
      else { texto = bruto; valorTxt = ''; }
    }

    const custo = parseValor(valorTxt);

    // bateria (seminovos): 87%, bat 87, bateria 87%
    let bateria = null;
    const mb = texto.match(/(?:bat(?:eria)?\s*:?\s*)?(\d{2,3})\s*%/i);
    if (mb) { bateria = Number(mb[1]); texto = texto.replace(mb[0], ' '); }

    // capacidade
    let capacidade = '';
    const mc = texto.match(/(\d+)\s*(gb|tb)\b/i);
    if (mc) { capacidade = `${mc[1]}${mc[2].toUpperCase()}`; texto = texto.replace(mc[0], ' '); }

    // modelo: até o fim da família reconhecida; resto é cor
    const limpo = texto.replace(/\s+/g, ' ').trim();
    const fam = trechoFamilia(limpo);
    let modelo = limpo, cor = '';

    if (fam) {
      const idx = norm(limpo).indexOf(norm(fam));
      modelo = limpo.substr(idx, fam.length).trim();
      cor = (limpo.substr(0, idx) + ' ' + limpo.substr(idx + fam.length)).replace(/\s+/g, ' ').trim();
    } else {
      // heurística: "iPhone <n> <variação>" + resto = cor
      const mm = limpo.match(/^(iphone\s*[\w\s]*?(?:pro\s*max|pro|plus|mini|max|se(?:\s*\d(?:ª|a)?\s*ger\w*)?|\d{1,2}e?))\b(.*)$/i);
      if (mm) { modelo = mm[1].trim(); cor = mm[2].trim(); }
    }

    cor = cor.replace(/^[\s\-–—,]+|[\s\-–—,]+$/g, '');

    return {
      id: uid(),
      categoria: categoria || 'novo',
      modelo: tituloModelo(modelo),
      capacidade,
      cor: tituloCor(cor),
      bateria,
      custo,
      acrescimo: null,
      imagem: '',
      obs: '',
      destaque: false
    };
  }

  function parseValor(txt) {
    if (!txt) return 0;
    let s = String(txt).replace(/r\$/i, '').replace(/\s/g, '');
    // 5.800,00 -> 5800.00 | 5800 -> 5800 | 5,800.00 -> 5800.00
    if (s.includes(',') && s.includes('.')) {
      s = s.lastIndexOf(',') > s.lastIndexOf('.')
        ? s.replace(/\./g, '').replace(',', '.')
        : s.replace(/,/g, '');
    } else if (s.includes(',')) {
      s = s.replace(',', '.');
    } else if ((s.match(/\./g) || []).length === 1 && /\.\d{3}$/.test(s)) {
      s = s.replace('.', '');
    }
    const n = parseFloat(s);
    return isNaN(n) ? 0 : n;
  }

  function tituloModelo(s) {
    if (!s) return '';
    return s.replace(/\s+/g, ' ').trim()
      .replace(/\biphone\b/gi, 'iPhone')
      .replace(/\bpro\b/gi, 'Pro')
      .replace(/\bmax\b/gi, 'Max')
      .replace(/\bplus\b/gi, 'Plus')
      .replace(/\bmini\b/gi, 'mini')
      .replace(/\bair\b/gi, 'Air')
      .replace(/\bse\b/gi, 'SE')
      .replace(/\b(\d{1,2})e\b/gi, '$1e')
      .replace(/\bxr\b/gi, 'XR')
      .replace(/\bxs\b/gi, 'XS')
      .replace(/\bx\b/gi, 'X');
  }

  function tituloCor(s) {
    if (!s) return '';
    return s.replace(/\s+/g, ' ').trim()
      .split(' ')
      .map(p => p.length > 2 ? p.charAt(0).toUpperCase() + p.slice(1).toLowerCase() : p.toLowerCase())
      .join(' ')
      .replace(/^./, c => c.toUpperCase());
  }

  function parseLista(texto, categoria) {
    return String(texto || '')
      .split(/\r?\n/)
      .map(l => l.trim())
      .filter(l => l && !/^[-=_*#]+$/.test(l))
      .map(l => parseLinha(l, categoria))
      .filter(Boolean);
  }

  /* ---------- Senha da configuração --------------------------------------
     O catálogo é aberto; a senha vale só para a página de configuração. Como
     o arquivo de dados fica público, guardamos apenas o resumo SHA-256 dela.  */
  function sha256Hex(texto) {
  const K = [];
  const H = [];
  let n = 2, i = 0;
  const raiz = (x, p) => {
    const r = Math.pow(x, 1 / p);
    return Math.floor((r - Math.floor(r)) * Math.pow(2, 32)) >>> 0;
  };
  const primo = (x) => { for (let d = 2; d * d <= x; d++) if (x % d === 0) return false; return true; };
  while (i < 64) {
    if (primo(n)) {
      if (i < 8) H.push(raiz(n, 2));
      K.push(raiz(n, 3));
      i++;
    }
    n++;
  }
  const bytes = [];
  for (const ch of unescape(encodeURIComponent(texto))) bytes.push(ch.charCodeAt(0));
  const bits = bytes.length * 8;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  for (let j = 7; j >= 0; j--) bytes.push((j < 4 ? Math.floor(bits / Math.pow(2, 8 * j)) : 0) & 0xff);

  const h = H.slice();
  const w = new Array(64);
  const rotr = (x, c) => ((x >>> c) | (x << (32 - c))) >>> 0;
  for (let bloco = 0; bloco < bytes.length; bloco += 64) {
    for (let t = 0; t < 16; t++) {
      w[t] = ((bytes[bloco + t * 4] << 24) | (bytes[bloco + t * 4 + 1] << 16) |
              (bytes[bloco + t * 4 + 2] << 8) | bytes[bloco + t * 4 + 3]) >>> 0;
    }
    for (let t = 16; t < 64; t++) {
      const s0 = (rotr(w[t - 15], 7) ^ rotr(w[t - 15], 18) ^ (w[t - 15] >>> 3)) >>> 0;
      const s1 = (rotr(w[t - 2], 17) ^ rotr(w[t - 2], 19) ^ (w[t - 2] >>> 10)) >>> 0;
      w[t] = (w[t - 16] + s0 + w[t - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let t = 0; t < 64; t++) {
      const S1 = (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) >>> 0;
      const ch = ((e & f) ^ (~e & g)) >>> 0;
      const t1 = (hh + S1 + ch + K[t] + w[t]) >>> 0;
      const S0 = (rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) >>> 0;
      const maj = ((a & b) ^ (a & c) ^ (b & c)) >>> 0;
      const t2 = (S0 + maj) >>> 0;
      hh = g; g = f; f = e; e = (d + t1) >>> 0;
      d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    const novos = [a, b, c, d, e, f, g, hh];
    for (let t = 0; t < 8; t++) h[t] = (h[t] + novos[t]) >>> 0;
  }
  return h.map(x => x.toString(16).padStart(8, '0')).join('');
  }

  /** Resumo da senha, para gravar na configuração. */
  const hashSenha = (texto) => sha256Hex(String(texto == null ? '' : texto));

  /** Confere a senha digitada contra a configuração. */
  function confereSenha(texto, config) {
    const c = config || {};
    if (c.senhaHash) return hashSenha(texto) === c.senhaHash;
    if (c.senha) return String(texto) === String(c.senha);   // arquivo antigo
    return hashSenha(texto) === CONFIG_PADRAO.senhaHash;
  }

  /* ---------- Utilidades -------------------------------------------------- */
  function uid() {
    return 'ap' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function nomeCompleto(ap) {
    return [ap.modelo, ap.capacidade, ap.cor].filter(Boolean).join(' ');
  }

  function hojeISO() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }

  function mescla(dados) {
    const base = catalogoVazio();
    const out = {
      config: Object.assign({}, base.config, (dados && dados.config) || {}),
      aparelhos: Array.isArray(dados && dados.aparelhos) ? dados.aparelhos : []
    };
    out.config.taxas = Object.assign({}, TAXAS_PADRAO, (dados && dados.config && dados.config.taxas) || {});
    out.config.taxas.credito = Object.assign({}, TAXAS_PADRAO.credito,
      (dados && dados.config && dados.config.taxas && dados.config.taxas.credito) || {});
    out.aparelhos = out.aparelhos.map(a => Object.assign({
      id: uid(), categoria: 'novo', modelo: '', capacidade: '', cor: '',
      bateria: null, custo: 0, acrescimo: null, imagem: '', obs: '', destaque: false
    }, a));
    return out;
  }

  /* ---------- Persistência ------------------------------------------------ */
  function salvarLocal(dados) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(dados)); return true; }
    catch (e) { console.warn('Falha ao salvar local:', e); return false; }
  }

  function lerLocal() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? mescla(JSON.parse(raw)) : null;
    } catch (e) { return null; }
  }

  async function lerPublicado(url) {
    try {
      const r = await fetch((url || BASE + 'catalogo.json') + '?v=' + Date.now(), { cache: 'no-store' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return mescla(await r.json());
    } catch (e) { return null; }
  }

  function baixarJSON(dados, nome) {
    const blob = new Blob([JSON.stringify(dados, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = nome || 'catalogo.json';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
  }

  return {
    STORAGE_KEY, AUTH_KEY, TAXAS_PADRAO, CONFIG_PADRAO, CORES,
    catalogoVazio, mescla, salvarLocal, lerLocal, lerPublicado, baixarJSON,
    BASE, hashSenha, confereSenha, fotosDe, fotoPrincipal, ROTULO_LADO, svgAparelho, corHex, corSlug, familiaDe, FOTOS,
    desenhosDe, fotosApple,
    money, pct, dataBR, hojeISO, uid, nomeCompleto, norm,
    precoAVista, simular, melhorParcela, aplicaTaxa,
    parseLista, parseLinha, parseValor
  };
})();

if (typeof module !== 'undefined') module.exports = I2;
