const puppeteer = require('puppeteer');
const fs = require('fs');

// Fonction d'attente compatible
const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

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
        
        await wait(3000);
        
        // 2. Accepter les cookies
        try {
            console.log('🍪 Gestion des cookies...');
            const cookieButton = await page.$('#didomi-notice-agree-button');
            if (cookieButton) {
                await cookieButton.click();
                console.log('✅ Cookies acceptés');
                await wait(1000);
            }
        } catch (e) {
            console.log('🍪 Pas de bannière cookies');
        }
        
        // 3. Connexion
        console.log('🔐 Recherche du formulaire...');
        
        // Chercher et remplir l'email
        let emailFound = false;
        const emailSelectors = [
            'input[type="email"]',
            'input[name="email"]',
            '#email',
            '#login-email',
            '#username',
            'input[placeholder*="mail"]',
            'input[placeholder*="email"]',
            'input[placeholder*="identifiant"]',
            'input[id*="email"]',
            'input[id*="login"]'
        ];
        
        for (const selector of emailSelectors) {
            try {
                await page.waitForSelector(selector, { timeout: 2000 });
                await page.type(selector, process.env.LAPOSTE_EMAIL);
                console.log(`✅ Email saisi: ${selector}`);
                emailFound = true;
                break;
            } catch (e) {
                continue;
            }
        }
        
        // Chercher et remplir le mot de passe
        let passwordFound = false;
        const passwordSelectors = [
            'input[type="password"]',
            'input[name="password"]',
            '#password',
            '#login-password',
            'input[placeholder*="mot de passe"]',
            'input[placeholder*="password"]',
            'input[id*="password"]',
            'input[id*="pass"]'
        ];
        
        for (const selector of passwordSelectors) {
            try {
                await page.waitForSelector(selector, { timeout: 2000 });
                await page.type(selector, process.env.LAPOSTE_PASSWORD);
                console.log(`✅ Mot de passe saisi: ${selector}`);
                passwordFound = true;
                break;
            } catch (e) {
                continue;
            }
        }
        
        if (!emailFound || !passwordFound) {
            // Capture d'écran pour debug
            await page.screenshot({ path: 'debug.png' });
            console.log('📸 Capture sauvegardée (debug.png)');
            throw new Error('Champs de connexion introuvables');
        }
        
        // Cliquer sur connexion
        console.log('🔘 Clic connexion...');
        const submitSelectors = [
            'button[type="submit"]',
            '#submit_button',
            '#login-submit',
            'button:has-text("Connexion")',
            'button:has-text("Se connecter")',
            '.login-button'
        ];
        
        let submitted = false;
        for (const selector of submitSelectors) {
            try {
                const button = await page.$(selector);
                if (button) {
                    await button.click();
                    console.log(`✅ Clic: ${selector}`);
                    submitted = true;
                    break;
                }
            } catch (e) {
                continue;
            }
        }
        
        if (!submitted) {
            await page.keyboard.press('Enter');
            console.log('✅ Envoi via Entrée');
        }
        
        // 4. Attendre la boîte mail
        console.log('⏳ Attente du chargement...');
        await wait(8000);
        
        // 5. Extraire les emails
        console.log('📧 Extraction...');
        
        const emails = await page.evaluate(() => {
            const results = [];
            
            // Chercher tous les éléments qui ressemblent à des emails
            const allElements = document.querySelectorAll('div, li, tr, article');
            const emailElements = Array.from(allElements).filter(el => {
                const text = el.textContent || '';
                return text.includes('@') && el.children.length >= 2 && el.offsetHeight > 30;
            });
            
            emailElements.slice(0, 20).forEach((el, index) => {
                try {
                    const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
                    
                    // Extraire l'email de l'expéditeur
                    const emailMatch = text.match(/([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z]{2,})/);
                    const from = emailMatch ? emailMatch[0] : 'Inconnu';
                    
                    // Sujet (première ligne significative)
                    const lines = text.split(/[.!?]\s+/).filter(l => l.length > 5);
                    const subject = lines[0] ? lines[0].substring(0, 100) : 'Sans objet';
                    
                    // Date
                    const dateMatch = text.match(/\d{2}[\/-]\d{2}[\/-]\d{4}/) || 
                                    text.match(/\d{2}:\d{2}/) ||
                                    text.match(/(Aujourd'hui|Hier|Il y a \d+)/);
                    const date = dateMatch ? dateMatch[0] : '';
                    
                    // Preview
                    const preview = text.substring(0, 150);
                    
                    // Non lu ?
                    const html = el.innerHTML || '';
                    const isUnread = html.includes('font-weight:700') || 
                                   html.includes('font-weight: 700') ||
                                   html.includes('<b>') ||
                                   html.includes('<strong>');
                    
                    results.push({
                        id: `email-${index}-${Date.now()}`,
                        subject: subject,
                        from: from,
                        date: date,
                        preview: preview + '...',
                        isUnread: Boolean(isUnread),
                        timestamp: new Date().toISOString()
                    });
                    
                } catch (err) {
                    // Ignorer
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
        console.log(`✅ ${emails.length} emails extraits`);
        
    } catch (error) {
        console.error('❌ Erreur:', error.message);
        
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
