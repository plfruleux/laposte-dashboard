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
        
        // ÉTAPE 1 : SAISIR L'EMAIL
        console.log('📧 Étape 1 : Saisie de l\'email...');
        const emailSelectors = [
            'input[type="email"]', 'input[name="email"]', '#email', '#login-email',
            'input[id*="email"]', 'input[id*="login"]'
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
        
        // ÉTAPE 2 : VALIDER L'EMAIL
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
        
        // ÉTAPE 3 : SAISIR LE MOT DE PASSE
        console.log('🔐 Étape 3 : Saisie du mot de passe...');
        const passwordSelectors = [
            'input[type="password"]', 'input[name="password"]', '#password',
            '#login-password', 'input[id*="password"]', 'input[id*="pass"]'
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
            } catch (e) { continue; }
        }
        if (!passwordInput) throw new Error('Champ mot de passe introuvable');
        
        // ÉTAPE 4 : CONNEXION FINALE
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
        
        // ATTENDRE LA BOÎTE DE RÉCEPTION
        console.log('⏳ Attente de la boîte de réception...');
        await wait(10000);
        
        // SAUVEGARDER LE HTML COMPLET
        const htmlContent = await page.content();
        fs.writeFileSync('debug_page.html', htmlContent);
        console.log('📄 HTML sauvegardé dans debug_page.html');
        
        // Capture d'écran
        await page.screenshot({ path: 'screenshot.png' });
        console.log('📸 Capture sauvegardée');
        
        // Extraction basique (pour l'instant on laisse vide, vous analyserez le HTML)
        const emails = []; // On n'extrait rien ici, on attend votre analyse
        console.log(`📧 Extraction non effectuée (en attente d'analyse du HTML)`);
        
        const data = {
            lastUpdate: new Date().toISOString(),
            emailCount: emails.length,
            emails: emails
        };
        fs.writeFileSync('emails.json', JSON.stringify(data, null, 2));
        console.log(`✅ ${emails.length} emails extraits (debug)`);
        
    } catch (error) {
        console.error('❌ Erreur:', error.message);
        try { await page.screenshot({ path: 'screenshot.png' }); } catch(e) {}
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
