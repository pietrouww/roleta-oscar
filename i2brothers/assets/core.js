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
    whatsapp: '',                   // ex.: 5541999999999
    loja: 'i2Brothers — Assistência Apple',
    atualizadoEm: '',               // ISO date (YYYY-MM-DD)
    garantiaNovo: '1 ano de garantia Apple',
    garantiaSeminovo: '3 meses de garantia da loja',
    senha: 'i2brothers',
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

  /* ---------- Mapa de imagens oficiais Apple ----------------------------
     Slugs verificados no CDN da Apple. Chave: "familia|cor".
     Fallback: imagem padrão da família -> render SVG gerado.        */
  const CDN = 'https://store.storeimages.cdn-apple.com/8756/as-images.apple.com/is/';
  const LOCAL = 'assets/iphones/';
  // Imagem local (recortada a partir do material oficial da Apple); o CDN fica como reserva.
  const IMG = (slug) => `${LOCAL}${slug}.webp`;
  const IMG_CDN = (slug, w) => `${CDN}${slug}?wid=${w || 700}&hei=${w || 700}&fmt=png-alpha`;

  // familia -> { padrao: slug, cores: { cor: slug } }
  const MODELOS_IMG = {
    'iphone 18 pro max': {
      padrao: 'iphone-18-pro-finish-select-black-202609',
      cores: {
        black: 'iphone-18-pro-finish-select-black-202609',
        burgundy: 'iphone-18-pro-finish-select-burgundy-202609',
        glacier: 'iphone-18-pro-finish-select-glacier-202609',
        silver: 'iphone-18-pro-finish-select-silver-202609'
      }
    },
    'iphone 18 pro': {
      padrao: 'iphone-18-pro-finish-select-black-202609',
      cores: {
        black: 'iphone-18-pro-finish-select-black-202609',
        burgundy: 'iphone-18-pro-finish-select-burgundy-202609',
        glacier: 'iphone-18-pro-finish-select-glacier-202609',
        silver: 'iphone-18-pro-finish-select-silver-202609'
      }
    },
    'iphone 17e': {
      padrao: 'iphone-17e-finish-select-black-202603',
      cores: {
        black: 'iphone-17e-finish-select-black-202603',
        softpink: 'iphone-17e-finish-select-softpink-202603',
        white: 'iphone-17e-finish-select-white-202603'
      }
    },
    'iphone 17 pro max': {
      padrao: 'iphone-17-pro-finish-select-deepblue-202509',
      cores: {
        deepblue: 'iphone-17-pro-finish-select-deepblue-202509',
        cosmicorange: 'iphone-17-pro-finish-select-cosmicorange-202509',
        silver: 'iphone-17-pro-finish-select-silver-202509'
      }
    },
    'iphone 17 pro': {
      padrao: 'iphone-17-pro-finish-select-deepblue-202509',
      cores: {
        deepblue: 'iphone-17-pro-finish-select-deepblue-202509',
        cosmicorange: 'iphone-17-pro-finish-select-cosmicorange-202509',
        silver: 'iphone-17-pro-finish-select-silver-202509'
      }
    },
    'iphone air': {
      padrao: 'iphone-air-finish-select-skyblue-202509',
      cores: {
        skyblue: 'iphone-air-finish-select-skyblue-202509',
        cloudwhite: 'iphone-air-finish-select-cloudwhite-202509',
        lightgold: 'iphone-air-finish-select-lightgold-202509',
        spaceblack: 'iphone-air-finish-select-spaceblack-202509'
      }
    },
    'iphone 17': {
      padrao: 'iphone-17-finish-select-lavender-202509',
      cores: {
        lavender: 'iphone-17-finish-select-lavender-202509',
        sage: 'iphone-17-finish-select-sage-202509',
        mistblue: 'iphone-17-finish-select-mistblue-202509',
        black: 'iphone-17-finish-select-black-202509',
        white: 'iphone-17-finish-select-white-202509'
      }
    },
    'iphone 16 pro max': {
      padrao: 'iphone-16-pro-finish-select-202409-6-9inch-naturaltitanium',
      cores: {
        naturaltitanium: 'iphone-16-pro-finish-select-202409-6-9inch-naturaltitanium',
        blacktitanium: 'iphone-16-pro-finish-select-202409-6-9inch-blacktitanium',
        whitetitanium: 'iphone-16-pro-finish-select-202409-6-9inch-whitetitanium',
        deserttitanium: 'iphone-16-pro-finish-select-202409-6-9inch-deserttitanium'
      }
    },
    'iphone 16 pro': {
      padrao: 'iphone-16-pro-finish-select-202409-6-3inch-naturaltitanium',
      cores: {
        naturaltitanium: 'iphone-16-pro-finish-select-202409-6-3inch-naturaltitanium',
        blacktitanium: 'iphone-16-pro-finish-select-202409-6-3inch-blacktitanium',
        whitetitanium: 'iphone-16-pro-finish-select-202409-6-3inch-whitetitanium',
        deserttitanium: 'iphone-16-pro-finish-select-202409-6-3inch-deserttitanium'
      }
    },
    'iphone 16 plus': {
      padrao: 'iphone-16-finish-select-202409-6-7inch-ultramarine',
      cores: {
        ultramarine: 'iphone-16-finish-select-202409-6-7inch-ultramarine',
        teal: 'iphone-16-finish-select-202409-6-7inch-teal',
        pink: 'iphone-16-finish-select-202409-6-7inch-pink',
        white: 'iphone-16-finish-select-202409-6-7inch-white',
        black: 'iphone-16-finish-select-202409-6-7inch-black'
      }
    },
    'iphone 16': {
      padrao: 'iphone-16-finish-select-202409-6-1inch-ultramarine',
      cores: {
        ultramarine: 'iphone-16-finish-select-202409-6-1inch-ultramarine',
        teal: 'iphone-16-finish-select-202409-6-1inch-teal',
        pink: 'iphone-16-finish-select-202409-6-1inch-pink',
        white: 'iphone-16-finish-select-202409-6-1inch-white',
        black: 'iphone-16-finish-select-202409-6-1inch-black'
      }
    },
    'iphone 15 pro max': {
      padrao: 'iphone-15-pro-finish-select-202309-6-7inch-naturaltitanium',
      cores: {
        naturaltitanium: 'iphone-15-pro-finish-select-202309-6-7inch-naturaltitanium',
        blacktitanium: 'iphone-15-pro-finish-select-202309-6-7inch-blacktitanium',
        whitetitanium: 'iphone-15-pro-finish-select-202309-6-7inch-whitetitanium',
        bluetitanium: 'iphone-15-pro-finish-select-202309-6-7inch-bluetitanium'
      }
    },
    'iphone 15 pro': {
      padrao: 'iphone-15-pro-finish-select-202309-6-1inch-naturaltitanium',
      cores: {
        naturaltitanium: 'iphone-15-pro-finish-select-202309-6-1inch-naturaltitanium',
        blacktitanium: 'iphone-15-pro-finish-select-202309-6-1inch-blacktitanium',
        whitetitanium: 'iphone-15-pro-finish-select-202309-6-1inch-whitetitanium',
        bluetitanium: 'iphone-15-pro-finish-select-202309-6-1inch-bluetitanium'
      }
    },
    'iphone 15 plus': {
      padrao: 'iphone-15-finish-select-202309-6-7inch-blue',
      cores: {
        blue: 'iphone-15-finish-select-202309-6-7inch-blue',
        pink: 'iphone-15-finish-select-202309-6-7inch-pink',
        yellow: 'iphone-15-finish-select-202309-6-7inch-yellow',
        green: 'iphone-15-finish-select-202309-6-7inch-green',
        black: 'iphone-15-finish-select-202309-6-7inch-black'
      }
    },
    'iphone 15': {
      padrao: 'iphone-15-finish-select-202309-6-1inch-blue',
      cores: {
        blue: 'iphone-15-finish-select-202309-6-1inch-blue',
        pink: 'iphone-15-finish-select-202309-6-1inch-pink',
        yellow: 'iphone-15-finish-select-202309-6-1inch-yellow',
        green: 'iphone-15-finish-select-202309-6-1inch-green',
        black: 'iphone-15-finish-select-202309-6-1inch-black'
      }
    },
    'iphone 14 pro max': {
      padrao: 'iphone-14-pro-finish-select-202209-6-7inch-deeppurple',
      cores: {
        deeppurple: 'iphone-14-pro-finish-select-202209-6-7inch-deeppurple',
        gold: 'iphone-14-pro-finish-select-202209-6-7inch-gold',
        silver: 'iphone-14-pro-finish-select-202209-6-7inch-silver',
        spaceblack: 'iphone-14-pro-finish-select-202209-6-7inch-spaceblack'
      }
    },
    'iphone 14 pro': {
      padrao: 'iphone-14-pro-finish-select-202209-6-1inch-deeppurple',
      cores: {
        deeppurple: 'iphone-14-pro-finish-select-202209-6-1inch-deeppurple',
        gold: 'iphone-14-pro-finish-select-202209-6-1inch-gold',
        silver: 'iphone-14-pro-finish-select-202209-6-1inch-silver',
        spaceblack: 'iphone-14-pro-finish-select-202209-6-1inch-spaceblack'
      }
    },
    'iphone 14 plus': {
      padrao: 'iphone-14-finish-select-202209-6-7inch-blue',
      cores: {
        blue: 'iphone-14-finish-select-202209-6-7inch-blue',
        purple: 'iphone-14-finish-select-202209-6-7inch-purple',
        midnight: 'iphone-14-finish-select-202209-6-7inch-midnight',
        starlight: 'iphone-14-finish-select-202209-6-7inch-starlight',
        yellow: 'iphone-14-finish-select-202209-6-7inch-yellow'
      }
    },
    'iphone 14': {
      padrao: 'iphone-14-finish-select-202209-6-1inch-blue',
      cores: {
        blue: 'iphone-14-finish-select-202209-6-1inch-blue',
        purple: 'iphone-14-finish-select-202209-6-1inch-purple',
        midnight: 'iphone-14-finish-select-202209-6-1inch-midnight',
        starlight: 'iphone-14-finish-select-202209-6-1inch-starlight',
        yellow: 'iphone-14-finish-select-202209-6-1inch-yellow'
      }
    },
    'iphone 13 pro max': {
      padrao: 'iphone-13-pro-finish-select-202207-6-7inch-sierrablue',
      cores: {
        sierrablue: 'iphone-13-pro-finish-select-202207-6-7inch-sierrablue',
        graphite: 'iphone-13-pro-finish-select-202207-6-7inch-graphite',
        gold: 'iphone-13-pro-finish-select-202207-6-7inch-gold',
        silver: 'iphone-13-pro-finish-select-202207-6-7inch-silver',
        alpinegreen: 'iphone-13-pro-finish-select-202207-6-7inch-alpinegreen'
      }
    },
    'iphone 13 pro': {
      padrao: 'iphone-13-pro-finish-select-202207-6-1inch-sierrablue',
      cores: {
        sierrablue: 'iphone-13-pro-finish-select-202207-6-1inch-sierrablue',
        graphite: 'iphone-13-pro-finish-select-202207-6-1inch-graphite',
        gold: 'iphone-13-pro-finish-select-202207-6-1inch-gold',
        silver: 'iphone-13-pro-finish-select-202207-6-1inch-silver',
        alpinegreen: 'iphone-13-pro-finish-select-202207-6-1inch-alpinegreen'
      }
    },
    'iphone 13 mini': {
      padrao: 'iphone-13-finish-select-202207-5-4inch-blue',
      cores: {
        blue: 'iphone-13-finish-select-202207-5-4inch-blue',
        midnight: 'iphone-13-finish-select-202207-5-4inch-midnight',
        starlight: 'iphone-13-finish-select-202207-5-4inch-starlight',
        pink: 'iphone-13-finish-select-202207-5-4inch-pink',
        green: 'iphone-13-finish-select-202207-5-4inch-green'
      }
    },
    'iphone 13': {
      padrao: 'iphone-13-finish-select-202207-6-1inch-blue',
      cores: {
        blue: 'iphone-13-finish-select-202207-6-1inch-blue',
        midnight: 'iphone-13-finish-select-202207-6-1inch-midnight',
        starlight: 'iphone-13-finish-select-202207-6-1inch-starlight',
        pink: 'iphone-13-finish-select-202207-6-1inch-pink',
        green: 'iphone-13-finish-select-202207-6-1inch-green'
      }
    },
    'iphone 12 mini': {
      padrao: 'iphone-12-finish-select-202207-5-4inch-blue',
      cores: {
        blue: 'iphone-12-finish-select-202207-5-4inch-blue',
        black: 'iphone-12-finish-select-202207-5-4inch-black',
        white: 'iphone-12-finish-select-202207-5-4inch-white',
        green: 'iphone-12-finish-select-202207-5-4inch-green',
        purple: 'iphone-12-finish-select-202207-5-4inch-purple'
      }
    },
    'iphone 12': {
      padrao: 'iphone-12-finish-select-202207-6-1inch-blue',
      cores: {
        blue: 'iphone-12-finish-select-202207-6-1inch-blue',
        black: 'iphone-12-finish-select-202207-6-1inch-black',
        white: 'iphone-12-finish-select-202207-6-1inch-white',
        green: 'iphone-12-finish-select-202207-6-1inch-green',
        purple: 'iphone-12-finish-select-202207-6-1inch-purple'
      }
    },
    // --- Modelos fora de linha: imagem única por família (material oficial da Apple) ---
    'iphone 16e':          { padrao: 'fam-iphone-16e', cores: {} },
    'iphone 12 pro max':   { padrao: 'fam-iphone-12-pro-max', cores: {} },
    'iphone 12 pro':       { padrao: 'fam-iphone-12-pro', cores: {} },
    'iphone 11 pro max':   { padrao: 'fam-iphone-11-pro-max', cores: {} },
    'iphone 11 pro':       { padrao: 'fam-iphone-11-pro', cores: {} },
    'iphone 11':           { padrao: 'fam-iphone-11', cores: {} },
    'iphone xs max':       { padrao: 'fam-iphone-xs-max', cores: {} },
    'iphone xs':           { padrao: 'fam-iphone-xs', cores: {} },
    'iphone xr':           { padrao: 'fam-iphone-xr', cores: {} },
    'iphone x':            { padrao: 'fam-iphone-x', cores: {} },
    'iphone se 2':         { padrao: 'fam-iphone-se-2', cores: {} },
    'iphone se 3':         { padrao: 'fam-iphone-se-3', cores: {} },
    'iphone 8 plus':       { padrao: 'fam-iphone-8-plus', cores: {} },
    'iphone 8':            { padrao: 'fam-iphone-8', cores: {} },
    'iphone 7 plus':       { padrao: 'fam-iphone-7-plus', cores: {} },
    'iphone 7':            { padrao: 'fam-iphone-7', cores: {} },
    'iphone se': {
      padrao: 'iphone-se-finish-select-202207-midnight',
      cores: {
        midnight: 'iphone-se-finish-select-202207-midnight',
        starlight: 'iphone-se-finish-select-202207-starlight'
      }
    }
  };

  // Ordem de busca: do nome mais específico para o mais genérico
  const FAMILIAS = Object.keys(MODELOS_IMG).sort((a, b) => b.length - a.length);

  /* ---------- Normalização ---------------------------------------------- */
  const semAcento = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
  const norm = (s) => semAcento(String(s || '')).toLowerCase().replace(/\s+/g, ' ').trim();

  function familiaDe(modelo) {
    const m = norm(modelo).replace(/\bmax\b/g, 'max').replace(/\bplus\b/g, 'plus');
    for (const f of FAMILIAS) {
      if (m.includes(norm(f))) return f;
    }
    // "iphone 11 pro max" etc. não têm imagem mapeada — devolve null
    return null;
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

  /* ---------- Resolução de imagem --------------------------------------- */
  function imagensDe(ap, largura) {
    const svg = svgAparelho(ap.cor, true);
    if (ap.imagem) return { principal: ap.imagem, alternativa: null, fallback: svg };

    const fam = familiaDe(ap.modelo);
    const entrada = fam ? MODELOS_IMG[fam] : null;
    if (!entrada) return { principal: svg, alternativa: null, fallback: svg };

    const slugCor = corSlug(ap.cor);
    const slug = (slugCor && entrada.cores[slugCor]) ? entrada.cores[slugCor] : entrada.padrao;
    return {
      principal: IMG(slug),                                          // arquivo local
      alternativa: slug.startsWith('fam-') ? null : IMG_CDN(slug, largura), // reserva: CDN da Apple
      fallback: svg                               // reserva final: desenho gerado
    };
  }

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
    const fam = familiaDe(limpo);
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
      const r = await fetch((url || 'catalogo.json') + '?v=' + Date.now(), { cache: 'no-store' });
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
    STORAGE_KEY, AUTH_KEY, TAXAS_PADRAO, CONFIG_PADRAO, MODELOS_IMG, CORES,
    catalogoVazio, mescla, salvarLocal, lerLocal, lerPublicado, baixarJSON,
    imagensDe, svgAparelho, corHex, corSlug, familiaDe,
    money, pct, dataBR, hojeISO, uid, nomeCompleto, norm,
    precoAVista, simular, melhorParcela, aplicaTaxa,
    parseLista, parseLinha, parseValor
  };
})();

if (typeof module !== 'undefined') module.exports = I2;
