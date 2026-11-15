/* FitWay — painel de administração. Só é baixado por quem é admin; o servidor confere de novo a cada chamada. */
(function () {
  "use strict";
  const { shell } = window.FitWay;
  window.FitWayAdmin = {
    render() { shell("Admin", `<p class="muted" style="margin-top:16px">Painel em construção.</p>`, "admin"); },
  };
})();
