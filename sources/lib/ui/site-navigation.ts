const initialized = new WeakSet<HTMLElement>();

export function initSiteNavigation(): void {
  for (const nav of document.querySelectorAll<HTMLElement>('.site-nav')) {
    // Both page entry points initialize navigation on the production site.
    if (initialized.has(nav)) continue;
    initialized.add(nav);

    document.addEventListener('click', event => {
      const path = event.composedPath();
      for (const group of nav.querySelectorAll<HTMLDetailsElement>('details.nav-group[open]')) {
        if (!path.includes(group)) group.open = false;
      }
    });

    document.addEventListener('keydown', event => {
      if (event.key !== 'Escape') return;
      const openGroups = nav.querySelectorAll<HTMLDetailsElement>('details.nav-group[open]');
      if (!openGroups.length) return;
      for (const group of openGroups) {
        const restoreFocus = group.contains(document.activeElement);
        group.open = false;
        if (restoreFocus) group.querySelector('summary')?.focus();
      }
      event.preventDefault();
    });
  }
}
