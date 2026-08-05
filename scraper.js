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
    
    // Configuration réaliste du navigateur
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
    await page.setViewport({ width: 1366, height: 768 });
    
    try {
        // 1. Accéder à la page de connexion
        console.log('📄 Accès à la page de connexion...');
        await page.goto('https://www.laposte.net/accueil', {
            waitUntil: 'networkidle2',
            timeout: 30000
        });
        
        // 2. Accepter les cookies
        try {
            const cookieButton = await page.waitForSelector('#didomi-notice-agree-button', { timeout: 5000 });
            if (cookieButton) {
                await cookieButton.click();
                console.log('🍪 Cookies acceptés');
                await page.waitForTimeout(1000);
            }
        } catch (e) {
            console.log('🍪 Pas de bannière cookies détectée');
        }
        
        // 3. Connexion
        console.log('🔐 Tentative de connexion...');
        
        // Attendre le formulaire de connexion
        await page.waitForSelector('input[type="email"], #email', { timeout: 10000 });
        
        // Remplir les champs
        await page.type('input[type="email"], #email', process.env.LAPOSTE_EMAIL);
        await page.type('input[type="password"], #password', process.env.LAPOSTE_PASSWORD);
        
        // Cliquer sur le bouton de connexion
        await page.click('button[type="submit"], #submit_button, .login-button');
        
        // 4. Attendre le chargement de la boîte mail
        console.log('⏳ Attente du chargement de la boîte mail...');
        await page.waitForTimeout(5000);
        
        // 5. Extraire les emails
        console.log('📧 Extraction des emails...');
        
        const emails = await page.evaluate(() => {
            const results = [];
            
            // Sélecteurs génériques pour différentes interfaces LaPoste
            const selectors = [
                '.message-item',
                '.email-row',
                '.mail-item',
                'tr[role="row"]',
                '.msg-list__item',
                '.list-group-item'
            ];
            
            let emailElements = [];
            
            // Essayer différents sélecteurs
            for (const selector of selectors) {
                const elements = document.querySelectorAll(selector);
                if (elements.length > 0) {
                    emailElements = Array.from(elements);
                    break;
                }
            }
            
            // Fallback : chercher des motifs communs
            if (emailElements.length === 0) {
                const allDivs = document.querySelectorAll('div, li, tr');
                emailElements = Array.from(allDivs).filter(el => {
                    const text = el.textContent.toLowerCase();
                    return (text.includes('@') || text.includes('objet')) && 
                           el.children.length >= 2;
                });
            }
            
            // Limiter à 20 emails max
            emailElements.slice(0, 20).forEach((el, index) => {
                try {
                    const text = el.textContent || '';
                    const html = el.innerHTML || '';
                    
                    // Extraction du sujet
                    let subject = '';
                    const subjectSelectors = [
                        '.subject', '.object', '.mail-subject',
                        '[data-test="subject"]', 'h3', 'h4',
                        '.message-subject', '.email-subject'
                    ];
                    
                    for (const sel of subjectSelectors) {
                        const subjectEl = el.querySelector(sel);
                        if (subjectEl && subjectEl.textContent.trim()) {
                            subject = subjectEl.textContent.trim();
                            break;
                        }
                    }
                    
                    if (!subject) {
                        // Essayer d'extraire le sujet du texte
                        const lines = text.split('\n').filter(l => l.trim());
                        subject = lines.find(l => 
                            l.length > 5 && 
                            !l.includes('@') && 
                            !l.match(/^\d{2}[\/-]\d{2}/)
                        ) || text.substring(0, 100);
                    }
                    
                    // Extraction de l'expéditeur
                    let from = '';
                    const fromSelectors = [
                        '.from', '.sender', '.mail-from',
                        '[data-test="from"]', '.contact-name'
                    ];
                    
                    for (const sel of fromSelectors) {
                        const fromEl = el.querySelector(sel);
                        if (fromEl && fromEl.textContent.trim()) {
                            from = fromEl.textContent.trim();
                            break;
                        }
                    }
                    
                    if (!from) {
                        const emailMatch = text.match(/([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9_-]+)/);
                        from = emailMatch ? emailMatch[1] : 'Inconnu';
                    }
                    
                    // Détection des emails non lus
                    const isUnread = el.classList.contains('unread') || 
                                   el.classList.contains('new') ||
                                   html.includes('bold') ||
                                   html.includes('font-weight: bold') ||
                                   html.includes('font-weight:700') ||
                                   el.querySelector('.unread, .new, .badge-new');
                    
                    // Extraction de la date
                    let date = '';
                    const dateSelectors = ['.date', '.time', '.mail-date'];
                    
                    for (const sel of dateSelectors) {
                        const dateEl = el.querySelector(sel);
                        if (dateEl && dateEl.textContent.trim()) {
                            date = dateEl.textContent.trim();
                            break;
                        }
                    }
                    
                    if (!date) {
                        const dateMatch = text.match(/\d{2}[\/-]\d{2}[\/-]\d{4}/) || 
                                        text.match(/\d{2}:\d{2}/) ||
                                        text.match(/(Aujourd'hui|Hier|Il y a \d+)/);
                        date = dateMatch ? dateMatch[0] : 'Date inconnue';
                    }
                    
                    // Extraction du preview
                    let preview = '';
                    const previewSelectors = ['.preview', '.snippet', '.mail-preview', 'p'];
                    
                    for (const sel of previewSelectors) {
                        const previewEl = el.querySelector(sel);
                        if (previewEl && previewEl.textContent.trim().length > 10) {
                            preview = previewEl.textContent.trim().substring(0, 150);
                            break;
                        }
                    }
                    
                    if (!preview) {
                        const cleanText = text.replace(/\s+/g, ' ').trim();
                        const subjectIndex = cleanText.indexOf(subject);
                        if (subjectIndex >= 0) {
                            preview = cleanText.substring(subjectIndex + subject.length).trim().substring(0, 150);
                        } else {
                            preview = cleanText.substring(0, 150);
                        }
                    }
                    
                    results.push({
                        id: `email-${index}-${Date.now()}`,
                        subject: subject.substring(0, 100) || 'Sans objet',
                        from: from.substring(0, 50),
                        date: date.substring(0, 30),
                        preview: preview.substring(0, 150) + '...',
                        isUnread: Boolean(isUnread),
                        timestamp: new Date().toISOString()
                    });
                    
                } catch (err) {
                    console.error(`Erreur extraction email ${index}:`, err.message);
                }
            });
            
            return results;
        });
        
        // 6. Sauvegarder les résultats
        const data = {
            lastUpdate: new Date().toISOString(),
            emailCount: emails.length,
            emails: emails
        };
        
        fs.writeFileSync('emails.json', JSON.stringify(data, null, 2));
        console.log(`✅ ${emails.length} emails sauvegardés dans emails.json`);
        
        return emails;
        
    } catch (error) {
        console.error('❌ Erreur lors du scraping:', error);
        
        // Créer un fichier d'erreur
        const errorData = {
            lastUpdate: new Date().toISOString(),
            emailCount: 0,
            error: error.message,
            emails: []
        };
        
        fs.writeFileSync('emails.json', JSON.stringify(errorData, null, 2));
        
    } finally {
        await browser.close();
        console.log('🏁 Scraping terminé');
    }
}

// Exécution
scrapeLaposteEmails().then(emails => {
    console.log(`📊 Résultat: ${emails?.length || 0} emails récupérés`);
    process.exit(0);
}).catch(error => {
    console.error('💥 Erreur fatale:', error);
    process.exit(1);
});
