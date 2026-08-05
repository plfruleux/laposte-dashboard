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
    await page.setViewport({ width: 1600, height: 1200 });
    
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
        await wait(12000);

        // 2. Nettoyage de l'interface
        console.log('🧹 Nettoyage de l\'interface...');
        await page.evaluate(() => {
            const hideSelectors = [
                'nav', 'header', '.sidebar', '.left-panel', '.folder-list',
                '.navigation', '.menu', '[role="navigation"]', '#side-menu',
                '.advertisement', '.pub', '.banner', '[class*="ad-"]',
                '.toolbar', '.action-bar', '.search-bar',
                '.mail-footer', '.signature', '.disclaimer',
                '.compose-btn', '.write-btn', '.new-message',
                '.pagination', '.page-nav',
                'footer'
            ];
            hideSelectors.forEach(sel => {
                document.querySelectorAll(sel).forEach(el => {
                    el.style.display = 'none';
                });
            });

            const style = document.createElement('style');
            style.textContent = `
                .email-row, .message-item, .mail-item, tr[class*="mail"], tr[class*="msg"],
                div[class*="mail-item"], div[class*="message-item"], div[class*="msg"] {
                    padding: 2px 4px !important;
                    margin: 0 !important;
                    line-height: 1.2 !important;
                    height: auto !important;
                    min-height: 0 !important;
                    border-bottom: 1px solid rgba(0,0,0,0.05) !important;
                }
                .email-sender, .from, .sender, [class*="from"], [class*="sender"] {
                    font-size: 11px !important;
                    margin: 0 !important;
                }
                .email-subject, .subject, [class*="subject"], [class*="objet"] {
                    font-size: 12px !important;
                    margin: 0 !important;
                }
                .email-preview, .snippet, .preview, .body-preview, [class*="preview"], [class*="body"] {
                    font-size: 10px !important;
                    line-height: 1.2 !important;
                    margin: 0 !important;
                }
                /* Garder la date visible et plus grosse */
                .email-date, .date, .time, [class*="date"], [class*="time"] {
                    font-size: 10px !important;
                    color: #666 !important;
                    white-space: nowrap !important;
                }
                .email-icon, .avatar, .star, .flag, .attachment-icon, .checkbox, .favorite {
                    display: none !important;
                }
            `;
            document.head.appendChild(style);
        });
        
        await wait(1000);

        // 3. Identification des lignes d'emails
        console.log('🔍 Identification des 5 premières lignes...');
        const rowsInfo = await page.evaluate(() => {
            const selectors = [
                'tr[class*="mail"]', 'tr[class*="msg"]', 'tr[class*="message"]',
                'div[class*="mail-item"]', 'div[class*="message-item"]', 'div[class*="msg-item"]',
                'li[class*="mail"]', 'li[class*="msg"]', 'li[class*="message"]'
            ];
            let rows = [];
            for (const sel of selectors) {
                const nodes = document.querySelectorAll(sel);
                if (nodes.length > 2) {
                    rows = Array.from(nodes);
                    break;
                }
            }
            if (rows.length === 0) {
                const all = document.querySelectorAll('div, tr, li');
                rows = Array.from(all).filter(el => {
                    const text = el.textContent || '';
                    return text.includes('@') && el.children.length >= 2 && el.offsetHeight > 25 && el.offsetHeight < 200;
                });
            }
            rows = rows.filter(el => {
                const t = el.textContent || '';
                return !/Boîte de réception|Dossiers|Menu|Paramètres|Agenda|Contacts|Écrire un mail|Liste de mails|Sélection|Marquer tout comme lu|Vider le dossier|k-error/i.test(t);
            });
            const firstFive = rows.slice(0, 5);
            const positions = firstFive.map(el => {
                const rect = el.getBoundingClientRect();
                return {
                    top: rect.top,
                    bottom: rect.bottom,
                    left: rect.left,
                    right: rect.right,
                    width: rect.width,
                    height: rect.height
                };
            });
            return positions;
        });

        if (rowsInfo.length === 0) throw new Error('Aucune ligne d\'email trouvée');
        console.log(`✅ ${rowsInfo.length} lignes identifiées`);

        // 4. Capture 16:9
        const firstRowTop = rowsInfo[0].top;
        const lastRowBottom = rowsInfo[rowsInfo.length - 1].bottom;
        const rowHeight = lastRowBottom - firstRowTop;
        const margin = 15;
        const captureHeight = rowHeight + margin * 2;
        const captureWidth = Math.round(captureHeight * 16 / 9);
        const minLeft = Math.min(...rowsInfo.map(r => r.left));
        const maxRight = Math.max(...rowsInfo.map(r => r.right));
        const centerX = (minLeft + maxRight) / 2;
        const captureLeft = Math.max(0, centerX - captureWidth / 2);
        const captureTop = firstRowTop - margin;

        const clip = {
            x: captureLeft,
            y: Math.max(0, captureTop),
            width: Math.min(captureWidth, 1600 - captureLeft),
            height: captureHeight
        };

        console.log(`📸 Capture : x=${clip.x}, y=${clip.y}, w=${clip.width}, h=${clip.height}`);
        await page.screenshot({ path: 'screenshot.png', clip: clip });
        console.log('📸 Capture 16:9 sauvegardée');

        // 5. Extraction des données texte (avec date)
        console.log('📧 Extraction des données...');
        const emails = await page.evaluate(() => {
            const clean = (s) => s.replace(/\s+/g, ' ').trim();
            const results = [];
            const selectors = [
                'div[class*="msg"]', 'div[class*="mail-item"]', 'div[class*="message-item"]',
                'tr[class*="mail"]', 'tr[class*="msg"]', 'li[class*="mail"]', 'li[class*="msg"]'
            ];
            let rows = [];
            for (const sel of selectors) {
                const nodes = document.querySelectorAll(sel);
                if (nodes.length >= 2) { rows = Array.from(nodes); break; }
            }
            if (rows.length === 0) {
                const all = document.querySelectorAll('div, tr, li');
                rows = Array.from(all).filter(el => {
                    return el.children.length >= 2 && el.textContent.includes('@') && el.offsetHeight > 25 && el.offsetHeight < 200;
                });
            }
            rows = rows.filter(el => {
                const t = el.textContent || '';
                return !/Boîte de réception|Dossiers|Menu|Paramètres|Agenda|Contacts|Écrire un mail|Liste de mails|Sélection|Marquer tout comme lu|Vider le dossier|k-error/i.test(t);
            });
            
            for (const el of rows.slice(0, 5)) {
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
                    
                    // Date : chercher un élément spécifique ou une correspondance dans le texte
                    let date = '';
                    const dateEl = el.querySelector('[class*="date"], [class*="time"], .date, .time');
                    if (dateEl) date = clean(dateEl.textContent);
                    else {
                        // Chercher HH:MM ou JJ/MM/AAAA ou Aujourd'hui/Hier
                        const m = text.match(/(\d{2}:\d{2})/) || text.match(/(\d{2}\/\d{2}\/\d{4})/) || text.match(/(Aujourd'hui|Hier)/i);
                        date = m ? m[1] : '';
                    }
                    
                    let preview = '';
                    const previewEl = el.querySelector('[class*="preview"], [class*="snippet"], [class*="body"], p');
                    if (previewEl) preview = clean(previewEl.textContent);
                    else {
                        let cleanText = text.replace(subject, '').replace(from, '').replace(date, '');
                        cleanText = cleanText.replace(/\d{2}\/\d{2}\/\d{4}/g, '').replace(/\d{2}:\d{2}/g, '').trim();
                        preview = clean(cleanText).substring(0, 80);
                    }
                    
                    results.push({ from, subject, date, preview });
                } catch (e) {}
            }
            return results;
        });
        
        const data = {
            lastUpdate: new Date().toISOString(),
            emails: emails
        };
        fs.writeFileSync('latest_5.json', JSON.stringify(data));
        console.log(`✅ ${emails.length} emails extraits avec date`);
        
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
