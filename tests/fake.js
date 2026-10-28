globalThis.__nanoLog = [];
globalThis.LanguageModel = {
  availability: async (o) => 'available',
  create: async (o) => {
    const sys = o.initialPrompts ? o.initialPrompts[0].content : '';
    globalThis.__nanoLog.push({ create: o.expectedInputs, out: o.expectedOutputs });
    const mk = () => ({
      clone: async () => mk(),
      destroy() {},
      prompt: async (user, opt) => {
        globalThis.__nanoLog.push({ schema: !!(opt && opt.responseConstraint) });
        if (sys.includes('You analyze')) return JSON.stringify({ pageType: 'documentation', topic: 't', domain: 'd', tone: 'x', keepVerbatim: ['Magento'], glossary: [{ source: 'module', target: 'módulo' }], notes: '' });
        const items = JSON.parse(user); const r = {};
        for (const it of items) r[it.id] = 'NANO:' + it.t.replace(/(<\/?g\d+>|<x\d+\/>)|([^<]+)/g, (m, tag, txt) => tag ? tag : txt.toUpperCase());
        return JSON.stringify(r);
      },
    });
    return mk();
  },
};
