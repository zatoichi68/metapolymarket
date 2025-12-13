document.addEventListener('DOMContentLoaded', () => {
    const countEl = document.getElementById('scan-count');

    // On demande le badge actuel au background (via l'API action.getBadgeText qui n'est pas dispo facilement ici pour l'onglet actif sans permission complexe parfois, 
    // ou plus simple : on demande au content script de nous renvoyer l'état actuel).
    
    // Le plus simple : interroger le background qui stocke l'état ? Non, le background est stateless ici sauf message.
    // On va envoyer un message au content script de l'onglet actif.
    
    chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
        if (!tabs[0]) return;
        
        // On peut juste récupérer le badge text si on avait accès, mais ici on va tricher
        // En demandant au background le badge text de cet onglet
        chrome.action.getBadgeText({ tabId: tabs[0].id }, (text) => {
            countEl.textContent = text || '0';
        });
    });
});
