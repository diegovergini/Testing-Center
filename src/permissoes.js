/* The role in use and what it can view/edit on each screen.
   With no server this guides the interface — it is not access control. Anyone who opens the
   console or the JSON backup reaches everything. It counts as organising the work, not as
   security. */
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

  /* The copy published for the team: data embedded in the file, the same for everyone and
     with nowhere to write. Everything can be read, nothing can be edited. */
  function publicada() {
    return !!(TC.PUBLICACAO && TC.PUBLICACAO.dados);
  }

  /* Editing also requires being able to view: an invisible screen is not editable. */
  function podeEditar(estado, rota) {
    if (publicada()) return false;
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
    publicada: publicada,
    nomeDoPerfil: nomeDoPerfil
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = TC.permissoes;
})(typeof globalThis !== 'undefined' ? globalThis : this);
