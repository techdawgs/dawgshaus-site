(function () {
  const host = document.getElementById("site-nav");
  if (!host) return;

  const path = (location.pathname || "/").replace(/\/+$/, "/"); // normalize trailing slash
  const is = (p) => path === p;

  const nav = document.createElement("nav");
  nav.className = "site-nav";
  nav.setAttribute("aria-label", "Site");

  nav.innerHTML = `
    <a href="/" ${is("/") ? 'aria-current="page"' : ""}>Home</a>
    <a href="/projects/" ${is("/projects/") ? 'aria-current="page"' : ""}>Projects</a>
    <a href="/about/" ${is("/about/") ? 'aria-current="page"' : ""}>About</a>
    <a href="/contact/" ${is("/contact/") ? 'aria-current="page"' : ""}>Contact</a>
    <a href="https://github.com/techdawgs" target="_blank" rel="noreferrer">GitHub</a>
  `;

  host.replaceChildren(nav);
})();
