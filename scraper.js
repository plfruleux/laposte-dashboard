const puppeteer = require('puppeteer');
const fs = require('fs');

const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const randomWait = () => wait(500 + Math.random() * 2500);

async function clickButtonByText(page, text) {
    const clicked = await page.$$eval('button, input[type="submit"]', (elements, searchText) => {
        const el = elements.find(el => 
            el.textContent.includes(searchText) || el.value.includes(searchText)
        );
        if (el) {
            el.click();
            return true;
        }
        return false;
    }, text);
    return clicked;
}

async function checkPageState(page) {
    return await page.evaluate(() => {
        const bodyText = document.body.innerText || '';
        if (bodyText.includes('une erreur est survenue') || 
            bodyText.includes('Erreur technique') ||
            bodyText.includes('service momentanément indisponible') ||
            bodyText.includes('Veuillez réessayer')) {
            return 'error';
        }
        const all = document.querySelectorAll('div, tr, li');
        let emailCount = 0;
        for (const el of all) {
            if (el.textContent.includes('@') && el.offsetHeight > 20) {
                emailCount++;
                if (emailCount >= 2) return 'logged_in';
            }
        }
        if (document.querySelector('input[type="password"]') || 
            document.querySelector('input[type="email"]') ||
            document.querySelector('input[id*="login"]')) {
            return 'login_page';
        }
        return 'unknown';
    });
}

async function performLogin(page) {
    console.log('🔐 Tentative de connexion...');
    const client = await page.target().createCDPSession();
    await client.send('Network.clearBrowserCookies');
    await client.send('Network.clearBrowserCache');
    
    await page.goto('https://www.laposte.net/accueil', { waitUntil: 'networkidle2', timeout: 30000 });
    await randomWait();

    try {
        const cookieBtn = await page.$('#didomi-notice-agree-button');
        if (cookieBtn) { await cookieBtn.click(); await randomWait(); }
    } catch (e) {}

    console.log('📧 Saisie email...');
    let emailInput = await page.$('input[id*="login"]') || 
                     await page.$('input[type="email"]') || 
                     (await page.$$('input[type="text"]'))[0];
    if (!emailInput) throw new Error('Champ email introuvable');
    
    const email = process.env.LAPOSTE_EMAIL;
    for (const char of email) {
        await emailInput.type(char, { delay: 50 + Math.random() * 100 });
    }
    await randomWait();

    console.log('🔘 Validation email...');
    let clicked = await clickButtonByText(page, 'Suivant') || 
                  await clickButtonByText(page, 'Continuer') || 
                  await clickButtonByText(page, 'Valider');
    if (!clicked) {
        const submitBtn = await page.$('button[type="submit"], input[type="submit"]');
        if (submitBtn) await submitBtn.click();
        else await page.keyboard.press('Enter');
    }
    await wait(3000 + Math.random() * 2000);

    const stateAfterEmail = await checkPageState(page);
    if (stateAfterEmail === 'error') throw new Error('Erreur LaPoste après email');

    console.log('🔐 Saisie mot de passe...');
    let passwordInput = await page.$('input[type="password"]');
    if (!passwordInput) {
        await page.waitForSelector('input[type="password"]', { timeout: 10000 });
        passwordInput = await page.$('input[type="password"]');
    }
    if (!passwordInput) throw new Error('Champ mot de passe introuvable');
    
    const password = process.env.LAPOSTE_PASSWORD;
    for (const char of password) {
        await passwordInput.type(char, { delay: 50 + Math.random() * 100 });
    }
    await randomWait();

    console.log('🔘 Connexion finale...');
    let submitted = await clickButtonByText(page, 'Connexion') || 
                    await clickButtonByText(page, 'Se connecter');
    if (!submitted) {
        const submitBtn = await page.$('button[type="submit"], input[type="submit"]');
        if (submitBtn) await submitBtn.click();
        else await page.keyboard.press('Enter');
    }
    await wait(10000 + Math.random() * 5000);
}

async function waitForNoOverlay(page) {
    console.log('⏳ Attente disparition overlay de chargement...');
    const overlaySelectors = [
        '.loading-overlay', '.spinner', '[class*="loading"]', '[class*="spinner"]',
        '.m-loading', '.laposte-loading', '#loading', '.overlay'
    ];
    try {
        await page.waitForFunction((selectors) => {
            for (const sel of selectors) {
                const el = document.querySelector(sel);
                if (el && el.offsetParent !== null) return false;
            }
            return true;
        }, { timeout: 30000, polling: 'raf' }, overlaySelectors);
        console.log('✅ Overlay disparu');
    } catch (e) {
        console.log('⚠️ Overlay toujours présent après 30s, suppression manuelle');
        await page.evaluate((selectors) => {
            selectors.forEach(sel => {
                document.querySelectorAll(sel).forEach(el => el.remove());
            });
            document.querySelectorAll('*').forEach(el => {
                const style = window.getComputedStyle(el);
                if ((style.position === 'fixed' || style.position === 'absolute') && 
                    parseFloat(style.opacity) < 1 && 
                    el.offsetWidth > window.innerWidth * 0.5 && 
                    el.offsetHeight > window.innerHeight * 0.5) {
                    el.remove();
                }
            });
        }, overlaySelectors);
        await wait(2000);
    }
}

async function findEmailRows(page) {
    return await page.evaluate(() => {
        const candidates = [];
        document.querySelectorAll('*').forEach(el => {
            const text = el.textContent || '';
            if (!text.includes('@')) return;
            const rect = el.getBoundingClientRect();
            if (rect.width === 0 || rect.height === 0) return;
            if (rect.height < 15 || rect.height > 150) return;
            const style = window.getComputedStyle(el);
            if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return;
            candidates.push({ top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right });
        });
        candidates.sort((a, b) => a.top - b.top);
        const filtered = [];
        candidates.forEach(c => {
            const isInside = filtered.some(f => 
                c.top >= f.top - 2 && c.bottom <= f.bottom + 2 && c.left >= f.left - 2 && c.right <= f.right + 2
            );
            if (!isInside) filtered.push(c);
        });
        return filtered.slice(0, 5);
    });
}

async function scrapeLaposteEmails() {
    console.log('🚀 Démarrage...');
    
    const browser = await puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--disable-gpu','--disable-blink-features=AutomationControlled']
    });
    
    const page = await browser.newPage();
    await page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => false });
        Object.defineProperty(navigator, 'plugins', { get: () => [1,2,3,4,5] });
        Object.defineProperty(navigator, 'languages', { get: () => ['fr-FR','fr'] });
        window.chrome = { runtime: {} };
    });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.setViewport({ width: 1600, height: 1200 });
    
    // Connexion avec 3 tentatives
    for (let i = 0; i < 3; i++) {
        console.log(`\n🔄 Tentative ${i+1}/3`);
        try {
            await page.goto('https://www.laposte.net/accueil', { waitUntil: 'networkidle2', timeout: 30000 });
            await wait(3000);
            let state = await checkPageState(page);
            if (state === 'error') { await wait(30000); continue; }
            if (state !== 'logged_in') {
                await performLogin(page);
                state = await checkPageState(page);
            }
            if (state === 'logged_in') break;
        } catch (e) {
            if (i === 2) throw e;
            await wait(15000);
        }
    }

    const html = await page.content();
    fs.writeFileSync('debug_page.html', html);
    console.log('📄 debug_page.html sauvegardé');

    await waitForNoOverlay(page);
    await wait(2000);

    console.log('🔍 Recherche des lignes emails...');
    let rows = await findEmailRows(page);

    if (rows.length < 3) {
        console.log(`⚠️ Seulement ${rows.length} ligne(s) détectée(s). Capture plein écran pour diagnostic.`);
        await page.screenshot({ path: 'screenshot.png', fullPage: false });
        fs.writeFileSync('latest_5.json', JSON.stringify({ lastUpdate: new Date().toISOString(), emails: [], error: `only ${rows.length} rows` }));
        return;
    }

    console.log(`✅ ${rows.length} lignes trouvées`);

    const top = rows[0].top;
    const bottom = rows[rows.length-1].bottom;
    const left = Math.min(...rows.map(r => r.left));
    const right = Math.max(...rows.map(r => r.right));
    const height = bottom - top;
    const width = right - left;

    const margin = 15;
    const clipHeight = height + 2 * margin;
    const clipWidth = Math.round(clipHeight * 16 / 9);
    const centerX = (left + right) / 2;
    const clipLeft = Math.max(0, centerX - clipWidth / 2);
    const clipTop = Math.max(0, top - margin);

    const clip = {
        x: clipLeft,
        y: clipTop,
        width: Math.min(clipWidth, 1600 - clipLeft),
        height: clipHeight
    };

    console.log(`📸 Capture 16:9 : x=${clip.x}, y=${clip.y}, w=${clip.width}, h=${clip.height}`);
    await page.screenshot({ path: 'screenshot.png', clip });
    console.log('📸 Capture sauvegardée');

    // Extraction JSON
    const emailData = await page.evaluate((rows) => {
        const results = [];
        rows.forEach(r => {
            const el = document.elementFromPoint(r.left + 1, r.top + 1);
            if (!el) return;
            const text = el.textContent || '';
            const emailMatch = text.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
            const from = emailMatch ? emailMatch[0] : '';
            const dateMatch = text.match(/(\d{2}:\d{2})/) || text.match(/(\d{2}\/\d{2}\/\d{4})/) || text.match(/(Aujourd'hui|Hier)/i);
            const date = dateMatch ? dateMatch[1] : '';
            const preview = text.substring(0, 30).replace(from, '').replace(date, '');
            results.push({ from, date, preview });
        });
        return results;
    }, rows);
    fs.writeFileSync('latest_5.json', JSON.stringify({ lastUpdate: new Date().toISOString(), emails: emailData }));
    console.log(`✅ ${emailData.length} emails extraits`);
}

scrapeLaposteEmails();
