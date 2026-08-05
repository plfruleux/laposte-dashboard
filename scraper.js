const puppeteer = require('puppeteer');
const fs = require('fs');

const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Fonction pour cliquer sur un bouton contenant un texte
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
        // 1. Aller sur la page de connexion
        console.log('📄 Navigation...');
        await page.goto('https://www.laposte.net/accueil', {
            waitUntil: 'networkidle2',
            timeout: 30000
        });
        await wait(3000);
        
        // Accepter les cookies
        try {
            const cookieBtn = await page.$('#didomi-notice-agree-button');
            if (cookieBtn) {
                await cookieBtn.click();
                console.log('✅ Cookies acceptés');
                await wait(1000);
            }
        } catch (e) {}
        
        // --- ÉTAPE 1 : SAISIR L'EMAIL ---
        console.log('📧 Étape 1 : Saisie de l\'email...');
        
        const emailSelectors = [
            'input[type="email"]',
            'input[name="email"]',
            '#email',
            '#login-email',
            'input[id*="email"]',
            'input[id*="login"]'
        ];
        
        let emailInput = null;
        for (const sel of emailSelectors) {
            emailInput = await page.$(sel);
            if (emailInput) {
                await emailInput.type(process.env.LAPOSTE_EMAIL);
                console.log(`✅ Email saisi (${sel})`);
                break;
            }
        }
        
        if (!emailInput) {
            const inputs = await page.$$('input[type="text"], input:not([type])');
            if (inputs.length > 0) {
                await inputs[0].type(process.env.LAPOSTE_EMAIL);
                console.log('✅ Email saisi (fallback)');
            } else {
                throw new Error('Champ email introuvable');
            }
        }
        
        // --- ÉTAPE 2 : VALIDER L'EMAIL ---
        console.log('🔘 Étape 2 : Validation email...');
        
        let clicked = await clickButtonByText(page, 'Suivant');
        if (!clicked) clicked = await clickButtonByText(page, 'Continuer');
        if (!clicked) clicked = await clickButtonByText(page, 'Valider');
        
        if (!clicked) {
            const submitBtn = await page.$('input[type="submit"], button[type="submit"], #submit_button, #next');
            if (submitBtn) {
                await submitBtn.click();
                clicked = true;
            }
        }
        
        if (!clicked) {
            await page.keyboard.press('Enter');
            console.log('✅ Entrée pressée (fallback)');
        } else {
            console.log('✅ Bouton de validation cliqué');
        }
        
        await wait(3000);
        
        // --- ÉTAPE 3 : SAISIR LE MOT DE PASSE ---
        console.log('🔐 Étape 3 : Saisie du mot de passe...');
        
        const passwordSelectors = [
            'input[type="password"]',
            'input[name="password"]',
            '#password',
            '#login-password',
            'input[id*="password"]',
            'input[id*="pass"]'
        ];
        
        let passwordInput = null;
        for (const sel of passwordSelectors) {
            try {
                await page.waitForSelector(sel, { timeout: 5000 });
                passwordInput = await page.$(sel);
                if (passwordInput) {
                    await passwordInput.type(process.env.LAPOSTE_PASSWORD);
                    console.log(`✅ Mot de passe saisi (${sel})`);
                    break;
                }
            } catch (e) {
                continue;
            }
        }
        
        if (!passwordInput) {
            throw new Error('Champ mot de passe introuvable après validation email');
        }
        
        // --- ÉTAPE 4 : CONNEXION FINALE ---
        console.log('🔘 Étape 4 : Connexion finale...');
        
        let submitted = await clickButtonByText(page, 'Connexion');
        if (!submitted) submitted = await clickButtonByText(page, 'Se connecter');
        
        if (!submitted) {
            const submitBtn = await page.$('input[type="submit"], button[type="submit"], #submit_button, #login-submit');
            if (submitBtn) {
                await submitBtn.click();
                submitted = true;
            }
        }
        
        if (!submitted) {
            await page.keyboard.press('Enter');
            console.log('✅ Connexion via Entrée');
        } else {
            console.log('✅ Connexion cliquée');
        }
        
        // --- ATTENDRE LA BOÎTE DE RÉCEPTION ---
        console.log('⏳ Attente de la boîte de réception...');
        await wait(10000);
        
        // Sauvegarder le HTML complet pour analyse
        const htmlContent = await page.content();
        fs.writeFileSync('debug_page.html', htmlContent);
        console.log('📄 HTML sauvegardé (debug_page.html)');
        
        // Capture d'écran
        await page.screenshot({ path: 'screenshot.png' });
        console.log('📸 Capture sauvegardée (screenshot.png)');
        
        // --- ÉTAPE 5 : EXTRACTION AMÉLIORÉE ---
        console.log('📧 Extraction des emails...');
        
        const emails = await page.evaluate(() => {
            const cleanText = (text) => text.replace(/\s+/g, ' ').trim();
            
            // Récupérer tous les éléments contenant une adresse email
            const allElements = document.querySelectorAll('div, li, tr, article');
            
            // Filtrage : on garde les éléments de taille moyenne (pas la page entière) et contenant un "@"
            const candidates = Array.from(allElements).filter(el => {
                const text = el.textContent || '';
                const hasAt = text.includes('@');
                const height = el.offsetHeight;
                // Exclure les éléments trop petits (probablement du bruit) ou trop grands (conteneur principal)
                if (height < 20 || height > 300) return false;
                // Exclure les textes contenant des mots-clés de l'interface utilisateur
                if (/Boîte de réception|Dossiers|Menu|Paramètres|Agenda|Contacts|k-error-messages|Activer JavaScript|Liste de mails Sélection/i.test(text)) return false;
                return hasAt;
            });
            
            const results = [];
            candidates.slice(0, 25).forEach((el, idx) => {
                try {
                    const text = el.textContent || '';
                    const innerHtml = el.innerHTML || '';
                    
                    // Chercher l'adresse email expéditeur
                    const emailMatch = text.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
                    const from = emailMatch ? emailMatch[0] : '';
                    
                    // Sujet : on prend un élément enfant avec classe subject, objet, ou à défaut la première ligne non date/email
                    let subject = '';
                    const subjectEl = el.querySelector('[class*="subject"], [class*="objet"], [class*="title"], .subject, .object');
                    if (subjectEl) {
                        subject = cleanText(subjectEl.textContent);
                    } else {
                        const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 1);
                        subject = lines.find(l => 
                            !l.match(/^\d{2}[:\/]\d{2}/) && 
                            !l.match(/^\d{2}\/\d{2}\/\d{4}/) &&
                            !l.includes('@') &&
                            !l.match(/^(Aujourd'hui|Hier|Il y a)/)
                        ) || '';
                        if (!subject) subject = text.substring(0, 80);
                    }
                    // Nettoyer le sujet (supprimer l'adresse email)
                    subject = subject.replace(emailMatch ? emailMatch[0] : '', '').trim();
                    if (!subject || subject.length < 2) subject = '(Sans objet)';
                    
                    // Date
                    let date = '';
                    const dateEl = el.querySelector('[class*="date"], time, .time');
                    if (dateEl) {
                        date = cleanText(dateEl.textContent);
                    } else {
                        const dateMatch = text.match(/\d{2}\/\d{2}\/\d{4}/) || 
                                        text.match(/\d{2}:\d{2}/) ||
                                        text.match(/(Aujourd'hui|Hier|Il y a \d+ \w+)/i);
                        date = dateMatch ? dateMatch[0] : '';
                    }
                    
                    // Aperçu
                    let preview = '';
                    const previewEl = el.querySelector('[class*="preview"], [class*="snippet"], [class*="body"], p');
                    if (previewEl) {
                        preview = cleanText(previewEl.textContent).substring(0, 200);
                    } else {
                        let clean = text;
                        if (subject) clean = clean.replace(subject, '');
                        if (from) clean = clean.replace(from, '');
                        if (date) clean = clean.replace(date, '');
                        clean = clean.replace(/\s+/g, ' ').trim();
                        preview = clean.substring(0, 200);
                    }
                    
                    // Statut non lu
                    const isUnread = el.classList.contains('unread') || 
                                   el.classList.contains('new') ||
                                   innerHtml.includes('font-weight:700') ||
                                   innerHtml.includes('font-weight: 700') ||
                                   innerHtml.includes('<b>') ||
                                   innerHtml.includes('<strong>');
                    
                    if (from || (subject && subject.length > 5)) {
                        results.push({
                            id: `email-${idx}-${Date.now()}`,
                            subject: subject,
                            from: from || 'Inconnu',
                            date: date,
                            preview: preview + (preview.length > 0 ? '...' : ''),
                            isUnread: Boolean(isUnread),
                            timestamp: new Date().toISOString()
                        });
                    }
                } catch (e) {}
            });
            
            return results;
        });
        
        // Sauvegarder les emails
        const data = {
            lastUpdate: new Date().toISOString(),
            emailCount: emails.length,
            emails: emails
        };
        fs.writeFileSync('emails.json', JSON.stringify(data, null, 2));
        console.log(`✅ ${emails.length} emails extraits`);
        
    } catch (error) {
        console.error('❌ Erreur:', error.message);
        try { 
            await page.screenshot({ path: 'screenshot.png' }); 
        } catch(e) {}
        
        const errorData = {
            lastUpdate: new Date().toISOString(),
            emailCount: 0,
            error: error.message,
            emails: []
        };
        fs.writeFileSync('emails.json', JSON.stringify(errorData, null, 2));
    } finally {
        await browser.close();
        console.log('🏁 Terminé');
    }
}

scrapeLaposteEmails();
