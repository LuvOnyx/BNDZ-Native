/**
 * Iconify on-demand fallbacks — used only when native shell icons are unavailable.
 * - devicon: code / markup extensions ([devicon set](https://icon-sets.iconify.design/devicon/))
 * - skill-icons: application brands ([skill-icons set](https://icon-sets.iconify.design/skill-icons/))
 */

/** Devicon — code & markup types where a branded glyph adds clarity over generic shell icons */
const DEVICON_EXT: Record<string, string> = {
  js: 'devicon:javascript-plain',
  mjs: 'devicon:javascript-plain',
  cjs: 'devicon:javascript-plain',
  jsx: 'devicon:react-original',
  ts: 'devicon:typescript-plain',
  tsx: 'devicon:react-original',
  html: 'devicon:html5-plain',
  htm: 'devicon:html5-plain',
  css: 'devicon:css3-plain',
  scss: 'devicon:sass-original',
  sass: 'devicon:sass-original',
  less: 'devicon:less-plain-wordmark',
  json: 'devicon:json-plain',
  jsonc: 'devicon:json-plain',
  xml: 'devicon:xml-plain',
  svg: 'devicon:html5-plain',
  py: 'devicon:python-plain',
  rb: 'devicon:ruby-plain',
  go: 'devicon:go-original-wordmark',
  rs: 'devicon:rust-plain',
  java: 'devicon:java-plain',
  kt: 'devicon:kotlin-plain',
  cs: 'devicon:csharp-plain',
  cpp: 'devicon:cplusplus-plain',
  cc: 'devicon:cplusplus-plain',
  cxx: 'devicon:cplusplus-plain',
  c: 'devicon:c-plain',
  h: 'devicon:c-plain',
  hpp: 'devicon:cplusplus-plain',
  php: 'devicon:php-plain',
  sql: 'devicon:mysql-plain',
  vue: 'devicon:vuejs-plain',
  svelte: 'devicon:svelte-plain',
  wasm: 'devicon:webassembly-plain',
  dockerfile: 'devicon:docker-plain',
  yaml: 'devicon:yaml-plain',
  yml: 'devicon:yaml-plain',
  toml: 'devicon:toml-plain',
  md: 'devicon:markdown-plain',
};

export const ICONIFY_PATH_PREFIX = 'iconify:';

/** Known Iconify id renames / fallbacks when primary id 404s */
const ICONIFY_ALIASES: Record<string, string[]> = {
  'devicon:html5-plain': ['devicon:html5', 'logos:html-5'],
  'devicon:less-plain-wordmark': ['devicon:less', 'logos:less'],
  'devicon:go-original-wordmark': ['devicon:go', 'logos:go'],
  'devicon:cplusplus-plain': ['devicon:cplusplus', 'logos:c-plusplus'],
  'devicon:webassembly-plain': ['devicon:wasm', 'logos:webassembly-icon'],
  'devicon:markdown-plain': ['devicon:markdown', 'logos:markdown'],
  'devicon:json-plain': ['devicon:json', 'logos:json'],
  'devicon:xml-plain': ['devicon:xml', 'logos:xml'],
  'devicon:yaml-plain': ['devicon:yaml', 'logos:yaml'],
  'devicon:toml-plain': ['devicon:toml'],
};

export function toIconifyLibraryPath(iconId: string): string {
  return `${ICONIFY_PATH_PREFIX}${iconId}`;
}

export function parseIconifyLibraryPath(path: string): string | null {
  if (!path?.startsWith(ICONIFY_PATH_PREFIX)) return null;
  return path.slice(ICONIFY_PATH_PREFIX.length) || null;
}

/** Unique devicon entries for Icon Studio starter library */
export function listDeviconLibraryEntries(): Array<{ name: string; iconId: string }> {
  const seen = new Set<string>();
  const out: Array<{ name: string; iconId: string }> = [];
  for (const [ext, iconId] of Object.entries(DEVICON_EXT)) {
    if (seen.has(iconId)) continue;
    seen.add(iconId);
    const label = iconId.replace(/^devicon:/, '').replace(/-plain|-original|-wordmark/g, '').replace(/-/g, ' ');
    out.push({ name: label || ext, iconId });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** Unique skill-icons entries for Icon Studio starter library */
export function listSkillIconLibraryEntries(): Array<{ name: string; iconId: string }> {
  const seen = new Set<string>();
  const out: Array<{ name: string; iconId: string }> = [];
  for (const [app, slug] of Object.entries(SKILL_APP_SLUG)) {
    const iconId = `skill-icons:${slug}`;
    if (seen.has(iconId)) continue;
    seen.add(iconId);
    out.push({ name: app, iconId });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** skill-icons slug by normalized app / folder / exe stem (dark-theme variants applied at fetch) */
const SKILL_APP_SLUG: Record<string, string> = {
  docker: 'docker',
  discord: 'discord',
  discordptb: 'discord',
  discordcanary: 'discord',
  electron: 'electron',
  nginx: 'nginx',
  node: 'nodejs',
  nodejs: 'nodejs',
  npm: 'npm',
  npx: 'npm',
  python: 'python',
  python3: 'python',
  java: 'java',
  kotlin: 'kotlin',
  android: 'androidstudio',
  androidstudio: 'androidstudio',
  vscode: 'vscode',
  'visualstudiocode': 'vscode',
  code: 'vscode',
  cursor: 'vscode',
  webstorm: 'webstorm',
  pycharm: 'pycharm',
  idea: 'idea',
  intellij: 'idea',
  rust: 'rust',
  golang: 'golang',
  go: 'golang',
  ruby: 'ruby',
  rails: 'rails',
  php: 'php',
  laravel: 'laravel',
  symfony: 'symfony',
  dotnet: 'dotnet',
  unity: 'unity',
  unreal: 'unrealengine',
  blender: 'blender',
  godot: 'godot',
  steam: 'steam',
  spotify: 'spotify',
  slack: 'slack',
  teams: 'teams',
  zoom: 'zoom',
  figma: 'figma',
  sketch: 'sketch',
  photoshop: 'photoshop',
  premiere: 'premiere',
  aftereffects: 'aftereffects',
  audition: 'audition',
  illustrator: 'illustrator',
  indesign: 'indesign',
  lightroom: 'lightroom',
  obs: 'obs',
  obsstudio: 'obs',
  twitch: 'twitch',
  youtube: 'youtube',
  chrome: 'chrome',
  chromium: 'chromium',
  firefox: 'firefox',
  brave: 'brave',
  edge: 'edge',
  safari: 'safari',
  postman: 'postman',
  insomnia: 'insomnia',
  git: 'git',
  github: 'github',
  gitlab: 'gitlab',
  bitbucket: 'bitbucket',
  terraform: 'terraform',
  ansible: 'ansible',
  kubernetes: 'kubernetes',
  aws: 'aws',
  azure: 'azure',
  gcp: 'gcp',
  mongodb: 'mongodb',
  postgres: 'postgresql',
  postgresql: 'postgresql',
  mysql: 'mysql',
  redis: 'redis',
  elasticsearch: 'elasticsearch',
  kafka: 'kafka',
  rabbitmq: 'rabbitmq',
  nginxproxy: 'nginx',
  webpack: 'webpack',
  vite: 'vitejs',
  vitejs: 'vitejs',
  rollup: 'rollup',
  babel: 'babel',
  eslint: 'eslint',
  prettier: 'prettier',
  jest: 'jest',
  cypress: 'cypress',
  playwright: 'playwright',
  tailwind: 'tailwindcss',
  tailwindcss: 'tailwindcss',
  bootstrap: 'bootstrap',
  sass: 'sass',
  less: 'less',
  wordpress: 'wordpress',
  shopify: 'shopify',
  next: 'nextjs',
  nextjs: 'nextjs',
  nuxt: 'nuxtjs',
  nuxtjs: 'nuxtjs',
  angular: 'angular',
  svelte: 'svelte',
  astro: 'astro',
  remix: 'remix',
  bun: 'bun',
  deno: 'deno',
  flutter: 'flutter',
  dart: 'dart',
  swift: 'swift',
  xcode: 'xcode',
  apple: 'apple',
  windows: 'windows',
  linux: 'linux',
  ubuntu: 'ubuntu',
  debian: 'debian',
  arch: 'arch',
  fedora: 'fedora',
};

const svgCache = new Map<string, string>();
const inflight = new Map<string, Promise<string | null>>();

function normalizeAppKey(name: string): string {
  return (name || '')
    .replace(/\.(exe|lnk|msi|app|bat|cmd)$/i, '')
    .replace(/[^a-z0-9]/gi, '')
    .toLowerCase();
}

export function getDeviconIdForExtension(ext: string): string | null {
  const key = (ext || '').toLowerCase().replace(/^\./, '');
  return DEVICON_EXT[key] || null;
}

/** @deprecated use getDeviconIdForExtension */
export function getIconifyIdForExtension(ext: string): string | null {
  return getDeviconIdForExtension(ext);
}

export function getSkillIconIdForApp(name: string): string | null {
  const key = normalizeAppKey(name);
  if (!key) return null;
  const slug = SKILL_APP_SLUG[key];
  if (!slug) return null;
  return `skill-icons:${slug}`;
}

export async function fetchIconifySvg(iconId: string): Promise<string | null> {
  if (!iconId) return null;
  if (svgCache.has(iconId)) {
    const cached = svgCache.get(iconId)!;
    return cached || null;
  }

  const pending = inflight.get(iconId);
  if (pending) return pending;

  const promise = (async () => {
    const idsToTry: string[] = [iconId];
    const aliases = ICONIFY_ALIASES[iconId];
    if (aliases) idsToTry.push(...aliases);
    if (iconId.startsWith('skill-icons:') && !iconId.endsWith('-dark') && !iconId.endsWith('-light')) {
      const base = iconId.replace('skill-icons:', '');
      idsToTry.unshift(`skill-icons:${base}-dark`, `skill-icons:${base}-light`);
    }
    if (iconId.startsWith('devicon:') && iconId.includes('-plain')) {
      idsToTry.push(iconId.replace('-plain', '').replace('-wordmark', ''));
    }

    const unique = [...new Set(idsToTry)];
    for (const id of unique) {
      if (svgCache.has(id)) {
        const hit = svgCache.get(id)!;
        if (hit) {
          svgCache.set(iconId, hit);
          return hit;
        }
        continue;
      }
      try {
        const res = await fetch(`https://api.iconify.design/${id}.svg`, { cache: 'force-cache' });
        if (res.ok) {
          const svg = await res.text();
          if (svg) {
            svgCache.set(iconId, svg);
            svgCache.set(id, svg);
            return svg;
          }
        }
        // Negative-cache misses so remounts / alias retries don't spam the network.
        svgCache.set(id, '');
      } catch {
        svgCache.set(id, '');
      }
    }
    svgCache.set(iconId, '');
    return null;
  })().finally(() => inflight.delete(iconId));

  inflight.set(iconId, promise);
  return promise;
}

export function iconifySvgToDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
