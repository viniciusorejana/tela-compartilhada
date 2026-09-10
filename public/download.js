(() => {
  const link = document.getElementById('desktopDownload');
  const label = document.getElementById('desktopBuild');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  fetch('/api/desktop-app', { cache: 'no-store', signal: controller.signal })
    .then(response => { if (!response.ok) throw new Error('Unavailable'); return response.json(); })
    .then(build => {
      if (!build.available) {
        link.removeAttribute('href');
        link.setAttribute('aria-disabled', 'true');
        label.textContent = 'Download ainda indisponível. Você pode usar o navegador.';
        return;
      }
      const size = (build.size / (1024 * 1024)).toLocaleString('pt-BR', { maximumFractionDigits: 1 });
      const date = new Date(build.builtAt).toLocaleDateString('pt-BR');
      label.textContent = `Windows x64 · ${size} MB · build de ${date}`;
    })
    .catch(() => { label.textContent = 'Windows x64 · não foi possível consultar a build. Tente o download.'; })
    .finally(() => clearTimeout(timer));
})();
