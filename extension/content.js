(() => {
  const API_BASE_EVENTS = 'https://metapolymarket-140799832958.us-east5.run.app/api/polymarket/events';
  const API_PICKS = 'https://metapolymarket-140799832958.us-east5.run.app/api/picks/today';
  const API_FIND = 'https://metapolymarket-140799832958.us-east5.run.app/api/picks/find';
  const API_ANALYZE = 'https://metapolymarket-140799832958.us-east5.run.app/api/analyze';
  
  const CACHE_EVENT = new Map(); 
  const CACHE_ANALYSIS = new Map(); 
  const PENDING_LOOKUPS = new Set(); 

  const CONFIG = {
    domScanInterval: 1000,
  };

  // --- Gestionnaire Global ---
  document.addEventListener('click', (e) => {
      // Gestionnaire pour la fermeture modale uniquement ici
      // Les clics boutons sont gérés par les événements injectés avec logique "Link Disabler"
      if (e.target.closest('.polytrader-modal-close') || e.target.classList.contains('polytrader-backdrop')) {
          const backdrop = document.querySelector('.polytrader-backdrop');
          if (backdrop) backdrop.remove();
          e.preventDefault();
          e.stopPropagation();
      }
  }, true);

  // --- Fonctions ---

  const getSlugFromUrl = (url) => {
    if (!url) return null;
    const match = url.match(/\/(?:event|market|markets|e)\/([^/?#]+)/);
    return match ? match[1] : null;
  };

  const loadDailyPicks = async () => {
    try {
        const res = await fetch(API_PICKS);
        if (!res.ok) return;
        const data = await res.json();
        if (Array.isArray(data.markets)) {
            data.markets.forEach(m => {
                if (m.slug) CACHE_ANALYSIS.set(m.slug, m);
            });
        }
    } catch (e) {}
  };

  const lookupAnalysis = async (slug, element) => {
    if (PENDING_LOOKUPS.has(slug) || CACHE_ANALYSIS.has(slug)) return;
    PENDING_LOOKUPS.add(slug);

    let found = false;
    try {
        const res = await fetch(`${API_FIND}?slug=${slug}`);
        if (res.ok) {
            const analysis = await res.json();
            if (analysis && analysis.title) {
                CACHE_ANALYSIS.set(slug, analysis);
                if (document.body.contains(element)) {
                    injectOverlay(element, analysis, slug);
                    updateBadge();
                }
                found = true;
            }
        }
    } catch (e) {
    } finally {
        PENDING_LOOKUPS.delete(slug);
        if (!found && document.body.contains(element)) {
            injectAnalyzeButton(element, slug);
        }
    }
  };

  const fetchEventData = async (slug) => {
    if (CACHE_EVENT.has(slug)) return CACHE_EVENT.get(slug);
    try {
      const res = await fetch(`${API_BASE_EVENTS}?slug=${slug}`);
      if (!res.ok) return null;
      const data = await res.json();
      const event = Array.isArray(data) ? data[0] : data;
      if (event) CACHE_EVENT.set(slug, event);
      return event;
    } catch (e) { return null; }
  };

  const manualAnalyze = async (slug, element) => {
    const btn = element.querySelector('.polytrader-btn');
    if (btn) {
        btn.innerHTML = `<span class="polytrader-pred" style="font-size:11px; color:#ccc;">Analyzing...</span>`;
        btn.style.cursor = 'wait';
    }

    const event = await fetchEventData(slug);
    if (!event || !event.markets) return;
    const market = event.markets.find(m => m.active) || event.markets[0];
    
    try {
        const prices = Array.isArray(market.outcomePrices) 
            ? market.outcomePrices.map(Number) 
            : JSON.parse(market.outcomePrices || '[]').map(Number);
        
        const marketProb = prices[0] || 0.5;
        const volume = Number(market.volume || 0);

        const payload = {
            title: market.question,
            outcomes: JSON.parse(market.outcomes || '["Yes", "No"]'),
            marketProb,
            volume
        };

        const res = await fetch(API_ANALYZE, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (res.ok) {
            const analysis = await res.json();
            CACHE_ANALYSIS.set(slug, analysis);
            injectOverlay(element, analysis, slug);
            openModal(analysis);
        } else {
             if (btn) btn.innerHTML = `<span class="polytrader-pred" style="font-size:11px; color:#ef4444;">Error</span>`;
        }
    } catch (e) {
        if (btn) btn.innerHTML = `<span class="polytrader-pred" style="font-size:11px; color:#ef4444;">Failed</span>`;
    }
  };

  // --- UI ---

  const openModal = (analysis) => {
    const existing = document.querySelector('.polytrader-backdrop');
    if (existing) existing.remove();

    const { title, prediction, confidence, reasoning, kellyPercentage, aiProb, marketProb, riskFactor, outcomes } = analysis;
    const color = (kellyPercentage > 0) ? '#34d399' : '#fbbf24';
    
    let edgeVal = 0;
    if (prediction === outcomes[0]) {
       edgeVal = aiProb - marketProb;
    } else {
       edgeVal = (1 - aiProb) - (1 - marketProb);
    }
    const edgePct = (edgeVal * 100).toFixed(1);

    const backdrop = document.createElement('div');
    backdrop.className = 'polytrader-backdrop';
    backdrop.onclick = (e) => {
        if (e.target === backdrop) backdrop.remove();
    };
    
    backdrop.innerHTML = `
        <div class="polytrader-modal">
            <div class="polytrader-modal-header">
                <div style="flex:1">
                    <h2 class="pt-h2">${title || 'Market Analysis'}</h2>
                    <div class="pt-meta">Powered by Meta-Oracle • Gemma 2</div>
                </div>
                <button class="polytrader-modal-close" type="button">×</button>
            </div>
            <div class="polytrader-modal-content">
                <div class="pt-grid">
                    <div class="pt-stat" style="border-color:${color}40; background:${color}10;">
                        <span class="pt-label" style="color:${color}">Prediction</span>
                        <span class="pt-value" style="color:${color}">${prediction}</span>
                    </div>
                    <div class="pt-stat">
                        <span class="pt-label">Confidence</span>
                        <span class="pt-value">${confidence}/10</span>
                    </div>
                    <div class="pt-stat">
                        <span class="pt-label">Kelly Stake</span>
                        <span class="pt-value" style="color:${kellyPercentage > 0 ? '#34d399' : '#fff'}">${kellyPercentage}%</span>
                    </div>
                    <div class="pt-stat">
                        <span class="pt-label">Edge</span>
                        <span class="pt-value" style="color:${edgeVal > 0 ? '#34d399' : '#ef4444'}">${edgeVal > 0 ? '+' : ''}${edgePct}%</span>
                    </div>
                </div>
                <div class="pt-reasoning">
                    <strong style="color:#fff;display:block;margin-bottom:8px;">Meta-Oracle Analysis</strong>
                    ${reasoning}
                    ${riskFactor ? `<div style="margin-top:12px;font-size:12px;opacity:0.8;border-top:1px solid rgba(255,255,255,0.1);padding-top:8px;">
                        <strong style="color:#f87171">Risk Factor:</strong> ${riskFactor}
                    </div>` : ''}
                </div>
            </div>
            <div class="polytrader-modal-footer">
                <a href="https://metapolymarket.com" target="_blank" style="color:#00fa9a;text-decoration:none;">View on MetaPolymarket</a> for full history
            </div>
        </div>
    `;

    const closeBtn = backdrop.querySelector('.polytrader-modal-close');
    closeBtn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        backdrop.remove();
    };

    (document.body || document.documentElement).appendChild(backdrop);
  };

  // --- Helper: Link Disabler ---
  // Désactive temporairement le pointer-events sur les ancêtres pour permettre le clic
  const setupClickInterception = (button, action) => {
      button.addEventListener('mouseenter', () => {
          // Trouver le lien parent
          const parentLink = button.closest('a');
          if (parentLink) {
              parentLink.style.pointerEvents = 'none'; // Désactive le lien parent
              button.style.pointerEvents = 'auto'; // Réactive le bouton (qui hériterait sinon)
          }
      });

      button.addEventListener('mouseleave', () => {
          const parentLink = button.closest('a');
          if (parentLink) {
              parentLink.style.pointerEvents = ''; // Rétablit
          }
      });

      button.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
          action();
          return false;
      }, true);
  };

  const injectOverlay = (element, analysis, slug, isLoading = false) => {
    const existing = element.querySelector('.polytrader-overlay');
    if (existing) existing.remove();
    
    if (window.getComputedStyle(element).position === 'static') {
        element.style.position = 'relative';
    }

    const overlay = document.createElement('div');
    overlay.className = 'polytrader-overlay';
    if (slug) overlay.dataset.slug = slug;
    
    if (isLoading) {
        overlay.innerHTML = `<span class="polytrader-pred" style="font-size:11px; color:#ccc;">Analyzing...</span>`;
        element.appendChild(overlay);
        return;
    }

    const { prediction, confidence, kellyPercentage } = analysis;
    const color = (kellyPercentage > 0) ? '#00fa9a' : '#fbbf24'; 
    const borderColor = (kellyPercentage > 0) ? 'rgba(0, 250, 154, 0.4)' : 'rgba(251, 191, 36, 0.4)';

    overlay.style.borderColor = borderColor;
    overlay.innerHTML = `
        <span class="polytrader-pred" style="color:${color}">${prediction}</span>
        <span class="polytrader-score">${confidence}/10</span>
    `;
    
    // Attacher l'interception intelligente
    setupClickInterception(overlay, () => openModal(analysis));
    
    element.appendChild(overlay);
  };

  const injectAnalyzeButton = (element, slug) => {
    const existing = element.querySelector('.polytrader-overlay');
    if (existing) return; 
    
    if (window.getComputedStyle(element).position === 'static') {
        element.style.position = 'relative';
    }

    const btn = document.createElement('div');
    btn.className = 'polytrader-overlay polytrader-btn';
    if (slug) btn.dataset.slug = slug;
    
    btn.innerHTML = `
         <span class="polytrader-pred" style="font-size:11px; color:#94a3b8; font-weight:600;">✨ Analyze AI</span>
    `;
    
    setupClickInterception(btn, () => manualAnalyze(slug, element));
    
    element.appendChild(btn);
  };

  const processCard = async (element, slug) => {
    const analysis = CACHE_ANALYSIS.get(slug);
    if (analysis) {
        injectOverlay(element, analysis, slug);
        element.dataset.polytraderProcessed = 'true';
        updateBadge();
        return;
    }
    if (element.dataset.polytraderLookup !== 'true') {
        element.dataset.polytraderLookup = 'true';
        lookupAnalysis(slug, element);
    }
    element.dataset.polytraderProcessed = 'true';
  };

  const updateBadge = () => {
    const count = document.querySelectorAll('.polytrader-overlay').length;
    try { chrome.runtime.sendMessage({ type: 'UPDATE_BADGE', count }); } catch(e){}
  };

  const scanPage = () => {
    const links = document.querySelectorAll('a[href*="/event/"], a[href*="/market/"], a[href*="/e/"]');
    
    links.forEach(link => {
        const href = link.getAttribute('href');
        const match = href.match(/\/(?:event|market|markets|e)\/([^/?#]+)/);
        if (!match) return;
        const slug = match[1];

        let card = link;
        let depth = 0;
        let foundCard = false;

        while (depth < 6 && card.parentElement) {
            const p = card.parentElement;
            const rect = p.getBoundingClientRect();
            if (rect.width > 150 && rect.width < 800 && rect.height > 80 && rect.height < 600) {
                const otherLinks = p.querySelectorAll('a[href*="/event/"]');
                let hasOtherSlugs = false;
                otherLinks.forEach(l => {
                    const m = l.getAttribute('href')?.match(/\/(?:event|market|markets|e)\/([^/?#]+)/);
                    if (m && m[1] !== slug) hasOtherSlugs = true;
                });
                if (!hasOtherSlugs) {
                    card = p;
                    foundCard = true;
                }
            }
            if (foundCard) break;
            card = p;
            depth++;
        }

        if (!foundCard) {
             const r = link.getBoundingClientRect();
             if (r.width > 50 && r.height > 30) card = link;
             else return; 
        }

        if (card.dataset.polytraderProcessed === 'true') return;
        if (card.querySelector('.polytrader-overlay')) return;

        processCard(card, slug);
    });
  };

  console.log('[PolyTrader] Started...');
  loadDailyPicks().then(() => {
      scanPage();
      setInterval(scanPage, CONFIG.domScanInterval);
  });
})();
