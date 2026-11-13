/* Phone support for the full program (loaded last).
   - ☰ menu button for the top bar on a narrow screen
   - printing: Android Chrome cannot print the hidden frame the program uses, so on a phone/tablet
     the printed page is put into this page and the page itself is printed (only that part shows on paper) */
(function () {
  const isPhone = () => /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent) || matchMedia('(max-width: 760px)').matches;
  if (isPhone()) document.documentElement.classList.add('phone');

  /* ---------- menu */
  function addMenu() {
    const top = document.getElementById('top');
    if (!top || document.getElementById('phMenu')) return;
    const b = document.createElement('button');
    b.id = 'phMenu'; b.type = 'button'; b.textContent = '☰'; b.title = 'Menu';
    b.onclick = e => { e.stopPropagation(); document.body.classList.toggle('navopen'); };
    top.prepend(b);
    const nav = document.getElementById('nav');
    if (nav) nav.addEventListener('click', e => { if (e.target.closest('button')) document.body.classList.remove('navopen'); });
  }
  addMenu();
  // charts: drawn narrower and taller on a phone so the numbers stay readable
  if (typeof lineChart === 'function') { const lc = lineChart; window.lineChart = (s, t, W, H) => isPhone() ? lc(s, t, 420, 330) : lc(s, t, W, H); }
  window.addEventListener('hashchange', () => document.body.classList.remove('navopen'));
  document.addEventListener('click', e => { if (document.body.classList.contains('navopen') && !e.target.closest('#top')) document.body.classList.remove('navopen'); });

  /* ---------- printing */
  function printCss(css) {
    // @font-face and @page stay as they are; every other rule only applies when printing (so the screen is not changed)
    const keep = [];
    const rest = css.replace(/@font-face\s*\{[^}]*\}/g, m => { keep.push(m); return ''; })
                    .replace(/@page\s*\{[^}]*\}/g, m => { keep.push(m); return ''; });
    return keep.join('\n') + '\n@media print{' + rest + '}';
  }
  function printInPage(d) {
    let box = document.getElementById('prt');
    if (!box) { box = document.createElement('div'); box.id = 'prt'; document.body.appendChild(box); }
    const css = Array.from(d.querySelectorAll('style')).map(s => s.textContent).join('\n');
    box.innerHTML = '<style>' + printCss(css) + '</style>' + d.body.innerHTML;
    document.body.classList.add('printing');
    const done = () => { document.body.classList.remove('printing'); box.innerHTML = ''; };
    window.addEventListener('afterprint', done, { once: true });
    const fr = document.fonts;
    Promise.race([fr && fr.ready ? fr.ready : Promise.resolve(), new Promise(r => setTimeout(r, 1500))])
      .then(() => setTimeout(() => window.print(), 200));
  }
  window.printInPage = printInPage;
  // every print in the program goes through a hidden frame: on a phone its print() is replaced by printing in this page
  new MutationObserver(ms => {
    if (!isPhone()) return;
    ms.forEach(m => m.addedNodes.forEach(n => {
      if (n.tagName !== 'IFRAME' || !/width:\s*0/.test(n.getAttribute('style') || '')) return;
      Promise.resolve().then(() => {
        try { n.contentWindow.print = () => printInPage(n.contentDocument); } catch (e) { }
      });
    }));
  }).observe(document.body, { childList: true });
})();
