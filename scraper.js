const puppeteer = require('puppeteer');
const fs = require('fs');

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
        console.log('📄 Navigation vers la page de connexion...');
        await page.goto('https://www.laposte.net/accueil', {
            waitUntil: 'networkidle2',
            timeout: 30000
        });
        
        // Attendre que la page charge complètement
        await page.waitForTimeout(3000);
        
        // 2. Accepter les cookies
        try {
            console.log('🍪 Gestion des cookies...');
            const cookieSelectors = [
                '#didomi-notice-agree-button',
                '#cookie-agree',
                '.cookie-accept',
                'button[data-purpose="agree"]',
                '#accept-all-cookies'
            ];
            
            for (const selector of cookieSelectors) {
                const button = await page.$(selector);
                if (button) {
                    await button.click();
                    console.log('✅ Cookies acceptés');
                    await page.waitForTimeout(1000);
                    break;
                }
            }
        } catch (e) {
            console.log('🍪 Pas de bannière cookies ou déjà acceptée');
        }
        
        // 3. Connexion - approche multi-sélecteurs
        console.log('🔐 Recherche du formulaire de connexion...');
        
        // Prendre une capture d'écran pour debug
        await page.screenshot({ path: 'debug-login.png' });
        
        // Chercher les champs avec plusieurs sélecteurs possibles
        const emailSelectors = [
            'input[name="email"]',
            'input[type="email"]',
            '#email',
            '#login-email',
            '#username',
            'input[placeholder*="mail"]',
            'input[placeholder*="email"]',
            'input[placeholder*="identifiant"]',
            'input[id*="email"]',
            'input[id*="login"]'
        ];
        
        const passwordSelectors = [
            'input[name="password"]',
            'input[type="password"]',
            '#password',
            '#login-password',
            'input[placeholder*="mot de passe"]',
            'input[placeholder*="password"]',
            'input[id*="password"]',
            'input[id*="pass"]'
        ];
        
        const submitSelectors = [
            'button[type="submit"]',
            '#submit_button',
            '#login-submit',
            'button[data-purpose="submit"]',
            '.login-button',
            'input[type="submit"]',
            'button:has-text("Connexion")',
            'button:has-text("Se connecter")'
        ];
        
        // Trouver et remplir l'email
        let emailFound = false;
        for (const selector of emailSelectors) {
            try {
                await page.waitForSelector(selector, { timeout: 3000 });
                await page.type(selector, process.env.LAPOSTE_EMAIL);
                console.log(`✅ Email saisi avec le sélecteur: ${selector}`);
                emailFound = true;
                break;
            } catch (e) {
                continue;
            }
        }
        
        if (!emailFound) {
            // Essayer de trouver tous les inputs et prendre le premier de type email
            console.log('⚠️ Sélecteurs standards non trouvés, recherche alternative...');
            const inputs = await page.$$('input');
            for (const input of inputs) {
                const type = await input.evaluate(el => el.type);
                if (type === 'email' || type === 'text') {
                    await input.type(process.env.LAPOSTE_EMAIL);
                    console.log('✅ Email saisi via recherche alternative');
                    emailFound = true;
                    break;
                }
            }
        }
        
        // Trouver et remplir le mot de passe
        let passwordFound = false;
        for (const selector of passwordSelectors) {
            try {
                await page.waitForSelector(selector, { timeout: 3000 });
                await page.type(selector, process.env.LAPOSTE_PASSWORD);
                console.log(`✅ Mot de passe saisi avec le sélecteur: ${selector}`);
                passwordFound = true;
                break;
            } catch (e) {
                continue;
            }
        }
        
        if (!passwordFound) {
            const inputs = await page.$$('input[type="password"]');
            if (inputs.length > 0) {
                await inputs[0].type(process.env.LAPOSTE_PASSWORD);
                console.log('✅ Mot de passe saisi via recherche alternative');
                passwordFound = true;
            }
        }
        
        if (!emailFound || !passwordFound) {
            throw new Error('Impossible de trouver les champs de connexion');
        }
        
        // Cliquer sur le bouton de connexion
        console.log('🔘 Recherche du bouton de connexion...');
        let submitted = false;
        
        for (const selector of submitSelectors) {
            try {
                const button = await page.$(selector);
                if (button) {
                    await button.click();
                    console.log(`✅ Connexion avec le sélecteur: ${selector}`);
                    submitted = true;
                    break;
                }
            } catch (e) {
                continue;
            }
        }
        
        if (!submitted) {
            // Appuyer sur Entrée dans le champ mot de passe
            console.log('⚠️ Bouton non trouvé, tentative avec Entrée...');
            await page.keyboard.press('Enter');
        }
        
        // 4. Attendre la boîte mail
        console.log('⏳ Attente de la boîte mail...');
        await page.waitForTimeout(8000);
        
        // Prendre une capture de la boîte mail
        await page.screenshot({ path: 'debug-inbox.png' });
        
        // 5. Extraire les emails (code identique à avant)
        console.log('📧 Extraction des emails...');
        
        const emails = await page.evaluate(() => {
            const results = [];
            
            // Chercher les lignes d'emails avec différents sélecteurs
            const selectors = [
                '.message-item', '.email-row', '.mail-item',
                'tr[role="row"]', '.msg-list__item', '.list-group-item',
                '[data-testid="email-item"]', '.email-entry',
                'div[class*="mail"]', 'div[class*="message"]'
            ];
            
            let emailElements = [];
            for (const selector of selectors) {
                const elements = document.querySelectorAll(selector);
                if (elements.length > 2) {
                    emailElements = Array.from(elements);
                    break;
                }
            }
            
            // Fallback : chercher des éléments contenant "@"
            if (emailElements.length === 0) {
                const allElements = document.querySelectorAll('div, li, tr, article');
                emailElements = Array.from(allElements).filter(el => {
                    return el.textContent.includes('@') && 
                           el.children.length >= 2 &&
                           el.offsetHeight > 30;
                });
            }
            
            emailElements.slice(0, 20).forEach((el, index) => {
                try {
                    const text = el.textContent || '';
                    const html = el.innerHTML || '';
                    
                    // Sujet
                    let subject = '';
                    const subjectEl = el.querySelector('.subject, .object, .mail-subject, h3, h4, [class*="subject"], [class*="objet"]');
                    if (subjectEl) {
                        subject = subjectEl.textContent.trim();
                    } else {
                        const lines = text.split('\n').filter(l => l.trim().length > 3);
                        subject = lines[0] || text.substring(0, 80);
                    }
                    
                    // Expéditeur
                    let from = '';
                    const emailMatch = text.match(/([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z]{2,})/);
                    from = emailMatch ? emailMatch[0] : 'Inconnu';
                    
                    // Date
                    let date = '';
                    const dateMatch = text.match(/\d{2}[\/-]\d{2}[\/-]\d{4}/) || 
                                    text.match(/\d{2}:\d{2}/) ||
                                    text.match(/(Aujourd'hui|Hier|Il y a \d+ \w+)/);
                    date = dateMatch ? dateMatch[0] : 'Date inconnue';
                    
                    // Preview
                    let preview = text.replace(/\s+/g, ' ').trim().substring(0, 150);
                    
                    // Non lu ?
                    const isUnread = html.includes('bold') || 
                                   html.includes('font-weight:700') ||
                                   el.classList.contains('unread') ||
                                   el.classList.contains('new');
                    
                    results.push({
                        id: `email-${index}-${Date.now()}`,
                        subject: subject || 'Sans objet',
                        from: from,
                        date: date,
                        preview: preview + '...',
                        isUnread: Boolean(isUnread),
                        timestamp: new Date().toISOString()
                    });
                    
                } catch (err) {
                    // Ignorer les erreurs d'extraction individuelles
                }
            });
            
            return results;
        });
        
        // 6. Sauvegarder
        const data = {
            lastUpdate: new Date().toISOString(),
            emailCount: emails.length,
            emails: emails
        };
        
        fs.writeFileSync('emails.json', JSON.stringify(data, null, 2));
        console.log(`✅ ${emails.length} emails sauvegardés`);
        
    } catch (error) {
        console.error('❌ Erreur:', error.message);
        
        // Sauvegarder quand même avec l'erreur
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
