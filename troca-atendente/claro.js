// Tema claro como padrão no Chatwoot (só quando a pessoa ainda não escolheu outro)
try { if (!localStorage.getItem('color_scheme')) localStorage.setItem('color_scheme', 'light'); } catch (e) {}
