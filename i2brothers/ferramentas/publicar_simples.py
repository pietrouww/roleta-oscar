# -*- coding: utf-8 -*-
"""
Monta a versão enxuta para publicar: cada página vira um arquivo único, com
CSS, JavaScript e logo embutidos. Sem pasta de imagens — o catálogo desenha os
aparelhos. São 3 arquivos, nenhum precisa ser descompactado:

    venda_aparelhos/index.html          catálogo (o que o cliente abre)
    venda_aparelhos/catalogo.json       a lista (é o que muda todo dia)
    venda_aparelhos/config/index.html   configuração

Uso:  python3 ferramentas/publicar_simples.py
"""
import base64, os, re, shutil

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SAIDA = os.path.join(RAIZ, 'publicar', 'simples', 'venda_aparelhos')

def ler(*partes):
    with open(os.path.join(RAIZ, *partes), encoding='utf-8') as f:
        return f.read()

def dataURI(caminho, tipo):
    with open(os.path.join(RAIZ, caminho), 'rb') as f:
        return f'data:{tipo};base64,' + base64.b64encode(f.read()).decode()

LOGO = dataURI('assets/logo.png', 'image/png')
TABELA = dataURI('assets/tabela-taxas.jpg', 'image/jpeg')

def embute(html, base, com_tabela=False):
    prefixo = '../' if base else ''
    # folhas de estilo
    def css(m):
        arquivo = m.group(1).replace(prefixo, '')
        return '<style>\n' + ler(arquivo) + '\n</style>'
    html = re.sub(r'<link rel="stylesheet" href="([^"]+)">', css, html)
    # scripts
    def js(m):
        arquivo = m.group(1).replace(prefixo, '')
        return '<script>\n' + ler(arquivo) + '\n</script>'
    html = re.sub(r'<script src="([^"]+)"></script>', js, html)
    # a raiz do site não pode ser deduzida do script embutido: vai explícita
    html = html.replace('<script>\n' + ler('assets/core.js'),
                        f"<script>var I2_BASE = '{base}';</script>\n<script>\n" + ler('assets/core.js'), 1)
    # imagens
    html = html.replace(f'href="{prefixo}assets/logo.png"', f'href="{LOGO}"')
    html = html.replace(f'src="{prefixo}assets/logo.png"', f'src="{LOGO}"')
    html = html.replace(f'src="{prefixo}assets/tabela-taxas.jpg"',
                        f'src="{TABELA}"' if com_tabela else 'src="" style="display:none"')
    # o índice de fotos não serve sem a pasta de fotos
    html = html.replace('<option value="foto">Foto oficial da Apple (quando houver)</option>', '')
    return html

def main():
    shutil.rmtree(os.path.join(RAIZ, 'publicar', 'simples'), ignore_errors=True)
    os.makedirs(os.path.join(SAIDA, 'config'), exist_ok=True)

    catalogo = embute(ler('index.html'), '')
    config = embute(ler('config/index.html'), '../', com_tabela=True)

    with open(os.path.join(SAIDA, 'index.html'), 'w', encoding='utf-8') as f:
        f.write(catalogo)
    with open(os.path.join(SAIDA, 'config', 'index.html'), 'w', encoding='utf-8') as f:
        f.write(config)
    shutil.copy(os.path.join(RAIZ, 'catalogo.json'), os.path.join(SAIDA, 'catalogo.json'))

    print('pronto:', SAIDA)
    for pasta, _, arquivos in os.walk(SAIDA):
        for a in sorted(arquivos):
            caminho = os.path.join(pasta, a)
            print(f'  {os.path.relpath(caminho, SAIDA):26s} {os.path.getsize(caminho) / 1024:7.0f} KB')

main()
