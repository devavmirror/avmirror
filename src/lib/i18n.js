const translations = {
  pt: {
    catalogNames: {
      recentes: "🌐 Recentes",
      populares: "🔥 Populares",
      semCensura: "🟣 Sem Censura"
    },
    support: {
      streamName: "Apoie o AVMirror",
      streamTitle: "Ajude a manter o addon",
      metaLinkName: "Apoie o AVMirror"
    },
    addon: {
      name: "AVMirror Local",
      namePublic: "AVMirror",
      descriptionLocal: "AVMirror Local — Jav • Quality • Content.",
      descriptionPublic: "AVMirror — Jav • Quality • Content."
    },
    configure: {
      title: "Configurar AVMirror",
      subtitle: "Escolha o idioma e instale o addon",
      language: "Idioma",
      preview: "Preview dos catálogos",
      install: "Instalar no Stremio",
      configureNuvio: "Configurar Nuvio",
      copyManifest: "Copiar manifesto",
      manifestCopied: "Manifesto copiado.",
      status: "Status",
      checking: "Verificando...",
      onlineLocal: "Conectado ao servidor local.",
      onlineRemote: "Modo online ativo.",
      online: "Online",
      stremioSection: "Stremio",
      stremioDesc: "Copie o manifesto abaixo e adicione no Stremio.",
      nuvioSection: "Nuvio",
      nuvioDesc: "Adicione o manifesto abaixo no Nuvio.",
      copyNuvio: "Copiar manifesto Nuvio",
      opening: "Abrindo Stremio...",
      footerVersion: "AVMirror",
      footerManifest: "Manifesto",
      footerGitHub: "GitHub"
    }
  },
  en: {
    catalogNames: {
      recentes: "🌐 Recent",
      populares: "🔥 Popular",
      semCensura: "🟣 Uncensored"
    },
    support: {
      streamName: "Support AVMirror",
      streamTitle: "Help keep the addon running",
      metaLinkName: "Support AVMirror"
    },
    addon: {
      name: "AVMirror Local",
      namePublic: "AVMirror",
      descriptionLocal: "AVMirror Local — Jav • Quality • Content.",
      descriptionPublic: "AVMirror — Jav • Quality • Content."
    },
    configure: {
      title: "Configure AVMirror",
      subtitle: "Choose language and install the addon",
      language: "Language",
      preview: "Catalog preview",
      install: "Install on Stremio",
      configureNuvio: "Configure Nuvio",
      copyManifest: "Copy manifest",
      manifestCopied: "Manifest copied.",
      status: "Status",
      checking: "Checking...",
      onlineLocal: "Connected to local server.",
      onlineRemote: "Online mode active.",
      online: "Online",
      stremioSection: "Stremio",
      stremioDesc: "Copy the manifest below and add it to Stremio.",
      nuvioSection: "Nuvio",
      nuvioDesc: "Add the manifest below to Nuvio.",
      copyNuvio: "Copy Nuvio manifest",
      opening: "Opening Stremio...",
      footerVersion: "AVMirror",
      footerManifest: "Manifest",
      footerGitHub: "GitHub"
    }
  }
};

function t(lang, path) {
  const l = translations[lang] || translations.pt;
  return path.split('.').reduce((obj, key) => obj?.[key], l) || path;
}

function getLang(req) {
  if (!req) return 'pt';
  const q = req.query?.lang;
  if (q === 'en' || q === 'pt') return q;
  const accept = req.headers?.['accept-language'] || '';
  if (accept.toLowerCase().startsWith('en')) return 'en';
  return 'pt';
}

module.exports = { t, getLang, translations };
