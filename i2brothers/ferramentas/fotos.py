# -*- coding: utf-8 -*-
"""
Monta o repositório de fotos do catálogo: duas fotos por modelo e cor
(verso e frente), aparelho inteiro, fundo transparente, sempre na mesma
tela de 620 x 880 px com o aparelho a 840 px de altura.

As artes vêm do material oficial da Apple. Quase todas trazem os dois
aparelhos lado a lado (verso à esquerda, frente à direita); o script separa
os dois pelo vão entre eles. Onde a Apple publica os aparelhos sobrepostos,
a janela de cada um está medida na tabela JANELAS, e a frente vem da arte de
comparação (FRENTE_ALT), que mostra o aparelho inteiro.

Uso:  python3 ferramentas/fotos.py [familia ...]
"""
import io, json, os, re, sys, urllib.request, concurrent.futures
import numpy as np
from scipy import ndimage
from PIL import Image

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(AQUI)
SAIDA = os.path.join(RAIZ, 'assets', 'iphones')
MAPA = os.path.join(RAIZ, 'assets', 'fotos.json')

CDN = 'https://store.storeimages.cdn-apple.com/8756/as-images.apple.com/is/'
SUP = 'https://cdsassets.apple.com/live/7WUAS350/images/iphone/'

TELA_W, TELA_H, ALTURA = 620, 880, 840
T0, T1 = 6.0, 26.0

def cdn(slug):  return CDN + slug + '?wid=1600&hei=1600&fmt=png-alpha'
def sup(caminho): return SUP + caminho

# ---------------------------------------------------------------- fontes
def sel(prefixo, data, cores):
    """Arte por cor do tipo <modelo>-<cor>-select-<data>."""
    return {nosso: cdn(f'{prefixo}-{deles}-select-{data}') for nosso, deles in cores.items()}

def fin(prefixo, cores):
    """Arte por cor do tipo <modelo>-finish-select-<...>."""
    return {nosso: cdn(deles) for nosso, deles in cores.items()}

FONTES = {
 'iphone 18 pro max': fin('', {
    'black': 'iphone-18-pro-max-finish-select-black-202609',
    'burgundy': 'iphone-18-pro-max-finish-select-burgundy-202609',
    'glacier': 'iphone-18-pro-max-finish-select-glacier-202609',
    'silver': 'iphone-18-pro-max-finish-select-silver-202609'}),
 'iphone 18 pro': fin('', {
    'black': 'iphone-18-pro-finish-select-black-202609',
    'burgundy': 'iphone-18-pro-finish-select-burgundy-202609',
    'glacier': 'iphone-18-pro-finish-select-glacier-202609',
    'silver': 'iphone-18-pro-finish-select-silver-202609'}),
 'iphone 17 pro max': fin('', {
    'cosmicorange': 'iphone-17-pro-max-finish-select-cosmicorange-202509',
    'deepblue': 'iphone-17-pro-max-finish-select-deepblue-202509',
    'silver': 'iphone-17-pro-max-finish-select-silver-202509'}),
 'iphone 17 pro': fin('', {
    'cosmicorange': 'iphone-17-pro-finish-select-cosmicorange-202509',
    'deepblue': 'iphone-17-pro-finish-select-deepblue-202509',
    'silver': 'iphone-17-pro-finish-select-silver-202509'}),
 'iphone 17e': fin('', {
    'black': 'iphone-17e-finish-select-black-202603',
    'softpink': 'iphone-17e-finish-select-softpink-202603',
    'white': 'iphone-17e-finish-select-white-202603'}),
 'iphone air': fin('', {
    'skyblue': 'iphone-air-finish-select-skyblue-202509',
    'cloudwhite': 'iphone-air-finish-select-cloudwhite-202509',
    'lightgold': 'iphone-air-finish-select-lightgold-202509',
    'spaceblack': 'iphone-air-finish-select-spaceblack-202509'}),
 'iphone 17': sel('iphone-17', '202509', {
    'lavender': 'lavender', 'sage': 'sage', 'mistblue': 'mistblue',
    'white': 'white', 'black': 'black'}),
 'iphone 16e': sel('iphone-16e', '202502', {'black': 'black', 'white': 'white'}),
 'iphone 16 pro max': fin('', {
    'naturaltitanium': 'iphone-16-pro-finish-select-202409-6-9inch-naturaltitanium',
    'deserttitanium': 'iphone-16-pro-finish-select-202409-6-9inch-deserttitanium',
    'whitetitanium': 'iphone-16-pro-finish-select-202409-6-9inch-whitetitanium',
    'blacktitanium': 'iphone-16-pro-finish-select-202409-6-9inch-blacktitanium'}),
 'iphone 16 pro': fin('', {
    'naturaltitanium': 'iphone-16-pro-finish-select-202409-6-3inch-naturaltitanium',
    'deserttitanium': 'iphone-16-pro-finish-select-202409-6-3inch-deserttitanium',
    'whitetitanium': 'iphone-16-pro-finish-select-202409-6-3inch-whitetitanium',
    'blacktitanium': 'iphone-16-pro-finish-select-202409-6-3inch-blacktitanium'}),
 'iphone 16 plus': sel('iphone-16-plus', '202409', {
    'ultramarine': 'ultramarine', 'teal': 'teal', 'pink': 'pink',
    'white': 'white', 'black': 'black'}),
 'iphone 16': sel('iphone-16', '202409', {
    'ultramarine': 'ultramarine', 'teal': 'teal', 'pink': 'pink',
    'white': 'white', 'black': 'black'}),
 'iphone 15 pro max': fin('', {
    'naturaltitanium': 'iphone-15-pro-finish-select-202309-6-7inch-naturaltitanium',
    'bluetitanium': 'iphone-15-pro-finish-select-202309-6-7inch-bluetitanium',
    'whitetitanium': 'iphone-15-pro-finish-select-202309-6-7inch-whitetitanium',
    'blacktitanium': 'iphone-15-pro-finish-select-202309-6-7inch-blacktitanium'}),
 'iphone 15 pro': fin('', {
    'naturaltitanium': 'iphone-15-pro-finish-select-202309-6-1inch-naturaltitanium',
    'bluetitanium': 'iphone-15-pro-finish-select-202309-6-1inch-bluetitanium',
    'whitetitanium': 'iphone-15-pro-finish-select-202309-6-1inch-whitetitanium',
    'blacktitanium': 'iphone-15-pro-finish-select-202309-6-1inch-blacktitanium'}),
 'iphone 15 plus': sel('iphone-15-plus', '202309', {
    'blue': 'blue', 'pink': 'pink', 'yellow': 'yellow', 'green': 'green', 'black': 'black'}),
 'iphone 15': sel('iphone-15', '202309', {
    'blue': 'blue', 'pink': 'pink', 'yellow': 'yellow', 'green': 'green', 'black': 'black'}),
 'iphone 14 pro max': fin('', {
    'deeppurple': 'iphone-14-pro-finish-select-202209-6-7inch-deeppurple',
    'gold': 'iphone-14-pro-finish-select-202209-6-7inch-gold',
    'silver': 'iphone-14-pro-finish-select-202209-6-7inch-silver',
    'spaceblack': 'iphone-14-pro-finish-select-202209-6-7inch-spaceblack'}),
 'iphone 14 pro': fin('', {
    'deeppurple': 'iphone-14-pro-finish-select-202209-6-1inch-deeppurple',
    'gold': 'iphone-14-pro-finish-select-202209-6-1inch-gold',
    'silver': 'iphone-14-pro-finish-select-202209-6-1inch-silver',
    'spaceblack': 'iphone-14-pro-finish-select-202209-6-1inch-spaceblack'}),
 'iphone 14 plus': sel('iphone-14-plus', '202209', {
    'blue': 'blue', 'purple': 'purple', 'midnight': 'midnight',
    'starlight': 'starlight', 'red': 'red'}),
 'iphone 14': sel('iphone-14', '202209', {
    'blue': 'blue', 'purple': 'purple', 'midnight': 'midnight',
    'starlight': 'starlight', 'red': 'red'}),
 'iphone 13 pro max': fin('', {
    'sierrablue': 'iphone-13-pro-finish-select-202207-6-7inch-sierrablue',
    'graphite': 'iphone-13-pro-finish-select-202207-6-7inch-graphite',
    'gold': 'iphone-13-pro-finish-select-202207-6-7inch-gold',
    'silver': 'iphone-13-pro-finish-select-202207-6-7inch-silver',
    'alpinegreen': 'iphone-13-pro-finish-select-202207-6-7inch-alpinegreen'}),
 'iphone 13 pro': fin('', {
    'sierrablue': 'iphone-13-pro-finish-select-202207-6-1inch-sierrablue',
    'graphite': 'iphone-13-pro-finish-select-202207-6-1inch-graphite',
    'gold': 'iphone-13-pro-finish-select-202207-6-1inch-gold',
    'silver': 'iphone-13-pro-finish-select-202207-6-1inch-silver',
    'alpinegreen': 'iphone-13-pro-finish-select-202207-6-1inch-alpinegreen'}),
 'iphone 13 mini': sel('iphone-13-mini', '2021', {
    'blue': 'blue', 'midnight': 'midnight', 'pink': 'pink', 'starlight': 'starlight'}),
 'iphone 13': sel('iphone-13', '2021', {
    'blue': 'blue', 'midnight': 'midnight', 'pink': 'pink', 'starlight': 'starlight'}),
 'iphone 12 pro max': {'graphite': sup('iphone-12-pro-max/iphone12-pro-max-colors.jpg')},
 'iphone 12 pro': {'graphite': sup('iphone-12-pro/iphone12-pro-colors.jpg')},
 'iphone 12 mini': sel('iphone-12-mini', '2020', {
    'blue': 'blue', 'green': 'green', 'black': 'black', 'white': 'white', 'red': 'red'}),
 'iphone 12': sel('iphone-12', '2020', {
    'blue': 'blue', 'green': 'green', 'black': 'black', 'white': 'white', 'red': 'red'}),
 'iphone 11 pro max': sel('iphone-11-pro-max', '2019', {
    'spacegray': 'space', 'silver': 'silver', 'gold': 'gold', 'midnightgreen': 'midnight-green'}),
 'iphone 11 pro': sel('iphone-11-pro', '2019', {
    'spacegray': 'space', 'silver': 'silver', 'gold': 'gold', 'midnightgreen': 'midnight-green'}),
 'iphone 11': sel('iphone11', '2019', {
    'black': 'black', 'white': 'white', 'green': 'green', 'yellow': 'yellow',
    'purple': 'purple', 'red': 'red'}),
 'iphone xs max': sel('iphone-xs-max', '2018', {'gold': 'gold', 'silver': 'silver', 'spacegray': 'space'}),
 'iphone xs': sel('iphone-xs', '2018', {'gold': 'gold', 'silver': 'silver', 'spacegray': 'space'}),
 'iphone xr': sel('iphone-xr', '201809', {
    'black': 'black', 'white': 'white', 'blue': 'blue', 'yellow': 'yellow',
    'coral': 'coral', 'red': 'red'}),
 'iphone x': sel('iphone-x', '2017', {'silver': 'silver', 'spacegray': 'gray'}),
 'iphone 8 plus': {'silver': sup('iphone-8-plus/iphone-8plus-colors.jpg')},
 'iphone 8': {'silver': sup('iphone-8/iphone-8-colors.jpg')},
 'iphone 7 plus': {'silver': sup('iphone-7-plus/iphone7plus-colors.jpg')},
 'iphone 7': {'silver': sup('iphone-7/iphone7-colors.jpg')},
 'iphone se 3': fin('', {
    'midnight': 'iphone-se-finish-select-202207-midnight',
    'starlight': 'iphone-se-finish-select-202207-starlight'}),
 'iphone se 2': sel('iphone-se', '2020', {'black': 'black', 'white': 'white', 'red': 'red'}),
}

# Famílias cuja arte por cor traz a frente encoberta pelo verso: a frente sai
# da arte de comparação da Apple, que mostra o aparelho inteiro.
FRENTE_ALT = {
 'iphone 18 pro':     cdn('iphone-compare-iphone-18-pro-202609'),
 'iphone 18 pro max': cdn('iphone-compare-iphone-18-pro-202609'),
 'iphone 17 pro':     cdn('iphone-compare-iphone-17-pro-202509'),
 'iphone 17 pro max': cdn('iphone-compare-iphone-17-pro-202509'),
}

# Janela medida na arte (recuo a partir da direita, largura), em alturas da arte.
# Artes de linha de cores: os versos aparecem em leque, um cobrindo o outro,
# então só a frente (o aparelho da direita) é aproveitada.
SEM_VERSO = {'iphone 12 pro', 'iphone 12 pro max', 'iphone se 3',
             'iphone 8', 'iphone 8 plus', 'iphone 7', 'iphone 7 plus'}

JANELAS = {
 'iphone 18 pro':     {'verso': (0.40, 0.56)},
 'iphone 18 pro max': {'verso': (0.40, 0.56)},
 'iphone 17 pro':     {'verso': (0.40, 0.56)},
 'iphone 17 pro max': {'verso': (0.40, 0.56)},
}

# ------------------------------------------------------------- tratamento
def baixa(url):
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    return Image.open(io.BytesIO(urllib.request.urlopen(req, timeout=60).read())).convert('RGBA')

def recorta(im):
    bb = im.split()[3].point(lambda v: 255 if v > 24 else 0).getbbox()
    return im.crop(bb) if bb else im

def tira_fundo(im):
    a = np.asarray(im).astype(np.float32)
    rgb, alpha = a[..., :3], a[..., 3].copy()
    if min(alpha[0, 0], alpha[0, -1], alpha[-1, 0], alpha[-1, -1]) < 200:
        return im
    bg = np.stack([rgb[0, 0], rgb[0, -1], rgb[-1, 0], rgb[-1, -1]]).mean(axis=0)
    dist = np.sqrt(((rgb - bg) ** 2).sum(axis=2))
    lab, _ = ndimage.label(dist <= T1)
    borda = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))) - {0}
    if not borda:
        return im
    fundo = np.isin(lab, list(borda))
    ramp = np.clip((dist - T0) / (T1 - T0), 0, 1) * 255
    alpha = np.where(fundo, np.minimum(alpha, ramp), alpha)
    return Image.fromarray(np.dstack([rgb, alpha]).astype(np.uint8), 'RGBA')

def blocos(im, min_vao=0.012):
    """Separa a arte em aparelhos usando as colunas vazias entre eles."""
    op = np.asarray(im.split()[3]) > 24
    col = op.any(axis=0)
    h, w = op.shape
    vao = max(2, int(h * min_vao))
    partes, ini, vazios = [], None, 0
    for x in range(w):
        if col[x]:
            if ini is None:
                ini = x
            vazios = 0
        elif ini is not None:
            vazios += 1
            if vazios >= vao:
                partes.append((ini, x - vazios + 1)); ini = None
    if ini is not None:
        partes.append((ini, w))
    return [p for p in partes if (p[1] - p[0]) > h * 0.04]

PROPORCAO = 0.49          # largura/altura de um iPhone (ex.: 17 Pro Max 78 x 163,4 mm)


def energia_colunas(im):
    """Força da aresta vertical em cada coluna, composta sobre branco."""
    cinza = np.asarray(im.convert('L')).astype(np.float32)
    alpha = np.asarray(im.split()[3]).astype(np.float32) / 255.0
    g = cinza * alpha + 255.0 * (1 - alpha)
    return (np.abs(np.diff(g, axis=1)) > 30).mean(axis=0)


def emenda(im):
    """Coluna que separa os dois aparelhos da arte.

    As arestas mais fortes são sempre as bordas externas (a silhueta contra o
    fundo); a emenda é a aresta mais forte do miolo.
    """
    e = energia_colunas(im)
    w = len(e)
    margem = max(4, int(w * 0.10))
    if w - 2 * margem < 4:
        return w // 2
    return margem + int(e[margem:w - margem].argmax()) + 1


def limpa_borda(im, lado):
    """Tira a faixa do aparelho vizinho que às vezes sobra na borda do recorte."""
    e = energia_colunas(im)
    h = im.height
    if e.size < 8:
        return im
    largura = max(4, int(h * 0.16))
    if lado == 'esquerda':
        faixa = e[:largura]
        corte = int(faixa.argmax()) + 1
        if faixa.max() > 0.45 and 0.18 <= (im.width - corte) / h <= 0.62:
            return recorta(im.crop((corte, 0, im.width, h)))
    else:
        faixa = e[-largura:]
        corte = len(e) - largura + int(faixa.argmax()) + 1
        if faixa.max() > 0.45 and 0.18 <= corte / h <= 0.62:
            return recorta(im.crop((0, 0, corte, h)))
    return im


def maior_bloco(im):
    partes = blocos(im)
    if not partes:
        return im
    a, b = max(partes, key=lambda p: p[1] - p[0])
    return im.crop((a, 0, b, im.height))


def divide(im):
    """Devolve (verso, frente): o aparelho da esquerda e o da direita.

    Vistas de perfil (aparelhos de lado que algumas artes trazem) são estreitas
    demais para contar como aparelho e ficam de fora.
    """
    h = im.height
    partes = [p for p in blocos(im) if (p[1] - p[0]) > h * 0.3]
    if not partes:
        return None, im
    esquerda = im.crop((partes[0][0], 0, partes[0][1], h))
    direita = im.crop((partes[-1][0], 0, partes[-1][1], h))
    if len(partes) == 1:
        if esquerda.width <= h * 0.55:
            return None, esquerda                   # arte com um aparelho só
        x = emenda(esquerda)
        direita = esquerda.crop((x, 0, esquerda.width, h))
        esquerda = esquerda.crop((0, 0, x, h))
    verso = limpa_borda(limpa_borda(maior_bloco(recorta(esquerda)), 'direita'), 'esquerda')
    frente = limpa_borda(limpa_borda(maior_bloco(recorta(direita)), 'esquerda'), 'direita')
    return recorta(verso), recorta(frente)


def janela(im, recuo, largura):
    w, h = im.size
    x1 = max(1, w - int(round(h * recuo)))
    x0 = max(0, x1 - int(round(h * largura)))
    return recorta(im.crop((x0, 0, x1, h)))

def padroniza(im):
    im = recorta(im)
    w, h = im.size
    nh = ALTURA
    nw = max(1, round(w * nh / h))
    if nw > TELA_W - 20:
        nw = TELA_W - 20
        nh = max(1, round(h * nw / w))
    im = im.resize((nw, nh), Image.LANCZOS)
    tela = Image.new('RGBA', (TELA_W, TELA_H), (0, 0, 0, 0))
    tela.paste(im, ((TELA_W - nw) // 2, (TELA_H - nh) // 2), im)
    return tela

def salva(im, nome):
    padroniza(im).save(os.path.join(SAIDA, nome + '.webp'), 'WEBP', quality=88, method=6)

def prefixo_arquivo(familia, cor):
    return re.sub(r'[^a-z0-9]+', '-', f'{familia} {cor}').strip('-')

def processa(familia, cor, url):
    arte = recorta(tira_fundo(recorta(baixa(url))))
    regras = JANELAS.get(familia, {})
    feitos = {}

    if 'verso' in regras or 'frente' in regras:
        for lado in ('verso', 'frente'):
            if lado in regras:
                if regras[lado] is None:
                    continue
                feitos[lado] = janela(arte, *regras[lado])
    if not feitos:
        verso, frente = divide(arte)
        if verso is not None and familia not in SEM_VERSO:
            feitos['verso'] = verso
        feitos['frente'] = frente

    if familia in FRENTE_ALT and 'frente' not in regras:
        feitos['frente'] = divide(recorta(tira_fundo(recorta(baixa(FRENTE_ALT[familia])))))[1]

    base = prefixo_arquivo(familia, cor)
    for lado, img in feitos.items():
        salva(img, f'{base}-{lado}')
    return base, sorted(feitos)

def escreve_mapa(mapa):
    """Grava o índice das fotos em JSON e em JS (lido pelo catálogo)."""
    json.dump(mapa, open(MAPA, 'w', encoding='utf-8'), ensure_ascii=False, indent=1, sort_keys=True)
    js = os.path.join(RAIZ, 'assets', 'fotos.js')
    corpo = json.dumps(mapa, ensure_ascii=False, indent=1, sort_keys=True)
    with open(js, 'w', encoding='utf-8') as f:
        f.write('/* Índice das fotos dos aparelhos — gerado por ferramentas/fotos.py. */\n')
        f.write('var I2_FOTOS = ' + corpo + ';\n')
        f.write("if (typeof module !== 'undefined') module.exports = I2_FOTOS;\n")


def monta_mapa(resultados):
    mapa = {}
    for familia, cores in FONTES.items():
        entrada = {'padrao': None, 'cores': {}}
        for cor in cores:
            lados = resultados.get((familia, cor))
            if not lados:
                continue
            entrada['cores'][cor] = {'base': prefixo_arquivo(familia, cor), 'lados': lados}
            if entrada['padrao'] is None:
                entrada['padrao'] = cor
        if entrada['cores']:
            mapa[familia] = entrada
    return mapa


def lados_no_disco(familia, cor):
    base = prefixo_arquivo(familia, cor)
    return [lado for lado in ('verso', 'frente')
            if os.path.exists(os.path.join(SAIDA, f'{base}-{lado}.webp'))]


def main():
    alvos = [a for a in sys.argv[1:] if not a.startswith('--')]
    if '--mapa' in sys.argv:                        # só reescreve o índice
        escreve_mapa(monta_mapa({(f, c): lados_no_disco(f, c)
                                 for f, cores in FONTES.items() for c in cores}))
        print('índice regravado a partir dos arquivos em', SAIDA)
        return
    os.makedirs(SAIDA, exist_ok=True)
    tarefas = [(f, c, u) for f, cores in FONTES.items() if not alvos or any(a in f for a in alvos)
               for c, u in cores.items()]
    falhas = []

    def roda(t):
        try:
            return t[0], t[1], processa(*t)[1], None
        except Exception as e:
            return t[0], t[1], None, f'{type(e).__name__}: {e}'

    with concurrent.futures.ThreadPoolExecutor(8) as ex:
        for familia, cor, lados, erro in ex.map(roda, tarefas):
            if erro:
                falhas.append(f'{familia} / {cor}: {erro}')

    # o índice sai do que existe no disco, então uma refeita parcial não o quebra
    mapa = monta_mapa({(f, c): lados_no_disco(f, c) for f, cores in FONTES.items() for c in cores})
    escreve_mapa(mapa)

    total = sum(len(e['cores']) for e in mapa.values())
    doisLados = sum(1 for e in mapa.values() for v in e['cores'].values() if len(v['lados']) == 2)
    print(f'{len(mapa)} famílias, {total} cores, {doisLados} com verso e frente')
    if falhas:
        print('FALHAS:'); print('\n'.join(falhas))

main()
