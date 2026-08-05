const puppeteer = require('puppeteer');
const fs = require('fs');

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
        
        const nextSelectors = [
            'input[type="submit"]',
            'button[type="submit"]',
            '#submit_button',
            '#next',
            'button:has-text("Suivant")',
            'button:has-text("Continuer")',
            'button:has-text("Valider")',
            '[data-testid="submit"]'
        ];
        
        let clicked = false;
        for (const sel of nextSelectors) {
            const btn = await page.$(sel);
            if (btn) {
                await btn.click();
                console.log(`✅ Clic sur bouton (${sel})`);
                clicked = true;
                break;
            }
        }
        
        if (!clicked) {
            await page.keyboard.press('Enter');
            console.log('✅ Entrée pressée');
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
            const html = await page.content();
            fs.writeFileSync('debug.html', html);
            await page.screenshot({ path: 'debug.png' });
            console.log('📸 Debug sauvegardé');
            throw new Error('Champ mot de passe introuvable après validation email');
        }
        
        // --- ÉTAPE 4 : CONNEXION FINALE ---
        console.log('🔘 Étape 4 : Connexion finale...');
        
        const submitSelectors = [
            'input[type="submit"]',
            'button[type="submit"]',
            '#submit_button',
            '#login-submit',
            'button:has-text("Connexion")',
            'button:has-text("Se connecter")'
        ];
        
        let submitted = false;
        for (const sel of submitSelectors) {
            const btn = await page.$(sel);
            if (btn) {
                await btn.click();
                console.log(`✅ Connexion (${sel})`);
                submitted = true;
                break;
            }
        }
        
        if (!submitted) {
            await page.keyboard.press('Enter');
            console.log('✅ Connexion via Entrée');
        }
        
        console.log('⏳ Attente de la boîte mail...');
        await wait(8000);
        
        // --- ÉTAPE 5 : EXTRACTION DES EMAILS ---
        console.log('📧 Extraction des emails...');
        
        const emails = await page.evaluate(() => {
            const results = [];
            const allElements = document.querySelectorAll('div, li, tr, article');
            const emailElements = Array.from(allElements).filter(el => {
                const text = el.textContent || '';
                return text.includes('@') && el.children.length >= 2 && el.offsetHeight > 30;
            });
            
            emailElements.slice(0, 20).forEach((el, index) => {
                try {
                    const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
                    const emailMatch = text.match(/([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z]{2,})/);
                    const from = emailMatch ? emailMatch[0] : 'Inconnu';
                    const lines = text.split(/[.!?]\s+/).filter(l => l.length > 5);
                    const subject = lines[0] ? lines[0].substring(0, 100) : 'Sans objet';
                    const dateMatch = text.match(/\d{2}[\/-]\d{2}[\/-]\d{4}/) || 
                                    text.match(/\d{2}:\d{2}/) ||
                                    text.match(/(Aujourd'hui|Hier|Il y a \d+)/);
                    const date = dateMatch ? dateMatch[0] : '';
                    const preview = text.substring(0, 150);
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
                } catch (err) {}
            });
            return results;
        });
        
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
