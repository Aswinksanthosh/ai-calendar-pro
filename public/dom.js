// Tiny element builder. Strings become text nodes, so user text can never inject HTML.
export function h(tag, props = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'style') {
      for (const [a, b] of Object.entries(v)) a.startsWith('--') ? n.style.setProperty(a, b) : (n.style[a] = b);
    } else if (k.startsWith('on')) n[k] = v;
    else if (k in n) n[k] = v;
    else n.setAttribute(k, v);
  }
  n.append(...kids.flat().filter((x) => x != null && x !== false));
  return n;
}

export const $ = (id) => document.getElementById(id);

export const store = {
  get(key, fallback) {
    try { const v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage may be blocked */ }
  },
};
