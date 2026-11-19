export function initNodePickerFixture() {
  localStorage.setItem('thoughtdag.seeded', 'yes');
  localStorage.setItem('thoughtdag.tutorialDone', '1');
  localStorage.setItem('thoughtdag.lang', 'zh');
  // Use the same module instance as the mounted app when Vite versions its URLs.
  performance.setResourceTimingBufferSize(2048);
  window.__importLive = path => import([...performance.getEntriesByType('resource')].reverse()
    .find(entry => new URL(entry.name).pathname === path)?.name ?? path);
}

/** Playwright bridge for node pickers. Discovery still goes through the app's catalog refresh. */
export function installNodeAgentCatalog(models) {
  window.desktopAgents = {
    models: async runtime => {
      const prefix = `${runtime}/`;
      const entries = models.filter(model => model.id.startsWith(prefix)).map(model => {
        const [, provider, id] = model.id.split('/');
        return { ...model, provider, id, name: model.name.split(' · ').at(-1) };
      });
      return { installed: entries.length > 0, models: entries, default: entries[0]?.id ?? null };
    },
  };
}
