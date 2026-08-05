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
        await wait(10000); // Attendre que la boîte mail soit complètement chargée
        
        // Sauvegarder une capture d'écran de la boîte mail
        await page.screenshot({ path: 'screenshot.png' });
        console.log('📸 Capture de la boîte mail sauvegardée');
        
        // --- ÉTAPE 5 : EXTRACTION PROPRE DES EMAILS ---
        console.log('📧 Extraction des emails...');
        
        const emails = await page.evaluate(() => {
            // Fonction utilitaire : nettoyer un texte (enlever les espaces multiples, etc.)
            const cleanText = (text) => text.replace(/\s+/g, ' ').trim();
            
            // Cibler les lignes de la liste des emails. Les sélecteurs sont spécifiques à Laposte.net.
            // On essaie plusieurs sélecteurs connus pour les lignes de mails.
            const selectors = [
                '.mails-list-item',          // Ancienne interface ?
                '.message-item',            // Interface classique
                'tr[role="row"]',           // Tableau
                '.msg-list__item',          // Nouvelle interface possible
                '[data-testid="mail-item"]',
                '.email-entry'
            ];
            let rows = [];
            for (const sel of selectors) {
                rows = document.querySelectorAll(sel);
                if (rows.length > 1) break;
            }
            
            // Si toujours rien, essayer de trouver des divs contenant une adresse email dans un enfant spécifique
            if (rows.length === 0) {
                const candidates = document.querySelectorAll('div, li');
                rows = Array.from(candidates).filter(el => {
                    // Vérifie que l'élément contient une adresse email et un sujet potentiel
                    const text = el.textContent || '';
                    const hasEmail = text.includes('@');
                    // Exclut les éléments trop grands (probablement le conteneur principal)
                    const isReasonableSize = el.offsetHeight > 20 && el.offsetHeight < 200;
                    // Exclut les éléments qui contiennent des mots clés de navigation
                    const hasNavigation = /Boîte de réception|Dossiers|Menu|Paramètres|Agenda|Contacts/i.test(text);
                    return hasEmail && isReasonableSize && !hasNavigation;
                });
            }
            
            const results = [];
            rows.slice(0, 25).forEach((row, idx) => {
                try {
                    const text = row.textContent || '';
                    // Ignorer les lignes qui sont clairement des menus ou des messages d'erreur
                    if (text.includes('k-error-messages') || 
                        text.includes('Activer JavaScript') ||
                        text.includes('Dossiers (Sauter)') ||
                        text.includes('Menu Réduire le menu') ||
                        text.includes('Liste de mails Sélection Etat') ||
                        text.match(/^\s*Menu\s/)) {
                        return;
                    }
                    
                    // Extraire l'expéditeur (adresse email)
                    const emailMatch = text.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
                    const from = emailMatch ? emailMatch[0] : '';
                    
                    // Tenter de trouver le sujet : chercher un élément enfant avec une classe 'subject' ou 'object'
                    let subject = '';
                    const subjectEl = row.querySelector('[class*="subject"], [class*="objet"], [class*="title"], .subject, .object');
                    if (subjectEl) {
                        subject = cleanText(subjectEl.textContent);
                    } else {
                        // Sinon, extraire la première ligne significative (ni date, ni email)
                        const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 1);
                        subject = lines.find(l => 
                            !l.match(/^\d{2}[:\/]\d{2}/) && 
                            !l.match(/^\d{2}\/\d{2}\/\d{4}/) &&
                            !l.includes('@') &&
                            !l.match(/^(Aujourd'hui|Hier|Il y a)/)
                        ) || '';
                        if (!subject) subject = text.substring(0, 80);
                    }
                    // Nettoyer le sujet de l'expéditeur s'il y est collé
                    subject = subject.replace(emailMatch ? emailMatch[0] : '', '').trim();
                    if (!subject || subject.length < 2) subject = '(Sans objet)';
                    
                    // Date
                    let date = '';
                    const dateEl = row.querySelector('[class*="date"], time, .time');
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
                    const previewEl = row.querySelector('[class*="preview"], [class*="snippet"], [class*="body"], p');
                    if (previewEl) {
                        preview = cleanText(previewEl.textContent).substring(0, 200);
                    } else {
                        // Nettoyer le texte brut en retirant sujet, expéditeur, date
                        let clean = text;
                        if (subject) clean = clean.replace(subject, '');
                        if (from) clean = clean.replace(from, '');
                        if (date) clean = clean.replace(date, '');
                        clean = clean.replace(/\s+/g, ' ').trim();
                        preview = clean.substring(0, 200);
                    }
                    
                    // Statut non lu (détection par classe ou style)
                    const isUnread = row.classList.contains('unread') || 
                                   row.classList.contains('new') ||
                                   row.innerHTML.includes('font-weight:700') ||
                                   row.innerHTML.includes('font-weight: 700') ||
                                   row.innerHTML.includes('<b>') ||
                                   row.innerHTML.includes('<strong>');
                    
                    // On n'ajoute que si on a au moins un expéditeur ou un sujet pertinent
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
                    
                } catch (e) {
                    // Ignorer les erreurs sur un élément
                }
            });
            
            return results;
        });

        // Sauvegarde des données
        const data = {
            lastUpdate: new Date().toISOString(),
            emailCount: emails.length,
            emails: emails
        };
        fs.writeFileSync('emails.json', JSON.stringify(data, null, 2));
        console.log(`✅ ${emails.length} emails extraits`);
        
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
