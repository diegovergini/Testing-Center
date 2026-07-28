/* Perfil em uso e o que ele pode ver/editar em cada janela.
   Sem servidor, isto guia a interface — não é controle de acesso. Quem abrir o console
   ou o backup JSON alcança tudo. Vale como organização do trabalho, não como segurança. */
(function (global) {
  'use strict';

  var TC = (global.TC = global.TC || {});

  function perfilAtual(estado) {
    return (estado && estado.perfilAtual) || 'TESTES';
  }

  function regra(estado, rota) {
    var mapa = (estado && estado.permissoes) || TC.data.PERMISSOES_PADRAO;
    return mapa[rota] || { ver: [], editar: [] };
  }

  function podeVer(estado, rota) {
    return regra(estado, rota).ver.indexOf(perfilAtual(estado)) !== -1;
  }

  /* Editar exige também poder ver: uma janela invisível não é editável. */
  function podeEditar(estado, rota) {
    return podeVer(estado, rota) && regra(estado, rota).editar.indexOf(perfilAtual(estado)) !== -1;
  }

  function nomeDoPerfil(perfilId) {
    var p = TC.util.porId(TC.data.PERFIS, perfilId);
    return p ? p.nome : perfilId;
  }

  TC.permissoes = {
    perfilAtual: perfilAtual,
    regra: regra,
    podeVer: podeVer,
    podeEditar: podeEditar,
    nomeDoPerfil: nomeDoPerfil
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = TC.permissoes;
})(typeof globalThis !== 'undefined' ? globalThis : this);
