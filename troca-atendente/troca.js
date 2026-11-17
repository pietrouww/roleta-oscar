(function(){
'use strict';
var API='/troca', LS=window.localStorage, HORA=60*60*1000;
function get(k){try{return LS.getItem(k);}catch(e){return null;}}
function set(k,v){try{LS.setItem(k,v);}catch(e){}}
function chave(){return get('efx_aparelho');}
function atual(){try{return JSON.parse(get('efx_atendente')||'null');}catch(e){return null;}}
function api(p,dados){var o={method:dados?'POST':'GET',headers:{'Content-Type':'application/json','X-Aparelho':chave()||''}};if(dados)o.body=JSON.stringify(dados);
return fetch(API+p,o).then(function(r){return r.json().catch(function(){return{};}).then(function(j){j._status=r.status;return j;});});}
function el(tag,css,txt){var e=document.createElement(tag);if(css)e.style.cssText=css;if(txt!=null)e.textContent=txt;return e;}
var BTN='min-height:44px;padding:0 16px;border:0;border-radius:10px;font:600 15px Inter,system-ui,sans-serif;cursor:pointer;';
var VERDE=BTN+'background:#1a8f6a;color:#fff;', CINZA=BTN+'background:#eef1ef;color:#111b21;';
var INP='width:100%;box-sizing:border-box;height:44px;border:1px solid #cfd8d3;border-radius:10px;padding:0 12px;font:16px Inter,system-ui,sans-serif;margin-top:4px;';

function modal(titulo,podeFechar){fechar();var o=el('div','position:fixed;inset:0;z-index:10000;background:rgba(11,20,26,.55);display:flex;align-items:center;justify-content:center;padding:16px');o.id='efx-troca';
var b=el('div','width:min(380px,100%);background:#fff;border-radius:16px;padding:20px;box-shadow:0 12px 40px rgba(0,0,0,.25);font-family:Inter,system-ui,sans-serif;color:#111b21;display:flex;flex-direction:column;gap:12px');b.setAttribute('role','dialog');b.setAttribute('aria-label',titulo);
var h=el('div','display:flex;align-items:center;justify-content:space-between');h.appendChild(el('strong','font-size:18px',titulo));
if(podeFechar){var x=el('button','border:0;background:transparent;font-size:24px;width:44px;height:44px;cursor:pointer','×');x.setAttribute('aria-label','Fechar');x.onclick=fechar;h.appendChild(x);}
b.appendChild(h);o.appendChild(b);document.body.appendChild(o);return b;}
function fechar(){var o=document.getElementById('efx-troca');if(o)o.remove();}
function erro(box){var e=el('div','color:#b3261e;font-size:14px;min-height:18px');box.appendChild(e);return e;}
function campo(box,rot,tipo,id){var l=el('label','font-size:14px;color:#3b4a54',rot);l.htmlFor=id;var i=el('input',INP);i.type=tipo;i.id=id;if(tipo==='password'&&/pin/.test(id)){i.inputMode='numeric';i.maxLength=4;i.autocomplete='off';}box.appendChild(l);box.appendChild(i);return i;}

/* ---- ativacao do aparelho (uma vez, por um administrador) ---- */
function telaAtivar(){var b=modal('Ativar este aparelho',true);
b.appendChild(el('div','font-size:14px;color:#54656f','Só um administrador. Depois disso, este aparelho mostra o botão de troca de atendente.'));
var n=campo(b,'Nome do aparelho (ex.: Recepção)','text','efx-an');var em=campo(b,'E-mail de administrador do Chatwoot','email','efx-ae');var s=campo(b,'Senha','password','efx-as');
var e=erro(b);var ok=el('button',VERDE,'Ativar');b.appendChild(ok);
ok.onclick=function(){ok.disabled=true;e.textContent='';api('/ativar',{nome:n.value.trim()||'Aparelho',email:em.value.trim(),senha:s.value}).then(function(j){ok.disabled=false;
if(j.chave){set('efx_aparelho',j.chave);set('efx_aparelho_nome',j.nome);s.value='';history.replaceState(null,'',location.pathname);fechar();botao();telaLista();}else e.textContent=j.erro||'Não foi possível ativar.';});};}

/* ---- lista de atendentes ---- */
function telaLista(){api('/atendentes').then(function(j){if(j._status===401){telaInvalido();return;}
var b=modal('Quem está atendendo?',!!atual());
(j.atendentes||[]).forEach(function(a){var bt=el('button',CINZA+'text-align:left;width:100%',a.nome+(a.temPin?'':'  (criar PIN)'));bt.onclick=function(){a.temPin?telaPin(a,'entrar'):telaCriarPin(a);};b.appendChild(bt);});});}
function telaInvalido(){var b=modal('Aparelho não ativado',true);b.appendChild(el('div','font-size:14px','Peça a um administrador para ativar este aparelho de novo.'));try{LS.removeItem('efx_aparelho');}catch(e){}var bt=document.getElementById('efx-troca-btn');if(bt)bt.remove();}

/* ---- PIN ---- */
function telaPin(a,modo){var b=modal(modo==='confirmar'?'Ainda é '+a.nome+'?':a.nome,modo!=='confirmar');
if(modo==='confirmar')b.appendChild(el('div','font-size:14px;color:#54656f','Confirmação de 1 em 1 hora. Digite o seu PIN para continuar.'));
var p=campo(b,'PIN de 4 números','password','efx-pin');var e=erro(b);var ok=el('button',VERDE,modo==='confirmar'?'Sou eu, continuar':'Entrar');b.appendChild(ok);
if(modo==='confirmar'){var tr=el('button',CINZA,'Trocar atendente');tr.onclick=telaLista;b.appendChild(tr);}
var esq=el('button','border:0;background:transparent;color:#0b6b53;font-size:14px;cursor:pointer;min-height:44px','Esqueci o PIN');esq.onclick=function(){telaCriarPin(a);};b.appendChild(esq);
function enviar(){ok.disabled=true;e.textContent='';api(modo==='confirmar'?'/confirmar':'/entrar',{id:a.id,pin:p.value}).then(function(j){ok.disabled=false;
if(j.semPin){telaCriarPin(a);return;}
if(modo==='confirmar'&&j.ok){set('efx_confirmado',String(Date.now()));fechar();return;}
if(j.url){entrarComo(a,j.url);return;}
p.value='';e.textContent=j.erro||'Não foi possível.';});}
ok.onclick=enviar;p.addEventListener('keydown',function(ev){if(ev.key==='Enter')enviar();});setTimeout(function(){p.focus();},50);}
function telaCriarPin(a){var b=modal('Criar PIN — '+a.nome,true);
b.appendChild(el('div','font-size:14px;color:#54656f','Só na primeira vez (ou se esquecer o PIN). Use a sua senha do Chatwoot para confirmar que é você.'));
var s=campo(b,'Sua senha do Chatwoot','password','efx-cs');var p1=campo(b,'Novo PIN (4 números)','password','efx-pin1');var p2=campo(b,'Repita o PIN','password','efx-pin2');
var e=erro(b);var ok=el('button',VERDE,'Salvar PIN e entrar');b.appendChild(ok);
ok.onclick=function(){e.textContent='';if(!/^\d{4}$/.test(p1.value)){e.textContent='O PIN deve ter 4 números.';return;}if(p1.value!==p2.value){e.textContent='Os PINs não conferem.';return;}
ok.disabled=true;api('/definir-pin',{id:a.id,senha:s.value,pin:p1.value}).then(function(j){if(!j.ok){ok.disabled=false;e.textContent=j.erro||'Não foi possível.';return;}
s.value='';api('/entrar',{id:a.id,pin:p1.value}).then(function(k){ok.disabled=false;if(k.url)entrarComo(a,k.url);else e.textContent=k.erro||'Não foi possível.';});});};}

/* ---- troca de sessao ---- */
function sairChatwoot(){var c=document.cookie.split('; ').filter(function(x){return x.indexOf('cw_d_session_info=')===0;})[0];var p=Promise.resolve();
if(c){try{var info=JSON.parse(decodeURIComponent(c.slice(18)));p=fetch('/auth/sign_out',{method:'DELETE',headers:{'access-token':info['access-token'],client:info.client,uid:info.uid}}).catch(function(){});}catch(e){}}
return p.then(function(){var d=location.hostname;['','; domain='+d,'; domain=.'+d.split('.').slice(-3).join('.')].forEach(function(s){document.cookie='cw_d_session_info=; Max-Age=0; path=/'+s;});});}
function entrarComo(a,url){set('efx_atendente',JSON.stringify({id:a.id,nome:a.nome}));set('efx_confirmado',String(Date.now()));fechar();sairChatwoot().then(function(){location.href=url;});}

/* ---- botao fixo e confirmacao horaria ---- */
function botao(){if(!chave()||document.getElementById('efx-troca-btn'))return;var a=atual();
var b=el('button','position:fixed;top:8px;right:12px;z-index:9998;min-height:36px;padding:0 14px;border:0;border-radius:18px;background:#0f4c40;color:#fff;font:600 13px Inter,system-ui,sans-serif;box-shadow:0 2px 8px rgba(0,0,0,.2);cursor:pointer',a?'Atendendo: '+a.nome+' ▾':'Escolher atendente ▾');
b.id='efx-troca-btn';b.onclick=telaLista;document.body.appendChild(b);}
function verificarHora(){if(!chave()||document.getElementById('efx-troca'))return;var a=atual();if(!a)return;var t=Number(get('efx_confirmado')||0);
if(Date.now()-t>HORA&&location.pathname.indexOf('/app/login')<0)telaPin(a,'confirmar');}

function iniciar(){if(location.hash==='#ativar-aparelho'){telaAtivar();return;}if(!chave())return;botao();verificarHora();}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',iniciar);else iniciar();
setInterval(function(){if(chave()){botao();verificarHora();}},30000);
window.addEventListener('hashchange',function(){if(location.hash==='#ativar-aparelho')telaAtivar();});
})();
