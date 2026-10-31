import tempfile

def launch(p, ext):
    # Chrome ya no acepta --load-extension: la extensión entra por CDP.
    ctx = p.chromium.launch_persistent_context(tempfile.mkdtemp(), channel='chromium', headless=True,
        args=['--enable-unsafe-extension-debugging'], ignore_default_args=['--disable-extensions'])
    ctx.browser.new_browser_cdp_session().send('Extensions.loadUnpacked', {'path': ext})
    sw = ctx.service_workers[0] if ctx.service_workers else ctx.wait_for_event('serviceworker')
    return ctx, sw

def badge(page):
    # El indicador está en un Shadow DOM closed: solo CDP con pierce llega a su texto.
    cdp = page.context.new_cdp_session(page)
    try:
        root = cdp.send('DOM.getDocument', {'depth': -1, 'pierce': True})['root']
    finally:
        cdp.detach()
    def find(n, inside):
        attrs = n.get('attributes', [])
        if inside and 'class' in attrs and attrs[attrs.index('class') + 1] == 'msg':
            return ''.join(c.get('nodeValue', '') for c in n.get('children', []) if c['nodeType'] == 3)
        inside = inside or ('id' in attrs and attrs[attrs.index('id') + 1] == '__ait_badge__')
        for c in n.get('children', []) + n.get('shadowRoots', []):
            r = find(c, inside)
            if r is not None: return r
        return None
    return find(root, False)
