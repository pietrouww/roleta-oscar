/* =========================================================================
   i2Brothers — desenho padronizado dos aparelhos

   Em vez de recortar as artes da Apple (que mudam de geração para geração:
   umas retas, outras em perspectiva), cada aparelho é desenhado aqui a partir
   das medidas reais, sempre do mesmo jeito: de frente, sem inclinação, mesma
   tela, mesma luz. O tamanho na tela respeita o tamanho real do aparelho —
   um Pro Max aparece maior que um mini, na proporção certa.

   I2_DESENHO.svg(familia, corHex, lado)  ->  data URI de um SVG
   ========================================================================= */

var I2_DESENHO = (() => {
  'use strict';

  /* Medidas em milímetros (altura x largura x raio do canto), tipo de tela e
     desenho do módulo de câmera. Fonte: especificações da Apple.            */
  const ESPECS = {
    'iphone 18 pro max':  { mm: [163.4, 78.0], raio: 9.5, tela: 'ilha',   camera: 'plateau3' },
    'iphone 18 pro':      { mm: [150.0, 71.9], raio: 9.5, tela: 'ilha',   camera: 'plateau3' },
    'iphone 17 pro max':  { mm: [163.4, 78.0], raio: 9.5, tela: 'ilha',   camera: 'plateau3' },
    'iphone 17 pro':      { mm: [150.0, 71.9], raio: 9.5, tela: 'ilha',   camera: 'plateau3' },
    'iphone air':         { mm: [156.2, 74.7], raio: 9.5, tela: 'ilha',   camera: 'plateau1' },
    'iphone 17':          { mm: [149.6, 71.5], raio: 9.0, tela: 'ilha',   camera: 'pilula2' },
    'iphone 17e':         { mm: [146.7, 71.5], raio: 8.5, tela: 'entalhe', camera: 'unica' },
    'iphone 16 pro max':  { mm: [163.0, 77.6], raio: 9.5, tela: 'ilha',   camera: 'quadrado3' },
    'iphone 16 pro':      { mm: [149.6, 71.5], raio: 9.5, tela: 'ilha',   camera: 'quadrado3' },
    'iphone 16 plus':     { mm: [160.9, 77.8], raio: 9.0, tela: 'ilha',   camera: 'pilula2' },
    'iphone 16':          { mm: [147.6, 71.6], raio: 9.0, tela: 'ilha',   camera: 'pilula2' },
    'iphone 16e':         { mm: [146.7, 71.5], raio: 8.5, tela: 'entalhe', camera: 'unica' },
    'iphone 15 pro max':  { mm: [159.9, 76.7], raio: 9.5, tela: 'ilha',   camera: 'quadrado3' },
    'iphone 15 pro':      { mm: [146.6, 70.6], raio: 9.5, tela: 'ilha',   camera: 'quadrado3' },
    'iphone 15 plus':     { mm: [160.9, 77.8], raio: 9.0, tela: 'ilha',   camera: 'diagonal2' },
    'iphone 15':          { mm: [147.6, 71.6], raio: 9.0, tela: 'ilha',   camera: 'diagonal2' },
    'iphone 14 pro max':  { mm: [160.7, 77.6], raio: 9.0, tela: 'ilha',   camera: 'quadrado3' },
    'iphone 14 pro':      { mm: [147.5, 71.5], raio: 9.0, tela: 'ilha',   camera: 'quadrado3' },
    'iphone 14 plus':     { mm: [160.8, 78.1], raio: 8.5, tela: 'entalhe', camera: 'diagonal2' },
    'iphone 14':          { mm: [146.7, 71.5], raio: 8.5, tela: 'entalhe', camera: 'diagonal2' },
    'iphone 13 pro max':  { mm: [160.8, 78.1], raio: 8.5, tela: 'entalhe', camera: 'quadrado3' },
    'iphone 13 pro':      { mm: [146.7, 71.5], raio: 8.5, tela: 'entalhe', camera: 'quadrado3' },
    'iphone 13 mini':     { mm: [131.5, 64.2], raio: 8.0, tela: 'entalhe', camera: 'diagonal2' },
    'iphone 13':          { mm: [146.7, 71.5], raio: 8.5, tela: 'entalhe', camera: 'diagonal2' },
    'iphone 12 pro max':  { mm: [160.8, 78.1], raio: 8.5, tela: 'entalhe', camera: 'quadrado3' },
    'iphone 12 pro':      { mm: [146.7, 71.5], raio: 8.5, tela: 'entalhe', camera: 'quadrado3' },
    'iphone 12 mini':     { mm: [131.5, 64.2], raio: 8.0, tela: 'entalhe', camera: 'diagonal2' },
    'iphone 12':          { mm: [146.7, 71.5], raio: 8.5, tela: 'entalhe', camera: 'diagonal2' },
    'iphone 11 pro max':  { mm: [158.0, 77.8], raio: 9.0, tela: 'entalhe', camera: 'quadrado3' },
    'iphone 11 pro':      { mm: [144.0, 71.4], raio: 9.0, tela: 'entalhe', camera: 'quadrado3' },
    'iphone 11':          { mm: [150.9, 75.7], raio: 9.5, tela: 'entalhe', camera: 'quadrado2' },
    'iphone xs max':      { mm: [157.5, 77.4], raio: 9.0, tela: 'entalhe', camera: 'vertical2' },
    'iphone xs':          { mm: [143.6, 70.9], raio: 9.0, tela: 'entalhe', camera: 'vertical2' },
    'iphone xr':          { mm: [150.9, 75.7], raio: 9.5, tela: 'entalhe', camera: 'unica' },
    'iphone x':           { mm: [143.6, 70.9], raio: 9.0, tela: 'entalhe', camera: 'vertical2' },
    'iphone se 3':        { mm: [138.4, 67.3], raio: 7.5, tela: 'botao',   camera: 'unica' },
    'iphone se 2':        { mm: [138.4, 67.3], raio: 7.5, tela: 'botao',   camera: 'unica' },
    'iphone 8 plus':      { mm: [158.4, 78.1], raio: 7.5, tela: 'botao',   camera: 'horizontal2' },
    'iphone 8':           { mm: [138.4, 67.3], raio: 7.5, tela: 'botao',   camera: 'unica' },
    'iphone 7 plus':      { mm: [158.2, 77.9], raio: 7.5, tela: 'botao',   camera: 'horizontal2' },
    'iphone 7':           { mm: [138.3, 67.1], raio: 7.5, tela: 'botao',   camera: 'unica' }
  };

  /* Tela do desenho: a mesma para todos. O maior aparelho da lista ocupa
     ALTURA_MAX; os outros encolhem na proporção do tamanho real.            */
  const TELA_W = 620, TELA_H = 880, ALTURA_MAX = 830;
  const MAIOR_MM = Math.max(...Object.values(ESPECS).map(e => e.mm[0]));

  const enc = (s) => 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(s);
  const arred = (n) => Math.round(n * 100) / 100;

  /* ---------- cor ---------- */
  function rgb(hex) {
    const h = String(hex || '#c9c9ce').replace('#', '');
    const n = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
    return [parseInt(n.slice(0, 2), 16), parseInt(n.slice(2, 4), 16), parseInt(n.slice(4, 6), 16)];
  }
  function mistura(hex, alvo, peso) {
    const a = rgb(hex), b = rgb(alvo);
    return '#' + a.map((v, i) => Math.round(v + (b[i] - v) * peso)
      .toString(16).padStart(2, '0')).join('');
  }
  const clarear = (hex, p) => mistura(hex, '#ffffff', p);
  const escurecer = (hex, p) => mistura(hex, '#000000', p);
  const luminancia = (hex) => { const [r, g, b] = rgb(hex); return (0.299 * r + 0.587 * g + 0.114 * b) / 255; };

  /* ---------- módulos de câmera ---------- */
  function lente(cx, cy, r, cor) {
    return `<circle cx="${arred(cx)}" cy="${arred(cy)}" r="${arred(r)}" fill="${escurecer(cor, 0.82)}"/>` +
           `<circle cx="${arred(cx)}" cy="${arred(cy)}" r="${arred(r * 0.62)}" fill="#0c0d10"/>` +
           `<circle cx="${arred(cx - r * 0.22)}" cy="${arred(cy - r * 0.24)}" r="${arred(r * 0.18)}" fill="rgba(255,255,255,.28)"/>`;
  }
  const flash = (cx, cy, r) =>
    `<circle cx="${arred(cx)}" cy="${arred(cy)}" r="${arred(r)}" fill="#f2efe6" opacity=".85"/>`;

  function camera(tipo, x, y, w, h, cor, esc) {
    const tom = luminancia(cor) > 0.5 ? escurecer(cor, 0.07) : clarear(cor, 0.10);
    const modulo = (mx, my, mw, mh, raio) =>
      `<rect x="${arred(mx)}" y="${arred(my)}" width="${arred(mw)}" height="${arred(mh)}" rx="${arred(raio)}"` +
      ` fill="${tom}" stroke="${escurecer(cor, 0.22)}" stroke-width="${arred(esc * 0.3)}"/>`;
    const m = esc;                                    // 1 mm em px
    const px = x + w * 0.085, py = y + h * 0.028;     // canto superior esquerdo

    if (tipo === 'unica') {
      return lente(px + 5.5 * m, py + 5.5 * m, 4.2 * m, cor) +
             flash(px + 5.5 * m, py + 15 * m, 1.7 * m);
    }
    if (tipo === 'horizontal2') {
      return modulo(px - 1.5 * m, py + 1 * m, 24 * m, 11 * m, 5.5 * m) +
             lente(px + 4.5 * m, py + 6.5 * m, 3.9 * m, cor) +
             lente(px + 18 * m, py + 6.5 * m, 3.9 * m, cor) +
             flash(px + 11.2 * m, py + 6.5 * m, 1.7 * m);
    }
    if (tipo === 'vertical2') {
      return modulo(px - 1.5 * m, py + 1 * m, 11 * m, 24 * m, 5.5 * m) +
             lente(px + 4 * m, py + 6.5 * m, 3.9 * m, cor) +
             lente(px + 4 * m, py + 19.5 * m, 3.9 * m, cor) +
             flash(px + 4 * m, py + 13 * m, 1.7 * m);
    }
    if (tipo === 'diagonal2') {
      return modulo(px - 2 * m, py + 0.5 * m, 27 * m, 27 * m, 8 * m) +
             lente(px + 5.5 * m, py + 6.5 * m, 5 * m, cor) +
             lente(px + 17 * m, py + 18 * m, 5 * m, cor) +
             flash(px + 17.5 * m, py + 6.5 * m, 2 * m);
    }
    if (tipo === 'quadrado2') {
      return modulo(px - 2 * m, py + 0.5 * m, 27 * m, 27 * m, 8 * m) +
             lente(px + 5.5 * m, py + 6.5 * m, 5 * m, cor) +
             lente(px + 5.5 * m, py + 19 * m, 5 * m, cor) +
             flash(px + 17.5 * m, py + 12.5 * m, 2 * m);
    }
    if (tipo === 'quadrado3') {
      return modulo(px - 2.5 * m, py + 0.5 * m, 32 * m, 32 * m, 9.5 * m) +
             lente(px + 5 * m, py + 7 * m, 5.4 * m, cor) +
             lente(px + 5 * m, py + 21.5 * m, 5.4 * m, cor) +
             lente(px + 19.5 * m, py + 14 * m, 5.4 * m, cor) +
             flash(px + 20 * m, py + 4.5 * m, 2 * m);
    }
    if (tipo === 'plateau3' || tipo === 'plateau1') {
      const barra = modulo(x + w * 0.055, py + 0.5 * m, w * 0.89, 24 * m, 7 * m);
      if (tipo === 'plateau1') {
        return barra + lente(px + 6 * m, py + 12 * m, 5.2 * m, cor) +
               flash(px + 18 * m, py + 12 * m, 1.9 * m);
      }
      return barra +
             lente(px + 6 * m, py + 6.5 * m, 5 * m, cor) +
             lente(px + 6 * m, py + 18 * m, 5 * m, cor) +
             lente(px + 17.5 * m, py + 12 * m, 5 * m, cor) +
             flash(px + 17.5 * m, py + 4 * m, 1.9 * m);
    }
    // pilula2 — módulo vertical em cápsula (iPhone 16 e 17)
    return modulo(px - 1 * m, py + 1 * m, 13 * m, 26 * m, 6.5 * m) +
           lente(px + 5.5 * m, py + 7 * m, 4.6 * m, cor) +
           lente(px + 5.5 * m, py + 20 * m, 4.6 * m, cor) +
           flash(px + 17 * m, py + 7 * m, 1.8 * m);
  }

  /* ---------- telas ---------- */
  function tela(tipo, x, y, w, h, cor, esc) {
    const m = esc;
    const borda = tipo === 'botao' ? 3 * m : 2.2 * m;
    const topo = tipo === 'botao' ? 17 * m : borda;
    const base = tipo === 'botao' ? 17 * m : borda;
    const sx = x + borda, sy = y + topo;
    const sw = w - borda * 2, sh = h - topo - base;
    const raio = tipo === 'botao' ? 1.5 * m : 6.5 * m;
    const claro = luminancia(cor) > 0.6;

    let out = `<rect x="${arred(sx)}" y="${arred(sy)}" width="${arred(sw)}" height="${arred(sh)}"` +
      ` rx="${arred(raio)}" fill="url(#papel)"/>` +
      `<rect x="${arred(sx)}" y="${arred(sy)}" width="${arred(sw)}" height="${arred(sh)}"` +
      ` rx="${arred(raio)}" fill="url(#reflexo)"/>`;

    if (tipo === 'entalhe') {
      const ew = sw * 0.44, eh = 5.6 * m;
      out += `<path d="M${arred(sx + sw / 2 - ew / 2)} ${arred(sy)} h${arred(ew)} v${arred(eh - 3 * m)}` +
        ` a${arred(3 * m)} ${arred(3 * m)} 0 0 1 -${arred(3 * m)} ${arred(3 * m)}` +
        ` h-${arred(ew - 6 * m)} a${arred(3 * m)} ${arred(3 * m)} 0 0 1 -${arred(3 * m)} -${arred(3 * m)} Z"` +
        ` fill="#0b0b0d"/>`;
    } else if (tipo === 'ilha') {
      const iw = sw * 0.33, ih = 4.6 * m;
      out += `<rect x="${arred(sx + sw / 2 - iw / 2)}" y="${arred(sy + 2.2 * m)}" width="${arred(iw)}"` +
        ` height="${arred(ih)}" rx="${arred(ih / 2)}" fill="#0b0b0d"/>`;
    } else {
      const cy = y + h - base / 2, r = 6.2 * m;
      out += `<circle cx="${arred(x + w / 2)}" cy="${arred(cy)}" r="${arred(r)}"` +
        ` fill="none" stroke="${claro ? 'rgba(0,0,0,.22)' : 'rgba(255,255,255,.22)'}" stroke-width="${arred(m * 0.6)}"/>`;
      out += `<circle cx="${arred(x + w / 2)}" cy="${arred(y + topo / 2)}" r="${arred(1.4 * m)}" fill="${escurecer(cor, 0.55)}"/>`;
      out += `<rect x="${arred(x + w / 2 - 6 * m)}" y="${arred(y + topo / 2 - 0.7 * m)}" width="${arred(12 * m)}"` +
        ` height="${arred(1.4 * m)}" rx="${arred(0.7 * m)}" fill="${escurecer(cor, 0.5)}"/>`;
    }
    return out;
  }

  /* ---------- corpo ---------- */
  function botoesLaterais(x, y, w, h, cor, esc) {
    const m = esc, c = escurecer(cor, 0.22);
    const faz = (lx, ly, lh) => `<rect x="${arred(lx)}" y="${arred(ly)}" width="${arred(m * 1.1)}"` +
      ` height="${arred(lh)}" rx="${arred(m * 0.5)}" fill="${c}"/>`;
    return faz(x - m * 0.4, y + h * 0.20, 9 * m) +
           faz(x - m * 0.4, y + h * 0.33, 16 * m) +
           faz(x - m * 0.4, y + h * 0.45, 16 * m) +
           faz(x + w - m * 0.7, y + h * 0.26, 22 * m);
  }

  function svg(familia, corHex, lado) {
    const e = ESPECS[familia];
    if (!e) return null;
    const cor = corHex || '#c9c9ce';
    const [mmH, mmW] = e.mm;

    const h = ALTURA_MAX * (mmH / MAIOR_MM);
    const esc = h / mmH;                               // px por mm
    const w = mmW * esc;
    const x = (TELA_W - w) / 2, y = (TELA_H - h) / 2;
    const raio = e.raio * esc;

    const verso = lado !== 'frente';
    const claro = luminancia(cor) > 0.62;
    // A tela é acesa: em aparelho escuro o papel de parede clareia, para não
    // virar um bloco preto.
    const corTela = luminancia(cor) < 0.34 ? clarear(cor, 0.52) : cor;
    const corpo = verso ? cor : escurecer(cor, claro ? 0.10 : 0.16);

    const partes = [];
    partes.push(`<defs>
      <linearGradient id="corpo" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="${clarear(corpo, 0.22)}"/>
        <stop offset="45%" stop-color="${corpo}"/>
        <stop offset="100%" stop-color="${escurecer(corpo, 0.16)}"/>
      </linearGradient>
      <linearGradient id="brilho" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stop-color="rgba(255,255,255,.34)"/>
        <stop offset="18%" stop-color="rgba(255,255,255,0)"/>
        <stop offset="82%" stop-color="rgba(255,255,255,0)"/>
        <stop offset="100%" stop-color="rgba(255,255,255,.22)"/>
      </linearGradient>
      <radialGradient id="papel" cx="50%" cy="38%" r="82%">
        <stop offset="0%" stop-color="${clarear(corTela, 0.34)}"/>
        <stop offset="46%" stop-color="${corTela}"/>
        <stop offset="100%" stop-color="${escurecer(corTela, 0.62)}"/>
      </radialGradient>
      <linearGradient id="reflexo" x1="0.1" y1="0" x2="0.9" y2="1">
        <stop offset="0%" stop-color="rgba(255,255,255,.16)"/>
        <stop offset="42%" stop-color="rgba(255,255,255,.02)"/>
        <stop offset="100%" stop-color="rgba(255,255,255,0)"/>
      </linearGradient>
    </defs>`);

    partes.push(botoesLaterais(x, y, w, h, corpo, esc));
    partes.push(`<rect x="${arred(x)}" y="${arred(y)}" width="${arred(w)}" height="${arred(h)}" rx="${arred(raio)}"` +
      ` fill="url(#corpo)" stroke="${escurecer(corpo, 0.3)}" stroke-width="${arred(esc * 0.45)}"/>`);

    if (verso) {
      partes.push(camera(e.camera, x, y, w, h, corpo, esc));
    } else {
      partes.push(tela(e.tela, x, y, w, h, corpo, esc));
    }

    partes.push(`<rect x="${arred(x)}" y="${arred(y)}" width="${arred(w)}" height="${arred(h)}" rx="${arred(raio)}"` +
      ` fill="url(#brilho)" pointer-events="none"/>`);

    return enc(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${TELA_W} ${TELA_H}" width="${TELA_W}" height="${TELA_H}">` +
      partes.join('') + '</svg>');
  }

  return { ESPECS, svg, familias: Object.keys(ESPECS), TELA_W, TELA_H };
})();

if (typeof module !== 'undefined') module.exports = I2_DESENHO;
