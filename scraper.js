const puppeteer = require('puppeteer');
const fs = require('fs');

const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

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

async function scrapeLaposteEmails() {
    console.log('🚀 Démarrage du scraping LaPoste.net...');
    
    const browser = await puppeteer.launch({
        headless: 'new',
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu'
        ]
    });
    
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.setViewport({ width: 1366, height: 768 });
    
    try {
        // Connexion (identique)
        console.log('📄 Navigation...');
        await page.goto('https://www.laposte.net/accueil', { waitUntil: 'networkidle2', timeout: 30000 });
        await wait(3000);
        try {
            const cookieBtn = await page.$('#didomi-notice-agree-button');
            if (cookieBtn) { await cookieBtn.click(); await wait(1000); }
        } catch (e) {}
        
        console.log('📧 Saisie email...');
        let emailInput = await page.$('input[id*="login"]') || await page.$('input[type="email"]') || (await page.$$('input[type="text"]'))[0];
        if (!emailInput) throw new Error('Champ email introuvable');
        await emailInput.type(process.env.LAPOSTE_EMAIL);
        console.log('✅ Email saisi');
        
        console.log('🔘 Validation email...');
        let clicked = await clickButtonByText(page, 'Suivant') || await clickButtonByText(page, 'Continuer') || await clickButtonByText(page, 'Valider');
        if (!clicked) {
            const submitBtn = await page.$('button[type="submit"], input[type="submit"]');
            if (submitBtn) await submitBtn.click();
            else await page.keyboard.press('Enter');
        }
        console.log('✅ Bouton cliqué');
        await wait(3000);
        
        console.log('🔐 Saisie mot de passe...');
        let passwordInput = await page.$('input[type="password"]');
        if (!passwordInput) {
            await page.waitForSelector('input[type="password"]', { timeout: 10000 });
            passwordInput = await page.$('input[type="password"]');
        }
        if (!passwordInput) throw new Error('Champ mot de passe introuvable');
        await passwordInput.type(process.env.LAPOSTE_PASSWORD);
        console.log('✅ Mot de passe saisi');
        
        console.log('🔘 Connexion finale...');
        let submitted = await clickButtonByText(page, 'Connexion') || await clickButtonByText(page, 'Se connecter');
        if (!submitted) {
            const submitBtn = await page.$('button[type="submit"], input[type="submit"]');
            if (submitBtn) await submitBtn.click();
            else await page.keyboard.press('Enter');
        }
        console.log('✅ Connecté');
        await wait(12000); // Attendre chargement complet de la boîte
        
        // ---- EXTRACTION DES 5 DERNIERS EMAILS ----
        console.log('📧 Extraction des 5 derniers emails...');
        const emails = await page.evaluate(() => {
            const clean = (s) => s.replace(/\s+/g, ' ').trim();
            
            // Stratégie : chercher des éléments avec classe contenant "msg", "mail", "message", "item"
            const selectors = [
                'div[class*="msg"]', 'div[class*="mail-item"]', 'div[class*="message-item"]',
                'tr[class*="mail"]', 'tr[class*="msg"]', 'li[class*="mail"]', 'li[class*="msg"]'
            ];
            let rows = [];
            for (const sel of selectors) {
                const nodes = document.querySelectorAll(sel);
                if (nodes.length >= 2) {
                    rows = Array.from(nodes);
                    break;
                }
            }
            // Fallback
            if (rows.length === 0) {
                const all = document.querySelectorAll('div, tr, li');
                rows = Array.from(all).filter(el => {
                    return el.children.length >= 2 && el.textContent.includes('@') && el.offsetHeight > 25 && el.offsetHeight < 200;
                });
            }
            
            // Filtrer les déchets
            rows = rows.filter(el => {
                const t = el.textContent || '';
                return !/Boîte de réception|Dossiers|Menu|Paramètres|Agenda|Contacts|Écrire un mail|Liste de mails|Sélection|Marquer tout comme lu|Vider le dossier|k-error/i.test(t);
            });
            
            const results = [];
            for (const el of rows) {
                try {
                    const text = el.textContent || '';
                    const emailMatch = text.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
                    if (!emailMatch) continue;
                    const from = emailMatch[0];
                    
                    // Sujet : on essaie un élément avec classe subject / objet, sinon première ligne non date
                    let subject = '';
                    const subjectEl = el.querySelector('[class*="subject"], [class*="objet"], [class*="title"], .subject, .objet');
                    if (subjectEl) subject = clean(subjectEl.textContent);
                    else {
                        const lines = text.split('\n').filter(l => l.trim().length > 1).map(l => clean(l));
                        subject = lines.find(l => !l.includes('@') && !l.match(/^\d{2}[:\/]\d{2}/) && !l.match(/^(Aujourd'hui|Hier|Il y a)/)) || '';
                    }
                    subject = subject.replace(from, '').trim();
                    if (!subject || subject.length < 2) subject = '(Sans objet)';
                    
                    // Aperçu : on prend le reste du texte après le sujet et l'expéditeur, limité à 80 caractères
                    let preview = '';
                    const previewEl = el.querySelector('[class*="preview"], [class*="snippet"], [class*="body"], p');
                    if (previewEl) preview = clean(previewEl.textContent);
                    else {
                        let cleanText = text.replace(subject, '').replace(from, '');
                        // Supprime dates/heures
                        cleanText = cleanText.replace(/\d{2}\/\d{2}\/\d{4}/g, '').replace(/\d{2}:\d{2}/g, '').trim();
                        preview = clean(cleanText).substring(0, 80);
                    }
                    
                    results.push({
                        from: from,
                        subject: subject,
                        preview: preview
                    });
                    if (results.length >= 5) break;
                } catch (e) {}
            }
            return results.slice(0, 5);
        });
        
        // Sauvegarde
        const data = {
            lastUpdate: new Date().toISOString(),
            emails: emails
        };
        fs.writeFileSync('latest_5.json', JSON.stringify(data));
        console.log(`✅ ${emails.length} emails extraits`);
        
        // Toujours garder la capture d'écran complète pour le dashboard existant
        await page.screenshot({ path: 'screenshot.png' });
        
    } catch (error) {
        console.error('❌ Erreur:', error.message);
        // Sauver une erreur
        fs.writeFileSync('latest_5.json', JSON.stringify({ lastUpdate: new Date().toISOString(), emails: [], error: error.message }));
        try { await page.screenshot({ path: 'screenshot.png' }); } catch(e) {}
    } finally {
        await browser.close();
        console.log('🏁 Terminé');
    }
}

scrapeLaposteEmails();
