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
            '--disable-gpu',
            '--window-size=1280,720'
        ]
    });
    
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.setViewport({ width: 1280, height: 720 });
    
    try {
        // 1. Connexion
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
        
        console.log('🔘 Validation email...');
        let clicked = await clickButtonByText(page, 'Suivant') || await clickButtonByText(page, 'Continuer') || await clickButtonByText(page, 'Valider');
        if (!clicked) {
            const submitBtn = await page.$('button[type="submit"], input[type="submit"]');
            if (submitBtn) await submitBtn.click();
            else await page.keyboard.press('Enter');
        }
        await wait(3000);
        
        console.log('🔐 Saisie mot de passe...');
        let passwordInput = await page.$('input[type="password"]');
        if (!passwordInput) {
            await page.waitForSelector('input[type="password"]', { timeout: 10000 });
            passwordInput = await page.$('input[type="password"]');
        }
        if (!passwordInput) throw new Error('Champ mot de passe introuvable');
        await passwordInput.type(process.env.LAPOSTE_PASSWORD);
        
        console.log('🔘 Connexion finale...');
        let submitted = await clickButtonByText(page, 'Connexion') || await clickButtonByText(page, 'Se connecter');
        if (!submitted) {
            const submitBtn = await page.$('button[type="submit"], input[type="submit"]');
            if (submitBtn) await submitBtn.click();
            else await page.keyboard.press('Enter');
        }
        
        console.log('⏳ Attente de la boîte mail...');
        await wait(10000);
        
        // 2. Masquer les éléments parasites
        console.log('🧹 Nettoyage de l\'interface...');
        await page.evaluate(() => {
            // Masquer barres de navigation, menus, dossiers, pubs
            const hideSelectors = [
                'nav', 'header', '.sidebar', '.left-panel', '.folder-list',
                '.navigation', '.menu', '[role="navigation"]', '#side-menu',
                '.advertisement', '.pub', '.banner', '[class*="ad-"]',
                '.toolbar', '.action-bar', '.search-bar',
                '.mail-footer', '.signature', '.disclaimer'
            ];
            hideSelectors.forEach(sel => {
                document.querySelectorAll(sel).forEach(el => {
                    el.style.display = 'none';
                    el.style.visibility = 'hidden';
                    el.style.height = '0';
                    el.style.overflow = 'hidden';
                });
            });
            
            // Réduire les marges et paddings de la zone principale
            const mainArea = document.querySelector('[role="main"], .main-content, #main, .content');
            if (mainArea) {
                mainArea.style.margin = '0';
                mainArea.style.padding = '4px';
            }
            
            // Forcer une police plus petite pour voir plus de texte
            document.querySelectorAll('.email-subject, .subject, .message-subject').forEach(el => {
                el.style.fontSize = '12px';
                el.style.lineHeight = '1.2';
            });
            document.querySelectorAll('.email-preview, .snippet, .preview, .message-body').forEach(el => {
                el.style.fontSize = '11px';
                el.style.lineHeight = '1.3';
            });
            document.querySelectorAll('.email-sender, .from, .sender').forEach(el => {
                el.style.fontSize = '10px';
            });
            
            // Supprimer les icônes et décorations inutiles
            document.querySelectorAll('.email-icon, .avatar, .star, .flag, .attachment-icon').forEach(el => {
                el.style.display = 'none';
            });
        });
        
        await wait(1000);
        
        // 3. Trouver la zone des emails
        console.log('📸 Recherche de la zone des emails...');
        
        const emailZoneSelectors = [
            '#messages-list', '.messages-list', '.email-list', '#mail-list',
            '[data-testid="mail-list"]', '.mails-list', '#inbox-list',
            'div[class*="list"]', 'div[class*="messages"]', '[role="main"]',
            '.message-container', '.email-container'
        ];
        
        let emailZone = null;
        for (const sel of emailZoneSelectors) {
            emailZone = await page.$(sel);
            if (emailZone) {
                console.log(`✅ Zone emails trouvée : ${sel}`);
                break;
            }
        }
        
        if (!emailZone) {
            // Fallback : chercher un div qui contient plusieurs @
            const divs = await page.$$('div');
            for (const div of divs) {
                const text = await div.evaluate(el => el.textContent);
                const atCount = (text.match(/@/g) || []).length;
                if (atCount >= 3) {
                    emailZone = div;
                    console.log('✅ Zone emails trouvée par comptage @');
                    break;
                }
            }
        }
        
        // 4. Capture de la zone emails
        if (emailZone) {
            // Récupérer les dimensions et la position
            const box = await emailZone.boundingBox();
            if (box) {
                // Calculer une zone 16:9 autour des 5 premiers emails
                // Hauteur estimée : 5 emails × ~80px = 400px
                const targetHeight = Math.min(box.height, 400);
                const targetWidth = Math.round(targetHeight * 16 / 9);
                
                // Limiter à la largeur de la zone
                const width = Math.min(targetWidth, box.width);
                const height = Math.round(width * 9 / 16);
                
                const clip = {
                    x: box.x,
                    y: box.y,
                    width: width,
                    height: height
                };
                
                console.log(`📸 Capture : ${clip.width}x${clip.height} (16:9)`);
                await page.screenshot({
                    path: 'screenshot.png',
                    clip: clip
                });
            } else {
                // Fallback : screenshot de l'élément
                await emailZone.screenshot({ path: 'screenshot.png' });
                console.log('📸 Capture de l\'élément complet');
            }
        } else {
            // Dernier recours : capture pleine page
            await page.screenshot({ path: 'screenshot.png', fullPage: false });
            console.log('⚠️ Capture pleine page (zone non trouvée)');
        }
        
        console.log('✅ Capture sauvegardée');
        
        // 5. Extraire les 5 emails pour latest_5.json
        console.log('📧 Extraction des 5 derniers emails...');
        const emails = await page.evaluate(() => {
            const clean = (s) => s.replace(/\s+/g, ' ').trim();
            const rows = [];
            
            const selectors = [
                'div[class*="msg"]', 'div[class*="mail-item"]', 'div[class*="message-item"]',
                'tr[class*="mail"]', 'tr[class*="msg"]', 'li[class*="mail"]', 'li[class*="msg"]'
            ];
            for (const sel of selectors) {
                const nodes = document.querySelectorAll(sel);
                if (nodes.length >= 2) { rows.push(...Array.from(nodes)); break; }
            }
            if (rows.length === 0) {
                const all = document.querySelectorAll('div, tr, li');
                rows.push(...Array.from(all).filter(el => {
                    return el.children.length >= 2 && el.textContent.includes('@') && el.offsetHeight > 25 && el.offsetHeight < 200;
                }));
            }
            
            const filtered = rows.filter(el => {
                const t = el.textContent || '';
                return !/Boîte de réception|Dossiers|Menu|Paramètres|Agenda|Contacts|Écrire un mail|Liste de mails|Sélection|Marquer tout comme lu|Vider le dossier|k-error/i.test(t);
            });
            
            const results = [];
            for (const el of filtered) {
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
                    
                    let preview = '';
                    const previewEl = el.querySelector('[class*="preview"], [class*="snippet"], [class*="body"], p');
                    if (previewEl) preview = clean(previewEl.textContent);
                    else {
                        let cleanText = text.replace(subject, '').replace(from, '');
                        cleanText = cleanText.replace(/\d{2}\/\d{2}\/\d{4}/g, '').replace(/\d{2}:\d{2}/g, '').trim();
                        preview = clean(cleanText).substring(0, 80);
                    }
                    
                    results.push({ from, subject, preview });
                    if (results.length >= 5) break;
                } catch (e) {}
            }
            return results.slice(0, 5);
        });
        
        const data = {
            lastUpdate: new Date().toISOString(),
            emails: emails
        };
        fs.writeFileSync('latest_5.json', JSON.stringify(data));
        console.log(`✅ ${emails.length} emails extraits`);
        
    } catch (error) {
        console.error('❌ Erreur:', error.message);
        fs.writeFileSync('latest_5.json', JSON.stringify({ lastUpdate: new Date().toISOString(), emails: [], error: error.message }));
        try { await page.screenshot({ path: 'screenshot.png' }); } catch(e) {}
    } finally {
        await browser.close();
        console.log('🏁 Terminé');
    }
}

scrapeLaposteEmails();
