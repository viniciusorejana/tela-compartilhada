const fs = require('node:fs/promises');

// Only this fixed artifact is exposed; never a path supplied by a request.
module.exports = function desktopDownload(app, file) {
  const url = '/downloads/SalaCompartilhada.exe';
  async function artifact() {
    try {
      const info = await fs.stat(file);
      return info.isFile() && info.size > 0 ? info : null;
    } catch (error) {
      if (['ENOENT', 'ENOTDIR'].includes(error.code)) return null;
      throw error;
    }
  }
  app.get('/api/desktop-app', async (_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    try {
      const info = await artifact();
      res.json(info ? { available: true, url, size: info.size, builtAt: info.mtime.toISOString(), platform: 'Windows x64' }
        : { available: false });
    } catch (error) { next(error); }
  });
  app.get(url, async (_req, res, next) => {
    res.set({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    try {
      if (!await artifact()) return res.status(503).type('text').send('O aplicativo para Windows ainda não está disponível. Você pode entrar na sala pelo navegador.');
      res.download(file, 'SalaCompartilhada.exe', { cacheControl: false }, error => {
        if (!error || res.headersSent || error.code === 'ECONNABORTED') return;
        if (error.code === 'ENOENT') res.status(503).send('Download temporariamente indisponível. Tente novamente.');
        else next(error);
      });
    } catch (error) { next(error); }
  });
};
