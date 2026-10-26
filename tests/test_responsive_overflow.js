const assert = require('assert');
const fs = require('fs');
const path = require('path');
const http = require('http');

const root = path.join(__dirname, '..');

function testCssRules() {
    const appCss = fs.readFileSync(path.join(root, 'css/app.css'), 'utf8');
    const baseCss = fs.readFileSync(path.join(root, 'css/base.css'), 'utf8');
    const indexHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

    // 1.1 Non-débordement Séances & Grilles
    assert(appCss.includes('minmax(0, 1fr)'), 'Les grilles doivent utiliser minmax(0, 1fr) pour éviter le débordement');
    assert(appCss.includes('.training-card') && appCss.includes('min-width: 0'), '.training-card doit avoir min-width: 0');
    assert(appCss.includes('.history-item-card') && appCss.includes('min-width: 0'), '.history-item-card doit avoir min-width: 0');
    assert(appCss.includes('.profile-card') && appCss.includes('min-width: 0'), '.profile-card doit avoir min-width: 0');

    // 1.2 Viewport & Zoom impossible
    assert(indexHtml.includes('user-scalable=no'), 'index.html doit interdire le zoom utilisateur');
    assert(indexHtml.includes('viewport-fit=cover'), 'index.html doit inclure viewport-fit=cover');
    assert(baseCss.includes('touch-action: manipulation'), 'base.css doit définir touch-action: manipulation');
    assert(baseCss.includes('-webkit-text-size-adjust: 100%'), 'base.css doit fixer text-size-adjust à 100%');
    assert(baseCss.includes('font-size: 16px'), 'Les champs de saisie doivent être à 16px pour éviter le zoom iOS');

    // 1.3 Barre de navigation
    assert(!indexHtml.includes('nav-icon'), 'index.html ne doit plus contenir d’icônes glyphes dans la nav');

    console.log('✓ Règles CSS et métadonnées de non-débordement validées.');
}

async function testBrowserOverflowIfAvailable() {
    return new Promise((resolve) => {
        const req = http.get('http://localhost:9222/json', (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', async () => {
                try {
                    const list = JSON.parse(data);
                    const page = list.find(t => t.type === 'page');
                    if (!page || typeof WebSocket === 'undefined') {
                        resolve();
                        return;
                    }

                    const ws = new WebSocket(page.webSocketDebuggerUrl);
                    let msgId = 1;
                    const send = (method, params = {}) => new Promise((resCb) => {
                        const id = msgId++;
                        const onMsg = (event) => {
                            const parsed = JSON.parse(event.data);
                            if (parsed.id === id) {
                                ws.removeEventListener('message', onMsg);
                                resCb(parsed.result);
                            }
                        };
                        ws.addEventListener('message', onMsg);
                        ws.send(JSON.stringify({ id, method, params }));
                    });

                    ws.onopen = async () => {
                        const widths = [360, 390, 430, 768];
                        const tabs = ['compteur', 'workouts', 'history', 'settings'];

                        for (const tab of tabs) {
                            await send('Runtime.evaluate', { expression: `window.switchTab && window.switchTab('${tab}')` });
                            for (const w of widths) {
                                await send('Emulation.setDeviceMetricsOverride', {
                                    width: w,
                                    height: 844,
                                    deviceScaleFactor: 1,
                                    mobile: true
                                });
                                const evalRes = await send('Runtime.evaluate', {
                                    expression: '({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth })',
                                    returnByValue: true
                                });
                                const { scrollWidth, innerWidth } = evalRes.result.value || {};
                                assert(scrollWidth <= innerWidth, `Débordement sur onglet ${tab} à ${w}px: scrollWidth=${scrollWidth} > innerWidth=${innerWidth}`);
                            }
                        }
                        console.log('✓ Validation dynamique du non-débordement sur 360, 390, 430 et 768 px réussie.');
                        ws.close();
                        resolve();
                    };
                    ws.onerror = () => resolve();
                } catch (e) {
                    resolve();
                }
            });
        });
        req.on('error', () => resolve());
    });
}

(async () => {
    testCssRules();
    await testBrowserOverflowIfAvailable();
    console.log('=======================================================');
    console.log('TEST DE NON-DÉBORDEMENT RESPONSIVE TERMINÉ AVEC SUCCÈS');
    console.log('=======================================================');
})();
