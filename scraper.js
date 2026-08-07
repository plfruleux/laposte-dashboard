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

async function scrapeLaposteEmails() {
    console.log('🚀 Démarrage du scraping LaPoste.net...');
    
    const browser = await puppeteer.launch({
        headless: 'new',
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--disable-blink-features=AutomationControlled'
        ]
    });
    
    const page = await browser.newPage();
    
    await page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => false });
        Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
        Object.defineProperty(navigator, 'languages', { get: () => ['fr-FR', 'fr'] });
        window.chrome = { runtime: {} };
    });
    
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.setViewport({ width: 1600, height: 1200 });
    
    let maxRetries = 3;
    let currentTry = 0;
    
    while (currentTry < maxRetries) {
        currentTry++;
        console.log(`\n🔄 Tentative ${currentTry}/${maxRetries}`);
        try {
            await page.goto('https://www.laposte.net/accueil', { waitUntil: 'networkidle2', timeout: 30000 });
            await wait(3000);
            let state = await checkPageState(page);
            console.log(`📊 État : ${state}`);
            if (state === 'error') { await wait(30000); continue; }
            if (state !== 'logged_in') {
                await performLogin(page);
                state = await checkPageState(page);
                console.log(`📊 État après login : ${state}`);
            }
            if (state === 'error') { await wait(30000); continue; }
            if (state !== 'logged_in') { await wait(10000); continue; }
            console.log('✅ Connecté');
            break;
        } catch (error) {
            console.log(`❌ Tentative ${currentTry}: ${error.message}`);
            if (currentTry === maxRetries) throw error;
            await wait(15000);
        }
    }

    // ---- NETTOYAGE DES PARASITES ----
    console.log('🧹 Nettoyage de l\'interface...');
    await page.evaluate(() => {
        const hideSelectors = [
            'nav', 'header', '.sidebar', '.left-panel', '.folder-list',
            '.navigation', '.menu', '[role="navigation"]', '#side-menu',
            '.advertisement', '.pub', '.banner', '[class*="ad-"]',
            '.toolbar', '.action-bar', '.search-bar',
            '.mail-footer', '.signature', '.disclaimer',
            '.compose-btn', '.write-btn', '.new-message',
            '.pagination', '.page-nav', 'footer'
        ];
        hideSelectors.forEach(sel => {
            document.querySelectorAll(sel).forEach(el => { el.style.display = 'none'; });
        });
    });
    await wait(1000);

    // ---- IDENTIFICATION DES 5 PREMIERS EMAILS (avant compactage) ----
    console.log('🔍 Identification des 5 premières lignes...');
    const foundRowsCount = await page.evaluate(() => {
        const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
        // Recherche robuste
        const selectors = [
            'tr[class*="mail"]', 'tr[class*="msg"]', 'tr[class*="message"]',
            'div[class*="mail-item"]', 'div[class*="message-item"]', 'div[class*="msg-item"]',
            'li[class*="mail"]', 'li[class*="msg"]', 'li[class*="message"]'
        ];
        let rows = [];
        for (const sel of selectors) {
            const nodes = document.querySelectorAll(sel);
            if (nodes.length > 1) { rows = Array.from(nodes); break; }
        }
        if (rows.length === 0) {
            // Fallback : tout élément contenant un @ et avec au moins 2 enfants
            const all = document.querySelectorAll('div, tr, li');
            rows = Array.from(all).filter(el => {
                return el.textContent.includes('@') && el.children.length >= 2 && el.offsetHeight > 25 && el.offsetHeight < 300;
            });
        }
        // Filtrer les lignes parasites
        rows = rows.filter(el => {
            const t = el.textContent || '';
            return !/Boîte de réception|Dossiers|Menu|Paramètres|Agenda|Contacts|Écrire un mail|Liste de mails|Sélection|Marquer tout comme lu|Vider le dossier|k-error|une erreur/i.test(t);
        });
        const firstFive = rows.slice(0, 5);
        // Marquer ces lignes pour pouvoir les retrouver après compactage
        firstFive.forEach(el => el.setAttribute('data-email-row', 'true'));
        return firstFive.length;
    });

    if (foundRowsCount === 0) {
        // Si vraiment aucune ligne, on prend une capture plein écran pour debug
        console.log('⚠️ Aucune ligne trouvée, capture écran complète pour debug');
        await page.screenshot({ path: 'screenshot.png' });
        fs.writeFileSync('latest_5.json', JSON.stringify({ lastUpdate: new Date().toISOString(), emails: [], error: 'no rows' }));
        return;
    }
    console.log(`✅ ${foundRowsCount} lignes identifiées`);

    // ---- COMPACTAGE DES LIGNES (expéditeur · 30 premiers car. aperçu · heure) ----
    console.log('🔧 Compactage des lignes...');
    await page.evaluate(() => {
        const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
        const rows = document.querySelectorAll('[data-email-row="true"]');
        rows.forEach(el => {
            const text = el.textContent || '';
            const emailMatch = text.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
            if (!emailMatch) return;
            const from = emailMatch[0];
            
            // Aperçu : 30 premiers caractères après avoir enlevé l'expéditeur et la date
            let preview = '';
            const previewEl = el.querySelector('[class*="preview"], [class*="snippet"], [class*="body"], p');
            if (previewEl) preview = clean(previewEl.textContent);
            else {
                let cleanText = text;
                cleanText = cleanText.replace(from, '');
                cleanText = cleanText.replace(/\d{2}\/\d{2}\/\d{4}/g, '').replace(/\d{2}:\d{2}/g, '');
                preview = clean(cleanText).substring(0, 30);
            }
            
            // Heure
            let date = '';
            const dateEl = el.querySelector('[class*="date"], [class*="time"], .date, .time');
            if (dateEl) date = clean(dateEl.textContent);
            else {
                const m = text.match(/(\d{2}:\d{2})/) || text.match(/(\d{2}\/\d{2}\/\d{4})/) || text.match(/(Aujourd'hui|Hier)/i);
                date = m ? m[1] : '';
            }
            
            el.innerHTML = `
                <span style="font-family: Arial, sans-serif; font-size: 12px; line-height: 1.2; white-space: nowrap; display: block; padding: 1px 0;">
                    <strong style="color: #1a0dab;">${from}</strong>
                    <span style="color: #333;"> · ${preview.substring(0, 30)}</span>
                    <span style="color: #888; margin-left: 8px;">${date}</span>
                </span>
            `;
            el.style.margin = '0';
            el.style.padding = '1px 0';
            el.style.border = 'none';
            el.style.height = 'auto';
        });
    });
    await wait(500);

    // ---- MESURE DES LIGNES COMPACTÉES (via l'attribut) ----
    console.log('📏 Mesure des lignes...');
    const rowsInfo = await page.evaluate(() => {
        const rows = document.querySelectorAll('[data-email-row="true"]');
        return Array.from(rows).map(el => {
            const rect = el.getBoundingClientRect();
            return { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right };
        });
    });

    if (rowsInfo.length === 0) {
        console.log('⚠️ Mesure vide, capture plein écran');
        await page.screenshot({ path: 'screenshot.png' });
        fs.writeFileSync('latest_5.json', JSON.stringify({ lastUpdate: new Date().toISOString(), emails: [], error: 'measurement failed' }));
        return;
    }

    // ---- CAPTURE 16:9 ----
    const firstRowTop = rowsInfo[0].top;
    const lastRowBottom = rowsInfo[rowsInfo.length - 1].bottom;
    const rowHeight = lastRowBottom - firstRowTop;
    const margin = 10;
    const captureHeight = rowHeight + margin * 2;
    const captureWidth = Math.round(captureHeight * 16 / 9);
    const minLeft = Math.min(...rowsInfo.map(r => r.left));
    const maxRight = Math.max(...rowsInfo.map(r => r.right));
    const centerX = (minLeft + maxRight) / 2;
    const captureLeft = Math.max(0, centerX - captureWidth / 2);
    const captureTop = firstRowTop - margin;

    const clip = {
        x: captureLeft,
        y: Math.max(0, captureTop),
        width: Math.min(captureWidth, 1600 - captureLeft),
        height: captureHeight
    };
    console.log(`📸 Capture : x=${clip.x}, y=${clip.y}, w=${clip.width}, h=${clip.height}`);
    await page.screenshot({ path: 'screenshot.png', clip: clip });
    console.log('📸 Capture sauvegardée');

    // ---- EXTRACTION JSON ----
    console.log('📧 Extraction JSON...');
    const emails = await page.evaluate(() => {
        const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
        const rows = document.querySelectorAll('[data-email-row="true"]');
        const results = [];
        rows.forEach(el => {
            const text = el.textContent || '';
            const emailMatch = text.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
            if (!emailMatch) return;
            const from = emailMatch[0];
            // Sujet (peut être extrait de la ligne d'origine, mais après compactage on ne l'a plus, donc on met un placeholder)
            let subject = '';
            // On peut récupérer le sujet depuis l'attribut data-* qu'on aurait pu sauvegarder avant compactage, 
            // mais pour simplifier, on laisse le sujet vide ou on extrait de l'élément original (avant compactage).
            // Comme on a perdu l'info, on met le début du preview comme sujet.
            subject = el.querySelector('span')?.textContent?.split('·')[1]?.trim() || '';
            let date = '';
            const dateEl = el.querySelector('[class*="date"], [class*="time"], .date, .time');
            if (dateEl) date = clean(dateEl.textContent);
            else {
                const m = text.match(/(\d{2}:\d{2})/) || text.match(/(\d{2}\/\d{2}\/\d{4})/) || text.match(/(Aujourd'hui|Hier)/i);
                date = m ? m[1] : '';
            }
            let preview = el.querySelector('span')?.textContent?.split('·')[1]?.trim() || '';
            results.push({ from, subject, date, preview });
        });
        return results;
    });
    
    fs.writeFileSync('latest_5.json', JSON.stringify({
        lastUpdate: new Date().toISOString(),
        emails: emails
    }));
    console.log(`✅ ${emails.length} emails extraits`);
}

scrapeLaposteEmails();
