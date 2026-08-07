const puppeteer = require('puppeteer');
const fs = require('fs');

const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Délai aléatoire entre 500ms et 3000ms
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

// Vérifie si on est connecté OU si une erreur est affichée
async function checkPageState(page) {
    return await page.evaluate(() => {
        const bodyText = document.body.innerText || '';
        
        // Erreurs LaPoste
        if (bodyText.includes('une erreur est survenue') || 
            bodyText.includes('Erreur technique') ||
            bodyText.includes('service momentanément indisponible') ||
            bodyText.includes('Veuillez réessayer')) {
            return 'error';
        }
        
        // Vérifier si on est dans la boîte mail
        const all = document.querySelectorAll('div, tr, li');
        let emailCount = 0;
        for (const el of all) {
            if (el.textContent.includes('@') && el.offsetHeight > 20) {
                emailCount++;
                if (emailCount >= 2) return 'logged_in';
            }
        }
        
        // Si on voit un champ de connexion, on n'est pas connecté
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
    
    // Effacer cookies et cache avant
    const client = await page.target().createCDPSession();
    await client.send('Network.clearBrowserCookies');
    await client.send('Network.clearBrowserCache');
    
    await page.goto('https://www.laposte.net/accueil', { waitUntil: 'networkidle2', timeout: 30000 });
    await randomWait();

    // Cookies
    try {
        const cookieBtn = await page.$('#didomi-notice-agree-button');
        if (cookieBtn) { await cookieBtn.click(); await randomWait(); }
    } catch (e) {}

    // Email
    console.log('📧 Saisie email...');
    let emailInput = await page.$('input[id*="login"]') || 
                     await page.$('input[type="email"]') || 
                     (await page.$$('input[type="text"]'))[0];
    if (!emailInput) throw new Error('Champ email introuvable');
    
    // Taper comme un humain (lettre par lettre avec délai)
    const email = process.env.LAPOSTE_EMAIL;
    for (const char of email) {
        await emailInput.type(char, { delay: 50 + Math.random() * 100 });
    }
    await randomWait();

    // Valider email
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

    // Vérifier si une erreur est apparue
    const stateAfterEmail = await checkPageState(page);
    if (stateAfterEmail === 'error') {
        console.log('⚠️ Erreur après validation email, nouvelle tentative...');
        throw new Error('Erreur LaPoste après email');
    }

    // Mot de passe
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

    // Connexion finale
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
            '--disable-blink-features=AutomationControlled', // Anti-bot
            '--disable-web-security',
            '--disable-features=IsolateOrigins,site-per-process'
        ]
    });
    
    const page = await browser.newPage();
    
    // Anti-détection : masquer l'automation
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
            // Aller sur la page
            await page.goto('https://www.laposte.net/accueil', { waitUntil: 'networkidle2', timeout: 30000 });
            await wait(3000);
            
            // Vérifier l'état
            let state = await checkPageState(page);
            console.log(`📊 État de la page : ${state}`);
            
            if (state === 'error') {
                console.log('⚠️ Page d\'erreur détectée, attente et réessai...');
                await wait(30000); // Attendre 30 secondes
                continue;
            }
            
            if (state !== 'logged_in') {
                await performLogin(page);
                state = await checkPageState(page);
                console.log(`📊 État après login : ${state}`);
            }
            
            if (state === 'error') {
                console.log('⚠️ Erreur après login, réessai...');
                await wait(30000);
                continue;
            }
            
            if (state !== 'logged_in') {
                console.log('❌ Échec de connexion, réessai...');
                await wait(10000);
                continue;
            }
            
            // Connecté avec succès !
            console.log('✅ Connecté avec succès');
            break;
            
        } catch (error) {
            console.log(`❌ Erreur tentative ${currentTry}:`, error.message);
            if (currentTry === maxRetries) throw error;
            await wait(15000);
        }
    }
    
    // Vérification finale
    const finalState = await checkPageState(page);
    if (finalState !== 'logged_in') {
        throw new Error('Impossible de se connecter après plusieurs tentatives');
    }
    
    // Nettoyage de l'interface
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

        const style = document.createElement('style');
        style.textContent = `
            .email-row, .message-item, .mail-item, tr[class*="mail"], tr[class*="msg"],
            div[class*="mail-item"], div[class*="message-item"], div[class*="msg"] {
                padding: 2px 4px !important; margin: 0 !important;
                line-height: 1.2 !important; height: auto !important; min-height: 0 !important;
                border-bottom: 1px solid rgba(0,0,0,0.05) !important;
            }
            .email-sender, .from, .sender, [class*="from"], [class*="sender"] {
                font-size: 11px !important; margin: 0 !important;
            }
            .email-subject, .subject, [class*="subject"], [class*="objet"] {
                font-size: 12px !important; margin: 0 !important;
            }
            .email-preview, .snippet, .preview, .body-preview, [class*="preview"], [class*="body"] {
                font-size: 10px !important; line-height: 1.2 !important; margin: 0 !important;
            }
            .email-date, .date, .time, [class*="date"], [class*="time"] {
                font-size: 10px !important; color: #666 !important; white-space: nowrap !important;
            }
            .email-icon, .avatar, .star, .flag, .attachment-icon, .checkbox, .favorite {
                display: none !important;
            }
        `;
        document.head.appendChild(style);
    });
    await wait(1000);

    // Identification des lignes d'emails
    console.log('🔍 Identification des 5 premières lignes...');
    const rowsInfo = await page.evaluate(() => {
        const selectors = [
            'tr[class*="mail"]', 'tr[class*="msg"]', 'tr[class*="message"]',
            'div[class*="mail-item"]', 'div[class*="message-item"]', 'div[class*="msg-item"]',
            'li[class*="mail"]', 'li[class*="msg"]', 'li[class*="message"]'
        ];
        let rows = [];
        for (const sel of selectors) {
            const nodes = document.querySelectorAll(sel);
            if (nodes.length > 2) { rows = Array.from(nodes); break; }
        }
        if (rows.length === 0) {
            const all = document.querySelectorAll('div, tr, li');
            rows = Array.from(all).filter(el => {
                const text = el.textContent || '';
                return text.includes('@') && el.children.length >= 2 && el.offsetHeight > 25 && el.offsetHeight < 200;
            });
        }
        rows = rows.filter(el => {
            const t = el.textContent || '';
            return !/Boîte de réception|Dossiers|Menu|Paramètres|Agenda|Contacts|Écrire un mail|Liste de mails|Sélection|Marquer tout comme lu|Vider le dossier|k-error|une erreur/i.test(t);
        });
        const firstFive = rows.slice(0, 5);
        return firstFive.map(el => {
            const rect = el.getBoundingClientRect();
            return { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right };
        });
    });

    if (rowsInfo.length === 0) throw new Error('Aucune ligne d\'email trouvée');
    console.log(`✅ ${rowsInfo.length} lignes identifiées`);

    // Capture 16:9
    const firstRowTop = rowsInfo[0].top;
    const lastRowBottom = rowsInfo[rowsInfo.length - 1].bottom;
    const rowHeight = lastRowBottom - firstRowTop;
    const margin = 15;
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
    console.log('📸 Capture 16:9 sauvegardée');

    // Extraction des données
    console.log('📧 Extraction des données...');
    const emails = await page.evaluate(() => {
        const clean = (s) => s.replace(/\s+/g, ' ').trim();
        const results = [];
        const selectors = [
            'div[class*="msg"]', 'div[class*="mail-item"]', 'div[class*="message-item"]',
            'tr[class*="mail"]', 'tr[class*="msg"]', 'li[class*="mail"]', 'li[class*="msg"]'
        ];
        let rows = [];
        for (const sel of selectors) {
            const nodes = document.querySelectorAll(sel);
            if (nodes.length >= 2) { rows = Array.from(nodes); break; }
        }
        if (rows.length === 0) {
            const all = document.querySelectorAll('div, tr, li');
            rows = Array.from(all).filter(el => {
                return el.children.length >= 2 && el.textContent.includes('@') && el.offsetHeight > 25 && el.offsetHeight < 200;
            });
        }
        rows = rows.filter(el => {
            const t = el.textContent || '';
            return !/Boîte de réception|Dossiers|Menu|Paramètres|Agenda|Contacts|Écrire un mail|Liste de mails|Sélection|Marquer tout comme lu|Vider le dossier|k-error|une erreur/i.test(t);
        });
        for (const el of rows.slice(0, 5)) {
            try {
                const text = el.textContent || '';
                const emailMatch = text.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
                if (!emailMatch) continue;
                const from = emailMatch[0];
                
                let subject = '';
                const subjectEl = el.querySelector('[class*="subject"], [class*="objet"], [class*="title"], .subject, .objet');
                if (subjectEl) subject = clean(subjectEl.textContent);
                else {
                    const lines = text.split('\n').filter(l => l.trim().length > 1).map(l => clean(l));
                    subject = lines.find(l => !l.includes('@') && !l.match(/^\d{2}[:\/]\d{2}/) && !l.match(/^(Aujourd'hui|Hier|Il y a)/)) || '';
                }
                subject = subject.replace(from, '').trim() || '(Sans objet)';
                
                let date = '';
                const dateEl = el.querySelector('[class*="date"], [class*="time"], .date, .time');
                if (dateEl) date = clean(dateEl.textContent);
                else {
                    const m = text.match(/(\d{2}:\d{2})/) || text.match(/(\d{2}\/\d{2}\/\d{4})/) || text.match(/(Aujourd'hui|Hier)/i);
                    date = m ? m[1] : '';
                }
                
                let preview = '';
                const previewEl = el.querySelector('[class*="preview"], [class*="snippet"], [class*="body"], p');
                if (previewEl) preview = clean(previewEl.textContent);
                else {
                    let cleanText = text.replace(subject, '').replace(from, '').replace(date, '');
                    cleanText = cleanText.replace(/\d{2}\/\d{2}\/\d{4}/g, '').replace(/\d{2}:\d{2}/g, '').trim();
                    preview = clean(cleanText).substring(0, 80);
                }
                
                results.push({ from, subject, date, preview });
            } catch (e) {}
        }
        return results;
    });
    
    fs.writeFileSync('latest_5.json', JSON.stringify({
        lastUpdate: new Date().toISOString(),
        emails: emails
    }));
    console.log(`✅ ${emails.length} emails extraits`);
}

scrapeLaposteEmails();
