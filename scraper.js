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

async function findEmailRows(page) {
    return await page.evaluate(() => {
        // Récupère TOUS les éléments visibles contenant un "@"
        const allElements = document.querySelectorAll('*');
        const candidates = [];
        allElements.forEach(el => {
            const text = el.textContent || '';
            if (!text.includes('@')) return;
            const rect = el.getBoundingClientRect();
            if (rect.width === 0 || rect.height === 0) return;
            // Hauteur typique d'une ligne d'email : entre 20px et 100px
            if (rect.height < 20 || rect.height > 100) return;
            candidates.push({
                el,
                top: rect.top,
                bottom: rect.bottom,
                left: rect.left,
                right: rect.right,
                height: rect.height
            });
        });

        // Trier par position verticale
        candidates.sort((a, b) => a.top - b.top);

        // Supprimer les doublons : si un élément contient un autre (parent/enfant), on garde le plus petit (l'enfant)
        const filtered = [];
        candidates.forEach(c => {
            // Vérifier si c n'est pas déjà inclus dans un élément déjà gardé
            const isInside = filtered.some(f => {
                return c.top >= f.top && c.bottom <= f.bottom && c.left >= f.left && c.right <= f.right;
            });
            if (!isInside) {
                filtered.push(c);
            }
        });

        // Exclure les éléments situés dans des zones de navigation (haut de page, barre latérale)
        const navSelectors = ['nav', 'header', '.sidebar', '#side-menu', '.folder-list', '.left-panel'];
        const navElements = [];
        navSelectors.forEach(sel => {
            document.querySelectorAll(sel).forEach(el => navElements.push(el));
        });
        const rows = filtered.filter(item => {
            return !navElements.some(nav => {
                const navRect = nav.getBoundingClientRect();
                return item.top >= navRect.top && item.bottom <= navRect.bottom && item.left >= navRect.left && item.right <= navRect.right;
            });
        });

        // Ne garder que les 5 premiers
        return rows.slice(0, 5).map(r => ({
            top: r.top,
            bottom: r.bottom,
            left: r.left,
            right: r.right,
            height: r.height
        }));
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
    
    // Connexion avec reconnexion automatique
    let maxRetries = 3;
    for (let i = 0; i < maxRetries; i++) {
        console.log(`\n🔄 Tentative ${i+1}/${maxRetries}`);
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
            if (i === maxRetries-1) throw e;
            await wait(15000);
        }
    }

    // Sauvegarde HTML pour debug (optionnel)
    const html = await page.content();
    fs.writeFileSync('debug_page.html', html);
    console.log('📄 debug_page.html sauvegardé');

    // Attendre que la liste des emails soit bien chargée
    await wait(3000);

    console.log('🔍 Recherche des lignes emails...');
    let rows = await findEmailRows(page);

    if (rows.length === 0) {
        console.log('⚠️ Aucune ligne détectée, capture écran complète');
        await page.screenshot({ path: 'screenshot.png' });
        fs.writeFileSync('latest_5.json', JSON.stringify({ lastUpdate: new Date().toISOString(), emails: [], error: 'no rows found' }));
        return;
    }

    console.log(`✅ ${rows.length} lignes trouvées`);

    // Calcul du rectangle englobant
    const top = rows[0].top;
    const bottom = rows[rows.length-1].bottom;
    const left = Math.min(...rows.map(r => r.left));
    const right = Math.max(...rows.map(r => r.right));
    const height = bottom - top;
    const width = right - left;

    // Ajouter une marge de 15px
    const margin = 15;
    const clipHeight = height + 2 * margin;
    const clipWidth = Math.round(clipHeight * 16 / 9);

    // Centrer horizontalement
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

    // Extraction basique des expéditeurs et dates (optionnel)
    const emails = await page.evaluate((rows) => {
        return rows.map(r => {
            // Ici on ne peut pas accéder aux éléments, on retourne juste les positions
            return { from: '', date: '', preview: '' };
        });
    }, rows);
    // Pour avoir les vraies données, on pourrait réexécuter du JS, mais le plus simple est d'utiliser les rectangles.
    // On va refaire une passe rapide pour récupérer le texte des lignes.
    const emailData = await page.evaluate((rows) => {
        const results = [];
        rows.forEach(r => {
            // On ne peut pas récupérer l'élément ici, donc on fait une autre méthode :
            // On va chercher l'élément qui correspond à ces coordonnées.
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
